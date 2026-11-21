import test, { after, afterEach, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import session from 'express-session';

// This test must never consume MONGODB_URI, including a value supplied by a
// local .env file. Its only database URI is created by MongoMemoryServer below.
const appOrigin = 'http://127.0.0.1:5173';
const mongoVersion = '8.2.6';
const registrationPepper = 'integration-registration-otp-pepper-only-32-bytes';
const limiterSecret = 'integration-rate-limit-secret-only-32-bytes';
const adminPassword = 'integration-admin-password-only';
process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'test';
process.env.APP_ORIGIN = appOrigin;
process.env.SESSION_SECRET = 'integration-session-secret-only-32-bytes';
process.env.MONGODB_URI = '';
process.env.PUBLIC_BETA_REGISTRATION_ENABLED = 'false';
process.env.PUBLIC_BETA_PAID_PURCHASES_ENABLED = 'false';
process.env.MONGOMS_VERSION = mongoVersion;
process.env.MONGOMS_SYSTEM_BINARY = '';
process.env.MONGOMS_DOWNLOAD_URL = '';
process.env.MONGOMS_MD5_CHECK = 'true';

const { MongoMemoryServer } = await import('mongodb-memory-server');
const [
  { createApp },
  { default: UserSchemaModel },
  { default: ChallengeSchemaModel },
  { default: RateLimitSchemaModel },
  { default: EmailOutboxSchemaModel },
  { registrationInvitationDigest },
  { hashPassword },
] = await Promise.all([
  import('../src/app.js'),
  import('../src/models/User.js'),
  import('../src/models/RegistrationVerificationChallenge.js'),
  import('../src/models/PasswordResetRateLimit.js'),
  import('../src/models/EmailDeliveryOutbox.js'),
  import('../src/services/registrationVerification.js'),
  import('../src/utils/credentials.js'),
]);

let mongoServer;
let databaseConnection;
let UserModel;
let ChallengeModel;
let RateLimitModel;
let EmailOutboxModel;
let databaseName;
let adminHash;
let server;
let baseUrl;
let adminCookie;
let now;
let sentEmails;
let latestOtp;
let deliveryHold;
let backgroundTasks;

function assertDisposableLocalUri(uri, expectedDatabaseName) {
  const parsed = new URL(uri);
  const parsedDatabaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, '').replace(/\/$/u, ''));
  if (parsed.protocol !== 'mongodb:'
    || parsed.hostname !== '127.0.0.1'
    || parsed.username || parsed.password
    || parsedDatabaseName !== expectedDatabaseName
    || !/^mednexora_reg_it_[a-f\d]{32}$/u.test(expectedDatabaseName)) {
    throw new Error('Refusing to connect: the integration test URI is not an isolated local test database.');
  }
}

function makeDeliveryHold() {
  let release;
  let markStarted;
  const hold = {
    started: new Promise((resolve) => { markStarted = resolve; }),
    result: new Promise((resolve) => { release = resolve; }),
    markStarted: () => markStarted(),
    release: () => release({ sent: true }),
  };
  return hold;
}

function makeRequestResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { return this; },
  };
}

async function send(method, path, body, cookie = null) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Origin: appOrigin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = response.status === 204 ? null : await response.json();
  return {
    response,
    payload,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie,
  };
}

const adminPost = (path, body, cookie = adminCookie) => send('POST', path, body, cookie);
const adminDelete = (path, cookie = adminCookie) => send('DELETE', path, {}, cookie);
const issueInvitation = (email, cookie = adminCookie) => adminPost('/api/admin/staging-registration-invitations', { email }, cookie);
async function requestOtp(email, invitationToken) {
  const result = await send('POST', '/api/auth/registration/request-otp', { email, invitationToken }, null);
  while (backgroundTasks.length) await backgroundTasks.shift()();
  return result;
}
const verifyOtp = (email, otp) => send('POST', '/api/auth/registration/verify-otp', { email, otp }, null);

async function registerStudent({ email, invitationToken, verificationToken, password = 'integration-student-password-only-2026' }) {
  return adminPost('/api/auth/register', {
    name: 'Mongo Integration Student',
    email,
    password,
    invitationToken,
    verificationToken,
  }, null);
}

async function loginAdmin() {
  const loggedIn = await adminPost('/api/admin/login', {
    username: 'mongo-integration-admin',
    password: adminPassword,
  }, null);
  assert.equal(loggedIn.response.status, 200, 'admin test fixture must authenticate');
  adminCookie = loggedIn.cookie;
  assert.ok(adminCookie, 'admin login must set its session cookie');
}

