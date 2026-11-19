import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'test';
process.env.SESSION_SECRET = 'password-reset-test-session-secret-at-least-32-bytes';
process.env.APP_ORIGIN = 'http://localhost:5173';

const [{ default: bcrypt }, { default: session }, { createApp }, { default: User }] = await Promise.all([
  import('bcryptjs'),
  import('express-session'),
  import('../src/app.js'),
  import('../src/models/User.js'),
]);

const pepper = 'password-reset-test-pepper-that-is-long-enough-32-bytes';
const rateLimitSecret = 'password-reset-rate-limit-test-key-32-bytes-long';
const initialTime = Date.parse('2026-11-19T10:00:00.000Z');
const servers = new Set();
let usersByEmail;
let usersById;
let nextId;
let userUpdateOperations;

class FakeQuery {
  constructor(value) { this.value = value; }
  select() { return this; }
  then(resolve, reject) { return Promise.resolve(this.value).then(resolve, reject); }
}

function compare(left, right) {
  const a = left instanceof Date ? left.getTime() : left;
  const b = right instanceof Date ? right.getTime() : right;
  return a < b ? -1 : a > b ? 1 : 0;
}

function matchesValue(document, key, condition) {
  const exists = Object.hasOwn(document, key);
  const value = document[key];
  if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
    return Object.entries(condition).every(([operator, expected]) => {
      if (operator === '$exists') return exists === expected;
      if (operator === '$lt') return exists && compare(value, expected) < 0;
      if (operator === '$lte') return exists && compare(value, expected) <= 0;
      if (operator === '$gt') return exists && compare(value, expected) > 0;
      return false;
    });
  }
  return value === condition;
}

function matchesFilter(document, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') return condition.every((part) => matchesFilter(document, part));
    if (key === '$or') return condition.some((part) => matchesFilter(document, part));
    return matchesValue(document, key, condition);
  });
}

class FakeUserModel {
  static failCleanup = false;
  static failActivation = false;
  static activationCommitThenLoseAck = false;
  static failActivationRollback = false;

  static async create(data) {
    const id = String(nextId++);
    const user = {
      studentSessionVersion: 0,
      passwordResetOtpAttempts: 0,
      passwordResetOtpResendCount: 0,
      role: 'student',
      ...data,
      _id: id,
      id,
    };
    usersByEmail.set(user.email, user);
    usersById.set(id, user);
    return user;
  }

  static findOne({ email }) { return new FakeQuery(usersByEmail.get(email) ?? null); }
  static findById(id) { return new FakeQuery(usersById.get(String(id)) ?? null); }

  static async updateOne(filter, update, options = {}) {
    userUpdateOperations.push({ filter, update, options });
    const isActivation = filter.passwordResetOtpStatus === 'pending'
      && update.$set?.passwordResetOtpStatus === 'active';
    if (this.failActivation && isActivation) {
      this.failActivation = false;
      throw new Error('simulated activation database failure');
    }
    if (this.failActivationRollback && filter.passwordResetOtpStatus === 'active'
      && filter.passwordResetOtpActivationConfirmed === false
      && update.$set?.passwordResetOtpStatus === 'pending') {
      throw new Error('simulated rollback database failure');
    }
    if (this.failCleanup && filter.passwordResetOtpStatus === undefined && filter.passwordResetOtpHash
      && update.$unset?.passwordResetOtpStatus) {
      throw new Error('simulated cleanup database failure');
    }
    const user = [...usersByEmail.values()].find((candidate) => matchesFilter(candidate, filter));
    if (!user) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    for (const [key, value] of Object.entries(update.$set ?? {})) user[key] = value;
    for (const [key, amount] of Object.entries(update.$inc ?? {})) user[key] = (user[key] ?? 0) + amount;
    for (const key of Object.keys(update.$unset ?? {})) delete user[key];
    if (this.activationCommitThenLoseAck && isActivation) {
      this.activationCommitThenLoseAck = false;
      throw new Error('simulated lost activation acknowledgement after commit');
    }
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  }
}

