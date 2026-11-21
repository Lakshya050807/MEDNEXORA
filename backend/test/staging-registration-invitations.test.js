import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import { registrationInvitationDigest, registrationOtpDigest } from '../src/services/registrationVerification.js';
import { FakeRegistrationRateLimitModel, resetRegistrationTestModels, testRegistrationPepper } from './helpers/registration.js';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'staging-invite-test-session-secret-at-least-32-bytes';
process.env.APP_ORIGIN = 'http://localhost:5173';

const [{ createApp }, { default: RegistrationVerificationChallenge }] = await Promise.all([
  import('../src/app.js'),
  import('../src/models/RegistrationVerificationChallenge.js'),
]);
const { createFakeEmailOutboxModel } = await import('./helpers/fakeEmailOutbox.js');

const adminId = '507f1f77bcf86cd799439001';
const adminPassword = 'staging-admin-test-password';
const genericRequestMessage = 'If this address and request are eligible, a verification code may be sent. This response does not confirm account status or email delivery.';
const OTP_RE = /\b(\d{6})\b/u;
let challengeRows;
let studentRows;
let currentTime;
let emailMessages;
let otp;
let server;
let backgroundTasks;

function clone(value) {
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    if (value._bsontype === 'ObjectId') return String(value);
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  }
  return value;
}

function valueAt(record, path) {
  return path.split('.').reduce((value, key) => value?.[key], record);
}

function equal(left, right) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (left && typeof left === 'object' && left._bsontype === 'ObjectId') left = String(left);
  if (right && typeof right === 'object' && right._bsontype === 'ObjectId') right = String(right);
  return String(left) === String(right);
}

function matchValue(value, condition, record, path) {
  if (condition?._bsontype === 'ObjectId') return equal(value, condition);
  if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
    if ('$elemMatch' in condition) return Array.isArray(value) && value.some((entry) => match(entry, condition.$elemMatch));
    if ('$exists' in condition) return (value !== undefined) === condition.$exists;
    if ('$gt' in condition) return value != null && new Date(value).getTime() > new Date(condition.$gt).getTime();
    if ('$lt' in condition) return value != null && new Date(value).getTime() < new Date(condition.$lt).getTime();
    if ('$lte' in condition) return value != null && new Date(value).getTime() <= new Date(condition.$lte).getTime();
    if ('$ne' in condition) return !equal(value, condition.$ne);
    return Object.entries(condition).every(([key, nested]) => matchValue(value?.[key], nested, record, `${path}.${key}`));
  }
  return equal(value, condition);
}

function match(record, filter) {
  return Object.entries(filter ?? {}).every(([key, expected]) => {
    if (key === '$and') return expected.every((part) => match(record, part));
    if (key === '$or') return expected.some((part) => match(record, part));
    if (key === 'invitations' && expected?.$elemMatch) return (record.invitations ?? []).some((entry) => match(entry, expected.$elemMatch));
    return matchValue(valueAt(record, key), expected, record, key);
  });
}

function setPath(record, path, value, filter) {
  if (path.includes('.$[')) {
    const [prefix, rest] = path.split('.$[');
    const [identifier, suffix] = rest.split('].');
    if (prefix !== 'invitations') return;
    const arrayFilter = filter?.[identifier];
    for (const entry of record.invitations ?? []) if (!arrayFilter || match(entry, arrayFilter)) entry[suffix] = clone(value);
    return;
  }
  if (path.includes('.$.')) {
    const [prefix, suffix] = path.split('.$.');
    if (prefix !== 'invitations') return;
    const criteria = filter?.invitations?.$elemMatch ?? {};
    const entry = (record.invitations ?? []).find((candidate) => match(candidate, criteria));
    if (entry) entry[suffix] = clone(value);
    return;
  }
  record[path] = clone(value);
}

class Query {
  constructor(value) { this.value = value; }
  select() { return this; }
  sort() { return this; }
  limit() { return this; }
  async lean() { return clone(this.value); }
  then(resolve, reject) { return Promise.resolve(clone(this.value)).then(resolve, reject); }
}