async function createInvitationFor(email) {
  const issued = await issueInvitation(email);
  assert.equal(issued.response.status, 201, JSON.stringify(issued.payload));
  assert.equal(issued.payload.invitation.email, email.trim().toLowerCase());
  assert.equal(issued.payload.invitation.status, 'active');
  assert.match(issued.payload.token, /^[A-Za-z0-9_-]{43}$/u);
  return issued.payload;
}

async function submitOtp(email, invitationToken) {
  const result = await requestOtp(email, invitationToken);
  assert.equal(result.response.status, 202);
  assert.equal(sentEmails.at(-1)?.to, email.trim().toLowerCase());
  assert.match(latestOtp ?? '', /^\d{6}$/u);
  return latestOtp;
}

before(async () => {
  databaseName = `mednexora_reg_it_${randomUUID().replaceAll('-', '')}`;
  mongoServer = await MongoMemoryServer.create({
    binary: { version: mongoVersion, checkMD5: true, systemBinary: '' },
    instance: { ip: '127.0.0.1', dbName: databaseName },
  });
  const uri = mongoServer.getUri(databaseName);
  assertDisposableLocalUri(uri, databaseName);
  databaseConnection = await mongoose.createConnection(uri, { autoIndex: true }).asPromise();
  if (databaseConnection.name !== databaseName || databaseConnection.host !== '127.0.0.1') {
    throw new Error('Refusing to run: Mongoose did not connect to the expected disposable local database.');
  }

  UserModel = databaseConnection.model('User', UserSchemaModel.schema);
  ChallengeModel = databaseConnection.model('RegistrationVerificationChallenge', ChallengeSchemaModel.schema);
  RateLimitModel = databaseConnection.model('PasswordResetRateLimit', RateLimitSchemaModel.schema);
  EmailOutboxModel = databaseConnection.model('EmailDeliveryOutbox', EmailOutboxSchemaModel.schema);
  await Promise.all([UserModel.init(), ChallengeModel.init(), RateLimitModel.init(), EmailOutboxModel.init()]);

  const buildInfo = await databaseConnection.db.admin().command({ buildInfo: 1 });
  assert.equal(buildInfo.version, mongoVersion, 'the test must run against the pinned real MongoDB server version');
  adminHash = await hashPassword(adminPassword);
});

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ChallengeModel.deleteMany({}),
    RateLimitModel.deleteMany({}),
    EmailOutboxModel.deleteMany({}),
  ]);
  now = new Date();
  sentEmails = [];
  latestOtp = null;
  deliveryHold = null;
  backgroundTasks = [];
  adminCookie = null;

  await UserModel.create({
    name: 'Mongo Integration Admin',
    email: 'mongo-integration-admin@example.test',
    adminUsername: 'mongo-integration-admin',
    passwordHash: adminHash,
    role: 'admin',
    adminSessionVersion: 0,
  });

  const emailProvider = {
    async send(message) {
      const code = message.text?.match(/verification code is (\d{6})/iu)?.[1] ?? null;
      if (code) latestOtp = code;
      sentEmails.push({ to: message.to, subject: message.subject });
      if (deliveryHold) {
        const hold = deliveryHold;
        deliveryHold = null;
        hold.markStarted();
        return hold.result;
      }
      return { sent: true };
    },
  };
  const app = createApp({
    sessionStore: new session.MemoryStore(),
    UserModel,
    RegistrationVerificationChallengeModel: ChallengeModel,
    EmailOutboxModel,
    PasswordResetRateLimitModel: RateLimitModel,
    registrationEnabled: false,
    launchConfig: { registrationEnabled: false, paidPurchasesEnabled: false },
    stagingRestrictedRegistrationEnabled: true,
    stagingRegistrationInvitationTtlMinutes: 5,
    registrationEmailVerificationEnabled: true,
    registrationOtpPepper: registrationPepper,
    registrationEmailProvider: emailProvider,
    passwordResetEmailProvider: emailProvider,
    passwordResetEmailEnabled: false,
    passwordResetRateLimitSecret: limiterSecret,
    registrationNow: () => new Date(now),
    passwordResetNow: () => new Date(now),
    secureCookies: false,
    trustProxy: false,
    backgroundTaskScheduler(task) { backgroundTasks.push(task); },
  });
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await loginAdmin();
});

