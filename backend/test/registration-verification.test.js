import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'registration-otp-test-session-secret-at-least-32-bytes';
process.env.APP_ORIGIN = 'http://localhost:5173';

const [{ createApp }, session, { default: RegistrationVerificationChallenge }, { registrationOtpDigest }, registrationTests] = await Promise.all([
  import('../src/app.js'),
  import('express-session'),
  import('../src/models/RegistrationVerificationChallenge.js'),
  import('../src/services/registrationVerification.js'),
  import('./helpers/registration.js'),
]);
const { FakeRegistrationRateLimitModel, resetRegistrationTestModels, testRegistrationPepper } = registrationTests;

const OTP_RE = /\b(\d{6})\b/u;
let docs;
let users;
let clock;
let sent;
let otp;
let failEmail;
let failCleanup;
let failActivation;
let activationCommitThenLoseAck;
let failActivationRollback;
let server;

function matches(doc, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$and') return expected.every((part) => matches(doc, part));
    if (key === '$or') return expected.some((part) => matches(doc, part));
    const actual = doc[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === '$exists') return Object.hasOwn(doc, key) === value;
        if (operator === '$gt') return actual > value;
        if (operator === '$lt') return actual < value;
        if (operator === '$lte') return actual <= value;
        return true;
      });
    }
    return actual instanceof Date && expected instanceof Date
      ? actual.getTime() === expected.getTime()
      : actual === expected;
  });
}

class ChallengeModel {
  static async create(value) {
    if (docs.has(value.email)) {
      const error = new Error('Duplicate key');
      error.code = 11000;
      throw error;
    }
    docs.set(value.email, { ...value });
    return value;
  }

  static findOne(filter) {
    const value = [...docs.values()].find((doc) => matches(doc, filter));
    return { select: async () => value ? { ...value } : null };
  }

  static async updateOne(filter, update) {
    const isActivation = filter.status === 'pending' && update.$set?.status === 'active';
    if (failActivation && isActivation) {
      failActivation = false;
      throw new Error('simulated activation failure');
    }
    if (failActivationRollback && filter.status === 'active' && filter.activationConfirmed === false
      && update.$set?.status === 'pending') throw new Error('simulated activation rollback failure');
    if (failCleanup && update.$unset?.otpDigest) throw new Error('simulated cleanup failure');
    const doc = docs.get(filter.email);
    if (!doc || !matches(doc, filter)) return { matchedCount: 0 };
    Object.assign(doc, update.$set);
    for (const [key, amount] of Object.entries(update.$inc ?? {})) doc[key] = (doc[key] ?? 0) + amount;
    for (const key of Object.keys(update.$unset ?? {})) delete doc[key];
    if (activationCommitThenLoseAck && isActivation) {
      activationCommitThenLoseAck = false;
      throw new Error('simulated lost activation acknowledgement after commit');
    }
    return { matchedCount: 1 };
  }
}

class UserModel {
  static async exists({ email }) { return users.has(email) ? { _id: email } : null; }
  static async create(data) {
    if (users.has(data.email)) {
      const error = new Error('duplicate');
      error.code = 11000;
      error.keyPattern = { email: 1 };
      throw error;
    }
    const user = { ...data, _id: data.email, id: data.email, createdAt: new Date(clock) };
    users.set(data.email, user);
    return user;
  }
}

async function start({ gate = true, enabled = true, provider } = {}) {
  const sender = provider ?? {
    async send(message) {
      sent += 1;
      otp = message.text.match(OTP_RE)?.[1] ?? null;
      if (failEmail) throw new Error('provider error must remain private');
      return { sent: true };
    },
  };
  const app = createApp({
    sessionStore: new session.MemoryStore(),
    UserModel,
    RegistrationVerificationChallengeModel: ChallengeModel,
    PasswordResetRateLimitModel: FakeRegistrationRateLimitModel,
    registrationEmailVerificationEnabled: enabled,
    registrationOtpPepper: testRegistrationPepper,
    registrationNow: () => new Date(clock),
    registrationEmailProvider: sender,
    launchConfig: { registrationEnabled: gate, paidPurchasesEnabled: false },
  });
  server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  return 'http://127.0.0.1:' + server.address().port;
}