class ChallengeModel {
  static async create(value) {
    if (challengeRows.has(value.email)) {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
    challengeRows.set(value.email, clone(value));
    return value;
  }

  static findOne(filter) {
    const row = [...challengeRows.values()].find((candidate) => match(candidate, filter));
    return new Query(row);
  }

  static find(filter) {
    return new Query([...challengeRows.values()].filter((candidate) => match(candidate, filter)));
  }

  static async updateOne(filter, update, options = {}) {
    const row = challengeRows.get(filter.email) ?? [...challengeRows.values()].find((candidate) => match(candidate, filter));
    if (!row || !match(row, filter)) return { matchedCount: 0 };
    if (Array.isArray(update)) {
      const values = update[0].$set;
      const append = values.invitations.$slice[0].$concatArrays[1][0].$literal;
      const revokedAt = values.invitations.$slice[0].$concatArrays[0].$map.in.$cond[1].$mergeObjects[1].revokedAt.$literal;
      row.invitations = [...(row.invitations ?? []).map((entry) => entry.status === 'active'
        ? { ...entry, status: 'revoked', revokedAt: clone(revokedAt) }
        : entry), clone(append)].slice(-Math.abs(values.invitations.$slice[1]));
      for (const [key, value] of Object.entries(values)) {
        if (key === 'invitations') continue;
        if (value === '$$REMOVE') delete row[key];
        else row[key] = value && typeof value === 'object' && '$literal' in value ? clone(value.$literal) : clone(value);
      }
      return { matchedCount: 1 };
    }
    for (const [path, value] of Object.entries(update.$set ?? {})) {
      let arrayFilters;
      if (path.includes('$[')) {
        arrayFilters = Object.fromEntries((options.arrayFilters ?? []).map((item) => {
          const firstPath = Object.keys(item)[0];
          const key = firstPath.split('.')[0];
          const criteria = Object.fromEntries(Object.entries(item).map(([pathKey, itemValue]) => [pathKey.slice(key.length + 1), itemValue]));
          return [key, criteria];
        }));
      }
      setPath(row, path, value, arrayFilters ?? filter);
    }
    for (const [key, amount] of Object.entries(update.$inc ?? {})) row[key] = (row[key] ?? 0) + amount;
    for (const [path, value] of Object.entries(update.$push ?? {})) {
      if (path !== 'invitations') continue;
      const entries = value.$each ?? [value];
      row.invitations ??= [];
      row.invitations.push(...clone(entries));
      if (Number.isInteger(value.$slice) && value.$slice < 0) row.invitations = row.invitations.slice(value.$slice);
    }
    for (const key of Object.keys(update.$unset ?? {})) delete row[key];
    return { matchedCount: 1 };
  }
}

class UserModel {
  static async exists({ email }) { return studentRows.has(email) || email === 'admin@example.test' ? { _id: email } : null; }
  static findOne(filter) {
    const user = filter.email === 'admin@example.test' || filter.adminUsername === 'staging-admin' ? this.admin : null;
    return new Query(user);
  }
  static findById(id) { return new Query(String(id) === adminId ? this.admin : null); }
  static async create(data) {
    if (studentRows.has(data.email)) {
      const error = new Error('duplicate key');
      error.code = 11000;
      error.keyPattern = { email: 1 };
      throw error;
    }
    const user = { ...clone(data), _id: '507f1f77bcf86cd799439099', id: '507f1f77bcf86cd799439099' };
    studentRows.set(data.email, user);
    return user;
  }
}
UserModel.admin = { _id: adminId, id: adminId, name: 'Test Admin', email: 'admin@example.test', adminUsername: 'staging-admin', passwordHash: bcrypt.hashSync(adminPassword, 4), role: 'admin', adminSessionVersion: 0 };

async function start({ enabled = true, ttlMinutes = 120 } = {}) {
  backgroundTasks = [];
  const app = createApp({
    sessionStore: new session.MemoryStore(),
    UserModel,
    RegistrationVerificationChallengeModel: ChallengeModel,
    EmailOutboxModel: createFakeEmailOutboxModel(),
    PasswordResetRateLimitModel: FakeRegistrationRateLimitModel,
    stagingRestrictedRegistrationEnabled: enabled,
    stagingRegistrationInvitationTtlMinutes: ttlMinutes,
    registrationEnabled: false,
    registrationEmailVerificationEnabled: true,
    registrationOtpPepper: testRegistrationPepper,
    registrationNow: () => new Date(currentTime),
    registrationEmailProvider: { async send(message) {
      emailMessages.push(message);
      otp = message.text.match(OTP_RE)?.[1] ?? null;
      return { sent: true };
    } },
    passwordResetEmailProvider: { async send() { return { sent: true }; } },
    passwordResetNow: () => new Date(currentTime),
    launchConfig: { registrationEnabled: false, paidPurchasesEnabled: false },
    backgroundTaskScheduler(task) { backgroundTasks.push(task); },
  });
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(base, path, { method = 'GET', body, cookie, origin = 'http://localhost:5173' } = {}) {
  const headers = { ...(method !== 'GET' ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) };
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = response.status === 204 ? null : await response.json();
  if (path === '/api/auth/registration/request-otp') {
    while (backgroundTasks.length) await backgroundTasks.shift()();
  }
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie };
}

async function adminLogin(base) {
  const result = await request(base, '/api/admin/login', { method: 'POST', body: { username: 'staging-admin', password: adminPassword } });
  assert.equal(result.response.status, 200);
  return result.cookie;
}

async function createInvitation(base, cookie, email = 'student@example.test') {
  return request(base, '/api/admin/staging-registration-invitations', { method: 'POST', cookie, body: { email } });
}

async function requestOtp(base, email, token) {
  return request(base, '/api/auth/registration/request-otp', { method: 'POST', body: { email, invitationToken: token } });
}

beforeEach(() => {
  resetRegistrationTestModels();
  challengeRows = new Map();
  studentRows = new Map();
  currentTime = new Date('2026-11-19T06:00:00.000Z');
  emailMessages = [];
  otp = null;
  backgroundTasks = [];
});

afterEach(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  server = null;
});

