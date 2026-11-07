import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-bytes';
process.env.APP_ORIGIN = 'http://localhost:5173';

const [{ createApp }, session, bcrypt] = await Promise.all([
  import('../src/app.js'),
  import('express-session'),
  import('bcryptjs'),
]);

const adminId = '507f1f77bcf86cd799439001';
const examId = '507f1f77bcf86cd799439002';
const subjectId = '507f1f77bcf86cd799439003';
let users;
let collections;
let server;
let baseUrl;
let lastSort;
let privateStorageDir;
let studyMaterialCreateError;

class FakeQuery {
  constructor(rows, modelName = '') { this.rows = rows; this.modelName = modelName; this.populatePaths = []; this.offset = 0; this.max = Infinity; }
  select() { return this; }
  populate(value) { this.populatePaths.push(typeof value === 'string' ? { path: value } : value); return this; }
  sort(value) { lastSort = value; return this; }
  skip(value) { this.offset = value; return this; }
  limit(value) { this.max = value; return this; }
  lean() {
    const rows = Array.isArray(this.rows) ? this.rows.slice(this.offset, this.offset + this.max) : this.rows;
    const mapRow = (row) => {
      if (!row) return row;
      const result = row instanceof FakeRecord ? row.toObject() : { ...row };
      const references = {
        StudyMaterial: { exam: 'Exam', subject: 'Subject', chapter: 'Chapter', topic: 'Topic', topics: 'Topic', course: 'Course', bundleItems: 'StudyMaterial' },
        Chapter: { exam: 'Exam', subject: 'Subject' },
        Topic: { exam: 'Exam', subject: 'Subject', chapter: 'Chapter' },
        Subject: { exam: 'Exam' },
      }[this.modelName] ?? {};
      const populateReference = (reference, targetName, match, nested = []) => {
        const id = reference?._id ?? reference?.id ?? reference;
        const found = collections[targetName]?.find((item) => String(item._id) === String(id));
        if (!found || (match && !matchesFilter(found, match))) return null;
        const populated = found instanceof FakeRecord ? found.toObject() : { ...found };
        const nestedReferences = { Topic: { chapter: 'Chapter' } }[targetName] ?? {};
        for (const nestedPath of nested) {
          const nestedTarget = nestedReferences[nestedPath.path];
          if (!nestedTarget || populated[nestedPath.path] == null) continue;
          populated[nestedPath.path] = populateReference(populated[nestedPath.path], nestedTarget, nestedPath.match, nestedPath.populate ? [nestedPath.populate] : []);
        }
        return populated;
      };
      for (const populatePath of this.populatePaths) {
        const { path, match } = populatePath;
        const targetName = references[path];
        if (!targetName || result[path] == null) continue;
        const nested = populatePath.populate ? (Array.isArray(populatePath.populate) ? populatePath.populate : [populatePath.populate]) : [];
        const populateOne = (reference) => populateReference(reference, targetName, match, nested);
        result[path] = Array.isArray(result[path]) ? result[path].map(populateOne).filter(Boolean) : populateOne(result[path]);
      }
      return result;
    };
    return Promise.resolve(Array.isArray(rows) ? rows.map(mapRow) : mapRow(rows));
  }
}

class FakeRecord {
  constructor(values, name) { Object.assign(this, values); this._name = name; }
  toObject() { const result = { ...this }; delete result._name; return result; }
  toJSON() { return this.toObject(); }
  set(values) { Object.assign(this, values); }
  select() { return Promise.resolve(this); }
  async save() {
    const records = this._name === 'User' ? users : collections[this._name];
    if (this._name === 'Exam' && this.isPrimary === true && records.some((record) => String(record._id) !== String(this._id) && record.isPrimary === true)) {
      const error = new Error('duplicate primary exam');
      error.code = 11000;
      error.keyPattern = { isPrimary: 1 };
      throw error;
    }
    const index = records.findIndex((item) => String(item._id) === String(this._id));
    if (index >= 0) records[index] = this;
    this.updatedAt = new Date();
    return this;
  }
}

function pathValue(value, path) {
  if (!path.includes('.')) return value?.[path];
  const [head, ...tail] = path.split('.');
  const next = value?.[head];
  if (Array.isArray(next)) return next.flatMap((item) => {
    const child = pathValue(item, tail.join('.'));
    return child === undefined ? [] : Array.isArray(child) ? child : [child];
  });
  return pathValue(next, tail.join('.'));
}

function matchesCondition(value, condition) {
  if (condition instanceof RegExp) return (Array.isArray(value) ? value : [value]).some((entry) => condition.test(String(entry ?? '')));
  if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
    if (condition.$elemMatch) return Array.isArray(value) && value.some((entry) => matchesFilter(entry, condition.$elemMatch));
    if (condition.$type === 'date') return value instanceof Date;
    if (condition.$in) return (Array.isArray(value) ? value : [value]).some((entry) => condition.$in.some((item) => String(entry) === String(item)));
    if (condition.$nin) return !(Array.isArray(value) ? value : [value]).some((entry) => condition.$nin.some((item) => String(entry?._id ?? entry) === String(item?._id ?? item)));
    if ('$ne' in condition) return condition.$ne === null ? value !== null && value !== undefined : String(value?._id ?? value) !== String(condition.$ne?._id ?? condition.$ne);
    if ('$eq' in condition) return matchesCondition(value, condition.$eq);
    if ('$gte' in condition) return Number(value) >= Number(condition.$gte);
    if ('$lte' in condition) return Number(value) <= Number(condition.$lte);
    if ('$gt' in condition) return Number(value) > Number(condition.$gt);
    if ('$lt' in condition) return Number(value) < Number(condition.$lt);
    if ('$exists' in condition) return condition.$exists ? value !== undefined : value === undefined;
    return false;
  }
  const values = Array.isArray(value) ? value : [value];
  return values.some((entry) => String(entry?._id ?? entry?.id ?? entry) === String(condition?._id ?? condition?.id ?? condition));
}

function matchesFilter(record, filter) {
  return Object.entries(filter).every(([field, condition]) => {
    if (field === '$or') return condition.some((part) => matchesFilter(record, part));
    if (field === '$and') return condition.every((part) => matchesFilter(record, part));
    if (field === '$text') {
      const needle = String(condition.$search ?? '').toLocaleLowerCase();
      return [record.title, record.description, ...(record.keywords ?? [])].some((value) => String(value ?? '').toLocaleLowerCase().includes(needle));
    }
    return matchesCondition(pathValue(record, field), condition);
  });
}

function makeCollection(name) {
  return class {
    static modelName = name;
    static async create(data) {
      if (name === 'StudyMaterial' && studyMaterialCreateError) {
        const error = studyMaterialCreateError;
        studyMaterialCreateError = null;
        throw error;
      }
      if (name === 'Exam' && data.isPrimary === true && collections.Exam.some((record) => record.isPrimary === true)) {
        const error = new Error('duplicate primary exam');
        error.code = 11000;
        error.keyPattern = { isPrimary: 1 };
        throw error;
      }
      const record = new FakeRecord({ _id: nextId(), ...data, createdAt: new Date(), updatedAt: new Date() }, name);
      if (name === 'StudyMaterial') record.currentPricePaise = Number.isSafeInteger(record.pricePaise) ? record.pricePaise - (record.discountPaise ?? 0) : null;
      collections[name].push(record);
      return record;
    }
    // Mongoose returns a detached document for each findById; clone fake records so
    // rejected updates do not appear persisted merely because a controller called set().
    static findById(id) {
      const record = collections[name].find((item) => String(item._id) === String(id));
      return record ? new FakeRecord(record.toObject(), name) : null;
    }
    static findOne(filter = {}) { return new FakeQuery(collections[name].find((record) => matchesFilter(record, filter)) ?? null, name); }
    static find(filter = {}) {
      const rows = collections[name].filter((record) => matchesFilter(record, filter));
      return new FakeQuery(rows, name);
    }
    static async countDocuments(filter = {}) {
      return collections[name].filter((record) => matchesFilter(record, filter)).length;
    }
    static async deleteOne(filter = {}) {
      const index = collections[name].findIndex((record) => matchesFilter(record, filter));
      if (index < 0) return { deletedCount: 0 };
      collections[name].splice(index, 1);
      return { deletedCount: 1 };
    }
    static async updateMany(filter = {}, update = {}) {
      const rows = collections[name].filter((record) => matchesFilter(record, filter));
      for (const record of rows) Object.assign(record, update.$set ?? {});
      return { matchedCount: rows.length, modifiedCount: rows.length };
    }
  };
}

const FakeProductModel = makeCollection('StudyMaterial');
const FakeExamModel = makeCollection('Exam');
const FakeSubjectModel = makeCollection('Subject');
const FakeChapterModel = makeCollection('Chapter');
const FakeTopicModel = makeCollection('Topic');
const FakeCourseModel = makeCollection('Course');
const FakeQuestionBankModel = makeCollection('QuestionBank');
const FakeMockTestModel = makeCollection('MockTest');
const FakeTestAttemptModel = makeCollection('TestAttempt');
const FakePurchasedAccessModel = makeCollection('PurchasedAccess');
const FakeRefundModel = makeCollection('PaymentRefund');
const FakeCourseProgressModel = makeCollection('CourseProgress');

class FakeUserModel {
  static async exists({ email, adminUsername }) { return users.some((user) => (email && user.email === email) || (adminUsername && user.adminUsername === adminUsername)) ? { _id: users.find((user) => (email && user.email === email) || (adminUsername && user.adminUsername === adminUsername))._id } : null; }
  static findOne(filter = {}) { return { select: async () => users.find((user) => Object.entries(filter).every(([key, value]) => user[key] === value)) ?? null }; }
  static async create(data) {
    const user = new FakeRecord({ _id: nextId(), ...data, role: 'student', createdAt: new Date(), updatedAt: new Date() }, 'User');
    users.push(user);
    return user;
  }
  static async findById(id) { return users.find((user) => String(user._id) === String(id)) ?? null; }
  static async countDocuments(filter = {}) { return users.filter((user) => !filter.role || user.role === filter.role).length; }
  static find(filter = {}) {
    let found = users;
    if (filter.role) found = found.filter((user) => user.role === filter.role);
    if (filter.$or) {
      found = found.filter((user) => filter.$or.some((clause) => Object.entries(clause).some(([field, pattern]) => pattern.test(user[field] ?? ''))));
    }
    return new FakeQuery(found);
  }
}