async function post(base, path, body, origin = true) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(typeof origin === 'string' ? { Origin: origin } : origin ? { Origin: 'http://localhost:5173' } : {}) },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

const requestOtp = (base, email = 'student@example.test') => post(base, '/api/auth/registration/request-otp', { email });
const verifyOtp = (base, email = 'student@example.test', code = otp) => post(base, '/api/auth/registration/verify-otp', { email, otp: code });

beforeEach(() => {
  resetRegistrationTestModels();
  docs = new Map();
  users = new Map();
  clock = new Date('2026-11-19T06:00:00.000Z');
  sent = 0;
  otp = null;
  failEmail = false;
  failCleanup = false;
  failActivation = false;
  activationCommitThenLoseAck = false;
  failActivationRollback = false;
});

afterEach(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  server = null;
});

test('challenge schema hides digests and has unique-email plus TTL indexes', () => {
  assert.equal(RegistrationVerificationChallenge.schema.path('otpDigest').options.select, false);
  assert.equal(RegistrationVerificationChallenge.schema.path('verificationProofDigest').options.select, false);
  assert.equal(RegistrationVerificationChallenge.schema.path('activationConfirmed').options.select, false);
  const serializedChallenge = new RegistrationVerificationChallenge({
    email: 'hidden-state@example.test',
    status: 'active',
    activationConfirmed: true,
    expiresAt: new Date(),
    cleanupAt: new Date(Date.now() + 60_000),
  }).toJSON();
  assert.equal(Object.hasOwn(serializedChallenge, 'activationConfirmed'), false);
  assert.ok(RegistrationVerificationChallenge.schema.indexes().some(([fields, options]) => fields.email === 1 && options.unique));
  assert.ok(RegistrationVerificationChallenge.schema.indexes().some(([fields, options]) => fields.cleanupAt === 1 && options.expireAfterSeconds === 0));
});

test('email OTP proof is required before account creation and successful registration creates a verified student', async () => {
  const base = await start();
  const requested = await requestOtp(base, ' Student@Example.Test ');
  assert.equal(requested.response.status, 202);
  assert.equal(requested.response.headers.get('cache-control'), 'no-store');
  assert.equal(users.size, 0);
  assert.equal(requested.body.message, 'If this email address can be used for registration, a verification code will be sent.');
  assert.equal(JSON.stringify(requested.body).includes(otp), false);
  const doc = docs.get('student@example.test');
  assert.equal(doc.status, 'active');
  assert.equal(doc.activationConfirmed, true);
  assert.equal(doc.otpDigest, registrationOtpDigest('student@example.test', otp, testRegistrationPepper));
  assert.equal(JSON.stringify(doc).includes(otp), false);
  const withoutProof = await post(base, '/api/auth/register', { email: 'student@example.test', name: 'Student', password: 'safe-student-password-2026' });
  assert.equal(withoutProof.response.status, 400);
  assert.equal(users.size, 0);
  const verified = await verifyOtp(base);
  assert.equal(verified.response.status, 200);
  assert.match(verified.body.verificationToken, /^[A-Za-z0-9_-]{43}$/u);
  const registered = await post(base, '/api/auth/register', {
    email: 'STUDENT@example.test',
    name: 'Student Example',
    password: 'safe-student-password-2026',
    verificationToken: verified.body.verificationToken,
  });
  assert.equal(registered.response.status, 201);
  assert.equal(users.get('student@example.test').emailVerified, true);
  assert.equal(users.get('student@example.test').role, 'student');
  assert.equal(docs.get('student@example.test').status, 'consumed');
});