test('restricted routes are unavailable by default and launch status stays publicly closed', async () => {
  const base = await start({ enabled: false });
  const status = await request(base, '/api/launch/status');
  assert.deepEqual(status.payload, { registrationEnabled: false, paidPurchasesEnabled: false });
  assert.equal(status.response.headers.get('cache-control'), 'no-store');
  const unauthorized = await request(base, '/api/admin/staging-registration-invitations', { method: 'POST', body: { email: 'student@example.test' } });
  assert.equal(unauthorized.response.status, 401);
  const cookie = await adminLogin(base);
  assert.equal((await request(base, '/api/admin/staging-registration-invitations', { cookie })).response.status, 404);
  assert.equal((await requestOtp(base, 'student@example.test', '')).response.status, 503);
  assert.equal(emailMessages.length, 0);
});

test('invitation digests are hidden and the existing challenge model has a lookup index', () => {
  const invitationSchema = RegistrationVerificationChallenge.schema.path('invitations').schema;
  assert.equal(invitationSchema.path('tokenDigest').options.select, false);
  assert.equal(RegistrationVerificationChallenge.schema.path('invitationId').options.select, false);
  assert.ok(RegistrationVerificationChallenge.schema.indexes().some(([fields]) => fields['invitations._id'] === 1));
  assert.ok(RegistrationVerificationChallenge.schema.indexes().some(([fields, options]) => fields.email === 1 && options.unique));
  assert.ok(RegistrationVerificationChallenge.schema.indexes().some(([fields, options]) => fields.cleanupAt === 1 && options.expireAfterSeconds === 0));
});

