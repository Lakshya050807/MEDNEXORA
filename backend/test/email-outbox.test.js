import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailDeliveryOutbox } from '../src/services/emailDeliveryOutbox.js';
import { createFakeEmailOutboxModel } from './helpers/fakeEmailOutbox.js';
import { registrationOtpDigest } from '../src/services/registrationVerification.js';

const resetPepper = 'outbox-password-reset-test-pepper-at-least-32-bytes';
const registrationPepper = 'outbox-registration-test-pepper-at-least-32-bytes';
const startTime = new Date('2026-11-19T10:00:00.000Z');

function compare(a, b) {
  const left = a instanceof Date ? a.getTime() : a;
  const right = b instanceof Date ? b.getTime() : b;
  return left < right ? -1 : left > right ? 1 : 0;
}

function matchesValue(actual, exists, expected) {
  if (expected && typeof expected === 'object' && !(expected instanceof Date) && !Array.isArray(expected)) {
    return Object.entries(expected).every(([operator, operand]) => {
      if (operator === '$exists') return exists === operand;
      if (operator === '$gt') return exists && compare(actual, operand) > 0;
      if (operator === '$gte') return exists && compare(actual, operand) >= 0;
      if (operator === '$lt') return exists && compare(actual, operand) < 0;
      if (operator === '$lte') return exists && compare(actual, operand) <= 0;
      if (operator === '$ne') return !exists || actual !== operand;
      if (operator === '$in') return operand.includes(actual);
      if (operator === '$elemMatch') return Array.isArray(actual) && actual.some((entry) => matches(entry, operand));
      return false;
    });
  }
  return exists && (actual === expected || (actual instanceof Date && expected instanceof Date && actual.getTime() === expected.getTime()));
}

function matches(document, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some((item) => matches(document, item));
    if (key === '$and') return expected.every((item) => matches(document, item));
    const exists = Object.hasOwn(document, key);
    return matchesValue(document[key], exists, expected);
  });
}

function apply(document, update) {
  for (const [key, value] of Object.entries(update.$set ?? {})) document[key] = value instanceof Date ? new Date(value) : value;
  for (const [key, amount] of Object.entries(update.$inc ?? {})) document[key] = Number(document[key] ?? 0) + amount;
  for (const key of Object.keys(update.$unset ?? {})) delete document[key];
}