test('invalid, expired, replayed, and five-times incorrect OTPs are rejected', async () => {
  const base = await start();
  assert.equal((await requestOtp(base, 'invalid')).response.status, 400);
  await requestOtp(base);
  assert.equal((await verifyOtp(base, undefined, '000000')).response.status, 400);
  assert.equal(docs.get('student@example.test').attempts, 1);
  const success = await verifyOtp(base);
  assert.equal(success.response.status, 200);
  assert.equal((await verifyOtp(base)).response.status, 400);

  await requestOtp(base, 'expired@example.test');
  clock = new Date(clock.getTime() + 10 * 60 * 1000);
  assert.equal((await verifyOtp(base, 'expired@example.test')).response.status, 400);

  clock = new Date(clock.getTime() + 60 * 1000);
  await requestOtp(base, 'locked@example.test');
  for (let index = 0; index < 5; index += 1) assert.equal((await verifyOtp(base, 'locked@example.test', '000000')).response.status, 400);
  assert.equal(docs.get('locked@example.test').status, 'locked');
  assert.equal(docs.get('locked@example.test').attempts, 5);
});

test('resend cooldown and hourly cap block sends without revealing account state', async () => {
  const base = await start();
  await requestOtp(base, 'cap@example.test');
  await requestOtp(base, 'CAP@example.test');
  assert.equal(sent, 1);
  for (let index = 1; index < 5; index += 1) {
    clock = new Date(clock.getTime() + 60 * 1000 + 1);
    await requestOtp(base, 'cap@example.test');
  }
  assert.equal(sent, 5);
  clock = new Date(clock.getTime() + 60 * 1000 + 1);
  const blocked = await requestOtp(base, 'cap@example.test');
  assert.equal(blocked.response.status, 202);
  assert.equal(sent, 5);
});

test('existing addresses and unknown addresses receive the same generic response and existing accounts get no challenge', async () => {
  users.set('taken@example.test', { _id: 'existing' });
  const base = await start();
  const existing = await requestOtp(base, 'TAKEN@example.test');
  const available = await requestOtp(base, 'available@example.test');
  assert.equal(existing.response.status, 202);
  assert.deepEqual(existing.body, available.body);
  assert.equal(docs.has('taken@example.test'), false);
  assert.equal(sent, 1);
});

test('provider and cleanup failures never make an OTP usable; activation failure remains pending', async () => {
  const base = await start();
  failEmail = true;
  await requestOtp(base, 'cleanup@example.test');
  assert.equal(docs.get('cleanup@example.test').status, 'pending');
  assert.equal('otpDigest' in docs.get('cleanup@example.test'), false);
  assert.equal((await verifyOtp(base, 'cleanup@example.test')).response.status, 400);

  docs.clear();
  failCleanup = true;
  await requestOtp(base, 'cleanup-failed@example.test');
  assert.equal(docs.get('cleanup-failed@example.test').status, 'pending');
  assert.ok(docs.get('cleanup-failed@example.test').otpDigest);
  assert.equal((await verifyOtp(base, 'cleanup-failed@example.test')).response.status, 400);

  docs.clear();
  failEmail = false;
  failCleanup = false;
  failActivation = true;
  await requestOtp(base, 'activation@example.test');
  assert.equal(docs.get('activation@example.test').status, 'pending');
  assert.equal((await verifyOtp(base, 'activation@example.test')).response.status, 400);
});

test('committed activation with lost acknowledgement and failed rollback cannot verify on later requests', async () => {
  const base = await start();
  activationCommitThenLoseAck = true;
  failActivationRollback = true;

  const requested = await requestOtp(base, 'ambiguous@example.test');
  const sentOtp = otp;
  const challenge = docs.get('ambiguous@example.test');
  assert.equal(requested.response.status, 202);
  assert.equal(challenge.status, 'active', 'the simulated database committed before losing its acknowledgement');
  assert.equal(challenge.activationConfirmed, false);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await verifyOtp(base, 'ambiguous@example.test', sentOtp);
    assert.equal(result.response.status, 400);
    assert.equal(challenge.status, 'active');
    assert.equal(challenge.verificationProofDigest, undefined);
    assert.equal(users.size, 0);
  }
});