test('an authenticated admin issues one-time email-bound invitations and listing never returns token material', async () => {
  const base = await start();
  const unauthorized = await request(base, '/api/admin/staging-registration-invitations', { method: 'POST', body: { email: 'student@example.test' } });
  assert.equal(unauthorized.response.status, 401);
  const cookie = await adminLogin(base);
  const wrongOrigin = await request(base, '/api/admin/staging-registration-invitations', { method: 'POST', cookie, origin: 'https://attacker.invalid', body: { email: 'student@example.test' } });
  assert.equal(wrongOrigin.response.status, 403);
  const issued = await createInvitation(base, cookie, ' Student@Example.Test ');
  assert.equal(issued.response.status, 201);
  assert.equal(issued.response.headers.get('cache-control'), 'no-store');
  assert.equal(issued.payload.invitation.email, 'student@example.test');
  assert.equal(issued.payload.invitation.status, 'active');
  assert.match(issued.payload.token, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(issued.payload.tokenDigest, undefined);
  const digest = registrationInvitationDigest(issued.payload.token);
  assert.equal(challengeRows.get('student@example.test').invitations[0].tokenDigest, digest);
  const listed = await request(base, '/api/admin/staging-registration-invitations', { cookie });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.payload.invitations[0].status, 'active');
  assert.equal(JSON.stringify(listed.payload).includes(digest), false);
  assert.equal(JSON.stringify(listed.payload).includes(issued.payload.token), false);
});

test('admin invitation writes are rate-limited through the shared Mongo-backed limiter', async () => {
  const base = await start();
  const cookie = await adminLogin(base);
  for (let index = 0; index < 10; index += 1) {
    const issued = await createInvitation(base, cookie, `limited-${index}@example.test`);
    assert.equal(issued.response.status, 201);
  }
  const blocked = await createInvitation(base, cookie, 'limited-final@example.test');
  assert.equal(blocked.response.status, 429);
  assert.equal(challengeRows.has('limited-final@example.test'), false);
});

test('invitation expiry, revocation and wrong-email use are rejected without sending an OTP', async () => {
  const base = await start({ ttlMinutes: 5 });
  const cookie = await adminLogin(base);
  const issued = await createInvitation(base, cookie, 'invitee@example.test');
  const wrongEmail = await requestOtp(base, 'other@example.test', issued.payload.token);
  assert.equal(wrongEmail.response.status, 202);
  assert.deepEqual(wrongEmail.payload, { message: genericRequestMessage });
  assert.equal(emailMessages.length, 0);
  const revoked = await request(base, `/api/admin/staging-registration-invitations/${issued.payload.invitation.id}`, { method: 'DELETE', cookie, body: {} });
  assert.equal(revoked.response.status, 200);
  assert.equal((await requestOtp(base, 'invitee@example.test', issued.payload.token)).response.status, 202);
  assert.equal(emailMessages.length, 0);
  const next = await createInvitation(base, cookie, 'expired@example.test');
  currentTime = new Date(currentTime.getTime() + 5 * 60 * 1000 + 1);
  assert.equal((await requestOtp(base, 'expired@example.test', next.payload.token)).response.status, 202);
  assert.equal(emailMessages.length, 0);
});