function createModels() {
  const users = new Map();
  const challenges = new Map();
  class UserModel {
    static findOne(filter) {
      const doc = [...users.values()].find((value) => matches(value, filter)) ?? null;
      const query = {
        select() { return this; },
        readConcern() { return this; },
        then(resolve, reject) { return Promise.resolve(doc).then(resolve, reject); },
      };
      return query;
    }
    static async exists(filter) { return [...users.values()].some((value) => matches(value, filter)) ? { _id: filter.email } : null; }
    static async updateOne(filter, update) {
      const doc = [...users.values()].find((value) => matches(value, filter));
      if (!doc) return { matchedCount: 0 };
      apply(doc, update);
      return { matchedCount: 1 };
    }
    static async updateMany(filter, update) {
      const docs = [...users.values()].filter((value) => matches(value, filter));
      docs.forEach((doc) => apply(doc, update));
      return { matchedCount: docs.length, modifiedCount: docs.length };
    }
  }
  class ChallengeModel {
    static findOne(filter) {
      const doc = [...challenges.values()].find((value) => matches(value, filter)) ?? null;
      return { select() { return Promise.resolve(doc ? structuredClone(doc) : null); }, readConcern() { return this; } };
    }
    static async updateOne(filter, update) {
      const doc = [...challenges.values()].find((value) => matches(value, filter));
      if (!doc) return { matchedCount: 0 };
      apply(doc, update);
      return { matchedCount: 1 };
    }
    static async create(value) {
      if (challenges.has(value.email)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      const doc = structuredClone(value);
      challenges.set(doc.email, doc);
      return doc;
    }
  }
  return { users, challenges, UserModel, ChallengeModel };
}

function createService({ OutboxModel, UserModel, ChallengeModel, provider, clock, logger = { error() {} } }) {
  return createEmailDeliveryOutbox({
    OutboxModel,
    UserModel,
    ChallengeModel,
    emailProvider: provider,
    passwordResetEmailProvider: provider,
    registrationEmailProvider: provider,
    passwordResetOtpPepper: resetPepper,
    registrationOtpPepper: registrationPepper,
    passwordResetEmailEnabled: true,
    registrationEmailVerificationEnabled: true,
    registrationEnabled: true,
    now: clock,
    logger,
  });
}

test('encrypted Mongo outbox survives a worker restart and activates only after provider acceptance', async () => {
  const OutboxModel = createFakeEmailOutboxModel();
  const { users, UserModel, ChallengeModel } = createModels();
  const email = 'restart@example.test';
  const otp = '130579';
  users.set(email, { email, role: 'student', passwordResetOtpAttempts: 0, passwordResetOtpResendCount: 0 });
  let clock = new Date(startTime);
  const unusedProvider = { async send() { assert.fail('a stopped process must not deliver the job'); } };
  const stoppedProcess = createService({ OutboxModel, UserModel, ChallengeModel, provider: unusedProvider, clock: () => new Date(clock) });
  const queued = await stoppedProcess.enqueue({
    type: 'password-reset', payload: { email, otp }, expiresAt: new Date(clock.getTime() + 10 * 60_000),
  });
  const stored = OutboxModel.documents()[0];
  assert.equal(stored._id, queued.id);
  assert.equal(stored.status, 'queued');
  assert.ok(stored.payloadCiphertext);
  assert.equal(JSON.stringify(stored).includes(email), false);
  assert.equal(JSON.stringify(stored).includes(otp), false);

  const sent = [];
  const restartedProcess = createService({
    OutboxModel, UserModel, ChallengeModel,
    provider: { async send(message) { sent.push(message); return { sent: true }; } },
    clock: () => new Date(clock),
  });
  await restartedProcess.processDue();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, email);
  assert.match(sent[0].text, new RegExp(otp, 'u'));
  assert.equal(users.get(email).passwordResetOtpStatus, 'active');
  assert.equal(users.get(email).passwordResetOtpActivationConfirmed, true);
  assert.equal(OutboxModel.documents()[0].status, 'delivered');
  assert.equal(OutboxModel.documents()[0].payloadCiphertext, undefined);
});

test('two worker instances atomically claim a job once while another process holds provider delivery', async () => {
  const OutboxModel = createFakeEmailOutboxModel();
  const { users, UserModel, ChallengeModel } = createModels();
  const email = 'concurrent-workers@example.test';
  users.set(email, { email, role: 'student', passwordResetOtpAttempts: 0, passwordResetOtpResendCount: 0 });
  const clock = () => new Date(startTime);
  let signalStarted;
  let release;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  let sendCount = 0;
  const provider = { async send() { sendCount += 1; signalStarted(); await held; return { sent: true }; } };
  const firstWorker = createService({ OutboxModel, UserModel, ChallengeModel, provider, clock });
  const secondWorker = createService({ OutboxModel, UserModel, ChallengeModel, provider, clock });
  await firstWorker.enqueue({ type: 'password-reset', payload: { email, otp: '432109' }, expiresAt: new Date(startTime.getTime() + 600_000) });

  const firstPass = firstWorker.processDue();
  await started;
  await secondWorker.processDue();
  assert.equal(sendCount, 1, 'the persisted processing lease prevents a second instance from claiming the same job');
  release();
  await firstPass;
  assert.equal(users.get(email).passwordResetOtpActivationConfirmed, true);
  assert.equal(OutboxModel.documents()[0].attempts, 1);
});

test('provider failure retries with bounded exponential delay while the OTP stays pending and unusable', async () => {
  const OutboxModel = createFakeEmailOutboxModel();
  const { users, UserModel, ChallengeModel } = createModels();
  const email = 'retry@example.test';
  users.set(email, { email, role: 'student', passwordResetOtpAttempts: 0, passwordResetOtpResendCount: 0 });
  let clock = new Date(startTime);
  let sends = 0;
  const provider = { async send() { sends += 1; if (sends === 1) throw new Error('private provider detail'); return { sent: true }; } };
  const service = createService({ OutboxModel, UserModel, ChallengeModel, provider, clock: () => new Date(clock) });
  await service.enqueue({ type: 'password-reset', payload: { email, otp: '700123' }, expiresAt: new Date(clock.getTime() + 600_000) });
  await service.processDue();
  let job = OutboxModel.documents()[0];
  assert.equal(job.status, 'queued');
  assert.equal(job.attempts, 1);
  assert.equal(job.availableAt.getTime(), startTime.getTime() + 5_000);
  assert.equal(users.get(email).passwordResetOtpStatus, 'pending');
  assert.equal(users.get(email).passwordResetOtpActivationConfirmed, false);

  clock = new Date(job.availableAt);
  await service.processDue();
  job = OutboxModel.documents()[0];
  assert.equal(job.status, 'delivered');
  assert.equal(job.attempts, 2);
  assert.equal(sends, 2);
  assert.equal(users.get(email).passwordResetOtpActivationConfirmed, true);
});

