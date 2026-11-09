import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-bytes';
process.env.APP_ORIGIN = 'http://localhost:5173';

const [{ createApp }, session, bcrypt, UserModule] = await Promise.all([
  import('../src/app.js'),
  import('express-session'),
  import('bcryptjs'),
  import('../src/models/User.js'),
]);
const User = UserModule.default;

class EmptyQuery {
  constructor(value) { this.value = value; }
  select() { return this; }
  populate() { return this; }
  sort() { return this; }
  limit() { return this; }
  async lean() { return this.value; }
  then(resolve, reject) { return Promise.resolve(this.value).then(resolve, reject); }
}

class EmptyDashboardModel {
  static find() { return new EmptyQuery([]); }
  static findOne() { return new EmptyQuery(null); }
  static async countDocuments() { return 0; }
}

let usersByEmail;
let usersById;
let nextId;
let createFailure;
let duplicateOnCreate;
let server;
let baseUrl;

class FakeUserModel {
  static async exists({ email }) {
    return usersByEmail.has(email) ? { _id: usersByEmail.get(email)._id } : null;
  }

  static findOne({ email }) {
    return { select: async () => usersByEmail.get(email) ?? null };
  }

  static async create(data) {
    if (createFailure) throw createFailure;
    if (duplicateOnCreate) {
      const error = new Error('Duplicate email');
      error.code = 11000;
      error.keyPattern = { email: 1 };
      throw error;
    }
    if (usersByEmail.has(data.email)) {
      const error = new Error('Duplicate email');
      error.code = 11000;
      error.keyPattern = { email: 1 };
      throw error;
    }
    const id = String(nextId++);
    const user = { ...data, _id: id, id, createdAt: new Date(), updatedAt: new Date() };
    usersByEmail.set(user.email, user);
    usersById.set(id, user);
    return user;
  }

  static async findById(id) {
    return usersById.get(String(id)) ?? null;
  }
}