function createFakeRateLimitModel(sharedBuckets = new Map()) {
  return class FakePasswordResetRateLimitModel {
    static async findOneAndUpdate(filter, update, options = {}) {
      const key = `${filter.scope}|${filter.ipHash}|${filter.windowStart.getTime()}`;
      let bucket = sharedBuckets.get(key);
      if (!bucket && !options.upsert) return null;
      if (!bucket) {
        bucket = { ...update.$setOnInsert, scope: filter.scope, ipHash: filter.ipHash, windowStart: filter.windowStart, count: 0 };
        sharedBuckets.set(key, bucket);
      }
      bucket.count += update.$inc?.count ?? 0;
      return { ...bucket };
    }
  };
}

function resetFixtures() {
  usersByEmail = new Map();
  usersById = new Map();
  nextId = 1;
  userUpdateOperations = [];
  FakeUserModel.failCleanup = false;
  FakeUserModel.failActivation = false;
  FakeUserModel.activationCommitThenLoseAck = false;
  FakeUserModel.failActivationRollback = false;
}

function createResetApp({
  emailProvider,
  rateLimitModel,
  clock = () => initialTime,
  enabled = true,
  sessionStore = new session.MemoryStore(),
} = {}) {
  const sentEmails = [];
  const provider = emailProvider ?? {
    async send(message) { sentEmails.push(message); return { sent: true }; },
  };
  const app = createApp({
    sessionStore,
    UserModel: FakeUserModel,
    PasswordResetRateLimitModel: rateLimitModel ?? createFakeRateLimitModel(),
    passwordResetEmailEnabled: enabled,
    passwordResetOtpPepper: pepper,
    passwordResetEmailProvider: provider,
    passwordResetRateLimitSecret: rateLimitSecret,
    passwordResetNow: () => new Date(clock()),
  });
  return { app, sentEmails, sessionStore };
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  servers.add(server);
  return server;
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  servers.delete(server);
}

afterEach(async () => {
  await Promise.all([...servers].map(close));
});

async function requestAt(server, path, { method = 'GET', body, cookie, origin = 'http://localhost:5173' } = {}) {
  const headers = { Origin: origin };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseBody = response.status === 204 ? null : await response.json();
  return {
    response,
    body: responseBody,
    cookie: response.headers.get('set-cookie')?.split(';', 1)[0] ?? null,
    setCookie: response.headers.get('set-cookie'),
  };
}

async function createStudent(email = 'student@example.test', password = 'original-student-password-123') {
  return FakeUserModel.create({
    name: 'Test Student',
    email,
    passwordHash: await bcrypt.hash(password, 10),
    role: 'student',
  });
}

function otpFrom(message) {
  const match = message?.text?.match(/code is (\d{6})/u);
  assert.ok(match, 'mock email should contain a six-digit code');
  return match[1];
}

async function issueOtp(server, email = 'student@example.test') {
  return requestAt(server, '/api/auth/password-reset/request', { method: 'POST', body: { email } });
}

async function completeReset(server, email, otp, overrides = {}) {
  return requestAt(server, '/api/auth/password-reset/complete', {
    method: 'POST',
    body: {
      email,
      otp,
      newPassword: 'new-student-password-456',
      confirmPassword: 'new-student-password-456',
      ...overrides,
    },
  });
}