afterEach(async () => {
  if (server?.listening) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  server = null;
  baseUrl = null;
});

after(async () => {
  try {
    if (databaseConnection) {
      if (!/^mednexora_reg_it_[a-f\d]{32}$/u.test(databaseConnection.name)
        || databaseConnection.host !== '127.0.0.1') {
        throw new Error('Refusing cleanup: database connection is not the isolated integration database.');
      }
      await databaseConnection.dropDatabase();
      await databaseConnection.close();
    }
  } finally {
    await mongoServer?.stop();
  }
});

test('real MongoDB indexes initialize and enforce their actual constraints', async () => {
  const challengeIndexes = await ChallengeModel.collection.indexes();
  const emailIndex = challengeIndexes.find((index) => index.name === 'uniq_registration_verification_email');
  const invitationIdIndex = challengeIndexes.find((index) => index.name === 'registration_invitation_id');
  const cleanupIndex = challengeIndexes.find((index) => index.name === 'ttl_registration_verification_cleanup');
  assert.deepEqual(emailIndex?.key, { email: 1 });
  assert.equal(emailIndex?.unique, true);
  assert.deepEqual(invitationIdIndex?.key, { 'invitations._id': 1 });
  assert.notEqual(invitationIdIndex?.unique, true);
  assert.deepEqual(cleanupIndex?.key, { cleanupAt: 1 });
  assert.equal(cleanupIndex?.expireAfterSeconds, 0);

  const rateIndexes = await RateLimitModel.collection.indexes();
  const limiterUnique = rateIndexes.find((index) => index.key.scope === 1 && index.key.ipHash === 1 && index.key.windowStart === 1);
  const limiterTtl = rateIndexes.find((index) => index.key.expiresAt === 1);
  assert.equal(limiterUnique?.unique, true);
  assert.equal(limiterTtl?.expireAfterSeconds, 0);

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const challenge = {
    email: 'MixedCase@example.test',
    status: 'invited',
    expiresAt,
    cleanupAt: new Date(expiresAt.getTime() + 60 * 60 * 1000),
  };
  await ChallengeModel.create(challenge);
  assert.equal(await ChallengeModel.exists({ email: 'mixedcase@example.test' }) !== null, true);
  await assert.rejects(ChallengeModel.create({ ...challenge, email: 'mixedcase@example.test' }), (error) => error?.code === 11000);
  await assert.rejects(UserModel.create({
    name: 'Duplicate Admin Email',
    email: 'MONGO-INTEGRATION-ADMIN@example.test',
    passwordHash: adminHash,
    role: 'admin',
  }), (error) => error?.code === 11000);

  // TTL deletion is asynchronous; expiry is enforced by application queries.
  const oldChallengeCount = await ChallengeModel.countDocuments({ email: 'mixedcase@example.test' });
  assert.equal(oldChallengeCount, 1);
});

test('Mongo-backed limiter shares atomic counters and rejects excess requests', async () => {
  const { createMongoRateLimiter } = await import('../src/middleware/mongoRateLimit.js');
  const limit = createMongoRateLimiter({
    RateLimitModel,
    secret: limiterSecret,
    scope: 'registration-request',
    windowMs: 60_000,
    max: 3,
    now: () => new Date(now),
  });
  const secondInstanceLimit = createMongoRateLimiter({
    RateLimitModel,
    secret: limiterSecret,
    scope: 'registration-request',
    windowMs: 60_000,
    max: 3,
    now: () => new Date(now),
  });
  const results = await Promise.all(Array.from({ length: 8 }, async (_value, index) => {
    const response = makeRequestResponse();
    const limiter = index % 2 ? limit : secondInstanceLimit;
    await limiter({ ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } }, response, (error) => {
      if (error) throw error;
    });
    return response.statusCode;
  }));
  assert.equal(results.filter((status) => status === 200).length, 3);
  assert.equal(results.filter((status) => status === 429).length, 5);
  assert.equal(await RateLimitModel.countDocuments({ scope: 'registration-request' }), 1);
  const bucket = await RateLimitModel.findOne({ scope: 'registration-request' });
  assert.equal(bucket.count, 8);
  assert.equal(bucket.ipHash.includes('127.0.0.1'), false);
});