beforeEach(async () => {
  usersByEmail = new Map();
  usersById = new Map();
  nextId = 1;
  createFailure = null;
  duplicateOnCreate = false;
  server = createApp({
    sessionStore: new session.MemoryStore(),
    UserModel: FakeUserModel,
    ProductModel: EmptyDashboardModel,
    CourseModel: EmptyDashboardModel,
    CourseProgressModel: EmptyDashboardModel,
    TestAttemptModel: EmptyDashboardModel,
    PurchasedAccessModel: EmptyDashboardModel,
    OrderModel: EmptyDashboardModel,
    QuestionBankModel: EmptyDashboardModel,
    MockTestModel: EmptyDashboardModel,
    SubjectModel: EmptyDashboardModel,
    TopicModel: EmptyDashboardModel,
  });
  await new Promise((resolve) => {
    server = server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(path, { method = 'GET', body, cookie, origin, fetchSite } = {}) {
  return requestAt(baseUrl, path, { method, body, cookie, origin, fetchSite });
}

async function requestAt(url, path, { method = 'GET', body, cookie, origin, fetchSite, forwardedProto } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  if (fetchSite) headers['Sec-Fetch-Site'] = fetchSite;
  if (forwardedProto) headers['X-Forwarded-Proto'] = forwardedProto;
  const response = await fetch(`${url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseBody = response.status === 204 ? null : await response.json();
  const setCookie = response.headers.get('set-cookie');
  return {
    response,
    body: responseBody,
    cookie: setCookie ? setCookie.split(';')[0] : null,
    setCookie,
  };
}

function createAuthTestApp(overrides = {}) {
  return createApp({
    sessionStore: new session.MemoryStore(),
    UserModel: FakeUserModel,
    ProductModel: EmptyDashboardModel,
    CourseModel: EmptyDashboardModel,
    CourseProgressModel: EmptyDashboardModel,
    TestAttemptModel: EmptyDashboardModel,
    PurchasedAccessModel: EmptyDashboardModel,
    OrderModel: EmptyDashboardModel,
    QuestionBankModel: EmptyDashboardModel,
    MockTestModel: EmptyDashboardModel,
    SubjectModel: EmptyDashboardModel,
    TopicModel: EmptyDashboardModel,
    ...overrides,
  });
}

async function listen(app) {
  const instance = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    instance.once('listening', resolve);
    instance.once('error', reject);
  });
  return instance;
}

test('registration and login create a safe profile, access dashboard, and logout', async () => {
  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Asha Student', email: ' ASHA@example.com ', password: 'careful-study-pass-42', role: 'admin' },
  });
  assert.equal(registration.response.status, 201);
  assert.equal(registration.body.user.email, 'asha@example.com');
  assert.equal(registration.body.user.name, 'Asha Student');
  assert.equal('passwordHash' in registration.body.user, false);
  assert.equal('role' in registration.body.user, false);
  assert.match(registration.setCookie, /HttpOnly/i);
  assert.match(registration.setCookie, /SameSite=Lax/i);
  assert.equal(registration.response.headers.get('cache-control'), 'no-store');
  assert.equal(registration.response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(registration.response.headers.get('x-frame-options'), 'DENY');
  assert.equal(registration.response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(usersByEmail.get('asha@example.com').role, 'student');
  assert.notEqual(usersByEmail.get('asha@example.com').passwordHash, 'careful-study-pass-42');
  assert.equal(await bcrypt.compare('careful-study-pass-42', usersByEmail.get('asha@example.com').passwordHash), true);

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'asha@example.com', password: 'careful-study-pass-42' },
  });
  assert.equal(login.response.status, 200);
  assert.ok(login.cookie);
  assert.equal(login.response.headers.get('cache-control'), 'no-store');
  assert.notEqual(login.cookie, registration.cookie, 'login should rotate the session identifier');

  const profile = await request('/api/auth/me', { cookie: login.cookie });
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.user.email, 'asha@example.com');
  assert.equal(profile.response.headers.get('cache-control'), 'no-store');
  assert.equal('passwordHash' in profile.body.user, false);

  const dashboard = await request('/api/student/dashboard', { cookie: login.cookie });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.user.email, 'asha@example.com');
  assert.equal(dashboard.response.headers.get('cache-control'), 'no-store');

  const refreshedDashboard = await request('/api/student/dashboard', { cookie: login.cookie });
  assert.equal(refreshedDashboard.response.status, 200, 'a valid session can refresh the protected dashboard');
  assert.equal(refreshedDashboard.body.user.email, 'asha@example.com');
  assert.equal(refreshedDashboard.response.headers.get('cache-control'), 'no-store');

  const logout = await request('/api/auth/logout', { method: 'POST', cookie: login.cookie });
  assert.equal(logout.response.status, 204);
  assert.equal(logout.response.headers.get('cache-control'), 'no-store');
  assert.match(logout.setCookie, /(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i, 'logout expires the browser session cookie');
  const afterLogout = await request('/api/auth/me', { cookie: login.cookie });
  assert.equal(afterLogout.response.status, 401);
  assert.equal(afterLogout.response.headers.get('cache-control'), 'no-store');
  const dashboardAfterLogout = await request('/api/student/dashboard', { cookie: login.cookie });
  assert.equal(dashboardAfterLogout.response.status, 401, 'the destroyed session cannot reopen private dashboard data');
  assert.equal(dashboardAfterLogout.response.headers.get('cache-control'), 'no-store');
});

test('Secure student cookies are emitted behind Railway’s trusted HTTPS proxy and persist across profile refresh', async () => {
  const details = { name: 'Asha Student', email: 'asha@example.com', password: 'careful-study-pass-42' };
  const registration = await request('/api/auth/register', { method: 'POST', body: details });
  assert.equal(registration.response.status, 201);

  const untrustedServer = await listen(createAuthTestApp({ secureCookies: true, trustProxy: false }));
  const untrustedUrl = `http://127.0.0.1:${untrustedServer.address().port}`;
  try {
    const missingProxyTrust = await requestAt(untrustedUrl, '/api/auth/login', {
      method: 'POST', body: { email: details.email, password: details.password }, forwardedProto: 'https',
    });
    assert.equal(missingProxyTrust.response.status, 200);
    assert.equal(missingProxyTrust.setCookie, null, 'express-session omits Secure cookies when the HTTPS proxy is not trusted');
  } finally {
    await new Promise((resolve, reject) => untrustedServer.close((error) => error ? reject(error) : resolve()));
  }

  const trustedServer = await listen(createAuthTestApp({ secureCookies: true, trustProxy: 1 }));
  const trustedUrl = `http://127.0.0.1:${trustedServer.address().port}`;
  try {
    const login = await requestAt(trustedUrl, '/api/auth/login', {
      method: 'POST', body: { email: details.email, password: details.password }, forwardedProto: 'https',
    });
    assert.equal(login.response.status, 200);
    assert.ok(login.cookie);
    assert.match(login.setCookie, /HttpOnly/i);
    assert.match(login.setCookie, /Secure/i);
    assert.match(login.setCookie, /SameSite=Lax/i);
    assert.match(login.setCookie, /Path=\//i);
    assert.doesNotMatch(login.setCookie, /Domain=/i);

    const profile = await requestAt(trustedUrl, '/api/auth/me', { cookie: login.cookie, forwardedProto: 'https' });
    assert.equal(profile.response.status, 200);
    assert.equal(profile.body.user.email, details.email);

    const refreshedDashboard = await requestAt(trustedUrl, '/api/student/dashboard', { cookie: login.cookie, forwardedProto: 'https' });
    assert.equal(refreshedDashboard.response.status, 200);
    assert.equal(refreshedDashboard.body.user.email, details.email);
  } finally {
    await new Promise((resolve, reject) => trustedServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('invalid credentials return the same safe authentication error', async () => {
  await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Riya Student', email: 'riya@example.com', password: 'learning-safely-123' },
  });
  const wrongPassword = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'riya@example.com', password: 'incorrect-password-123' },
  });
  const unknownEmail = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'nobody@example.com', password: 'incorrect-password-123' },
  });
  assert.equal(wrongPassword.response.status, 401);
  assert.deepEqual(wrongPassword.body, { message: 'Email or password is incorrect.' });
  assert.deepEqual(unknownEmail.body, wrongPassword.body);
});

test('duplicate registration is rejected with the safe login instruction', async () => {
  const details = { name: 'Devika Student', email: 'devika@example.com', password: 'student-nursing-pass-3' };
  const first = await request('/api/auth/register', { method: 'POST', body: details });
  const duplicate = await request('/api/auth/register', { method: 'POST', body: details });
  assert.equal(first.response.status, 201);
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.message, 'This email is already registered. Please log in instead.');
  assert.equal(usersByEmail.size, 1);
  assert.equal('passwordHash' in duplicate.body, false);
});