test('request issues a cryptographically generated six-digit OTP stored only as a peppered HMAC with an exact ten-minute expiry', async () => {
  resetFixtures();
  const clock = { value: initialTime };
  const { app, sentEmails } = createResetApp({ clock: () => clock.value });
  const server = await listen(app);
  await createStudent();

  const result = await issueOtp(server);
  assert.equal(result.response.status, 202);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.equal(result.body.message, 'If an account exists, an email with password reset instructions will be sent.');
  assert.equal(result.body.message.includes(otpFrom(sentEmails[0])), false);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'student@example.test');
  assert.match(sentEmails[0].text, /expires in 10 minutes/u);

  const user = usersByEmail.get('student@example.test');
  const issuedOtp = otpFrom(sentEmails[0]);
  const expectedDigest = createHmac('sha256', pepper).update(`student@example.test\0${issuedOtp}`, 'utf8').digest('hex');
  assert.equal(user.passwordResetOtpHash, expectedDigest);
  assert.notEqual(user.passwordResetOtpHash, issuedOtp);
  assert.equal(user.passwordResetOtpExpiresAt.getTime(), clock.value + 10 * 60 * 1000);
  assert.equal(user.passwordResetOtpAttempts, 0);
  assert.equal(user.passwordResetOtpResendCount, 1);
  assert.equal(user.passwordResetOtpStatus, 'active');
  assert.equal(user.passwordResetOtpActivationConfirmed, true);
});

test('disabled email configuration does not send mail or permit password changes', async () => {
  resetFixtures();
  const { app, sentEmails } = createResetApp({ enabled: false });
  const server = await listen(app);
  const user = await createStudent();
  const requestResult = await issueOtp(server);
  const completeResult = await completeReset(server, user.email, '123456');
  assert.equal(requestResult.response.status, 503);
  assert.equal(completeResult.response.status, 503);
  assert.equal(requestResult.response.headers.get('cache-control'), 'no-store');
  assert.equal(completeResult.response.headers.get('cache-control'), 'no-store');
  assert.equal(sentEmails.length, 0);
  assert.equal(user.studentSessionVersion, 0);
  assert.equal(user.passwordResetOtpHash, undefined);
});

