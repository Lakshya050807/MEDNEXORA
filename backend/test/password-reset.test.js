import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'local-test-only-session-secret-please-do-not-reuse';
process.env.APP_ORIGIN = 'http://localhost:5173';
process.env.PUBLIC_BETA_REGISTRATION_ENABLED = 'false';
process.env.PUBLIC_BETA_PAID_PURCHASES_ENABLED = 'false';

const [{ createApp }, session, bcrypt] = await Promise.all([
  import('../src/app.js'),
  import('express-session'),
  import('bcryptjs'),
]);

class Query {
  constructor(value) { this.value = value; }
  select() { return this; }
  then(resolve, reject) { return Promise.resolve(this.value).then(resolve, reject); }
}

let usersByEmail;
let usersById;
let nextId;
let sentEmails;
let emailSender;
let loseActivationAck;
let failCleanup;
let server;
let baseUrl;

function matches(user, filter) {
  if (!user) return false;
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '_id') return String(user._id) === String(expected);
    if (expected && typeof expected === 'object' && expected.$gt) return new Date(user[key]) > new Date(expected.$gt);
    if (expected === null) return user[key] === null || user[key] === undefined;
    return user[key] === expected;
  });
}

function applyUpdate(user, update) {
  Object.assign(user, update.$set ?? {});
  for (const [key, amount] of Object.entries(update.$inc ?? {})) user[key] = (Number(user[key]) || 0) + amount;
  for (const key of Object.keys(update.$unset ?? {})) delete user[key];
  return user;
}

class FakeUserModel {
  static findOne(filter) {
    const user = [...usersByEmail.values()].find((candidate) => matches(candidate, filter));
    return new Query(user ?? null);
  }

  static findById(id) {
    return new Query(usersById.get(String(id)) ?? null);
  }

  static async findOneAndUpdate(filter, update) {
    if (failCleanup && update.$unset?.passwordResetTokenHash && !update.$inc?.studentSessionVersion) {
      throw new Error('simulated cleanup failure');
    }
    const user = [...usersByEmail.values()].find((candidate) => matches(candidate, filter));
    if (!user) return null;
    applyUpdate(user, update);
    if (loseActivationAck && update.$set?.passwordResetStatus === 'active') {
      loseActivationAck = false;
      throw new Error('simulated lost activation acknowledgement after commit');
    }
    return user;
  }

  static async create(data) {
    const id = String(nextId++);
    const user = { studentSessionVersion: 0, ...data, _id: id, id, createdAt: new Date(), updatedAt: new Date() };
    usersByEmail.set(user.email, user);
    usersById.set(id, user);
    return user;
  }
}

async function listen(app) {
  const instance = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    instance.once('listening', resolve);
    instance.once('error', reject);
  });
  return instance;
}

async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = { Origin: 'http://localhost:5173' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = response.status === 204 ? null : await response.json();
  const setCookie = response.headers.get('set-cookie');
  return {
    response,
    payload,
    cookie: setCookie ? setCookie.split(';')[0] : null,
  };
}

async function seedStudent(email = 'student@example.test') {
  const user = await FakeUserModel.create({
    name: 'Recovery Student',
    email,
    role: 'student',
    passwordHash: await bcrypt.hash('old-student-password-42', 4),
  });
  return user;
}

beforeEach(async () => {
  usersByEmail = new Map();
  usersById = new Map();
  nextId = 1;
  sentEmails = [];
  loseActivationAck = false;
  failCleanup = false;
  emailSender = {
    configured: true,
    async sendPasswordReset(message) { sentEmails.push(message); },
  };
  const app = createApp({
    sessionStore: new session.MemoryStore(),
    UserModel: FakeUserModel,
    passwordResetEmailSender: emailSender,
    passwordResetEmailEnabled: true,
    launchConfig: { registrationEnabled: false, paidPurchasesEnabled: false },
  });
  server = await listen(app);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('reset request is generic, stores a digest and activates only after mocked delivery succeeds', async () => {
  const user = await seedStudent();
  const existing = await request('/api/auth/forgot-password', { method: 'POST', body: { email: ' STUDENT@example.test ' } });
  const missing = await request('/api/auth/forgot-password', { method: 'POST', body: { email: 'missing@example.test' } });

  assert.equal(existing.response.status, 202);
  assert.equal(missing.response.status, 202);
  assert.deepEqual(existing.payload, missing.payload);
  assert.equal(existing.response.headers.get('cache-control'), 'no-store');
  assert.equal(sentEmails.length, 1);
  const url = new URL(sentEmails[0].url);
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  assert.equal(url.pathname, '/reset-password');
  assert.equal(url.searchParams.has('token'), false);
  assert.equal(user.passwordResetTokenHash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(user.passwordResetTokenHash, token);
  assert.equal(user.passwordResetStatus, 'active');
  assert.equal(user.passwordResetActivationConfirmed, true);
});

test('reset consumes an active token atomically with session invalidation and does not log the student in', async () => {
  const user = await seedStudent();
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: user.email, password: 'old-student-password-42' },
  });
  assert.equal(login.response.status, 200);
  assert.ok(login.cookie);

  await request('/api/auth/forgot-password', { method: 'POST', body: { email: user.email } });
  const token = new URLSearchParams(new URL(sentEmails[0].url).hash.slice(1)).get('token');
  const reset = await request('/api/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'new-student-password-2026', confirmPassword: 'new-student-password-2026' },
  });

  assert.equal(reset.response.status, 200);
  assert.equal(reset.cookie, null, 'reset does not create a login session');
  assert.equal(user.studentSessionVersion, 1);
  assert.equal(user.passwordResetTokenHash, undefined);
  assert.equal(user.passwordResetStatus, undefined);
  assert.equal(await bcrypt.compare('new-student-password-2026', user.passwordHash), true);
  const staleSession = await request('/api/auth/me', { cookie: login.cookie });
  assert.equal(staleSession.response.status, 401);
  const replay = await request('/api/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'another-student-password-42', confirmPassword: 'another-student-password-42' },
  });
  assert.equal(replay.response.status, 400);
});