let orderRecords;
class FakeOrderModel {
  static modelName = 'Order';
  static async countDocuments(filter = {}) { return orderRecords.filter((order) => matchesFilter(order, filter)).length; }
  static async aggregate(pipeline) {
    const match = pipeline[0].$match;
    const verified = orderRecords.filter((order) => match.status.$in.includes(order.status) && order.paymentVerifiedAt instanceof Date);
    return verified.length ? [{ amountPaise: verified.reduce((sum, order) => sum + order.amountPaise - (order.totalRefundedPaise ?? 0), 0), orderCount: verified.length }] : [];
  }
  static find(filter = {}) {
    return new FakeQuery(orderRecords.filter((order) => matchesFilter(order, filter)));
  }
  static findOne(filter = {}) { return new FakeQuery(orderRecords.find((order) => matchesFilter(order, filter)) ?? null); }
  static findById(id) { return new FakeQuery(orderRecords.find((order) => String(order._id) === String(id)) ?? null); }
  static async findOneAndUpdate(filter = {}, update = {}) {
    const order = orderRecords.find((item) => matchesFilter(item, filter));
    if (!order) return null;
    Object.assign(order, update.$set ?? {});
    return order;
  }
}

function nextId() {
  nextId.counter += 1;
  return nextId.counter.toString(16).padStart(24, '0');
}
nextId.counter = 100;

beforeEach(async () => {
  nextId.counter = 100;
  lastSort = null;
  studyMaterialCreateError = null;
  privateStorageDir = await mkdtemp(join(tmpdir(), 'nursing-private-pdf-'));
  collections = { StudyMaterial: [], Exam: [], Subject: [], Chapter: [], Topic: [], Course: [], CourseProgress: [], QuestionBank: [], MockTest: [], TestAttempt: [], PurchasedAccess: [], PaymentRefund: [] };
  const adminHash = await bcrypt.hash('admin-secret-password-123', 4);
  const studentHash = await bcrypt.hash('student-secret-password-123', 4);
  users = [
    new FakeRecord({ _id: adminId, name: 'Catalogue Admin', email: 'admin@example.com', role: 'admin', passwordHash: adminHash }, 'User'),
    new FakeRecord({ _id: '507f1f77bcf86cd799439010', name: 'Student Reader', email: 'student@example.com', role: 'student', passwordHash: studentHash }, 'User'),
  ];
  collections.Exam.push(new FakeRecord({ _id: examId, name: 'Configured competitive examination', region: '', publicationStatus: 'published' }, 'Exam'));
  collections.Subject.push(new FakeRecord({ _id: subjectId, name: 'Biology', exam: examId, publicationStatus: 'published' }, 'Subject'));
  orderRecords = [
    { _id: '507f1f77bcf86cd799439020', student: { _id: users[1]._id, name: users[1].name, email: users[1].email }, items: [{ titleSnapshot: 'Biology notes', unitPricePaise: 12000, quantity: 1, product: { _id: '507f1f77bcf86cd799439030', title: 'Biology notes', resourceType: 'notes' } }], amountPaise: 12000, status: 'paid', paymentProvider: 'razorpay', paymentVerifiedAt: new Date('2026-10-01T00:00:00Z'), createdAt: new Date('2026-10-01T00:00:00Z') },
    { _id: '507f1f77bcf86cd799439021', student: { _id: users[1]._id, name: users[1].name, email: users[1].email }, items: [{ titleSnapshot: 'Practice set', unitPricePaise: 5000, quantity: 1 }], amountPaise: 5000, status: 'paid', paymentProvider: 'razorpay', paymentVerifiedAt: null, createdAt: new Date('2026-10-02T00:00:00Z') },
    { _id: '507f1f77bcf86cd799439022', student: { _id: users[1]._id, name: users[1].name, email: users[1].email }, items: [], amountPaise: 8000, status: 'pending', paymentProvider: 'none', paymentVerifiedAt: null, createdAt: new Date('2026-10-03T00:00:00Z') },
  ];
  const app = createApp({
    sessionStore: new session.MemoryStore(),
    UserModel: FakeUserModel,
    OrderModel: FakeOrderModel,
    ProductModel: FakeProductModel,
    ExamModel: FakeExamModel,
    SubjectModel: FakeSubjectModel,
    ChapterModel: FakeChapterModel,
    TopicModel: FakeTopicModel,
    CourseModel: FakeCourseModel,
    QuestionBankModel: FakeQuestionBankModel,
    MockTestModel: FakeMockTestModel,
    TestAttemptModel: FakeTestAttemptModel,
    privateStorageDir,
    privateStorageOrigin: '',
    PurchasedAccessModel: FakePurchasedAccessModel,
    RefundModel: FakeRefundModel,
    CourseProgressModel: FakeCourseProgressModel,
  });
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (privateStorageDir) await rm(privateStorageDir, { recursive: true, force: true });
});

async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers.Origin = 'http://localhost:5173';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const contentType = response.headers.get('content-type') ?? '';
  const responseBody = response.status === 204 ? '' : await response.text();
  const payload = response.status === 204 ? null : contentType.includes('application/json') ? JSON.parse(responseBody) : responseBody;
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null };
}