test('registered, nonexistent, admin-only, and delivery-failure requests return the same generic 202 response', async () => {
  resetFixtures();
  const messages = [];
  let failDelivery = false;
  const { app } = createResetApp({ emailProvider: {
    async send(message) {
      messages.push(message);
      if (failDelivery) throw new Error('provider secret and response detail');
      return { sent: true };
    },
  } });
  const server = await listen(app);
  await createStudent();
  await createStudent('student2@example.test');
  await FakeUserModel.create({ name: 'Administrator', email: 'admin@example.test', passwordHash: 'admin-hash', role: 'admin' });

  const registered = await issueOtp(server, 'student@example.test');
  const missing = await issueOtp(server, 'nobody@example.test');
  const admin = await issueOtp(server, 'admin@example.test');
  failDelivery = true;
  const failedDelivery = await issueOtp(server, 'student2@example.test');
  await createStudent('student2@example.test');
  // Retry after a failed delivery is cooldown-limited and still reveals no state.

  for (const result of [registered, missing, admin, failedDelivery]) {
    assert.equal(result.response.status, 202);
    assert.deepEqual(result.body, registered.body);
    assert.equal(result.response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(messages.length, 2, 'only existing student accounts are emailed');
  assert.equal(usersByEmail.get('student@example.test').passwordResetOtpHash !== undefined, true);
  assert.equal(usersByEmail.get('admin@example.test').passwordResetOtpHash, undefined);
  assert.equal(usersByEmail.get('admin@example.test').passwordResetOtpStatus, undefined);
  assert.equal(usersByEmail.get('student2@example.test').passwordResetOtpHash, undefined, 'failed delivery invalidates the issued OTP');
  assert.equal(usersByEmail.get('student2@example.test').passwordResetOtpStatus, undefined);
  assert.equal(JSON.stringify(failedDelivery.body).includes('provider secret'), false);
  const failedDeliveryOtp = otpFrom(messages[1]);
  assert.equal((await completeReset(server, 'student2@example.test', failedDeliveryOtp)).response.status, 400);
});

test('pending OTP is rejected until email delivery completes and the exact challenge is activated', async () => {
  resetFixtures();
  let releaseDelivery;
  let signalDeliveryStarted;
  const deliveryStarted = new Promise((resolve) => { signalDeliveryStarted = resolve; });
  const deliveryGate = new Promise((resolve) => { releaseDelivery = resolve; });
  let capturedMessage;
  const { app } = createResetApp({ emailProvider: {
    async send(message) {
      capturedMessage = message;
      signalDeliveryStarted();
      await deliveryGate;
      return { sent: true };
    },
  } });
  const server = await listen(app);
  const user = await createStudent();

  const requestPromise = issueOtp(server);
  await deliveryStarted;
  const otp = otpFrom(capturedMessage);
  assert.equal(user.passwordResetOtpStatus, 'pending');
  const pendingAttempt = await completeReset(server, user.email, otp);
  assert.equal(pendingAttempt.response.status, 400);
  assert.equal(user.passwordResetOtpAttempts, 0, 'pending challenges do not accept or count verification attempts');
  assert.equal(user.studentSessionVersion, 0);

  releaseDelivery();
  const requestResult = await requestPromise;
  assert.equal(requestResult.response.status, 202);
  assert.equal(user.passwordResetOtpStatus, 'active');
  assert.equal((await completeReset(server, user.email, otp)).response.status, 200);
});

test('email failure followed by MongoDB cleanup failure leaves the OTP pending and unusable', async () => {
  resetFixtures();
  let deliveredAttemptedMessage;
  const { app } = createResetApp({ emailProvider: {
    async send(message) {
      deliveredAttemptedMessage = message;
      throw new Error('simulated provider failure');
    },
  } });
  const server = await listen(app);
  const user = await createStudent();
  FakeUserModel.failCleanup = true;

  const result = await issueOtp(server);
  const otp = otpFrom(deliveredAttemptedMessage);
  assert.equal(result.response.status, 202);
  assert.equal(user.passwordResetOtpStatus, 'pending');
  assert.ok(user.passwordResetOtpHash, 'the simulated failed cleanup leaves the digest for this test');
  const completion = await completeReset(server, user.email, otp);
  assert.equal(completion.response.status, 400);
  assert.equal(user.studentSessionVersion, 0);
  assert.equal(await bcrypt.compare('original-student-password-123', user.passwordHash), true);
});

test('activation failure after successful delivery leaves the challenge unusable', async () => {
  resetFixtures();
  const { app, sentEmails } = createResetApp();
  const server = await listen(app);
  const user = await createStudent();
  FakeUserModel.failActivation = true;

  const result = await issueOtp(server);
  const otp = otpFrom(sentEmails[0]);
  assert.equal(result.response.status, 202);
  assert.equal(user.passwordResetOtpStatus, 'pending');
  assert.equal((await completeReset(server, user.email, otp)).response.status, 400);
  assert.equal(user.studentSessionVersion, 0);
});

test('activation commit with lost acknowledgement and failed rollback remains unusable on retries', async () => {
  resetFixtures();
  const { app, sentEmails } = createResetApp();
  const server = await listen(app);
  const user = await createStudent();
  FakeUserModel.activationCommitThenLoseAck = true;
  FakeUserModel.failActivationRollback = true;

  const requestResult = await issueOtp(server);
  const otp = otpFrom(sentEmails[0]);
  assert.equal(requestResult.response.status, 202);
  assert.equal(user.passwordResetOtpStatus, 'active', 'the simulated database committed before losing the acknowledgement');
  assert.equal(user.passwordResetOtpActivationConfirmed, false);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const completion = await completeReset(server, user.email, otp);
    assert.equal(completion.response.status, 400);
    assert.equal(user.studentSessionVersion, 0);
    assert.equal(await bcrypt.compare('original-student-password-123', user.passwordHash), true);
  }
});

test('an older delivery cannot activate its OTP after a newer request replaces the challenge', async () => {
  resetFixtures();
  const clock = { value: initialTime };
  let releaseFirstDelivery;
  let signalFirstDelivery;
  const firstDeliveryStarted = new Promise((resolve) => { signalFirstDelivery = resolve; });
  const firstDeliveryGate = new Promise((resolve) => { releaseFirstDelivery = resolve; });
  const sentEmails = [];
  const { app } = createResetApp({
    clock: () => clock.value,
    emailProvider: {
      async send(message) {
        sentEmails.push(message);
        if (sentEmails.length === 1) {
          signalFirstDelivery();
          await firstDeliveryGate;
        }
        return { sent: true };
      },
    },
  });
  const server = await listen(app);
  const user = await createStudent();

  const firstRequest = issueOtp(server);
  await firstDeliveryStarted;
  const firstOtp = otpFrom(sentEmails[0]);
  clock.value += 60_001;
  const secondRequest = await issueOtp(server);
  const secondOtp = otpFrom(sentEmails[1]);
  assert.equal(secondRequest.response.status, 202);
  const secondDigest = createHmac('sha256', pepper).update(`${user.email}\0${secondOtp}`, 'utf8').digest('hex');
  assert.equal(user.passwordResetOtpHash, secondDigest);
  assert.equal(user.passwordResetOtpStatus, 'active');

  releaseFirstDelivery();
  assert.equal((await firstRequest).response.status, 202);
  assert.equal(user.passwordResetOtpHash, secondDigest);
  assert.equal(user.passwordResetOtpStatus, 'active');
  assert.equal((await completeReset(server, user.email, firstOtp)).response.status, 400);
  assert.equal((await completeReset(server, user.email, secondOtp)).response.status, 200);
});

test('correct OTP resets the password, consumes the challenge, increments student session version, and does not log in', async () => {
  resetFixtures();
  const { app, sentEmails } = createResetApp();
  const server = await listen(app);
  const user = await createStudent();
  const login = await requestAt(server, '/api/auth/login', {
    method: 'POST',
    body: { email: user.email, password: 'original-student-password-123' },
  });
  assert.equal(login.response.status, 200);
  assert.ok(login.cookie);

  await issueOtp(server);
  const otp = otpFrom(sentEmails[0]);
  const result = await completeReset(server, user.email, otp);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { message: 'Your password has been reset. Please log in with your new password.' });
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.equal(result.setCookie, null, 'the completion endpoint must not create an authenticated session');
  assert.equal(user.studentSessionVersion, 1);
  assert.equal(user.passwordResetOtpHash, undefined);
  assert.equal(user.passwordResetOtpExpiresAt, undefined);
  assert.equal(user.passwordResetOtpStatus, undefined);
  assert.equal(user.passwordResetOtpActivationConfirmed, undefined);
  assert.equal(user.passwordResetOtpAttempts, undefined);
  assert.equal(user.passwordResetOtpLastSentAt.getTime(), initialTime, 'send cooldown state remains to prevent bypass');
  const passwordAndSessionUpdate = userUpdateOperations.filter(({ update }) =>
    typeof update.$set?.passwordHash === 'string' && update.$inc?.studentSessionVersion === 1);
  assert.equal(passwordAndSessionUpdate.length, 1, 'password replacement and session-version increment use one atomic updateOne');
  assert.equal(passwordAndSessionUpdate[0].update.$unset.passwordResetOtpStatus, 1);
  assert.equal(passwordAndSessionUpdate[0].filter.passwordResetOtpStatus, 'active');
  assert.equal(passwordAndSessionUpdate[0].filter.passwordResetOtpActivationConfirmed, true);
  assert.equal(await bcrypt.compare('new-student-password-456', user.passwordHash), true);
  assert.equal((await requestAt(server, '/api/auth/me', { cookie: login.cookie })).response.status, 401, 'all prior student sessions are invalidated');
  const newLogin = await requestAt(server, '/api/auth/login', {
    method: 'POST',
    body: { email: user.email, password: 'new-student-password-456' },
  });
  assert.equal(newLogin.response.status, 200);
  assert.equal((await requestAt(server, '/api/auth/me', { cookie: newLogin.cookie })).response.status, 200);
});

