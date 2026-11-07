import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-bytes';
process.env.APP_ORIGIN = 'http://localhost:5173';

const [{ createApp }, session, bcrypt, { createAdminAccount, promptForAccount }] = await Promise.all([
  import('../src/app.js'),
  import('express-session'),
  import('bcryptjs'),
  import('../scripts/create-admin.js'),
]);

const studentPassword = 'student-secret-password-2026';
const adminPassword = 'admin-secret-password-2026';
let users;
let nextId;
let forceDuplicateOnCreate;
let server;
let baseUrl;

function duplicateKeyError() {
  const error = new Error('duplicate key for private database field');
  error.code = 11000;
  error.keyPattern = { email: 1 };
  return error;
}

function duplicateUsernameError() {
  const error = new Error('duplicate key for private database field');
  error.code = 11000;
  error.keyPattern = { adminUsername: 1 };
  return error;
}

function fakeFindById(id) {
  const value = users.find((user) => String(user._id) === String(id)) ?? null;
  return {
    select: async () => value,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
}

class FakeUserModel {
  static async exists({ email, adminUsername }) {
    const found = users.find((user) => (email && user.email === email) || (adminUsername && user.adminUsername === adminUsername));
    return found ? { _id: found._id } : null;
  }

  static findOne(filter = {}) {
    const found = users.find((user) => Object.entries(filter).every(([key, value]) => user[key] === value)) ?? null;
    return { select: async () => found };
  }

  static async create(data) {
    if (forceDuplicateOnCreate) throw duplicateKeyError();
    if (users.some((user) => user.email === data.email)) throw duplicateKeyError();
    if (users.some((user) => user.adminUsername === data.adminUsername)) throw duplicateUsernameError();
    const id = (nextId++).toString(16).padStart(24, '0');
    const user = { ...data, _id: id, id, createdAt: new Date(), updatedAt: new Date() };
    users.push(user);
    return user;
  }

  static findById(id) {
    return fakeFindById(id);
  }
}

beforeEach(async () => {
  nextId = 100;
  forceDuplicateOnCreate = false;
  users = [{
    _id: '507f1f77bcf86cd799439010',
    id: '507f1f77bcf86cd799439010',
    name: 'Existing Student',
    email: 'student@example.com',
    role: 'student',
    passwordHash: await bcrypt.hash(studentPassword, 4),
  }];
  const app = createApp({ sessionStore: new session.MemoryStore(), UserModel: FakeUserModel });
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers.Origin = 'http://localhost:5173';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null };
}

test('trusted admin creation hashes the password, logs in through the admin flow, and leaves student access unchanged', async () => {
  const created = await createAdminAccount({
    UserModel: FakeUserModel,
    name: '  Nursing Platform Admin  ',
    username: ' MedNexora.Admin ',
    email: ' ADMIN@example.com ',
    password: adminPassword,
    confirmPassword: adminPassword,
    role: 'student',
  });
  const storedAdmin = users.find((user) => user.email === 'admin@example.com');

  assert.equal(created.email, 'admin@example.com');
  assert.equal(created.username, 'mednexora.admin');
  assert.equal(created.name, 'Nursing Platform Admin');
  assert.equal(created.role, 'admin');
  assert.equal('passwordHash' in created, false);
  assert.equal(storedAdmin.role, 'admin');
  assert.notEqual(storedAdmin.passwordHash, adminPassword);
  assert.equal(await bcrypt.compare(adminPassword, storedAdmin.passwordHash), true);
  assert.equal(users[0].role, 'student');

  const adminAsStudent = await request('/api/auth/login', { method: 'POST', body: { email: 'admin@example.com', password: adminPassword } });
  assert.equal(adminAsStudent.response.status, 401);
  const adminLogin = await request('/api/admin/login', { method: 'POST', body: { username: 'MEDNEXORA.ADMIN', password: adminPassword } });
  assert.equal(adminLogin.response.status, 200);
  assert.equal(adminLogin.payload.user.email, 'admin@example.com');
  assert.equal(adminLogin.payload.user.username, 'mednexora.admin');
  assert.equal('passwordHash' in adminLogin.payload.user, false);
  assert.match(adminLogin.cookie, /^mednexora\.admin\.sid=/u);

  const adminProfile = await request('/api/admin/me', { cookie: adminLogin.cookie });
  assert.equal(adminProfile.response.status, 200);
  assert.equal(adminProfile.payload.user.email, 'admin@example.com');

  const studentLogin = await request('/api/auth/login', { method: 'POST', body: { email: 'student@example.com', password: studentPassword } });
  assert.equal(studentLogin.response.status, 200);
  const studentAdminRoute = await request('/api/admin/me', { cookie: studentLogin.cookie });
  assert.equal(studentAdminRoute.response.status, 401);
  const adminStudentRoute = await request('/api/auth/me', { cookie: adminLogin.cookie });
  assert.equal(adminStudentRoute.response.status, 401);
  const adminLogout = await request('/api/admin/logout', { method: 'POST', cookie: adminLogin.cookie, body: {} });
  assert.equal(adminLogout.response.status, 204);
  assert.match(adminLogout.response.headers.get('set-cookie'), /mednexora\.admin\.sid=;/u);
  assert.equal((await request('/api/admin/me', { cookie: adminLogin.cookie })).response.status, 401);
  assert.equal((await request('/api/auth/me', { cookie: studentLogin.cookie })).response.status, 200);
});

test('admin creation rejects duplicate email without modifying an existing student account', async () => {
  await assert.rejects(createAdminAccount({
    UserModel: FakeUserModel,
    name: 'Duplicate Admin',
    username: 'duplicate-admin',
    email: 'STUDENT@example.com',
    password: adminPassword,
    confirmPassword: adminPassword,
  }), { code: 'DUPLICATE_EMAIL', message: 'This email is already registered. No existing account was changed.' });
  assert.equal(users.length, 1);
  assert.equal(users[0].role, 'student');
  assert.equal(await bcrypt.compare(studentPassword, users[0].passwordHash), true);
});

test('admin usernames are normalized and unique without modifying an existing administrator', async () => {
  const created = await createAdminAccount({
    UserModel: FakeUserModel,
    name: 'First Admin', username: 'unique-admin', email: 'first-admin@example.com', password: adminPassword, confirmPassword: adminPassword,
  });
  assert.equal(created.username, 'unique-admin');
  await assert.rejects(createAdminAccount({
    UserModel: FakeUserModel,
    name: 'Second Admin', username: ' UNIQUE-ADMIN ', email: 'second-admin@example.com', password: adminPassword, confirmPassword: adminPassword,
  }), { code: 'DUPLICATE_USERNAME', message: 'That admin username is already in use.' });
  assert.equal(users.length, 2);
  assert.equal(users[1].role, 'admin');
  assert.equal(users[1].email, 'first-admin@example.com');
});

test('admin creation handles a duplicate-key race from the database index', async () => {
  forceDuplicateOnCreate = true;
  await assert.rejects(createAdminAccount({
    UserModel: FakeUserModel,
    name: 'Race Admin',
    username: 'race-admin',
    email: 'race@example.com',
    password: adminPassword,
    confirmPassword: adminPassword,
  }), { code: 'DUPLICATE_EMAIL', message: 'This email is already registered. No existing account was changed.' });
  assert.equal(users.length, 1);
});

test('admin creation validates required fields and password confirmation', async () => {
  await assert.rejects(createAdminAccount({ UserModel: FakeUserModel }), /Missing required fields: Full name, Admin username, Email address, Password, Confirm password\./);
  await assert.rejects(createAdminAccount({
    UserModel: FakeUserModel,
    name: 'New Admin',
    username: 'new-admin',
    email: 'not-an-email',
    password: adminPassword,
    confirmPassword: adminPassword,
  }), /Please enter a valid email address\./);
  await assert.rejects(createAdminAccount({
    UserModel: FakeUserModel,
    name: 'New Admin',
    username: 'new-admin',
    email: 'new-admin@example.com',
    password: adminPassword,
    confirmPassword: `${adminPassword}-different`,
  }), /Passwords do not match\./);
  await assert.rejects(createAdminAccount({
    UserModel: FakeUserModel,
    name: 'New Admin',
    username: 'bad username',
    email: 'new-admin@example.com',
    password: adminPassword,
    confirmPassword: adminPassword,
  }), /Admin username must be 3 to 32 characters/u);
  assert.equal(users.length, 1);
});

test('interactive prompts collect name, admin username, email, and hidden passwords in the required order', async () => {
  const input = new EventEmitter();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (enabled) => { input.isRaw = enabled; };
  input.resume = () => {};
  input.pause = () => {};
  const output = {
    isTTY: true,
    chunks: [],
    write(value) { this.chunks.push(value); return true; },
  };

  const credentialsPromise = promptForAccount({ input, output });
  async function typeLine(value) {
    assert.equal(input.isRaw, true, 'each prompt should read from the active terminal');
    for (const character of value) input.emit('data', Buffer.from(character));
    input.emit('data', Buffer.from('\r'));
    await new Promise((resolve) => setImmediate(resolve));
  }

  await typeLine('Nursing Platform Admin');
  await typeLine('cli-admin');
  await typeLine('cli-admin@example.com');
  await typeLine(adminPassword);
  await typeLine(adminPassword);

  const credentials = await credentialsPromise;
  assert.deepEqual(credentials, {
    name: 'Nursing Platform Admin',
    username: 'cli-admin',
    email: 'cli-admin@example.com',
    password: adminPassword,
    confirmPassword: adminPassword,
  });

  const terminalOutput = output.chunks.join('');
  const requiredPrompts = [
    'Full name: ',
    'Admin username: ',
    'Email address: ',
    'Password (input hidden): ',
    'Confirm password (input hidden): ',
  ];
  let previousPosition = -1;
  for (const prompt of requiredPrompts) {
    const position = terminalOutput.indexOf(prompt);
    assert.ok(position > previousPosition, `expected ${prompt} after the prior prompt`);
    previousPosition = position;
  }
  assert.match(terminalOutput, /Nursing Platform Admin/);
  assert.match(terminalOutput, /cli-admin@example\.com/);
  assert.equal(terminalOutput.includes(adminPassword), false, 'password entries must not be written to terminal output');

  const created = await createAdminAccount({ UserModel: FakeUserModel, ...credentials });
  assert.equal(created.name, 'Nursing Platform Admin');
  assert.equal(created.username, 'cli-admin');
  assert.equal(created.email, 'cli-admin@example.com');
  assert.equal(created.role, 'admin');
  assert.equal(input.isRaw, false, 'terminal raw mode should be restored after each prompt');
});