test('the MongoDB duplicate-key race path returns the same safe duplicate message', async () => {
  duplicateOnCreate = true;
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Devika Student', email: 'devika@example.com', password: 'student-nursing-pass-3' },
  });
  assert.equal(result.response.status, 409);
  assert.deepEqual(result.body, { message: 'This email is already registered. Please log in instead.' });
  assert.equal(usersByEmail.size, 0);
});

test('profile and student-only routes reject unauthenticated requests', async () => {
  const profile = await request('/api/auth/me');
  const dashboard = await request('/api/student/dashboard');
  assert.equal(profile.response.status, 401);
  assert.equal(dashboard.response.status, 401);
  assert.equal(profile.response.headers.get('cache-control'), 'no-store');
  assert.equal(dashboard.response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(profile.body, { message: 'Please log in to continue.' });
  assert.deepEqual(dashboard.body, profile.body);
});

test('registration gives safe, specific validation messages and identifies missing fields', async () => {
  const badEmail = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Mina Student', email: 'invalid', password: 'nursing-student-pass-4' },
  });
  const shortPassword = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Mina Student', email: 'mina@example.com', password: 'short' },
  });
  const longPassword = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Mina Student', email: 'long@example.com', password: '🩺'.repeat(19) },
  });
  const missing = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Mina Student', password: 'nursing-student-pass-4' },
  });
  const allMissing = await request('/api/auth/register', { method: 'POST', body: {} });

  assert.equal(badEmail.response.status, 400);
  assert.deepEqual(badEmail.body, { message: 'Please enter a valid email address.' });
  assert.equal(shortPassword.response.status, 400);
  assert.deepEqual(shortPassword.body, { message: 'Password must be at least 12 characters.' });
  assert.equal(longPassword.response.status, 400);
  assert.deepEqual(longPassword.body, { message: 'Password must be no more than 72 UTF-8 bytes.' });
  assert.equal(missing.response.status, 400);
  assert.deepEqual(missing.body, { message: 'Missing required fields: email address.' });
  assert.equal(allMissing.response.status, 400);
  assert.deepEqual(allMissing.body, { message: 'Missing required fields: name, email address, password.' });
  assert.equal(usersByEmail.size, 0);
});