test('incorrect and expired OTPs are rejected without changing the password', async () => {
  resetFixtures();
  const clock = { value: initialTime };
  const { app, sentEmails } = createResetApp({ clock: () => clock.value });
  const server = await listen(app);
  const user = await createStudent();
  await issueOtp(server);
  const otp = otpFrom(sentEmails[0]);

  const incorrect = await completeReset(server, user.email, otp === '000000' ? '000001' : '000000');
  assert.equal(incorrect.response.status, 400);
  assert.equal(incorrect.body.message, 'The code is invalid or expired. Request a new code and try again.');
  assert.equal(user.passwordResetOtpAttempts, 1);

  clock.value += 10 * 60 * 1000;
  const expired = await completeReset(server, user.email, otp);
  assert.equal(expired.response.status, 400);
  assert.deepEqual(expired.body, incorrect.body);
  assert.equal(user.studentSessionVersion, 0);
  assert.equal(await bcrypt.compare('original-student-password-123', user.passwordHash), true);
});

test('a consumed OTP cannot be replayed', async () => {
  resetFixtures();
  const { app, sentEmails } = createResetApp();
  const server = await listen(app);
  const user = await createStudent();
  await issueOtp(server);
  const otp = otpFrom(sentEmails[0]);
  assert.equal((await completeReset(server, user.email, otp)).response.status, 200);
  const replay = await completeReset(server, user.email, otp);
  assert.equal(replay.response.status, 400);
  assert.equal(replay.body.message, 'The code is invalid or expired. Request a new code and try again.');
  assert.equal(user.studentSessionVersion, 1);
});