test('expired links are rejected and a newer request invalidates the previous link', async () => {
  const user = await seedStudent();
  await request('/api/auth/forgot-password', { method: 'POST', body: { email: user.email } });
  const firstToken = new URLSearchParams(new URL(sentEmails[0].url).hash.slice(1)).get('token');
  user.passwordResetExpiresAt = new Date(Date.now() - 1000);
  const expired = await request('/api/auth/reset-password', {
    method: 'POST',
    body: { token: firstToken, password: 'new-student-password-2026', confirmPassword: 'new-student-password-2026' },
  });
  assert.equal(expired.response.status, 400);

  await request('/api/auth/forgot-password', { method: 'POST', body: { email: user.email } });
  const secondToken = new URLSearchParams(new URL(sentEmails[1].url).hash.slice(1)).get('token');
  assert.notEqual(secondToken, firstToken);
  const stale = await request('/api/auth/reset-password', {
    method: 'POST',
    body: { token: firstToken, password: 'new-student-password-2026', confirmPassword: 'new-student-password-2026' },
  });
  assert.equal(stale.response.status, 400);
  const current = await request('/api/auth/reset-password', {
    method: 'POST',
    body: { token: secondToken, password: 'new-student-password-2026', confirmPassword: 'new-student-password-2026' },
  });
  assert.equal(current.response.status, 200);
});

test('concurrent reset submissions can consume a token only once', async () => {
  const user = await seedStudent();
  await request('/api/auth/forgot-password', { method: 'POST', body: { email: user.email } });
  const token = new URLSearchParams(new URL(sentEmails[0].url).hash.slice(1)).get('token');
  const body = { token, password: 'new-student-password-2026', confirmPassword: 'new-student-password-2026' };
  const results = await Promise.all([
    request('/api/auth/reset-password', { method: 'POST', body }),
    request('/api/auth/reset-password', { method: 'POST', body }),
  ]);
  assert.deepEqual(results.map(({ response }) => response.status).sort(), [200, 400]);
  assert.equal(user.studentSessionVersion, 1);
});

test('pending challenge cannot be used when email delivery fails and cleanup also fails', async () => {
  const user = await seedStudent();
  emailSender.sendPasswordReset = async ({ url }) => {
    sentEmails.push({ url });
    throw new Error('provider detail must not be exposed');
  };
  failCleanup = true;
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await request('/api/auth/forgot-password', { method: 'POST', body: { email: user.email } });
    assert.equal(response.response.status, 202);
    const token = new URLSearchParams(new URL(sentEmails[0].url).hash.slice(1)).get('token');
    assert.equal(user.passwordResetStatus, 'pending');
    assert.equal(user.passwordResetActivationConfirmed, false);
    const completion = await request('/api/auth/reset-password', {
      method: 'POST',
      body: { token, password: 'new-student-password-2026', confirmPassword: 'new-student-password-2026' },
    });
    assert.equal(completion.response.status, 400);
    assert.equal(await bcrypt.compare('old-student-password-42', user.passwordHash), true);
  } finally {
    console.error = originalError;
  }
});

test('a post-commit activation acknowledgement loss leaves an unusable challenge if cleanup also fails', async () => {
  const user = await seedStudent();
  loseActivationAck = true;
  failCleanup = true;
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await request('/api/auth/forgot-password', { method: 'POST', body: { email: user.email } });
    assert.equal(response.response.status, 202);
    const token = new URLSearchParams(new URL(sentEmails[0].url).hash.slice(1)).get('token');
    assert.equal(user.passwordResetStatus, 'active');
    assert.equal(user.passwordResetActivationConfirmed, false);
    const completion = await request('/api/auth/reset-password', {
      method: 'POST',
      body: { token, password: 'new-student-password-2026', confirmPassword: 'new-student-password-2026' },
    });
    assert.equal(completion.response.status, 400);
    assert.equal(await bcrypt.compare('old-student-password-42', user.passwordHash), true);
  } finally {
    console.error = originalError;
  }
});

test('email delivery stays disabled unless both the feature gate and sender are enabled', async () => {
  const user = await seedStudent();
  const app = createApp({
    sessionStore: new session.MemoryStore(),
    UserModel: FakeUserModel,
    passwordResetEmailSender: { configured: true, async sendPasswordReset() { throw new Error('must not send'); } },
    passwordResetEmailEnabled: false,
    launchConfig: { registrationEnabled: false, paidPurchasesEnabled: false },
  });
  const disabledServer = await listen(app);
  const disabledUrl = `http://127.0.0.1:${disabledServer.address().port}`;
  try {
    const response = await fetch(`${disabledUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    });
    assert.equal(response.status, 503);
    assert.equal(user.passwordResetTokenHash, undefined);
    assert.equal(sentEmails.length, 0);
    const completion = await fetch(`${disabledUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(64), password: 'new-student-password-2026', confirmPassword: 'new-student-password-2026' }),
    });
    assert.equal(completion.status, 503);
  } finally {
    await new Promise((resolve, reject) => disabledServer.close((error) => error ? reject(error) : resolve()));
  }
});