test('maximum delivery attempts terminate the job and invalidate its pending reset challenge', async () => {
  const OutboxModel = createFakeEmailOutboxModel();
  const { users, UserModel, ChallengeModel } = createModels();
  const email = 'terminal@example.test';
  users.set(email, { email, role: 'student', passwordResetOtpAttempts: 0, passwordResetOtpResendCount: 0 });
  let sendCount = 0;
  const provider = { async send() { sendCount += 1; throw new Error('provider unavailable'); } };
  const service = createService({ OutboxModel, UserModel, ChallengeModel, provider, clock: () => new Date(startTime) });
  const queued = await service.enqueue({ type: 'password-reset', payload: { email, otp: '803216' }, expiresAt: new Date(startTime.getTime() + 600_000) });
  await OutboxModel.updateOne({ _id: queued.id }, { $set: { attempts: 7 } });
  await service.processDue();
  const job = OutboxModel.documents()[0];
  assert.equal(sendCount, 1);
  assert.equal(job.attempts, 8);
  assert.equal(job.status, 'failed');
  assert.equal(job.payloadCiphertext, undefined);
  assert.equal(users.get(email).passwordResetOtpHash, undefined);
  assert.equal(users.get(email).passwordResetOtpStatus, undefined);
});

test('expired retry jobs are removed from eligibility and cannot activate a pending code', async () => {
  const OutboxModel = createFakeEmailOutboxModel();
  const { users, UserModel, ChallengeModel } = createModels();
  const email = 'expiry-retry@example.test';
  users.set(email, { email, role: 'student', passwordResetOtpAttempts: 0, passwordResetOtpResendCount: 0 });
  let clock = new Date(startTime);
  let sendCount = 0;
  const provider = { async send() { sendCount += 1; throw new Error('provider unavailable'); } };
  const service = createService({ OutboxModel, UserModel, ChallengeModel, provider, clock: () => new Date(clock) });
  await service.enqueue({ type: 'password-reset', payload: { email, otp: '330126' }, expiresAt: new Date(startTime.getTime() + 600_000) });
  await service.processDue();
  assert.equal(users.get(email).passwordResetOtpStatus, 'pending');

  clock = new Date(startTime.getTime() + 600_001);
  await service.processDue();
  const job = OutboxModel.documents()[0];
  assert.equal(job.status, 'expired');
  assert.equal(job.payloadCiphertext, undefined);
  assert.equal(users.get(email).passwordResetOtpHash, undefined);
  assert.equal(users.get(email).passwordResetOtpStatus, undefined);
  assert.equal(sendCount, 1, 'an expired retry is finalized without another email send');
});

test('registration verification delivery persists only encrypted OTP/token payload and honors the registration challenge', async () => {
  const OutboxModel = createFakeEmailOutboxModel();
  const { users, challenges, UserModel, ChallengeModel } = createModels();
  const email = 'verify@example.test';
  const otp = '615204';
  const service = createService({
    OutboxModel, UserModel, ChallengeModel,
    provider: { async send(message) { assert.equal(message.to, email); assert.ok(message.text.includes(otp)); return { sent: true }; } },
    clock: () => new Date(startTime),
  });
  await service.enqueue({ type: 'registration-verification', payload: { email, otp }, expiresAt: new Date(startTime.getTime() + 600_000) });
  const queued = OutboxModel.documents()[0];
  assert.equal(JSON.stringify(queued).includes(email), false);
  assert.equal(JSON.stringify(queued).includes(otp), false);
  await service.processDue();
  const challenge = challenges.get(email);
  assert.equal(challenge.status, 'active');
  assert.equal(challenge.activationConfirmed, true);
  assert.equal(challenge.otpDigest, registrationOtpDigest(email, otp, registrationPepper));
});