test('concurrent completion attempts can consume a challenge only once', async () => {
  resetFixtures();
  const { app, sentEmails } = createResetApp();
  const server = await listen(app);
  const user = await createStudent();
  await issueOtp(server);
  const otp = otpFrom(sentEmails[0]);

  const results = await Promise.all([
    completeReset(server, user.email, otp),
    completeReset(server, user.email, otp),
  ]);
  assert.deepEqual(results.map((item) => item.response.status).sort(), [200, 400]);
  assert.equal(user.studentSessionVersion, 1);
  assert.equal(user.passwordResetOtpHash, undefined);
});

test('five incorrect OTP attempts lock and invalidate the challenge', async () => {
  resetFixtures();
  const { app, sentEmails } = createResetApp();
  const server = await listen(app);
  const user = await createStudent();
  await issueOtp(server);
  const otp = otpFrom(sentEmails[0]);
  const incorrectOtp = otp === '000000' ? '000001' : '000000';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await completeReset(server, user.email, incorrectOtp);
    assert.equal(result.response.status, 400);
  }
  assert.equal(user.passwordResetOtpAttempts, 5);
  assert.equal(user.passwordResetOtpHash, undefined);
  assert.equal((await completeReset(server, user.email, otp)).response.status, 400);
  assert.equal(user.studentSessionVersion, 0);
});

test('per-account resend cooldown and five-send hourly cap are atomic and reset after the window', async () => {
  resetFixtures();
  const clock = { value: initialTime };
  const { app, sentEmails } = createResetApp({ clock: () => clock.value });
  const server = await listen(app);
  const user = await createStudent();
  await issueOtp(server);
  await issueOtp(server);
  assert.equal(sentEmails.length, 1, 'a request inside 60 seconds does not send again');
  assert.equal(user.passwordResetOtpResendCount, 1);

  for (let send = 1; send < 5; send += 1) {
    clock.value += 60_001;
    await issueOtp(server);
  }
  assert.equal(sentEmails.length, 5);
  assert.equal(user.passwordResetOtpResendCount, 5);

  clock.value += 60_001;
  const capped = await issueOtp(server);
  assert.equal(capped.response.status, 202);
  assert.equal(sentEmails.length, 5, 'the sixth request within an hour is silently capped');
  assert.equal(user.passwordResetOtpResendCount, 5);

  clock.value = initialTime + 60 * 60 * 1000 + 1;
  await issueOtp(server);
  assert.equal(sentEmails.length, 6);
  assert.equal(user.passwordResetOtpResendCount, 1);
  assert.equal(user.passwordResetOtpResendWindowStartedAt.getTime(), clock.value);
});