test('invitation creation, replacement, email binding, and revocation use real MongoDB updates', async () => {
  const denied = await issueInvitation('one@example.test', null);
  assert.equal(denied.response.status, 401);

  const first = await createInvitationFor(' One@Example.Test ');
  const rawFirst = await databaseConnection.db.collection(ChallengeModel.collection.name).findOne({ email: 'one@example.test' });
  assert.equal(rawFirst.invitations.length, 1);
  assert.equal(rawFirst.invitations[0].tokenDigest.length, 64);
  assert.equal(JSON.stringify(rawFirst).includes(first.token), false);
  assert.equal(rawFirst.invitations[0]._id._bsontype, 'ObjectId');
  assert.equal(rawFirst.invitations[0].issuedBy.toString(), (await UserModel.findOne({ role: 'admin' }))._id.toString());
  assert.ok(rawFirst.invitations[0].expiresAt instanceof Date);

  const second = await createInvitationFor('one@example.test');
  assert.notEqual(second.token, first.token);
  const rawSecond = await databaseConnection.db.collection(ChallengeModel.collection.name).findOne({ email: 'one@example.test' });
  assert.equal(rawSecond.invitations.length, 2);
  assert.deepEqual(rawSecond.invitations.map((entry) => entry.status), ['revoked', 'active']);
  assert.equal(rawSecond.invitationId.toString(), rawSecond.invitations[1]._id.toString());

  const wrongEmail = await requestOtp('other@example.test', second.token);
  assert.equal(wrongEmail.response.status, 202);
  assert.equal(sentEmails.length, 0);
  const staleToken = await requestOtp('one@example.test', first.token);
  assert.equal(staleToken.response.status, 202);
  assert.equal(sentEmails.length, 0);
  const accepted = await requestOtp('ONE@example.test', second.token);
  assert.equal(accepted.response.status, 202);
  assert.equal(sentEmails.length, 1);
  let saved = await ChallengeModel.findOne({ email: 'one@example.test' }).select('+otpDigest +invitationId');
  assert.equal(saved.status, 'active');
  assert.equal(saved.invitationId.toString(), rawSecond.invitations[1]._id.toString());

  const revoked = await adminDelete(`/api/admin/staging-registration-invitations/${second.invitation.id}`);
  assert.equal(revoked.response.status, 200);
  saved = await ChallengeModel.findOne({ email: 'one@example.test' });
  assert.equal(saved.status, 'locked');
  assert.equal(saved.invitationId, undefined);
  assert.equal((await requestOtp('one@example.test', second.token)).response.status, 202);
  assert.equal(sentEmails.length, 1);
});

test('expired invitation and expired OTP are rejected by application checks, not TTL timing', async () => {
  const invitation = await createInvitationFor('expired@example.test');
  const expiredInvitation = new Date(now.getTime() + 5 * 60 * 1000 + 1);
  now = expiredInvitation;
  assert.equal((await requestOtp('expired@example.test', invitation.token)).response.status, 202);
  assert.equal(sentEmails.length, 0);

  now = new Date();
  const otpInvitation = await createInvitationFor('otp-expiry@example.test');
  const otp = await submitOtp('otp-expiry@example.test', otpInvitation.token);
  now = new Date(now.getTime() + 10 * 60 * 1000 + 1);
  const expired = await verifyOtp('otp-expiry@example.test', otp);
  assert.equal(expired.response.status, 400);
  assert.equal(expired.payload.message, 'The code is invalid or expired. Request a new code and try again.');
  assert.equal(await UserModel.countDocuments({ email: 'otp-expiry@example.test' }), 0);
});

test('pending OTP cannot verify before provider acceptance; successful delivery activates that challenge', async () => {
  const invitation = await createInvitationFor('pending@example.test');
  const hold = makeDeliveryHold();
  deliveryHold = hold;
  const pendingRequest = requestOtp('pending@example.test', invitation.token);
  await hold.started;
  const rawOutboxJob = await databaseConnection.db.collection(EmailOutboxModel.collection.name).findOne({
    type: 'registration-verification',
    status: 'processing',
  });
  assert.ok(rawOutboxJob, 'the request is dispatched only after its MongoDB outbox row has been claimed');
  assert.ok(rawOutboxJob.payloadCiphertext);
  assert.equal(JSON.stringify(rawOutboxJob).includes(invitation.token), false, 'the reusable invitation token is encrypted at rest');
  assert.equal(JSON.stringify(rawOutboxJob).includes(latestOtp), false, 'the OTP is encrypted at rest');
  assert.equal(JSON.stringify(rawOutboxJob).includes('pending@example.test'), false, 'the recipient address is encrypted at rest');
  const pendingChallenge = await ChallengeModel.findOne({ email: 'pending@example.test' }).select('+otpDigest');
  assert.equal(pendingChallenge.status, 'pending');
  const rejectedPending = await verifyOtp('pending@example.test', latestOtp);
  assert.equal(rejectedPending.response.status, 400);
  hold.release();
  const sent = await pendingRequest;
  assert.equal(sent.response.status, 202);
  const activated = await ChallengeModel.findOne({ email: 'pending@example.test' }).select('+otpDigest');
  assert.equal(activated.status, 'active');
  assert.equal((await verifyOtp('pending@example.test', latestOtp)).response.status, 200);
  const terminalOutboxJob = await databaseConnection.db.collection(EmailOutboxModel.collection.name).findOne({ _id: rawOutboxJob._id });
  assert.equal(terminalOutboxJob.status, 'delivered');
  assert.equal(terminalOutboxJob.payloadCiphertext, undefined, 'terminal jobs remove encrypted message payloads');
});