test('restricted registration requires a valid invitation and verified OTP proof, then consumes both once', async () => {
  const base = await start();
  const cookie = await adminLogin(base);
  const issued = await createInvitation(base, cookie);
  const invalidInvitation = await requestOtp(base, 'student@example.test', 'A'.repeat(43));
  assert.equal(invalidInvitation.response.status, 202);
  assert.deepEqual(invalidInvitation.payload, { message: genericRequestMessage });
  assert.equal(emailMessages.length, 0);

  const sent = await requestOtp(base, 'STUDENT@example.test', issued.payload.token);
  assert.equal(sent.response.status, 202);
  assert.equal(sent.payload.message, genericRequestMessage);
  assert.equal(emailMessages.length, 1);
  assert.equal(String(challengeRows.get('student@example.test').otpDigest), registrationOtpDigest('student@example.test', otp, testRegistrationPepper));
  const withoutOtpProof = await request(base, '/api/auth/register', { method: 'POST', body: { email: 'student@example.test', name: 'Test Student', password: 'safe-student-password-2026', invitationToken: issued.payload.token } });
  assert.equal(withoutOtpProof.response.status, 400);
  const verified = await request(base, '/api/auth/registration/verify-otp', { method: 'POST', body: { email: 'student@example.test', otp } });
  assert.equal(verified.response.status, 200);
  const noInvitation = await request(base, '/api/auth/register', { method: 'POST', body: { email: 'student@example.test', name: 'Test Student', password: 'safe-student-password-2026', verificationToken: verified.payload.verificationToken } });
  assert.equal(noInvitation.response.status, 400);

  const registered = await request(base, '/api/auth/register', { method: 'POST', body: {
    email: 'student@example.test', name: 'Test Student', password: 'safe-student-password-2026',
    verificationToken: verified.payload.verificationToken, invitationToken: issued.payload.token,
  } });
  assert.equal(registered.response.status, 201);
  assert.equal(studentRows.size, 1);
  const stored = challengeRows.get('student@example.test');
  assert.equal(stored.status, 'consumed');
  assert.equal(stored.invitations[0].status, 'consumed');
  assert.equal('verificationProofDigest' in stored, false);
  assert.equal('invitationId' in stored, false);
  const replay = await request(base, '/api/auth/register', { method: 'POST', body: {
    email: 'student@example.test', name: 'Test Student', password: 'safe-student-password-2026',
    verificationToken: verified.payload.verificationToken, invitationToken: issued.payload.token,
  } });
  assert.equal(replay.response.status, 400);
  const listed = await request(base, '/api/admin/staging-registration-invitations', { cookie });
  assert.equal(listed.payload.invitations[0].status, 'consumed');
});

test('concurrent final registration attempts atomically consume the invitation and proof once', async () => {
  const base = await start();
  const cookie = await adminLogin(base);
  const issued = await createInvitation(base, cookie);
  await requestOtp(base, 'student@example.test', issued.payload.token);
  const verified = await request(base, '/api/auth/registration/verify-otp', { method: 'POST', body: { email: 'student@example.test', otp } });
  const body = { email: 'student@example.test', name: 'Test Student', password: 'safe-student-password-2026', verificationToken: verified.payload.verificationToken, invitationToken: issued.payload.token };
  const attempts = await Promise.all([
    request(base, '/api/auth/register', { method: 'POST', body }),
    request(base, '/api/auth/register', { method: 'POST', body }),
  ]);
  assert.equal(attempts.filter((result) => result.response.status === 201).length, 1);
  assert.equal(studentRows.size, 1);
});

test('reissuing an invitation revokes the old token and clears any outstanding OTP proof', async () => {
  const base = await start();
  const cookie = await adminLogin(base);
  const first = await createInvitation(base, cookie);
  await requestOtp(base, 'student@example.test', first.payload.token);
  const oldDigest = challengeRows.get('student@example.test').otpDigest;
  const verified = await request(base, '/api/auth/registration/verify-otp', { method: 'POST', body: { email: 'student@example.test', otp } });
  assert.equal(verified.response.status, 200);
  currentTime = new Date(currentTime.getTime() + 60 * 1000 + 1);
  const second = await createInvitation(base, cookie);
  assert.notEqual(second.payload.token, first.payload.token);
  assert.equal(challengeRows.get('student@example.test').invitations[0].status, 'revoked');
  assert.equal('otpDigest' in challengeRows.get('student@example.test'), false);
  assert.equal(oldDigest !== second.payload.token, true);
  assert.equal((await requestOtp(base, 'student@example.test', first.payload.token)).response.status, 202);
  const staleProof = await request(base, '/api/auth/register', { method: 'POST', body: {
    email: 'student@example.test', name: 'Test Student', password: 'safe-student-password-2026',
    verificationToken: verified.payload.verificationToken, invitationToken: first.payload.token,
  } });
  assert.equal(staleProof.response.status, 400);
  assert.equal(emailMessages.length, 1);
});