test('simultaneous OTP requests on separate backend instances reserve one account send slot', async () => {
  resetFixtures();
  const rateLimitModel = createFakeRateLimitModel();
  const firstHarness = createResetApp({ rateLimitModel });
  const secondHarness = createResetApp({ rateLimitModel });
  const first = await listen(firstHarness.app);
  const second = await listen(secondHarness.app);
  const user = await createStudent();

  const responses = await Promise.all([issueOtp(first), issueOtp(second)]);
  assert.deepEqual(responses.map((result) => result.response.status), [202, 202]);
  assert.equal(firstHarness.sentEmails.length + secondHarness.sentEmails.length, 1);
  assert.equal(user.passwordResetOtpResendCount, 1);
  assert.ok(user.passwordResetOtpHash);
});

test('request and completion per-IP limits are shared between application instances', async () => {
  resetFixtures();
  const rateLimitModel = createFakeRateLimitModel();
  const first = await listen(createResetApp({ rateLimitModel }).app);
  const second = await listen(createResetApp({ rateLimitModel }).app);

  for (let index = 0; index < 9; index += 1) {
    const result = await requestAt(index % 2 ? first : second, '/api/auth/password-reset/request', {
      method: 'POST', body: { email: 'invalid-email' },
    });
    assert.equal(result.response.status, 400);
  }
  const requestLimited = await requestAt(second, '/api/auth/password-reset/request', {
    method: 'POST', body: { email: 'invalid-email' },
  });
  assert.equal(requestLimited.response.status, 400, 'the tenth request is allowed');
  const requestBlocked = await requestAt(first, '/api/auth/password-reset/request', {
    method: 'POST', body: { email: 'invalid-email' },
  });
  assert.equal(requestBlocked.response.status, 429, 'the eleventh request is blocked across instances');
  assert.ok(Number(requestBlocked.response.headers.get('retry-after')) > 0);

  for (let index = 0; index < 20; index += 1) {
    const result = await requestAt(index % 2 ? first : second, '/api/auth/password-reset/complete', {
      method: 'POST', body: {},
    });
    assert.equal(result.response.status, 400);
  }
  const completionBlocked = await requestAt(second, '/api/auth/password-reset/complete', {
    method: 'POST', body: {},
  });
  assert.equal(completionBlocked.response.status, 429, 'completion attempts are limited across instances');
});