test('expired password-reset metadata is atomically cleared without touching a newer challenge or resend controls', async () => {
  const OutboxModel = createFakeEmailOutboxModel();
  const { users, UserModel, ChallengeModel } = createModels();
  const expiredEmail = 'expired@example.test';
  const freshEmail = 'fresh@example.test';
  users.set(expiredEmail, {
    email: expiredEmail, role: 'student', passwordResetOtpHash: 'expired-digest',
    passwordResetOtpExpiresAt: new Date(startTime.getTime() - 1), passwordResetOtpStatus: 'pending',
    passwordResetOtpActivationConfirmed: false, passwordResetOtpAttempts: 2,
    passwordResetOtpLastSentAt: new Date(startTime.getTime() - 60_000),
    passwordResetOtpResendCount: 3, passwordResetOtpResendWindowStartedAt: new Date(startTime.getTime() - 30_000),
  });
  users.set(freshEmail, {
    email: freshEmail, role: 'student', passwordResetOtpHash: 'fresh-digest',
    passwordResetOtpExpiresAt: new Date(startTime.getTime() + 60_000), passwordResetOtpStatus: 'pending',
    passwordResetOtpResendCount: 1,
  });
  const service = createService({ OutboxModel, UserModel, ChallengeModel, provider: { async send() { return { sent: true }; } }, clock: () => new Date(startTime) });
  await service.processDue();
  const expired = users.get(expiredEmail);
  assert.equal(expired.passwordResetOtpHash, undefined);
  assert.equal(expired.passwordResetOtpExpiresAt, undefined);
  assert.equal(expired.passwordResetOtpResendCount, 3);
  assert.ok(expired.passwordResetOtpLastSentAt);
  assert.equal(users.get(freshEmail).passwordResetOtpHash, 'fresh-digest');
});

test('a delayed job cannot recreate a consumed reset or registration OTP challenge', async () => {
  const OutboxModel = createFakeEmailOutboxModel();
  const { users, challenges, UserModel, ChallengeModel } = createModels();
  let sendCount = 0;
  const provider = { async send() { sendCount += 1; return { sent: true }; } };
  const service = createService({ OutboxModel, UserModel, ChallengeModel, provider, clock: () => new Date(startTime) });

  const resetEmail = 'reset-consumed@example.test';
  users.set(resetEmail, {
    email: resetEmail, role: 'student', passwordResetOtpLastSentAt: new Date(startTime.getTime() - 120_000),
    passwordResetOtpResendWindowStartedAt: new Date(startTime.getTime() - 3_700_000),
    passwordResetOtpResendCount: 1,
  });
  const resetJob = await service.enqueue({ type: 'password-reset', payload: { email: resetEmail, otp: '240681' }, expiresAt: new Date(startTime.getTime() + 600_000) });
  const resetRow = OutboxModel.documents().find((row) => row._id === resetJob.id);
  users.get(resetEmail).passwordResetOtpDeliveryJobId = resetJob.id;
  users.get(resetEmail).passwordResetOtpDeliveryJobCreatedAt = new Date(resetRow.createdAt);
  resetRow.providerAcceptedAt = new Date(startTime);

  const registrationEmail = 'registration-consumed@example.test';
  const registrationJob = await service.enqueue({ type: 'registration-verification', payload: { email: registrationEmail, otp: '190247' }, expiresAt: new Date(startTime.getTime() + 600_000) });
  const registrationRow = OutboxModel.documents().find((row) => row._id === registrationJob.id);
  challenges.set(registrationEmail, {
    email: registrationEmail,
    status: 'consumed',
    deliveryJobId: registrationJob.id,
    deliveryJobCreatedAt: new Date(registrationRow.createdAt),
    lastSentAt: new Date(startTime.getTime() - 120_000),
    resendWindowStartedAt: new Date(startTime.getTime() - 3_700_000),
    resendCount: 1,
    expiresAt: new Date(startTime.getTime() + 600_000),
  });
  registrationRow.providerAcceptedAt = new Date(startTime);

  await service.processDue();
  assert.equal(users.get(resetEmail).passwordResetOtpHash, undefined);
  assert.equal(challenges.get(registrationEmail).otpDigest, undefined);
  assert.equal(OutboxModel.documents().find((row) => row._id === resetJob.id).status, 'suppressed');
  assert.equal(OutboxModel.documents().find((row) => row._id === registrationJob.id).status, 'suppressed');
  assert.equal(sendCount, 0);
});