async function uploadPdf(content, { cookie, contentType = 'application/pdf' } = {}) {
  const headers = { 'Content-Type': contentType, Origin: 'http://localhost:5173' };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}/api/admin/uploads/pdf`, { method: 'POST', headers, body: content });
  return { response, payload: await response.json() };
}

async function loginAdmin() {
  const result = await request('/api/admin/login', { method: 'POST', body: { username: 'admin@example.com', password: 'admin-secret-password-123' } });
  assert.equal(result.response.status, 200);
  return result.cookie;
}

test('admin login requires a provisioned database role and every admin API checks it', async () => {
  const anonymous = await request('/api/admin/overview');
  assert.equal(anonymous.response.status, 401);

  const student = await request('/api/auth/login', { method: 'POST', body: { email: 'student@example.com', password: 'student-secret-password-123' } });
  assert.equal(student.response.status, 200);
  const deniedStudent = await request('/api/admin/overview', { cookie: student.cookie });
  assert.equal(deniedStudent.response.status, 401);

  const deniedStudentLogin = await request('/api/admin/login', { method: 'POST', body: { username: 'student@example.com', password: 'student-secret-password-123' } });
  assert.equal(deniedStudentLogin.response.status, 401);
  const adminCookie = await loginAdmin();
  const profile = await request('/api/admin/me', { cookie: adminCookie });
  assert.equal(profile.response.status, 200);
  assert.equal(profile.payload.user.email, 'admin@example.com');
  assert.equal('passwordHash' in profile.payload.user, false);
});

test('admin login rejects incorrect usernames and passwords with the same safe response', async () => {
  const unknownUsername = await request('/api/admin/login', { method: 'POST', body: { username: 'missing-admin', password: 'admin-secret-password-123' } });
  const wrongPassword = await request('/api/admin/login', { method: 'POST', body: { username: 'admin@example.com', password: 'wrong-admin-password-123' } });
  assert.equal(unknownUsername.response.status, 401);
  assert.equal(wrongPassword.response.status, 401);
  assert.deepEqual(unknownUsername.payload, { message: 'Username or password is incorrect.' });
  assert.deepEqual(wrongPassword.payload, unknownUsername.payload);
  assert.equal(unknownUsername.cookie, null);
  assert.equal(wrongPassword.cookie, null);
});

test('admin dashboard metrics use actual records and only count verified paid revenue', async () => {
  const cookie = await loginAdmin();
  const result = await request('/api/admin/overview', { cookie });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload.metrics, {
    productCount: 0,
    publishedProductCount: 0,
    studyMaterialCount: 0,
    courseCount: 0,
    publishedCourseCount: 0,
    draftCourseCount: 0,
    questionBankCount: 0,
    mockTestCount: 0,
    studentCount: 1,
    orderCount: 3,
    verifiedRevenuePaise: 12000,
    verifiedPaidOrderCount: 1,
  });
  assert.equal(Object.hasOwn(result.payload, 'configuration'), false);
});

test('admin list pagination defaults missing or empty values and enforces the 50-row limit', async () => {
  const cookie = await loginAdmin();
  const defaults = await request('/api/admin/exams', { cookie });
  assert.equal(defaults.response.status, 200);
  assert.equal(defaults.payload.pagination.page, 1);
  assert.equal(defaults.payload.pagination.limit, 20);

  const emptyValues = await request('/api/admin/chapters?page=&limit=', { cookie });
  assert.equal(emptyValues.response.status, 200);
  assert.equal(emptyValues.payload.pagination.page, 1);
  assert.equal(emptyValues.payload.pagination.limit, 20);

  const validMaximum = await request('/api/admin/chapters?page=1&limit=50', { cookie });
  assert.equal(validMaximum.response.status, 200);
  assert.equal(validMaximum.payload.pagination.limit, 50);

  for (const path of ['/api/admin/chapters?limit=100', '/api/admin/students?limit=51', '/api/admin/orders?page=0']) {
    const invalid = await request(path, { cookie });
    assert.equal(invalid.response.status, 400, path);
    assert.match(invalid.payload.message, /integer from 1 to/u, path);
  }
});

test('administrator can change a password with current credentials and invalidate other admin sessions', async () => {
  const firstCookie = await loginAdmin();
  const secondCookie = await loginAdmin();
  const changed = await request('/api/admin/password', { method: 'POST', cookie: firstCookie, body: {
    currentPassword: 'admin-secret-password-123',
    newPassword: 'new-admin-password-45678',
    confirmPassword: 'new-admin-password-45678',
  } });
  assert.equal(changed.response.status, 200);
  assert.equal((await request('/api/admin/me', { cookie: changed.cookie })).response.status, 200, 'the rotated current session stays active');
  assert.equal((await request('/api/admin/me', { cookie: secondCookie })).response.status, 401, 'other admin sessions are invalidated');
  const stored = users.find((user) => user.email === 'admin@example.com');
  assert.equal(await bcrypt.compare('new-admin-password-45678', stored.passwordHash), true);
  assert.equal(await bcrypt.compare('admin-secret-password-123', stored.passwordHash), false);
  const badCurrent = await request('/api/admin/password', { method: 'POST', cookie: changed.cookie, body: {
    currentPassword: 'wrong-current-password', newPassword: 'another-admin-password-5678', confirmPassword: 'another-admin-password-5678',
  } });
  assert.equal(badCurrent.response.status, 400);
  assert.equal(JSON.stringify(badCurrent.payload).includes(stored.passwordHash), false);
});

test('administrator student list shows real activity counts without exposing credentials', async () => {
  const adminCookie = await loginAdmin();
  const student = users.find((user) => user.email === 'student@example.com');
  collections.PurchasedAccess.push(new FakeRecord({ _id: nextId(), student: student._id, status: 'active' }, 'PurchasedAccess'));
  collections.CourseProgress.push(new FakeRecord({ _id: nextId(), student: student._id, course: nextId(), updatedAt: new Date('2026-01-02T00:00:00Z') }, 'CourseProgress'));
  collections.TestAttempt.push(new FakeRecord({ _id: nextId(), student: student._id, createdAt: new Date('2026-01-03T00:00:00Z'), updatedAt: new Date('2026-01-03T00:00:00Z') }, 'TestAttempt'));
  const listing = await request('/api/admin/students?q=student&page=1&limit=10', { cookie: adminCookie });
  assert.equal(listing.response.status, 200);
  assert.equal(listing.payload.pagination.total, 1);
  assert.deepEqual(listing.payload.items[0], {
    id: student._id,
    name: 'Student Reader',
    email: 'student@example.com',
    registeredAt: null,
    activePurchases: 1,
    enrolledCourseCount: 1,
    courseProgressCount: 1,
    testAttemptCount: 1,
    lastActivityAt: '2026-01-03T00:00:00.000Z',
  });
  assert.equal(JSON.stringify(listing.payload).includes('passwordHash'), false);
  assert.equal((await request('/api/admin/students')).response.status, 401);
});

test('admin product create, publish, search/list, archive, and private URL handling work', async () => {
  const cookie = await loginAdmin();
  const created = await request('/api/admin/products', {
    method: 'POST', cookie,
    body: {
      exam: examId, subject: subjectId, chapter: null, topic: null, topics: [], title: 'Biology revision notes', slug: 'biology-revision-notes',
      description: 'A configurable entrance revision resource.', resourceType: 'notes', pricePaise: 12500,
      discountPaise: 2500, detailedDescription: 'A longer configured description.', category: 'revision-notes',
      difficultyLevel: 'intermediate', language: 'English', fileSizeBytes: 2048,
      preview: { title: 'Sample excerpt', excerpt: 'A limited public excerpt.' },
      contentUrl: 'https://private.example/content.pdf', publicationStatus: 'draft',
    },
  });
  assert.equal(created.response.status, 201);
  assert.equal(Object.hasOwn(created.payload.product, 'paperClassification'), false);
  assert.equal('contentUrl' in created.payload.product, false);
  assert.equal(created.payload.product.category, 'revision-notes');
  assert.equal(created.payload.product.detailedDescription, 'A longer configured description.');
  assert.equal(created.payload.product.preview.excerpt, 'A limited public excerpt.');
  const productId = created.payload.product.id;

  const published = await request(`/api/admin/products/${productId}`, { method: 'PATCH', cookie, body: { publicationStatus: 'published' } });
  assert.equal(published.response.status, 200);
  assert.equal(published.payload.product.publicationStatus, 'published');
  const updated = await request(`/api/admin/products/${productId}`, { method: 'PATCH', cookie, body: { category: 'chapter-notes', detailedDescription: 'Updated description.', fileSizeBytes: 3072 } });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.payload.product.category, 'chapter-notes');
  assert.equal(updated.payload.product.detailedDescription, 'Updated description.');

  const listed = await request('/api/admin/products?status=published&page=1&limit=10', { cookie });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.payload.pagination.total, 1);
  assert.equal('contentUrl' in listed.payload.items[0], false);
  const allPublic = await request('/api/products');
  assert.equal(allPublic.payload.pagination.total, 1, JSON.stringify(allPublic.payload));
  const categorized = await request('/api/products?category=chapter-notes&sort=newest');
  assert.equal(categorized.response.status, 200);
  assert.equal(categorized.payload.pagination.total, 1, JSON.stringify(categorized.payload));
  assert.equal(categorized.payload.items[0].category, 'chapter-notes');

  const archived = await request(`/api/admin/products/${productId}`, { method: 'PATCH', cookie, body: { publicationStatus: 'archived' } });
  assert.equal(archived.response.status, 200);
  assert.equal(archived.payload.product.publicationStatus, 'archived');
});

test('admin can save empty and named language metadata without using it as a MongoDB text-index override', async () => {
  const cookie = await loginAdmin();
  for (const [index, language] of ['', 'English'].entries()) {
    const created = await request('/api/admin/products', {
      method: 'POST', cookie,
      body: {
        exam: examId,
        subject: subjectId,
        title: `Language metadata resource ${index + 1}`,
        slug: `language-metadata-resource-${index + 1}`,
        description: 'A draft resource for testing educational language metadata.',
        resourceType: 'notes',
        language,
        publicationStatus: 'draft',
      },
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.payload));
    assert.equal(created.payload.product.language, language);
    const stored = collections.StudyMaterial.find((record) => String(record._id) === created.payload.product.id);
    assert.equal(stored.language, language);
  }
});

test('MongoDB 17262 during StudyMaterial creation is logged internally and hidden behind the safe API error', async () => {
  const cookie = await loginAdmin();
  const mongoError = new Error('language override unsupported:');
  mongoError.name = 'MongoServerError';
  mongoError.code = 17262;
  mongoError.collectionName = 'studymaterials';
  mongoError.stack = 'MongoServerError: language override unsupported:\n    at StudyMaterial.create';
  studyMaterialCreateError = mongoError;
  const logLines = [];
  const originalError = console.error;
  console.error = (...values) => logLines.push(values.map(String).join(' '));
  let result;
  try {
    result = await request('/api/admin/products', {
      method: 'POST', cookie,
      body: {
        exam: examId,
        subject: subjectId,
        title: 'Empty language draft notes',
        slug: 'empty-language-draft-notes',
        description: 'A draft resource reproducing the text-index language override failure.',
        resourceType: 'notes',
        language: '',
        publicationStatus: 'draft',
      },
    });
  } finally {
    console.error = originalError;
  }

  assert.equal(result.response.status, 500);
  assert.deepEqual(result.payload, { message: 'Something went wrong. Please try again later.' });
  assert.equal(JSON.stringify(result.payload).includes('17262'), false);
  const diagnostic = logLines.find((line) => line.includes('MongoDB StudyMaterial operation failed:'));
  assert.ok(diagnostic);
  assert.match(diagnostic, /"name":"MongoServerError"/);
  assert.match(diagnostic, /"collection":"studymaterials"/);
  assert.match(diagnostic, /"operation":"StudyMaterial\.create"/);
  assert.match(diagnostic, /"code":17262/);
  assert.match(diagnostic, /language override unsupported/);
  assert.match(diagnostic, /"stack":"MongoServerError: language override unsupported:/);
});

test('admin can create a draft PDF resource with existing draft exam and subject ObjectIds, without publishing its parents', async () => {
  const cookie = await loginAdmin();
  const exam = await request('/api/admin/exams', { method: 'POST', cookie, body: {
    name: 'Draft PDF target examination', slug: 'draft-pdf-target-examination', publicationStatus: 'draft',
  } });
  assert.equal(exam.response.status, 201, JSON.stringify(exam.payload));
  const subject = await request('/api/admin/subjects', { method: 'POST', cookie, body: {
    exam: exam.payload.exam._id, name: 'Physics', slug: 'physics', publicationStatus: 'draft',
  } });
  assert.equal(subject.response.status, 201, JSON.stringify(subject.payload));

  const courseProduct = await request('/api/admin/products', { method: 'POST', cookie, body: {
    exam: exam.payload.exam._id, subject: subject.payload.subject._id,
    title: 'B.Sc. Nursing Entrance Preparation', slug: 'draft-pdf-linked-course-product',
    description: 'Draft course catalogue record for resource-link validation.', resourceType: 'video-course',
    pricePaise: 0, publicationStatus: 'draft',
  } });
  assert.equal(courseProduct.response.status, 201, JSON.stringify(courseProduct.payload));
  const course = await request('/api/admin/courses', { method: 'POST', cookie, body: {
    product: courseProduct.payload.product.id, exam: exam.payload.exam._id,
    subjects: [subject.payload.subject._id], courseType: 'video-course', publicationStatus: 'draft',
  } });
  assert.equal(course.response.status, 201, JSON.stringify(course.payload));

  const examsResponse = await request('/api/admin/exams?page=1&limit=50', { cookie });
  const subjectsResponse = await request(`/api/admin/subjects?examId=${exam.payload.exam._id}&page=1&limit=50`, { cookie });
  const listedExam = examsResponse.payload.items.find((item) => item._id === exam.payload.exam._id);
  const listedSubject = subjectsResponse.payload.items.find((item) => item._id === subject.payload.subject._id);
  assert.equal(typeof listedExam?._id, 'string');
  assert.equal(typeof listedSubject?._id, 'string');
  assert.equal(listedSubject.exam._id ?? listedSubject.exam, listedExam._id);

  const created = await request('/api/admin/products', { method: 'POST', cookie, body: {
    exam: listedExam._id,
    subject: listedSubject._id,
    course: course.payload.course._id,
    title: 'Draft Physics PDF notes', slug: 'draft-physics-pdf-notes',
    description: 'Draft material mapped to existing draft curriculum records.',
    resourceType: 'notes', format: 'PDF', pricePaise: 0, publicationStatus: 'draft',
  } });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(String(created.payload.product.exam.id ?? created.payload.product.exam), listedExam._id);
  assert.equal(String(created.payload.product.subject.id ?? created.payload.product.subject), listedSubject._id);
  assert.equal(String(created.payload.product.course.id ?? created.payload.product.course), course.payload.course._id);
  assert.equal(created.payload.product.publicationStatus, 'draft');
  assert.equal((await request('/api/admin/exams?status=draft', { cookie })).payload.items.some((item) => item._id === exam.payload.exam._id), true);
  assert.equal((await request('/api/admin/subjects?status=draft', { cookie })).payload.items.some((item) => item._id === subject.payload.subject._id), true);
  assert.equal((await request('/api/products')).payload.items.some((item) => item.id === created.payload.product.id), false);

  const prematurePublish = await request(`/api/admin/products/${created.payload.product.id}`, { method: 'PATCH', cookie, body: { publicationStatus: 'published' } });
  assert.equal(prematurePublish.response.status, 400);
  assert.match(prematurePublish.payload.message, /Publish the target examination and matching subject/i);
});

test('admin product validation distinguishes missing, invalid, and unknown examination or subject references', async () => {
  const cookie = await loginAdmin();
  const body = { title: 'Reference validation draft', slug: 'reference-validation-draft', description: 'Validation fixture.', resourceType: 'notes', publicationStatus: 'draft' };
  const missingExam = await request('/api/admin/products', { method: 'POST', cookie, body: { ...body, subject: subjectId } });
  assert.equal(missingExam.response.status, 400);
  assert.match(missingExam.payload.message, /Select an existing target examination/u);
  const invalidSubject = await request('/api/admin/products', { method: 'POST', cookie, body: { ...body, exam: examId, subject: 'physics' } });
  assert.equal(invalidSubject.response.status, 400);
  assert.match(invalidSubject.payload.message, /subject names and slugs are not valid references/u);
  const unknownSubject = await request('/api/admin/products', { method: 'POST', cookie, body: { ...body, exam: examId, subject: '507f1f77bcf86cd799439099' } });
  assert.equal(unknownSubject.response.status, 400);
  assert.match(unknownSubject.payload.message, /selected subject was not found/u);
});

test('admin can manage exam, subject, and topic configuration records', async () => {
  const cookie = await loginAdmin();
  const exam = await request('/api/admin/exams', { method: 'POST', cookie, body: { name: 'Second competitive examination', slug: 'second-competitive-exam', region: '', publicationStatus: 'draft' } });
  assert.equal(exam.response.status, 201);
  const examEdit = await request(`/api/admin/exams/${exam.payload.exam._id}`, { method: 'PATCH', cookie, body: { description: 'Exam-specific configuration.' } });
  assert.equal(examEdit.response.status, 200);
  assert.equal(examEdit.payload.exam.description, 'Exam-specific configuration.');

  const subject = await request('/api/admin/subjects', { method: 'POST', cookie, body: { exam: examId, name: 'Chemistry', slug: 'chemistry', publicationStatus: 'draft' } });
  assert.equal(subject.response.status, 201);
  const chapter = await request('/api/admin/chapters', { method: 'POST', cookie, body: { exam: examId, subject: subject.payload.subject._id, name: 'Atomic structure', slug: 'atomic-structure', publicationStatus: 'draft' } });
  assert.equal(chapter.response.status, 201);
  const topic = await request('/api/admin/topics', { method: 'POST', cookie, body: { exam: examId, subject: subject.payload.subject._id, chapter: chapter.payload.chapter._id, name: 'Atomic structure basics', slug: 'atomic-structure-basics', publicationStatus: 'draft' } });
  assert.equal(topic.response.status, 201);
  assert.equal(String(topic.payload.topic.chapter), chapter.payload.chapter._id);
  const topicEdit = await request(`/api/admin/topics/${topic.payload.topic._id}`, { method: 'PATCH', cookie, body: { publicationStatus: 'archived' } });
  assert.equal(topicEdit.response.status, 200);
  assert.equal(topicEdit.payload.topic.publicationStatus, 'archived');
});

test('admin can create, edit, publish and unpublish examinations without source records; students cannot publish', async () => {
  const details = { name: 'Open publication examination', slug: 'open-publication-examination', region: 'India', description: 'Configured examination details.', publicationStatus: 'draft' };
  const unauthorized = await request('/api/admin/exams', { method: 'POST', body: { ...details, publicationStatus: 'published' } });
  assert.equal(unauthorized.response.status, 401);

  const cookie = await loginAdmin();
  const created = await request('/api/admin/exams', { method: 'POST', cookie, body: details });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.exam.publicationStatus, 'draft');
  assert.equal(Object.hasOwn(created.payload.exam, 'officialSources'), false);

  const edited = await request(`/api/admin/exams/${created.payload.exam._id}`, { method: 'PATCH', cookie, body: { eligibility: 'Administrator-authored eligibility notes.' } });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.payload.exam.eligibility, 'Administrator-authored eligibility notes.');

  const published = await request(`/api/admin/exams/${created.payload.exam._id}`, { method: 'PATCH', cookie, body: { publicationStatus: 'published' } });
  assert.equal(published.response.status, 200);
  assert.equal(published.payload.exam.publicationStatus, 'published');

  const unpublished = await request(`/api/admin/exams/${created.payload.exam._id}`, { method: 'PATCH', cookie, body: { publicationStatus: 'draft' } });
  assert.equal(unpublished.response.status, 200);
  assert.equal(unpublished.payload.exam.publicationStatus, 'draft');
  assert.equal(collections.Exam.find((exam) => exam._id === created.payload.exam._id).publicationStatus, 'draft');
});

test('chapter and topic publication uses the existing PATCH routes, preserves hierarchy rules, and persists publish and unpublish states', async () => {
  const cookie = await loginAdmin();
  const draftExam = await request('/api/admin/exams', { method: 'POST', cookie, body: {
    name: 'Explicit publication workflow examination', slug: 'explicit-publication-workflow-examination', region: '', publicationStatus: 'draft',
  } });
  assert.equal(draftExam.response.status, 201);
  const draftSubject = await request('/api/admin/subjects', { method: 'POST', cookie, body: {
    exam: draftExam.payload.exam._id, name: 'Publication workflow subject', slug: 'publication-workflow-subject', publicationStatus: 'draft',
  } });
  assert.equal(draftSubject.response.status, 201);
  const blockedSubject = await request(`/api/admin/subjects/${draftSubject.payload.subject._id}`, { method: 'PATCH', cookie, body: { publicationStatus: 'published' } });
  assert.equal(blockedSubject.response.status, 400);
  assert.match(blockedSubject.payload.message, /Publish the examination before publishing its subjects/i);
  const draftChapter = await request('/api/admin/chapters', { method: 'POST', cookie, body: {
    exam: draftExam.payload.exam._id, subject: draftSubject.payload.subject._id,
    name: 'Publication workflow chapter', slug: 'publication-workflow-chapter', publicationStatus: 'draft',
  } });
  assert.equal(draftChapter.response.status, 201);
  const draftTopic = await request('/api/admin/topics', { method: 'POST', cookie, body: {
    exam: draftExam.payload.exam._id, subject: draftSubject.payload.subject._id, chapter: draftChapter.payload.chapter._id,
    name: 'Publication workflow topic', slug: 'publication-workflow-topic', publicationStatus: 'draft',
  } });
  assert.equal(draftTopic.response.status, 201);

  const blockedChapter = await request(`/api/admin/chapters/${draftChapter.payload.chapter._id}`, { method: 'PATCH', cookie, body: { publicationStatus: 'published' } });
  assert.equal(blockedChapter.response.status, 400);
  assert.match(blockedChapter.payload.message, /Publish the examination and subject before publishing this chapter/i);
  const blockedTopic = await request(`/api/admin/topics/${draftTopic.payload.topic._id}`, { method: 'PATCH', cookie, body: { publicationStatus: 'published' } });
  assert.equal(blockedTopic.response.status, 400);
  assert.match(blockedTopic.payload.message, /Publish the examination and subject before publishing its topics/i);
  const draftExamsAfterRejectedRequests = await request('/api/admin/exams?status=draft', { cookie });
  const draftSubjectsAfterRejectedRequests = await request('/api/admin/subjects?status=draft', { cookie });
  const draftChaptersAfterRejectedRequests = await request('/api/admin/chapters?status=draft', { cookie });
  const draftTopicsAfterRejectedRequests = await request('/api/admin/topics?status=draft', { cookie });
  assert.equal(draftExamsAfterRejectedRequests.payload.items.find((item) => item._id === draftExam.payload.exam._id).publicationStatus, 'draft');
  assert.equal(draftSubjectsAfterRejectedRequests.payload.items.find((item) => item._id === draftSubject.payload.subject._id).publicationStatus, 'draft');
  const visibleDraftChapter = draftChaptersAfterRejectedRequests.payload.items.find((item) => item._id === draftChapter.payload.chapter._id);
  assert.ok(visibleDraftChapter, `The admin draft chapter list should include the saved chapter: ${JSON.stringify(draftChaptersAfterRejectedRequests.payload)}`);
  assert.equal(visibleDraftChapter.publicationStatus, 'draft');
  assert.equal(draftTopicsAfterRejectedRequests.payload.items.find((item) => item._id === draftTopic.payload.topic._id).publicationStatus, 'draft');

  // Parent statuses are explicit administrator actions; publishing a child never changes them.
  assert.equal((await request(`/api/admin/exams/${draftExam.payload.exam._id}`, { method: 'PATCH', cookie, body: { publicationStatus: 'published' } })).response.status, 200);
  assert.equal((await request(`/api/admin/subjects/${draftSubject.payload.subject._id}`, { method: 'PATCH', cookie, body: { publicationStatus: 'published' } })).response.status, 200);
  const publishedChapter = await request(`/api/admin/chapters/${draftChapter.payload.chapter._id}`, { method: 'PATCH', cookie, body: { publicationStatus: 'published' } });
  assert.equal(publishedChapter.response.status, 200);
  assert.equal(publishedChapter.payload.chapter.publicationStatus, 'published');
  assert.equal((await request('/api/admin/chapters?status=published', { cookie })).payload.items.find((item) => item._id === draftChapter.payload.chapter._id).publicationStatus, 'published');

  const publishedTopic = await request(`/api/admin/topics/${draftTopic.payload.topic._id}`, { method: 'PATCH', cookie, body: { publicationStatus: 'published' } });
  assert.equal(publishedTopic.response.status, 200);
  assert.equal(publishedTopic.payload.topic.publicationStatus, 'published');
  assert.equal((await request('/api/admin/topics?status=published', { cookie })).payload.items.find((item) => item._id === draftTopic.payload.topic._id).publicationStatus, 'published');

  const unpublishedTopic = await request(`/api/admin/topics/${draftTopic.payload.topic._id}`, { method: 'PATCH', cookie, body: { publicationStatus: 'draft' } });
  assert.equal(unpublishedTopic.response.status, 200);
  assert.equal(unpublishedTopic.payload.topic.publicationStatus, 'draft');
  assert.equal((await request('/api/admin/topics?status=draft', { cookie })).payload.items.find((item) => item._id === draftTopic.payload.topic._id).publicationStatus, 'draft');
  const unpublishedChapter = await request(`/api/admin/chapters/${draftChapter.payload.chapter._id}`, { method: 'PATCH', cookie, body: { publicationStatus: 'draft' } });
  assert.equal(unpublishedChapter.response.status, 200);
  assert.equal(unpublishedChapter.payload.chapter.publicationStatus, 'draft');
  assert.equal((await request('/api/admin/chapters?status=draft', { cookie })).payload.items.find((item) => item._id === draftChapter.payload.chapter._id).publicationStatus, 'draft');
  assert.equal((await request('/api/admin/exams?status=published', { cookie })).payload.items.some((item) => item._id === draftExam.payload.exam._id), true);
  assert.equal((await request('/api/admin/subjects?status=published', { cookie })).payload.items.some((item) => item._id === draftSubject.payload.subject._id), true);
});

test('admin can set one primary exam and receives a safe conflict if another is selected', async () => {
  const cookie = await loginAdmin();
  const selected = await request(`/api/admin/exams/${examId}`, { method: 'PATCH', cookie, body: { isPrimary: true } });
  assert.equal(selected.response.status, 200);
  assert.equal(selected.payload.exam.isPrimary, true);
  const conflict = await request('/api/admin/exams', { method: 'POST', cookie, body: {
    name: 'Another configured exam', slug: 'another-configured-exam', region: '', isPrimary: true,
  } });
  assert.equal(conflict.response.status, 409);
  assert.match(conflict.payload.message, /Only one examination can be primary/i);
});

test('admin product drafts must keep exam, subject, and chapter references within one configured hierarchy', async () => {
  const cookie = await loginAdmin();
  const otherExam = await request('/api/admin/exams', { method: 'POST', cookie, body: {
    name: 'Other draft exam configuration', slug: 'other-draft-exam-configuration', region: '', publicationStatus: 'draft',
  } });
  const otherSubject = await request('/api/admin/subjects', { method: 'POST', cookie, body: {
    exam: otherExam.payload.exam._id, name: 'Other subject', slug: 'other-subject', publicationStatus: 'draft',
  } });
  const otherChapter = await request('/api/admin/chapters', { method: 'POST', cookie, body: {
    exam: otherExam.payload.exam._id, subject: otherSubject.payload.subject._id, name: 'Other chapter', slug: 'other-chapter', publicationStatus: 'draft',
  } });
  const mismatch = await request('/api/admin/products', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectId, chapter: otherChapter.payload.chapter._id, title: 'Mapped draft resource', slug: 'mapped-draft-resource',
    description: 'This draft deliberately has a mismatched chapter mapping.', resourceType: 'notes', pricePaise: 0, publicationStatus: 'draft',
  } });
  assert.equal(mismatch.response.status, 400);
  assert.match(mismatch.payload.message, /chapter that belongs to the selected examination and subject/i);
});

test('admin catalogue lists support validated sort choices', async () => {
  const cookie = await loginAdmin();
  const result = await request('/api/admin/subjects?sort=display-order', { cookie });
  assert.equal(result.response.status, 200);
  assert.deepEqual(lastSort, { sortOrder: 1, name: 1, _id: 1 });
  const invalid = await request('/api/admin/subjects?sort=unknown-field', { cookie });
  assert.equal(invalid.response.status, 400);
});

test('admin study material list filters by subject, chapter, category, and publication status', async () => {
  const cookie = await loginAdmin();
  const chapter = await request('/api/admin/chapters', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectId, name: 'Configured Biology Chapter', slug: 'configured-biology-chapter', publicationStatus: 'draft',
  } });
  assert.equal(chapter.response.status, 201);
  const created = await request('/api/admin/products', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectId, title: 'Filtered biology material', slug: 'filtered-biology-material',
    chapter: chapter.payload.chapter._id, description: 'A configurable material used to check admin filters.', category: 'chapter-notes',
    resourceType: 'notes', pricePaise: 0, publicationStatus: 'draft',
  } });
  assert.equal(created.response.status, 201);
  const filtered = await request(`/api/admin/products?subjectId=${subjectId}&chapterId=${chapter.payload.chapter._id}&category=chapter-notes&status=draft`, { cookie });
  assert.equal(filtered.response.status, 200);
  assert.equal(filtered.payload.pagination.total, 1);
  assert.equal(filtered.payload.items[0].title, 'Filtered biology material');
  const invalid = await request('/api/admin/products?category=not-a-category', { cookie });
  assert.equal(invalid.response.status, 400);
});

test('admin cannot delete study materials referenced by purchases or order history', async () => {
  const cookie = await loginAdmin();
  const created = await request('/api/admin/products', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectId, title: 'Referenced biology material', slug: 'referenced-biology-material',
    description: 'A configurable resource which will receive historical references.', resourceType: 'notes', pricePaise: 5000,
  } });
  assert.equal(created.response.status, 201);
  const productId = created.payload.product.id;
  orderRecords.push({ _id: nextId(), student: users[1]._id, status: 'pending', items: [{ product: productId }] });
  const deniedByOrder = await request(`/api/admin/products/${productId}`, { method: 'DELETE', cookie });
  assert.equal(deniedByOrder.response.status, 409);
  assert.match(deniedByOrder.payload.message, /order history reference/i);

  collections.PurchasedAccess.push(new FakeRecord({ _id: nextId(), student: users[1]._id, product: productId }, 'PurchasedAccess'));
  const deniedByAccess = await request(`/api/admin/products/${productId}`, { method: 'DELETE', cookie });
  assert.equal(deniedByAccess.response.status, 409);
  assert.match(deniedByAccess.payload.message, /student access record/i);
  assert.equal(collections.StudyMaterial.some((record) => String(record._id) === String(productId)), true);
});

test('admin PDF upload is role-protected and stores validated files outside public static paths', async () => {
  const denied = await uploadPdf(Buffer.from('%PDF-1.7 student material'));
  assert.equal(denied.response.status, 401);
  const student = await request('/api/auth/login', { method: 'POST', body: { email: 'student@example.com', password: 'student-secret-password-123' } });
  const studentDenied = await uploadPdf(Buffer.from('%PDF-1.7 student material'), { cookie: student.cookie });
  assert.equal(studentDenied.response.status, 401);

  const cookie = await loginAdmin();
  const invalid = await uploadPdf(Buffer.from('not a PDF'), { cookie });
  assert.equal(invalid.response.status, 400);
  const unsupported = await uploadPdf(Buffer.from('%PDF-1.7'), { cookie, contentType: 'text/plain' });
  assert.equal(unsupported.response.status, 415);
  const content = Buffer.from('%PDF-1.7 private demonstration bytes');
  const uploaded = await uploadPdf(content, { cookie });
  assert.equal(uploaded.response.status, 201);
  assert.match(uploaded.payload.reference, /^\/private\/[0-9a-f-]+\.pdf$/iu);
  assert.equal(uploaded.payload.sizeBytes, content.length);
  assert.deepEqual(await readFile(join(privateStorageDir, uploaded.payload.reference.split('/').at(-1))), content);
});

test('admin-to-student content workflow publishes configured mappings, protects private PDFs, and hides unpublished records', async () => {
  const adminCookie = await loginAdmin();
  const studentLogin = await request('/api/auth/login', { method: 'POST', body: { email: 'student@example.com', password: 'student-secret-password-123' } });
  assert.equal(studentLogin.response.status, 200);
  const studentCookie = studentLogin.cookie;

  const subject = await request('/api/admin/subjects', { method: 'POST', cookie: adminCookie, body: {
    exam: examId, name: 'Workflow Biology', slug: 'workflow-biology', description: 'Draft subject for isolated workflow tests.', publicationStatus: 'draft',
  } });
  assert.equal(subject.response.status, 201);
  const subjectId = subject.payload.subject._id;
  const subjectEdited = await request(`/api/admin/subjects/${subjectId}`, { method: 'PATCH', cookie: adminCookie, body: { description: 'Updated draft subject description.' } });
  assert.equal(subjectEdited.response.status, 200);
  assert.equal(subjectEdited.payload.subject.description, 'Updated draft subject description.');

  const chapter = await request('/api/admin/chapters', { method: 'POST', cookie: adminCookie, body: {
    exam: examId, subject: subjectId, name: 'Workflow Chapter', slug: 'workflow-chapter', publicationStatus: 'draft',
  } });
  assert.equal(chapter.response.status, 201);
  const chapterId = chapter.payload.chapter._id;
  const topic = await request('/api/admin/topics', { method: 'POST', cookie: adminCookie, body: {
    exam: examId, subject: subjectId, chapter: chapterId, name: 'Workflow Topic', slug: 'workflow-topic', publicationStatus: 'draft',
  } });
  assert.equal(topic.response.status, 201);
  const topicId = topic.payload.topic._id;

  const unpublishedSubjects = await request(`/api/subjects?examId=${examId}`);
  assert.equal(unpublishedSubjects.payload.items.some((item) => item._id === subjectId), false);
  assert.deepEqual((await request(`/api/chapters?subjectId=${subjectId}`)).payload.items, []);
  assert.deepEqual((await request(`/api/topics?subjectId=${subjectId}`)).payload.items, []);

  assert.equal((await request(`/api/admin/subjects/${subjectId}`, { method: 'PATCH', cookie: adminCookie, body: { publicationStatus: 'published' } })).response.status, 200);
  assert.equal((await request(`/api/subjects?examId=${examId}`)).payload.items.some((item) => item._id === subjectId), true);
  assert.equal((await request(`/api/chapters?subjectId=${subjectId}`)).payload.items.length, 0);
  assert.equal((await request(`/api/admin/chapters/${chapterId}`, { method: 'PATCH', cookie: adminCookie, body: { publicationStatus: 'published' } })).response.status, 200);
  assert.equal((await request(`/api/chapters?subjectId=${subjectId}`)).payload.items.some((item) => item._id === chapterId), true);
  assert.equal((await request(`/api/admin/topics/${topicId}`, { method: 'PATCH', cookie: adminCookie, body: { publicationStatus: 'published' } })).response.status, 200);
  assert.equal((await request(`/api/topics?subjectId=${subjectId}&chapterId=${chapterId}`)).payload.items.some((item) => item._id === topicId), true);

  const examOutline = await request(`/api/exams/${examId}`);
  assert.equal(examOutline.response.status, 200);
  const visibleSubject = examOutline.payload.subjects.find((item) => item._id === subjectId);
  assert.equal(visibleSubject.chapters[0].topics[0].name, 'Workflow Topic');

  const uploaded = await uploadPdf(Buffer.from('%PDF-1.7 isolated workflow sample'), { cookie: adminCookie });
  assert.equal(uploaded.response.status, 201);
  const createdProduct = await request('/api/admin/products', { method: 'POST', cookie: adminCookie, body: {
    exam: examId, subject: subjectId, chapter: chapterId, topic: topicId, title: 'Workflow private notes', slug: 'workflow-private-notes',
    description: 'Private resource created for an isolated content workflow test.', resourceType: 'notes', pricePaise: 9900, discountPaise: 9000,
    topics: [topicId], contentUrl: uploaded.payload.reference, publicationStatus: 'draft',
  } });
  assert.equal(createdProduct.response.status, 201);
  const productId = createdProduct.payload.product.id;
  assert.equal('contentUrl' in createdProduct.payload.product, false);
  assert.equal((await request(`/api/products/${productId}`)).response.status, 404);

  const searchBeforePublish = await request(`/api/products?q=Workflow&examId=${examId}&subjectId=${subjectId}&resourceType=notes&sort=price-asc&page=1&limit=5`);
  assert.equal(searchBeforePublish.response.status, 200);
  assert.equal(searchBeforePublish.payload.pagination.total, 0);
  const noPurchase = await request(`/api/student/resources/${productId}/download`, { cookie: studentCookie });
  assert.equal(noPurchase.response.status, 404);

  const published = await request(`/api/admin/products/${productId}`, { method: 'PATCH', cookie: adminCookie, body: { publicationStatus: 'published' } });
  assert.equal(published.response.status, 200);
  assert.equal((await request(`/api/products/${productId}`)).response.status, 200);
  const searched = await request(`/api/products?q=Workflow&examId=${examId}&subjectId=${subjectId}&chapterId=${chapterId}&topicId=${topicId}&resourceType=notes&sort=price-asc&page=1&limit=5`);
  assert.equal(searched.response.status, 200);
  assert.equal(searched.payload.pagination.total, 1);
  assert.equal(searched.payload.items[0].currentPricePaise, 900);
  assert.equal('contentUrl' in searched.payload.items[0], false);

  const deniedDownload = await request(`/api/student/resources/${productId}/download`, { cookie: studentCookie });
  assert.equal(deniedDownload.response.status, 403);
  const studentId = users.find((user) => user.email === 'student@example.com')._id;
  const verifiedOrder = orderRecords.find((order) => order.status === 'paid' && order.paymentVerifiedAt instanceof Date);
  collections.PurchasedAccess.push(new FakeRecord({ _id: nextId(), student: studentId, product: productId, order: verifiedOrder._id, status: 'active' }, 'PurchasedAccess'));
  const purchasedDownload = await request(`/api/student/resources/${productId}/download`, { cookie: studentCookie });
  assert.equal(purchasedDownload.response.status, 200);
  assert.equal(purchasedDownload.payload, '%PDF-1.7 isolated workflow sample');

  assert.equal((await request(`/api/admin/chapters/${chapterId}`, { method: 'PATCH', cookie: adminCookie, body: { publicationStatus: 'draft' } })).response.status, 200);
  assert.equal((await request(`/api/products/${productId}`)).response.status, 404);
  assert.equal((await request(`/api/student/resources/${productId}/download`, { cookie: studentCookie })).response.status, 404);
  assert.equal((await request(`/api/admin/chapters/${chapterId}`, { method: 'PATCH', cookie: adminCookie, body: { publicationStatus: 'published' } })).response.status, 200);

  assert.equal((await request(`/api/admin/topics/${topicId}`, { method: 'PATCH', cookie: adminCookie, body: { publicationStatus: 'draft' } })).response.status, 200);
  assert.equal((await request(`/api/products/${productId}`)).response.status, 404);
  const unpublishedTopicSearch = await request(`/api/products?q=Workflow&examId=${examId}&subjectId=${subjectId}`);
  assert.equal(unpublishedTopicSearch.payload.pagination.total, 0);
  assert.equal((await request(`/api/student/resources/${productId}/download`, { cookie: studentCookie })).response.status, 404);
  assert.equal((await request(`/api/admin/topics/${topicId}`, { method: 'PATCH', cookie: adminCookie, body: { publicationStatus: 'published' } })).response.status, 200);

  assert.equal((await request(`/api/admin/subjects/${subjectId}`, { method: 'PATCH', cookie: adminCookie, body: { publicationStatus: 'draft' } })).response.status, 200);
  assert.equal((await request(`/api/subjects?examId=${examId}`)).payload.items.some((item) => item._id === subjectId), false);
  assert.equal((await request(`/api/products/${productId}`)).response.status, 404);
  assert.equal((await request(`/api/student/resources/${productId}/download`, { cookie: studentCookie })).response.status, 404);
  assert.equal((await request(`/api/exams/${examId}`)).payload.subjects.some((item) => item._id === subjectId), false);
  assert.equal((await request(`/api/admin/subjects/${subjectId}`, { method: 'PATCH', cookie: adminCookie, body: { publicationStatus: 'published' } })).response.status, 200);

  for (const [resource, id] of [['topics', topicId], ['chapters', chapterId], ['subjects', subjectId]]) {
    const dependencyResponse = await request(`/api/admin/${resource}/${id}`, { method: 'DELETE', cookie: adminCookie });
    assert.equal(dependencyResponse.response.status, 409);
  }
  assert.equal((await request(`/api/admin/products/${productId}`, { method: 'PATCH', cookie: adminCookie, body: { publicationStatus: 'draft' } })).response.status, 200);
  assert.equal((await request(`/api/products/${productId}`)).response.status, 404);
  assert.equal((await request(`/api/student/resources/${productId}/download`, { cookie: studentCookie })).response.status, 404);

  assert.equal((await request(`/api/admin/topics/${topicId}`, { method: 'PATCH', cookie: adminCookie, body: { publicationStatus: 'draft' } })).response.status, 200);
  assert.equal((await request(`/api/topics?subjectId=${subjectId}&chapterId=${chapterId}`)).payload.items.some((item) => item._id === topicId), false);
  assert.equal((await request(`/api/admin/chapters/${chapterId}`, { method: 'PATCH', cookie: adminCookie, body: { publicationStatus: 'draft' } })).response.status, 200);
  assert.deepEqual((await request(`/api/chapters?subjectId=${subjectId}`)).payload.items, []);
  assert.equal((await request(`/api/admin/subjects/${subjectId}`, { method: 'PATCH', cookie: adminCookie, body: { publicationStatus: 'draft' } })).response.status, 200);
  assert.equal((await request(`/api/subjects?examId=${examId}`)).payload.items.some((item) => item._id === subjectId), false);
  const finalOutline = await request(`/api/exams/${examId}`);
  assert.equal(finalOutline.payload.subjects.some((item) => item._id === subjectId), false);
});

test('admin can delete unused subjects and topics while referenced records are protected', async () => {
  const cookie = await loginAdmin();
  const subject = await request('/api/admin/subjects', { method: 'POST', cookie, body: {
    exam: examId, name: 'Unused Chemistry', slug: 'unused-chemistry', publicationStatus: 'draft',
  } });
  assert.equal(subject.response.status, 201);
  const subjectRecordId = subject.payload.subject._id;
  const topic = await request('/api/admin/topics', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectRecordId, name: 'Unused atomic chapter', slug: 'unused-atomic-chapter', publicationStatus: 'draft',
  } });
  assert.equal(topic.response.status, 201);
  const topicRecordId = topic.payload.topic._id;
  const chapter = await request('/api/admin/chapters', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectRecordId, name: 'Unused chapter', slug: 'unused-chapter', publicationStatus: 'draft',
  } });
  assert.equal(chapter.response.status, 201);
  const chapterRecordId = chapter.payload.chapter._id;
  const remappedTopic = await request(`/api/admin/topics/${topicRecordId}`, { method: 'PATCH', cookie, body: { chapter: chapterRecordId } });
  assert.equal(remappedTopic.response.status, 200);

  const chapterInUse = await request(`/api/admin/chapters/${chapterRecordId}`, { method: 'DELETE', cookie });
  assert.equal(chapterInUse.response.status, 409);
  assert.match(chapterInUse.payload.message, /still used by 1 topic/i);

  const subjectInUse = await request(`/api/admin/subjects/${subjectRecordId}`, { method: 'DELETE', cookie });
  assert.equal(subjectInUse.response.status, 409);
  assert.match(subjectInUse.payload.message, /still used by 1 chapter/i);

  collections.StudyMaterial.push(new FakeRecord({ _id: nextId(), subject: subjectRecordId, topic: topicRecordId, topics: [topicRecordId] }, 'StudyMaterial'));
  const topicInUse = await request(`/api/admin/topics/${topicRecordId}`, { method: 'DELETE', cookie });
  assert.equal(topicInUse.response.status, 409);
  assert.match(topicInUse.payload.message, /still used by 1 study resource/i);

  collections.StudyMaterial.length = 0;
  const deletedTopic = await request(`/api/admin/topics/${topicRecordId}`, { method: 'DELETE', cookie });
  assert.equal(deletedTopic.response.status, 200);
  assert.equal(collections.Topic.some((item) => String(item._id) === String(topicRecordId)), false);

  const deletedSubject = await request(`/api/admin/subjects/${subjectRecordId}`, { method: 'DELETE', cookie });
  assert.equal(deletedSubject.response.status, 409);
  assert.match(deletedSubject.payload.message, /still used by 1 chapter/i);
  const deletedChapter = await request(`/api/admin/chapters/${chapterRecordId}`, { method: 'DELETE', cookie });
  assert.equal(deletedChapter.response.status, 200);
  const deletedUnusedSubject = await request(`/api/admin/subjects/${subjectRecordId}`, { method: 'DELETE', cookie });
  assert.equal(deletedUnusedSubject.response.status, 200);
  assert.equal(collections.Subject.some((item) => String(item._id) === String(subjectRecordId)), false);

  const unauthorized = await request(`/api/admin/topics/${topicRecordId}`, { method: 'DELETE' });
  assert.equal(unauthorized.response.status, 401);
});

test('published bundles must group other published catalogue products', async () => {
  const cookie = await loginAdmin();
  const item = await request('/api/admin/products', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectId, title: 'Bundle included notes', slug: 'bundle-included-notes', description: 'Notes to include in a preparation bundle.', resourceType: 'notes', pricePaise: 1000, publicationStatus: 'draft',
  } });
  const itemId = item.payload.product.id;
  const itemPublished = await request(`/api/admin/products/${itemId}`, { method: 'PATCH', cookie, body: { publicationStatus: 'published' } });
  assert.equal(itemPublished.response.status, 200);
  const bundle = await request('/api/admin/products', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectId, title: 'Entrance preparation bundle', slug: 'entrance-preparation-bundle', description: 'A group of published preparation resources.', resourceType: 'bundle', pricePaise: 5000, bundleItems: [itemId], publicationStatus: 'draft',
  } });
  assert.equal(bundle.response.status, 201);
  const publishedBundle = await request(`/api/admin/products/${bundle.payload.product.id}`, { method: 'PATCH', cookie, body: { publicationStatus: 'published' } });
  assert.equal(publishedBundle.response.status, 200, JSON.stringify(publishedBundle.payload));
  assert.deepEqual(publishedBundle.payload.product.bundleItems.map((entry) => typeof entry === 'string' ? entry : entry.id), [itemId]);
});

test('question bank create and update persist answer explanations for admin review', async () => {
  const cookie = await loginAdmin();
  const created = await request('/api/admin/question-banks', {
    method: 'POST', cookie,
    body: { exam: examId, subject: subjectId, title: 'Biology MCQs', questions: [{ prompt: 'Question?', options: ['A', 'B'], correctAnswerIndex: 1, explanation: 'B is correct.' }], publicationStatus: 'draft' },
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.questionBank.questions[0].explanation, 'B is correct.');
  const updated = await request(`/api/admin/question-banks/${created.payload.questionBank._id}`, { method: 'PATCH', cookie, body: { title: 'Biology entrance MCQs' } });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.payload.questionBank.title, 'Biology entrance MCQs');
});

test('admin can create and update course modules, lesson video metadata, and mock-test marking rules', async () => {
  const cookie = await loginAdmin();
  const courseChapter = await request('/api/admin/chapters', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectId, name: 'Configured Biology Chapter', slug: 'configured-biology-chapter', publicationStatus: 'draft',
  } });
  assert.equal(courseChapter.response.status, 201);
  const courseTopic = await request('/api/admin/topics', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectId, chapter: courseChapter.payload.chapter._id,
    name: 'Configured lesson topic', slug: 'configured-lesson-topic', publicationStatus: 'draft',
  } });
  assert.equal(courseTopic.response.status, 201);
  const videoProduct = await request('/api/admin/products', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectId, title: 'Biology video course', slug: 'biology-video-course', description: 'A recorded biology course for exam preparation.', resourceType: 'video-course', pricePaise: 0, publicationStatus: 'draft',
  } });
  const mockProduct = await request('/api/admin/products', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectId, title: 'Biology mock product', slug: 'biology-mock-product', description: 'A mock test product for entrance preparation.', resourceType: 'mock-test', pricePaise: 0, publicationStatus: 'draft',
  } });
  const course = await request('/api/admin/courses', {
    method: 'POST', cookie,
    body: {
      product: videoProduct.payload.product.id, exam: examId, subjects: [subjectId], courseType: 'video-course',
      durationMinutes: 40, lessonCount: 1, publicationStatus: 'draft',
      modules: [{ _id: '507f1f77bcf86cd799439301', title: 'Cell biology', subject: subjectId, chapter: courseChapter.payload.chapter._id, lessons: [{ _id: '507f1f77bcf86cd799439302', title: 'Cell structure', topic: courseTopic.payload.topic._id, durationMinutes: 40, videoProvider: 'private-hosted', videoAssetId: 'video-asset-key-9', isPreview: false }] }],
    },
  });
  assert.equal(course.response.status, 201);
  assert.equal(course.payload.course.modules[0].lessons[0].videoAssetId, 'video-asset-key-9');
  assert.equal(course.payload.course.modules[0].lessons[0].topic, courseTopic.payload.topic._id);
  assert.equal(course.payload.course.modules[0].lessons[0].publicationStatus, 'draft');
  assert.equal(course.payload.course.modules[0].chapter, courseChapter.payload.chapter._id);
  const protectedChapter = await request(`/api/admin/chapters/${courseChapter.payload.chapter._id}`, { method: 'DELETE', cookie });
  assert.equal(protectedChapter.response.status, 409);
  assert.match(protectedChapter.payload.message, /course module/i);
  const courseEdit = await request(`/api/admin/courses/${course.payload.course._id}`, { method: 'PATCH', cookie, body: { lessonCount: 2 } });
  assert.equal(courseEdit.response.status, 200);
  assert.equal(courseEdit.payload.course.lessonCount, 2);

  const preservedProgress = { student: '507f1f77bcf86cd799439399', course: course.payload.course._id, completedLessonIds: ['507f1f77bcf86cd799439302'], lastLessonId: '507f1f77bcf86cd799439302' };
  const progressSnapshot = structuredClone(preservedProgress);
  collections.CourseProgress.push(preservedProgress);
  const lessonEdit = await request(`/api/admin/courses/${course.payload.course._id}`, { method: 'PATCH', cookie, body: {
    modules: [{ _id: '507f1f77bcf86cd799439301', title: 'Cell biology updated', subject: subjectId, chapter: courseChapter.payload.chapter._id, lessons: [{
      _id: '507f1f77bcf86cd799439302', title: 'Cell structure updated', durationMinutes: 40, videoProvider: 'private-hosted', videoAssetId: 'video-asset-key-9', isPreview: false,
    }] }],
  } });
  assert.equal(lessonEdit.response.status, 200);
  assert.equal(lessonEdit.payload.course.modules[0]._id, '507f1f77bcf86cd799439301');
  assert.equal(lessonEdit.payload.course.modules[0].lessons[0]._id, '507f1f77bcf86cd799439302');
  assert.equal(lessonEdit.payload.course.modules[0].lessons[0].topic, courseTopic.payload.topic._id, 'omitting the topic from an ordinary edit retains its mapping');
  assert.deepEqual(collections.CourseProgress[0], progressSnapshot);
  const topicInUse = await request(`/api/admin/topics/${courseTopic.payload.topic._id}`, { method: 'DELETE', cookie });
  assert.equal(topicInUse.response.status, 409);
  assert.match(topicInUse.payload.message, /course lesson/u);

  const otherSubject = await request('/api/admin/subjects', { method: 'POST', cookie, body: { exam: examId, name: 'Other configured subject', slug: 'other-configured-subject', publicationStatus: 'draft' } });
  const otherChapter = await request('/api/admin/chapters', { method: 'POST', cookie, body: { exam: examId, subject: otherSubject.payload.subject._id, name: 'Other subject chapter', slug: 'other-subject-chapter', publicationStatus: 'draft' } });
  const invalidChapter = await request(`/api/admin/courses/${course.payload.course._id}`, { method: 'PATCH', cookie, body: {
    modules: [{ _id: '507f1f77bcf86cd799439301', title: 'Cell biology', subject: subjectId, chapter: otherChapter.payload.chapter._id, lessons: [{ _id: '507f1f77bcf86cd799439302', title: 'Cell structure', durationMinutes: 40, videoProvider: 'private-hosted', videoAssetId: 'video-asset-key-9', isPreview: false }] }],
  } });
  assert.equal(invalidChapter.response.status, 400);
  assert.match(invalidChapter.payload.message, /chapter must belong|chapter.*module subject/i);

  const mock = await request('/api/admin/mock-tests', {
    method: 'POST', cookie,
    body: {
      product: mockProduct.payload.product.id, exam: examId, title: 'Biology mock test', description: 'Configurable test description.', instructions: 'Read the instructions before starting.', questionBanks: [],
      durationMinutes: 60, questionCount: 50, marksPerQuestion: 2, totalMarks: 100,
      negativeMarkingEnabled: true, negativeMarksPerQuestion: 0.5, patternVerified: false, publicationStatus: 'draft',
    },
  });
  assert.equal(mock.response.status, 201);
  assert.equal(mock.payload.mockTest.description, 'Configurable test description.');
  assert.equal(mock.payload.mockTest.instructions, 'Read the instructions before starting.');
  assert.equal(mock.payload.mockTest.negativeMarksPerQuestion, 0.5);
  const mockEdit = await request(`/api/admin/mock-tests/${mock.payload.mockTest._id}`, { method: 'PATCH', cookie, body: { negativeMarksPerQuestion: 1 } });
  assert.equal(mockEdit.response.status, 200);
  assert.equal(mockEdit.payload.mockTest.negativeMarksPerQuestion, 1);
  const mockTextEdit = await request(`/api/admin/mock-tests/${mock.payload.mockTest._id}`, { method: 'PATCH', cookie, body: { description: 'Updated test description.', instructions: 'Updated test instructions.' } });
  assert.equal(mockTextEdit.response.status, 200);
  assert.equal(mockTextEdit.payload.mockTest.description, 'Updated test description.');
  assert.equal(mockTextEdit.payload.mockTest.instructions, 'Updated test instructions.');
});

test('course lesson topic mappings must remain inside the configured course subject, chapter, and exam', async () => {
  const cookie = await loginAdmin();
  const baseChapter = await request('/api/admin/chapters', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectId, name: 'Mapping base chapter', slug: 'mapping-base-chapter', publicationStatus: 'draft',
  } });
  const validTopic = await request('/api/admin/topics', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectId, chapter: baseChapter.payload.chapter._id, name: 'Mapping valid topic', slug: 'mapping-valid-topic', publicationStatus: 'draft',
  } });
  const otherChapter = await request('/api/admin/chapters', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectId, name: 'Mapping other chapter', slug: 'mapping-other-chapter', publicationStatus: 'draft',
  } });
  const otherSubject = await request('/api/admin/subjects', { method: 'POST', cookie, body: {
    exam: examId, name: 'Mapping other subject', slug: 'mapping-other-subject', publicationStatus: 'draft',
  } });
  const otherSubjectChapter = await request('/api/admin/chapters', { method: 'POST', cookie, body: {
    exam: examId, subject: otherSubject.payload.subject._id, name: 'Mapping other subject chapter', slug: 'mapping-other-subject-chapter', publicationStatus: 'draft',
  } });
  const subjectMismatchTopic = await request('/api/admin/topics', { method: 'POST', cookie, body: {
    exam: examId, subject: otherSubject.payload.subject._id, chapter: otherSubjectChapter.payload.chapter._id,
    name: 'Mapping other subject topic', slug: 'mapping-other-subject-topic', publicationStatus: 'draft',
  } });
  const chapterMismatchTopic = await request('/api/admin/topics', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectId, chapter: otherChapter.payload.chapter._id,
    name: 'Mapping other chapter topic', slug: 'mapping-other-chapter-topic', publicationStatus: 'draft',
  } });

  const otherExam = await request('/api/admin/exams', { method: 'POST', cookie, body: {
    name: 'Mapping other exam', slug: 'mapping-other-exam', region: '', publicationStatus: 'draft',
  } });
  const videoProduct = await request('/api/admin/products', { method: 'POST', cookie, body: {
    exam: examId, subject: subjectId, title: 'Mapping course product', slug: 'mapping-course-product', description: 'Draft course product for hierarchy mapping tests.', resourceType: 'video-course', pricePaise: 0, publicationStatus: 'draft',
  } });
  const moduleId = '507f1f77bcf86cd799439311';
  const lessonId = '507f1f77bcf86cd799439312';
  const course = await request('/api/admin/courses', { method: 'POST', cookie, body: {
    product: videoProduct.payload.product.id, exam: examId, subjects: [subjectId], courseType: 'video-course', publicationStatus: 'draft',
    modules: [{ _id: moduleId, title: 'Mapping module', subject: subjectId, chapter: baseChapter.payload.chapter._id, lessons: [{ _id: lessonId, title: 'Mapped lesson', topic: validTopic.payload.topic._id }] }],
  } });
  assert.equal(course.response.status, 201, JSON.stringify(course.payload));
  assert.equal(course.payload.course.modules[0].lessons[0].topic, validTopic.payload.topic._id);

  const mismatchedExamTopicId = '507f1f77bcf86cd799439313';
  collections.Topic.push(new FakeRecord({
    _id: mismatchedExamTopicId, exam: otherExam.payload.exam._id, subject: subjectId, chapter: baseChapter.payload.chapter._id,
    name: 'Inconsistent cross-exam topic', slug: 'inconsistent-cross-exam-topic', publicationStatus: 'draft',
  }, 'Topic'));
  const mapLesson = (topic, chapter = baseChapter.payload.chapter._id) => request(`/api/admin/courses/${course.payload.course._id}`, { method: 'PATCH', cookie, body: {
    modules: [{ _id: moduleId, title: 'Mapping module', subject: subjectId, chapter, lessons: [{ _id: lessonId, title: 'Mapped lesson', topic }] }],
  } });
  const noChapter = await mapLesson(validTopic.payload.topic._id, null);
  assert.equal(noChapter.response.status, 400);
  assert.match(noChapter.payload.message, /module with a chapter/u);
  const invalidReference = await mapLesson('507f1f77bcf86cd799439314');
  assert.equal(invalidReference.response.status, 400);
  assert.match(invalidReference.payload.message, /existing topic/u);
  const subjectMismatch = await mapLesson(subjectMismatchTopic.payload.topic._id);
  assert.equal(subjectMismatch.response.status, 400);
  assert.match(subjectMismatch.payload.message, /module subject/u);
  const chapterMismatch = await mapLesson(chapterMismatchTopic.payload.topic._id);
  assert.equal(chapterMismatch.response.status, 400);
  assert.match(chapterMismatch.payload.message, /module chapter/u);
  const examMismatch = await mapLesson(mismatchedExamTopicId);
  assert.equal(examMismatch.response.status, 400);
  assert.match(examMismatch.payload.message, /course examination/u);
  const restored = await mapLesson(validTopic.payload.topic._id);
  assert.equal(restored.response.status, 200);
  assert.equal(collections.PurchasedAccess.length, 0, 'curriculum mapping does not grant purchase entitlement');
});

test('admin can create the unpriced flagship course draft with exactly Physics, Chemistry, and Biology', async () => {
  const cookie = await loginAdmin();
  const product = await request('/api/admin/products', { method: 'POST', cookie, body: {
    exam: examId,
    subject: null,
    title: 'B.Sc. Nursing Entrance Preparation',
    slug: 'bsc-nursing-entrance-preparation',
    description: 'A structured learning programme covering Physics, Chemistry and Biology to help students prepare for B.Sc. Nursing entrance examinations.',
    resourceType: 'video-course',
    pricePaise: null,
    publicationStatus: 'draft',
  } });
  assert.equal(product.response.status, 201);
  assert.equal(product.payload.product.pricePaise, null);
  assert.equal(product.payload.product.currentPricePaise, null);
  assert.equal(product.payload.product.isFree, false);

  const subjects = [];
  for (const [name, slug, sortOrder] of [['Physics', 'physics', 0], ['Chemistry', 'chemistry', 1], ['Biology', 'biology', 2]]) {
    const created = await request('/api/admin/subjects', { method: 'POST', cookie, body: { exam: examId, name, slug, sortOrder, publicationStatus: 'draft' } });
    assert.equal(created.response.status, 201);
    subjects.push(created.payload.subject._id);
  }
  const audience = 'Students preparing for B.Sc. Nursing entrance examinations.';
  const course = await request('/api/admin/courses', { method: 'POST', cookie, body: {
    product: product.payload.product.id,
    exam: examId,
    subjects,
    courseType: 'video-course',
    category: 'Government Competitive Exam Preparation',
    targetAudience: audience,
    publicationStatus: 'draft',
  } });
  assert.equal(course.response.status, 201);
  assert.equal(course.payload.course.subjects.length, 3);
  assert.equal(course.payload.course.category, 'Government Competitive Exam Preparation');
  assert.equal(course.payload.course.targetAudience, audience);

  const invalidSubjects = [...subjects, subjectId];
  const invalid = await request(`/api/admin/courses/${course.payload.course._id}`, { method: 'PATCH', cookie, body: { subjects: invalidSubjects } });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.payload.message, /exactly Physics, Chemistry, and Biology/i);
});

test('admin order listing includes payment status and student purchase details without provider IDs', async () => {
  const cookie = await loginAdmin();
  const result = await request('/api/admin/orders?status=paid&page=1&limit=10', { cookie });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.pagination.total, 2);
  assert.equal(result.payload.items[0].student.email, 'student@example.com');
  assert.equal(result.payload.items[0].items[0].title, 'Biology notes');
  assert.equal(result.payload.items.some((order) => 'providerOrderId' in order), false);
});

test('admin refund report exposes verified refund and entitlement state and permits one protected review decision', async () => {
  const partialOrderId = '507f1f77bcf86cd799439099';
  const studentId = users.find((user) => user.email === 'student@example.com')._id;
  orderRecords.push({
    _id: partialOrderId,
    student: { _id: studentId, name: 'Student Reader', email: 'student@example.com' },
    items: [{ titleSnapshot: 'Biology notes', unitPricePaise: 12000, quantity: 1 }],
    amountPaise: 12000,
    totalRefundedPaise: 3000,
    status: 'partially_refunded',
    paymentProvider: 'razorpay',
    paymentVerifiedAt: new Date('2026-10-06T00:00:00Z'),
    refundReviewStatus: 'pending',
    createdAt: new Date('2026-10-06T00:00:00Z'),
  });
  collections.PaymentRefund.push(new FakeRecord({
    _id: nextId(), order: partialOrderId, providerRefundId: 'rfnd_test_admin_review',
    providerPaymentId: 'pay_test_admin_review', amountPaise: 3000, currency: 'INR',
    status: 'processed', reconciliationStatus: 'verified', processedAt: new Date('2026-10-06T00:00:00Z'),
  }, 'PaymentRefund'));
  const access = new FakeRecord({
    _id: nextId(), order: partialOrderId, student: studentId,
    source: 'purchase', status: 'active',
  }, 'PurchasedAccess');
  collections.PurchasedAccess.push(access);

  const studentLogin = await request('/api/auth/login', { method: 'POST', body: { email: 'student@example.com', password: 'student-secret-password-123' } });
  assert.equal(studentLogin.response.status, 200);
  const unauthorized = await request(`/api/admin/orders/${partialOrderId}/refund-review`, {
    method: 'POST', cookie: studentLogin.cookie, body: { decision: 'revoke-access' },
  });
  assert.equal(unauthorized.response.status, 401);
  assert.equal(access.status, 'active');

  const adminCookie = await loginAdmin();
  const listing = await request('/api/admin/orders?status=partially_refunded', { cookie: adminCookie });
  assert.equal(listing.response.status, 200);
  assert.equal(listing.payload.items.length, 1);
  assert.equal(listing.payload.items[0].amountPaise, 12000);
  assert.equal(listing.payload.items[0].totalRefundedPaise, 3000);
  assert.equal(listing.payload.items[0].remainingCapturedPaise, 9000);
  assert.equal(listing.payload.items[0].refundReviewStatus, 'pending');
  assert.equal(listing.payload.items[0].entitlementStatus, 'active');
  assert.equal(listing.payload.items[0].refunds[0].refundId, 'rfnd_test_admin_review');

  const decision = await request(`/api/admin/orders/${partialOrderId}/refund-review`, {
    method: 'POST', cookie: adminCookie, body: { decision: 'revoke-access' },
  });
  assert.equal(decision.response.status, 200);
  assert.equal(decision.payload.decision, 'revoke-access');
  assert.equal(access.status, 'revoked');
  const retry = await request(`/api/admin/orders/${partialOrderId}/refund-review`, {
    method: 'POST', cookie: adminCookie, body: { decision: 'revoke-access' },
  });
  assert.equal(retry.response.status, 200, 'repeated admin decision is idempotent');
  assert.equal(access.status, 'revoked');

  const keepOrderId = '507f1f77bcf86cd799439098';
  orderRecords.push({
    _id: keepOrderId,
    student: { _id: studentId, name: 'Student Reader', email: 'student@example.com' },
    items: [{ titleSnapshot: 'Physics notes', unitPricePaise: 8000, quantity: 1 }],
    amountPaise: 8000, totalRefundedPaise: 1000, status: 'partially_refunded',
    paymentProvider: 'razorpay', paymentVerifiedAt: new Date('2026-10-07T00:00:00Z'),
    refundReviewStatus: 'pending', createdAt: new Date('2026-10-07T00:00:00Z'),
  });
  const keepAccess = new FakeRecord({
    _id: nextId(), order: keepOrderId, student: studentId, source: 'purchase', status: 'active',
  }, 'PurchasedAccess');
  collections.PurchasedAccess.push(keepAccess);
  const keepDecision = await request(`/api/admin/orders/${keepOrderId}/refund-review`, {
    method: 'POST', cookie: adminCookie, body: { decision: 'keep-access' },
  });
  assert.equal(keepDecision.response.status, 200);
  assert.equal(keepDecision.payload.decision, 'keep-access');
  assert.equal(keepAccess.status, 'active');
});