test('incorrect OTP attempts update atomically and lock after five concurrent failures', async () => {
  const invitation = await createInvitationFor('attempts@example.test');
  const correctOtp = await submitOtp('attempts@example.test', invitation.token);
  const wrongOtp = String((Number(correctOtp) + 1) % 1_000_000).padStart(6, '0');
  const attempts = await Promise.all(Array.from({ length: 8 }, () => verifyOtp('attempts@example.test', wrongOtp)));
  assert.ok(attempts.every((result) => result.response.status === 400));
  const locked = await ChallengeModel.findOne({ email: 'attempts@example.test' }).select('+otpDigest');
  assert.equal(locked.attempts, 5);
  assert.equal(locked.status, 'locked');
  assert.equal(locked.otpDigest, undefined);
  assert.equal((await verifyOtp('attempts@example.test', correctOtp)).response.status, 400);
});

test('resending after cooldown invalidates the prior OTP while preserving one active challenge', async () => {
  const invitation = await createInvitationFor('resend@example.test');
  const firstOtp = await submitOtp('resend@example.test', invitation.token);
  now = new Date(now.getTime() + 60_001);
  const secondOtp = await submitOtp('resend@example.test', invitation.token);
  assert.notEqual(secondOtp, firstOtp);
  assert.equal((await verifyOtp('resend@example.test', firstOtp)).response.status, 400);
  const current = await ChallengeModel.findOne({ email: 'resend@example.test' }).select('+otpDigest');
  assert.equal(current.status, 'active');
  assert.equal(current.attempts, 1);
  assert.equal((await verifyOtp('resend@example.test', secondOtp)).response.status, 200);
});