test('origin validation and no-store headers apply to both password-reset endpoints', async () => {
  resetFixtures();
  const { app, sentEmails } = createResetApp();
  const server = await listen(app);
  await createStudent();

  for (const [path, body] of [
    ['/api/auth/password-reset/request', { email: 'student@example.test' }],
    ['/api/auth/password-reset/complete', {
      email: 'student@example.test', otp: '123456', newPassword: 'new-student-password-456', confirmPassword: 'new-student-password-456',
    }],
  ]) {
    const forbidden = await requestAt(server, path, { method: 'POST', body, origin: 'https://untrusted.example' });
    assert.equal(forbidden.response.status, 403);
    assert.equal(forbidden.response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(forbidden.body, { message: 'This request origin is not allowed.' });
  }
  assert.equal(sentEmails.length, 0);
  assert.equal(usersByEmail.get('student@example.test').passwordResetOtpHash, undefined);
});

test('reset endpoints reject administrator accounts even if an admin has reset fields', async () => {
  resetFixtures();
  const { app, sentEmails } = createResetApp();
  const server = await listen(app);
  const admin = await FakeUserModel.create({
    name: 'Administrator',
    email: 'admin@example.test',
    passwordHash: 'admin-hash',
    role: 'admin',
    passwordResetOtpHash: 'admin-should-never-reset',
    passwordResetOtpExpiresAt: new Date(initialTime + 60_000),
    passwordResetOtpAttempts: 0,
  });

  const requestResult = await issueOtp(server, admin.email);
  const completeResult = await completeReset(server, admin.email, '123456');
  assert.equal(requestResult.response.status, 202);
  assert.equal(completeResult.response.status, 400);
  assert.equal(sentEmails.length, 0);
  assert.equal(admin.passwordHash, 'admin-hash');
  assert.equal(admin.studentSessionVersion, 0);
  assert.equal(admin.passwordResetOtpHash, 'admin-should-never-reset');
});

test('reset-related fields and digest are never serialized by the User model or returned by endpoints', async () => {
  resetFixtures();
  const { app, sentEmails } = createResetApp();
  const server = await listen(app);
  const user = await createStudent();
  const requestResult = await issueOtp(server);
  const otp = otpFrom(sentEmails[0]);
  const digest = createHmac('sha256', pepper).update(`${user.email}\0${otp}`, 'utf8').digest('hex');
  assert.equal(user.passwordResetOtpHash, digest);
  assert.equal(JSON.stringify(requestResult.body).includes(digest), false);
  assert.equal(JSON.stringify(requestResult.body).includes(otp), false);

  const profileLogin = await requestAt(server, '/api/auth/login', {
    method: 'POST', body: { email: user.email, password: 'original-student-password-123' },
  });
  const profile = await requestAt(server, '/api/auth/me', { cookie: profileLogin.cookie });
  const serializedProfile = JSON.stringify(profile.body);
  for (const field of [
    'passwordResetOtpHash', 'passwordResetOtpExpiresAt', 'passwordResetOtpAttempts',
    'passwordResetOtpStatus',
    'passwordResetOtpActivationConfirmed',
    'passwordResetOtpLastSentAt', 'passwordResetOtpResendWindowStartedAt', 'passwordResetOtpResendCount',
    'studentSessionVersion', digest, otp,
  ]) assert.equal(serializedProfile.includes(field), false, `${field} must not appear in the profile response`);

  const serializedUser = new User({
    name: 'Serialized', email: 'serialized@example.test', passwordHash: 'private-hash',
    studentSessionVersion: 4, passwordResetOtpHash: digest, passwordResetOtpExpiresAt: new Date(),
    passwordResetOtpStatus: 'active',
    passwordResetOtpActivationConfirmed: true,
    passwordResetOtpAttempts: 1, passwordResetOtpLastSentAt: new Date(),
    passwordResetOtpResendWindowStartedAt: new Date(), passwordResetOtpResendCount: 2,
  }).toJSON();
  assert.equal(User.schema.path('passwordResetOtpStatus').options.select, false);
  assert.deepEqual(User.schema.path('passwordResetOtpStatus').options.enum, ['pending', 'active']);
  assert.equal(User.schema.path('passwordResetOtpActivationConfirmed').options.select, false);
  for (const field of ['passwordHash', 'studentSessionVersion', 'passwordResetOtpHash', 'passwordResetOtpExpiresAt', 'passwordResetOtpStatus', 'passwordResetOtpActivationConfirmed', 'passwordResetOtpAttempts', 'passwordResetOtpLastSentAt', 'passwordResetOtpResendWindowStartedAt', 'passwordResetOtpResendCount']) {
    assert.equal(Object.hasOwn(serializedUser, field), false);
  }
});

test('the rate-limit model has a unique fixed-window key and TTL cleanup indexes', async () => {
  const indexes = (await import('../src/models/PasswordResetRateLimit.js')).default.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => fields.scope === 1 && fields.ipHash === 1 && fields.windowStart === 1 && options.unique));
  assert.ok(indexes.some(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0));
});