test('unexpected registration errors return only the generic safe message', async () => {
  createFailure = new Error('MongoServerError: confidential database detail');
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Nisha Student', email: 'nisha@example.com', password: 'nursing-student-pass-4' },
  });
  assert.equal(result.response.status, 500);
  assert.deepEqual(result.body, { message: 'Something went wrong. Please try again later.' });
  assert.equal(JSON.stringify(result.body).includes('confidential'), false);
  assert.equal('stack' in result.body, false);
});

test('the user email field is protected by a unique MongoDB index', () => {
  assert.equal(User.schema.path('email').options.unique, true);
  assert.ok(User.schema.indexes().some(([fields, options]) => fields.email === 1 && options.unique === true));
  assert.equal(User.schema.path('adminUsername').options.unique, true);
  assert.equal(User.schema.path('adminUsername').options.sparse, true);
  assert.ok(User.schema.indexes().some(([fields, options]) => fields.adminUsername === 1 && options.unique === true && options.sparse === true));
});

test('account mutation routes reject requests from a different origin', async () => {
  const result = await request('/api/auth/register', {
    method: 'POST',
    origin: 'https://untrusted.example',
    body: { name: 'Sara Student', email: 'sara@example.com', password: 'nursing-student-pass-5' },
  });
  assert.equal(result.response.status, 403);
  assert.deepEqual(result.body, { message: 'This request origin is not allowed.' });
  assert.equal(usersByEmail.size, 0);
});

test('account mutation routes reject cross-site browser requests even when Origin is missing', async () => {
  const result = await request('/api/auth/register', {
    method: 'POST',
    fetchSite: 'cross-site',
    body: { name: 'Sara Student', email: 'sara@example.com', password: 'nursing-student-pass-5' },
  });
  assert.equal(result.response.status, 403);
  assert.deepEqual(result.body, { message: 'This request origin is not allowed.' });
  assert.equal(usersByEmail.size, 0);
});

test('registration endpoint applies its per-IP request limit', async () => {
  let lastResponse;
  for (let index = 0; index < 21; index += 1) {
    lastResponse = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'A', email: `invalid-${index}@example.com`, password: 'safe-student-password-2026' },
    });
    if (index < 20) assert.equal(lastResponse.response.status, 400);
  }
  assert.equal(lastResponse.response.status, 429);
  assert.ok(Number(lastResponse.response.headers.get('retry-after')) > 0);
  assert.equal(usersByEmail.size, 0);
});