test('registration requires OTP proof and invitation, binds both to one email, and creates only verified students', async () => {
  const invitation = await createInvitationFor('student@example.test');
  const otp = await submitOtp('student@example.test', invitation.token);
  const noProof = await registerStudent({ email: 'student@example.test', invitationToken: invitation.token });
  assert.equal(noProof.response.status, 400);
  assert.equal(await UserModel.countDocuments({ email: 'student@example.test' }), 0);

  const verified = await verifyOtp('student@example.test', otp);
  assert.equal(verified.response.status, 200);
  const invalidInvitation = await registerStudent({
    email: 'student@example.test',
    invitationToken: 'A'.repeat(43),
    verificationToken: verified.payload.verificationToken,
  });
  assert.equal(invalidInvitation.response.status, 400);
  const wrongEmail = await registerStudent({
    email: 'different@example.test',
    invitationToken: invitation.token,
    verificationToken: verified.payload.verificationToken,
  });
  assert.equal(wrongEmail.response.status, 400);
  assert.equal(await UserModel.countDocuments({ role: 'student' }), 0);

  const created = await registerStudent({
    email: 'student@example.test',
    invitationToken: invitation.token,
    verificationToken: verified.payload.verificationToken,
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const savedStudent = await UserModel.findOne({ email: 'student@example.test' });
  assert.equal(savedStudent.emailVerified, true);
  assert.equal(savedStudent.role, 'student');
  assert.equal(savedStudent.passwordHash, undefined, 'password hashes must remain excluded from ordinary Mongoose queries');
  const rawStudent = await databaseConnection.db.collection(UserModel.collection.name).findOne({ email: 'student@example.test' });
  assert.equal(typeof rawStudent.passwordHash, 'string', 'the password hash must be persisted');
  assert.notEqual(rawStudent.passwordHash, 'integration-student-password-only-2026');
  assert.equal(Object.hasOwn(created.payload.user, 'passwordHash'), false, 'the registration response must not expose the password hash');
  const consumedChallenge = await ChallengeModel.findOne({ email: 'student@example.test' });
  assert.equal(consumedChallenge.status, 'consumed');
  assert.equal(consumedChallenge.invitations[0].status, 'consumed');
  assert.equal(consumedChallenge.invitationId, undefined);

  const replay = await registerStudent({
    email: 'student@example.test',
    invitationToken: invitation.token,
    verificationToken: verified.payload.verificationToken,
  });
  assert.equal(replay.response.status, 400);
  assert.equal(await UserModel.countDocuments({ email: 'student@example.test' }), 1);
  assert.equal((await send('GET', '/api/auth/me', undefined, created.cookie)).response.status, 200);
});

test('expired invitation cannot complete registration after OTP verification', async () => {
  const invitation = await createInvitationFor('expired-final@example.test');
  const otp = await submitOtp('expired-final@example.test', invitation.token);
  const verified = await verifyOtp('expired-final@example.test', otp);
  assert.equal(verified.response.status, 200);
  now = new Date(now.getTime() + 5 * 60 * 1000 + 1);
  const result = await registerStudent({
    email: 'expired-final@example.test',
    invitationToken: invitation.token,
    verificationToken: verified.payload.verificationToken,
  });
  assert.equal(result.response.status, 400);
  assert.equal(await UserModel.countDocuments({ email: 'expired-final@example.test' }), 0);
});

test('two concurrent invitation replacements leave exactly one usable token', async () => {
  await createInvitationFor('replace-race@example.test');
  const [left, right] = await Promise.all([
    issueInvitation('replace-race@example.test'),
    issueInvitation('replace-race@example.test'),
  ]);
  assert.deepEqual([left.response.status, right.response.status].sort(), [201, 201]);
  const raw = await databaseConnection.db.collection(ChallengeModel.collection.name).findOne({ email: 'replace-race@example.test' });
  const active = raw.invitations.filter((entry) => entry.status === 'active');
  assert.equal(active.length, 1);
  const activeToken = [left.payload.token, right.payload.token].find((token) => active[0].tokenDigest === registrationInvitationDigest(token));
  assert.ok(activeToken, 'the current token must match the sole active invitation digest');
  const inactiveToken = [left.payload.token, right.payload.token].find((token) => token !== activeToken);
  assert.equal((await requestOtp('replace-race@example.test', inactiveToken)).response.status, 202);
  assert.equal(sentEmails.length, 0);
  assert.equal((await requestOtp('replace-race@example.test', activeToken)).response.status, 202);
  assert.equal(sentEmails.length, 1);
});

test('simultaneous OTP verification and registration completion consume proof and invitation once', async () => {
  const invitation = await createInvitationFor('concurrent@example.test');
  const otp = await submitOtp('concurrent@example.test', invitation.token);
  const verificationAttempts = await Promise.all([
    verifyOtp('concurrent@example.test', otp),
    verifyOtp('concurrent@example.test', otp),
  ]);
  const successfulVerifications = verificationAttempts.filter((result) => result.response.status === 200);
  assert.equal(successfulVerifications.length, 1);
  const proof = successfulVerifications[0].payload.verificationToken;
  const body = {
    email: 'concurrent@example.test',
    invitationToken: invitation.token,
    verificationToken: proof,
  };
  const registrations = await Promise.all([registerStudent(body), registerStudent(body)]);
  assert.equal(registrations.filter((result) => result.response.status === 201).length, 1);
  assert.equal(await UserModel.countDocuments({ email: 'concurrent@example.test', role: 'student' }), 1);
  const finalChallenge = await ChallengeModel.findOne({ email: 'concurrent@example.test' });
  assert.equal(finalChallenge.status, 'consumed');
  assert.equal(finalChallenge.invitations.filter((entry) => entry.status === 'consumed').length, 1);
});

test('MongoDB version is reported by the test suite, with exact runtime asserted at setup', async () => {
  const buildInfo = await databaseConnection.db.admin().command({ buildInfo: 1 });
  assert.equal(buildInfo.version, mongoVersion);
  assert.equal(databaseConnection.name.startsWith('mednexora_reg_it_'), true);
  assert.equal(databaseConnection.host, '127.0.0.1');
});