test('committed activation with lost acknowledgement and failed rollback cannot verify on later requests', async () => {
  const base = await start();
  activationCommitThenLoseAck = true;
  failActivationRollback = true;

  const requested = await requestOtp(base, 'ambiguous@example.test');
  const sentOtp = otp;
  const challenge = docs.get('ambiguous@example.test');
  assert.equal(requested.response.status, 202);
  assert.equal(challenge.status, 'active', 'the simulated database committed before losing its acknowledgement');
  assert.equal(challenge.activationConfirmed, false);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await verifyOtp(base, 'ambiguous@example.test', sentOtp);
    assert.equal(result.response.status, 400);
    assert.equal(challenge.status, 'active');
    assert.equal(challenge.verificationProofDigest, undefined);
    assert.equal(users.size, 0);
  }
});

test('newer resend replaces the digest so an older delayed code is rejected', async () => {
  let releaseOld;
  let started;
  const deliveryStarted = new Promise((resolve) => { started = resolve; });
  const provider = {
    count: 0,
    async send(message) {
      this.count += 1;
      const code = message.text.match(OTP_RE)?.[1];
      if (this.count === 1) {
        this.oldCode = code;
        started();
        await new Promise((resolve) => { releaseOld = resolve; });
      } else this.newCode = code;
      return { sent: true };
    },
  };
  const base = await start({ provider });
  const oldRequest = requestOtp(base, 'race@example.test');
  await deliveryStarted;
  clock = new Date(clock.getTime() + 60 * 1000 + 1);
  await requestOtp(base, 'race@example.test');
  releaseOld();
  await oldRequest;
  assert.equal((await verifyOtp(base, 'race@example.test', provider.oldCode)).response.status, 400);
  assert.equal((await verifyOtp(base, 'race@example.test', provider.newCode)).response.status, 200);
});

test('concurrent verification and registration attempts can consume proof only once', async () => {
  const base = await start();
  await requestOtp(base);
  const verified = await Promise.all([verifyOtp(base), verifyOtp(base)]);
  assert.equal(verified.filter((item) => item.response.status === 200).length, 1);
  const token = verified.find((item) => item.response.status === 200).body.verificationToken;
  const body = { email: 'student@example.test', name: 'Student Example', password: 'safe-student-password-2026', verificationToken: token };
  const registrations = await Promise.all([post(base, '/api/auth/register', body), post(base, '/api/auth/register', body)]);
  assert.equal(registrations.filter((item) => item.response.status === 201).length, 1);
  assert.equal(users.size, 1);
});

test('closed registration gate, disabled verification feature, Origin checks and per-IP limits fail closed', async () => {
  let base = await start({ gate: false });
  let result = await requestOtp(base);
  assert.equal(result.response.status, 503);
  assert.equal(docs.size, 0);
  await new Promise((resolve) => server.close(resolve));
  server = null;
  base = await start({ enabled: false });
  assert.equal((await requestOtp(base)).response.status, 503);
  await new Promise((resolve) => server.close(resolve));
  server = null;
  base = await start();
  assert.equal((await post(base, '/api/auth/registration/request-otp', { email: 'origin@example.test' }, 'https://attacker.example')).response.status, 403);
  for (let index = 0; index < 10; index += 1) assert.equal((await requestOtp(base, 'ip-' + index + '@example.test')).response.status, 202);
  result = await requestOtp(base, 'ip-final@example.test');
  assert.equal(result.response.status, 429);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
});

test('verification endpoint has a shared per-IP completion limit', async () => {
  const base = await start();
  for (let index = 0; index < 20; index += 1) {
    assert.equal((await verifyOtp(base, 'missing-' + index + '@example.test', '123456')).response.status, 400);
  }
  assert.equal((await verifyOtp(base, 'missing-final@example.test', '123456')).response.status, 429);
});
