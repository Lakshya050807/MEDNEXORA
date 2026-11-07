import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'dashboard-test-session-secret-with-at-least-32-bytes';
process.env.APP_ORIGIN = 'http://localhost:5173';

const [{ createApp }, session, bcrypt] = await Promise.all([
  import('../src/app.js'),
  import('express-session'),
  import('bcryptjs'),
]);

const ids = {
  subject: '507f1f77bcf86cd799439201',
  topic: '507f1f77bcf86cd799439202',
  productPdf: '507f1f77bcf86cd799439203',
  productCourse: '507f1f77bcf86cd799439204',
  productFreeMock: '507f1f77bcf86cd799439205',
  productFreePdf: '507f1f77bcf86cd799439215',
  productPaidPdf: '507f1f77bcf86cd799439216',
  course: '507f1f77bcf86cd799439206',
  lessonOne: '507f1f77bcf86cd799439207',
  lessonTwo: '507f1f77bcf86cd799439208',
  bank: '507f1f77bcf86cd799439209',
  freeBank: '507f1f77bcf86cd799439210',
  mockTest: '507f1f77bcf86cd799439211',
  order: '507f1f77bcf86cd799439212',
  otherOrder: '507f1f77bcf86cd799439213',
  exam: '507f1f77bcf86cd799439214',
};

function sameId(left, right) {
  return String(left?._id ?? left?.id ?? left ?? '') === String(right?._id ?? right?.id ?? right ?? '');
}

function matchesValue(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
    if ('$in' in expected) return expected.$in.some((value) => sameId(actual, value));
    if ('$ne' in expected) return expected.$ne === null ? actual !== null && actual !== undefined : !sameId(actual, expected.$ne);
    if ('$exists' in expected) return expected.$exists ? actual !== null && actual !== undefined : actual === null || actual === undefined;
  }
  return sameId(actual, expected);
}

function matches(row, filter = {}) {
  for (const [key, expected] of Object.entries(filter)) {
    if (key === '$or') {
      if (!expected.some((branch) => matches(row, branch))) return false;
      continue;
    }
    if (!matchesValue(row[key], expected)) return false;
  }
  return true;
}

class FakeQuery {
  constructor(value) { this.value = value; this.max = Infinity; this.sortSpec = null; }
  select() { return this; }
  populate() { return this; }
  sort(value) { this.sortSpec = value; return this; }
  limit(value) { this.max = value; return this; }
  async lean() {
    let rows = this.value;
    if (Array.isArray(rows) && this.sortSpec) {
      const [field, direction] = Object.entries(this.sortSpec)[0] ?? [];
      rows = [...rows].sort((left, right) => (new Date(left[field] ?? 0) - new Date(right[field] ?? 0)) * direction);
    }
    return Array.isArray(rows) ? rows.slice(0, this.max) : rows;
  }
  then(resolve, reject) { return this.lean().then(resolve, reject); }
}

let rows;
let usersByEmail;
let usersById;
let nextUserId;
let server;
let baseUrl;
let fetchedAssetUrl;
let fetchedAssetResponse;
let privateStorageDir;

class FakeUserModel {
  static async exists(filter) { return usersByEmail.has(filter.email) ? { _id: usersByEmail.get(filter.email)._id } : null; }
  static findOne(filter) { return new FakeQuery(usersByEmail.get(filter.email) ?? null); }
  static async findById(id) { return usersById.get(String(id)) ?? null; }
  static async create(data) {
    if (usersByEmail.has(data.email)) {
      const error = new Error('Duplicate email');
      error.code = 11000;
      throw error;
    }
    const id = `507f1f77bcf86cd79943${String(nextUserId++).padStart(4, '0')}`;
    const user = { ...data, _id: id, id, role: 'student', createdAt: new Date() };
    usersByEmail.set(user.email, user);
    usersById.set(id, user);
    return user;
  }
}

function modelFor(collectionName) {
  const model = class {
    static find(filter = {}) { return new FakeQuery(rows[collectionName].filter((row) => matches(row, filter))); }
    static findOne(filter = {}) { return new FakeQuery(rows[collectionName].find((row) => matches(row, filter)) ?? null); }
    static async countDocuments(filter = {}) { return rows[collectionName].filter((row) => matches(row, filter)).length; }
    static async create(data) {
      if (collectionName === 'access' && rows.access.some((item) => sameId(item.student, data.student) && sameId(item.product, data.product))) {
        const error = new Error('duplicate student resource access');
        error.code = 11000;
        throw error;
      }
      const record = { ...data, _id: randomUUID().replaceAll('-', '').slice(0, 24), createdAt: new Date() };
      rows[collectionName].push(record);
      return record;
    }
  };
  return model;
}

const ProductModel = modelFor('products');
const CourseModel = modelFor('courses');
const CourseProgressModel = modelFor('progress');
const TestAttemptModel = modelFor('attempts');
const PurchasedAccessModel = modelFor('access');
const OrderModel = modelFor('orders');
const QuestionBankModel = modelFor('banks');
const MockTestModel = modelFor('mockTests');
const SubjectModel = modelFor('subjects');
const TopicModel = modelFor('topics');

beforeEach(async () => {
  privateStorageDir = await mkdtemp(join(tmpdir(), 'nursing-private-download-'));
  const now = new Date('2026-10-21T10:00:00Z');
  const studentId = '507f1f77bcf86cd799430001';
  const otherStudentId = '507f1f77bcf86cd799430002';
  const order = {
    _id: ids.order, student: studentId, status: 'paid', paymentVerifiedAt: now, accessGrantedAt: now,
    amountPaise: 25000, currency: 'INR', createdAt: now,
    items: [
      { product: ids.productPdf, titleSnapshot: 'Biology revision notes', quantity: 1, unitPricePaise: 5000 },
      { product: ids.productCourse, titleSnapshot: 'Biology recorded course', quantity: 1, unitPricePaise: 20000 },
    ],
  };
  rows = {
    subjects: [{ _id: ids.subject, name: 'Biology', publicationStatus: 'published' }],
    topics: [{ _id: ids.topic, name: 'Cell structure', subject: ids.subject }],
    products: [
      { _id: ids.productPdf, title: 'Biology revision notes', description: 'Configured private Biology notes.', thumbnailUrl: '', resourceType: 'notes', pricePaise: 5000, discountPaise: 0, currentPricePaise: 5000, subject: { _id: ids.subject, name: 'Biology', publicationStatus: 'published' }, chapter: null, exam: { _id: ids.exam, name: 'B.Sc. Nursing Entrance Examination', publicationStatus: 'published' }, contentUrl: 'https://files.example.test/private/biology.pdf', publicationStatus: 'published', updatedAt: now },
      { _id: ids.productCourse, title: 'Biology recorded course', description: 'Configured course.', thumbnailUrl: '', resourceType: 'video-course', pricePaise: 20000, discountPaise: 0, currentPricePaise: 20000, subject: { _id: ids.subject, name: 'Biology', publicationStatus: 'published' }, chapter: null, exam: { _id: ids.exam, name: 'B.Sc. Nursing Entrance Examination', publicationStatus: 'published' }, contentUrl: '', publicationStatus: 'published', updatedAt: now },
      { _id: ids.productFreeMock, title: 'Free original example mock', resourceType: 'mock-test', pricePaise: 0, discountPaise: 0, currentPricePaise: 0, subject: { _id: ids.subject, name: 'Biology', publicationStatus: 'published' }, chapter: null, exam: { _id: ids.exam, name: 'B.Sc. Nursing Entrance Examination', publicationStatus: 'published' }, publicationStatus: 'published' },
      { _id: ids.productFreePdf, title: 'Free Biology worksheet', description: 'A configured free worksheet for Biology practice.', resourceType: 'practice-paper', pricePaise: 0, discountPaise: 0, currentPricePaise: 0, subject: { _id: ids.subject, name: 'Biology', publicationStatus: 'published' }, chapter: null, exam: { _id: ids.exam, name: 'B.Sc. Nursing Entrance Examination', publicationStatus: 'published' }, contentUrl: 'https://files.example.test/private/free-worksheet.pdf', publicationStatus: 'published', updatedAt: now },
      { _id: ids.productPaidPdf, title: 'Paid Biology notes', description: 'A configured paid resource for Biology study.', resourceType: 'notes', pricePaise: 5000, discountPaise: 0, currentPricePaise: 5000, subject: { _id: ids.subject, name: 'Biology', publicationStatus: 'published' }, chapter: null, exam: { _id: ids.exam, name: 'B.Sc. Nursing Entrance Examination', publicationStatus: 'published' }, contentUrl: 'https://files.example.test/private/paid-notes.pdf', publicationStatus: 'published', updatedAt: now },
    ],
    courses: [{
      _id: ids.course, product: ids.productCourse, exam: { name: 'B.Sc. Nursing Entrance Examination' }, courseType: 'video-course', publicationStatus: 'published',
      modules: [{ sortOrder: 0, lessons: [
        { _id: ids.lessonOne, title: 'Introduction', sortOrder: 0 },
        { _id: ids.lessonTwo, title: 'Cell basics', sortOrder: 1 },
      ] }],
    }],
    progress: [{ student: studentId, course: ids.course, completedLessonIds: [ids.lessonOne], lastLessonId: ids.lessonOne, updatedAt: now }],
    attempts: [{
      _id: '507f1f77bcf86cd799439220', student: studentId, mode: 'mock', mockTest: ids.mockTest, questionBank: ids.bank,
      titleSnapshot: 'Biology example mock', status: 'submitted', startedAt: now, submittedAt: now, createdAt: now,
      result: { score: 2, maximumMarks: 4, correctAnswers: 2, incorrectAnswers: 2, unansweredQuestions: 0, accuracyPercent: 50 },
      questions: [0, 1, 2, 3].map((index) => ({ questionId: `507f1f77bcf86cd79943923${index}`, bankId: ids.bank, topic: ids.topic })),
      answers: [0, 1, 0, 2].map((selectedOptionIndex, index) => ({ questionId: `507f1f77bcf86cd79943923${index}`, selectedOptionIndex })),
      answerKey: [0, 0, 1, 2].map((correctAnswerIndex, index) => ({ questionId: `507f1f77bcf86cd79943923${index}`, correctAnswerIndex, explanation: 'Private answer key content.' })),
    }],
    access: [
      { student: studentId, product: ids.productPdf, order: ids.order, status: 'active' },
      { student: studentId, product: ids.productCourse, order: ids.order, status: 'active' },
    ],
    orders: [order, { ...order, _id: ids.otherOrder, student: otherStudentId, items: [{ product: ids.productFreeMock, titleSnapshot: 'Other student resource', quantity: 1, unitPricePaise: 1 }] }],
    banks: [
      { _id: ids.bank, title: 'Biology question bank', subject: ids.subject, product: ids.productCourse, publicationStatus: 'published' },
      { _id: ids.freeBank, title: 'Free cell structure practice', subject: ids.subject, product: null, publicationStatus: 'published' },
    ],
    mockTests: [{ _id: ids.mockTest, product: ids.productFreeMock, title: 'Free example mock', durationMinutes: 30, questionCount: 10, publicationStatus: 'published', createdAt: now }],
  };
  usersByEmail = new Map();
  usersById = new Map();
  nextUserId = 1;
  fetchedAssetUrl = null;
  fetchedAssetResponse = new Response('%PDF-1.7 student copy', { status: 200, headers: { 'content-type': 'application/pdf' } });
  server = createApp({
    sessionStore: new session.MemoryStore(),
    UserModel: FakeUserModel,
    ProductModel,
    CourseModel,
    CourseProgressModel,
    TestAttemptModel,
    PurchasedAccessModel,
    OrderModel,
    QuestionBankModel,
    MockTestModel,
    SubjectModel,
    TopicModel,
    privateStorageOrigin: 'https://files.example.test',
    privateStorageDir,
    privateAssetFetch: async (url) => {
      fetchedAssetUrl = String(url);
      return fetchedAssetResponse;
    },
  });
  await new Promise((resolve) => { server = server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (privateStorageDir) await rm(privateStorageDir, { recursive: true, force: true });
});

async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
  const setCookie = response.headers.get('set-cookie');
  return { response, body: payload, cookie: setCookie ? setCookie.split(';')[0] : null };
}

async function registerAndLogin(email, name) {
  await request('/api/auth/register', { method: 'POST', body: { email, name, password: 'safe-student-password-2026' } });
  const login = await request('/api/auth/login', { method: 'POST', body: { email, password: 'safe-student-password-2026' } });
  assert.equal(login.response.status, 200);
  return login.cookie;
}

test('dashboard aggregates only the authenticated student’s purchases, course progress, and saved attempt results', async () => {
  const cookie = await registerAndLogin('asha@example.com', 'Asha Student');
  const result = await request('/api/student/dashboard', { cookie });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.user.name, 'Asha Student');
  assert.equal('passwordHash' in result.body.user, false);
  assert.equal(result.body.dashboard.summary.purchasedResources, 2);
  assert.equal(result.body.dashboard.purchased.materials.length, 1);
  assert.equal(result.body.dashboard.purchased.materials[0].downloadAvailable, true);
  assert.equal('contentUrl' in result.body.dashboard.purchased.materials[0], false);
  assert.equal(result.body.dashboard.purchased.courses[0].progressPercent, 50);
  assert.equal(result.body.dashboard.purchased.courses[0].nextLesson.id, ids.lessonTwo);
  assert.equal(result.body.dashboard.recentAttempts[0].result.accuracyPercent, 50);
  assert.equal(result.body.dashboard.analytics.subjectPerformance[0].name, 'Biology');
  assert.equal(result.body.dashboard.analytics.subjectPerformance[0].accuracyPercent, 50);
  assert.equal(result.body.dashboard.analytics.weakTopics[0].name, 'Cell structure');
  assert.equal(result.body.dashboard.analytics.weakTopics[0].answered, 4);
  assert.equal(result.body.dashboard.freePractice.questionBanks[0].title, 'Free cell structure practice');
  assert.equal(result.body.dashboard.freePractice.mockTests[0].title, 'Free example mock');
  assert.equal(result.body.dashboard.orders.length, 1);
  assert.equal(result.body.dashboard.orders[0].status, 'paid');
  assert.equal(JSON.stringify(result.body).includes('Private answer key content.'), false);
  assert.equal(JSON.stringify(result.body).includes('correctAnswerIndex'), false);
});

test('dashboard empty states are backed by the new student’s own records and another student cannot download a purchased PDF', async () => {
  await registerAndLogin('asha@example.com', 'Asha Student');
  const otherCookie = await registerAndLogin('riya@example.com', 'Riya Student');
  const result = await request('/api/student/dashboard', { cookie: otherCookie });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.user.id, '507f1f77bcf86cd799430002');
  assert.deepEqual(result.body.dashboard.purchased.materials, []);
  assert.deepEqual(result.body.dashboard.purchased.courses, []);
  assert.deepEqual(result.body.dashboard.recentAttempts, []);
  assert.deepEqual(result.body.dashboard.analytics.subjectPerformance, []);
  assert.deepEqual(result.body.dashboard.analytics.trend, []);
  assert.deepEqual(result.body.dashboard.analytics.weakTopics, []);
  assert.deepEqual(result.body.dashboard.orders.map((order) => order.id), [ids.otherOrder]);
  assert.equal(result.body.dashboard.summary.overallAccuracyPercent, null);

  const newStudentCookie = await registerAndLogin('nina@example.com', 'Nina Student');
  const empty = await request('/api/student/dashboard', { cookie: newStudentCookie });
  assert.deepEqual(empty.body.dashboard.purchased.materials, []);
  assert.deepEqual(empty.body.dashboard.purchased.courses, []);
  assert.deepEqual(empty.body.dashboard.recentAttempts, []);
  assert.deepEqual(empty.body.dashboard.orders, []);

  const denied = await request(`/api/student/resources/${ids.productPdf}/download`, { cookie: otherCookie });
  assert.equal(denied.response.status, 403);
  assert.equal(fetchedAssetUrl, null);
  const anonymous = await request(`/api/student/resources/${ids.productPdf}/download`);
  assert.equal(anonymous.response.status, 401);
});

test('verified owner download proxies only a configured private-origin PDF', async () => {
  const cookie = await registerAndLogin('asha@example.com', 'Asha Student');
  const response = await request(`/api/student/resources/${ids.productPdf}/download`, { cookie });
  assert.equal(response.response.status, 200);
  assert.match(response.response.headers.get('content-disposition'), /biology-revision-notes\.pdf/iu);
  assert.equal(response.response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.body, '%PDF-1.7 student copy');
  assert.equal(fetchedAssetUrl, 'https://files.example.test/private/biology.pdf');
});

test('free PDF access is claimed on the server, idempotent, listed in My Library, and isolated per student', async () => {
  const anonymous = await request(`/api/student/resources/${ids.productFreePdf}/access`, { method: 'POST', body: {} });
  assert.equal(anonymous.response.status, 401);
  const cookie = await registerAndLogin('asha@example.com', 'Asha Student');
  const firstClaim = await request(`/api/student/resources/${ids.productFreePdf}/access`, { method: 'POST', cookie, body: {} });
  assert.equal(firstClaim.response.status, 201);
  assert.equal(firstClaim.body.access.source, 'free');
  assert.match(firstClaim.response.headers.get('cache-control'), /no-store/u);

  const repeatClaim = await request(`/api/student/resources/${ids.productFreePdf}/access`, { method: 'POST', cookie, body: {} });
  assert.equal(repeatClaim.response.status, 200);
  assert.equal(rows.access.filter((item) => sameId(item.product, ids.productFreePdf)).length, 1);

  const library = await request('/api/student/dashboard', { cookie });
  const freeItem = library.body.dashboard.purchased.materials.find((item) => item.id === ids.productFreePdf);
  assert.equal(freeItem.accessSource, 'free');
  assert.equal(freeItem.downloadAvailable, true);
  assert.equal('contentUrl' in freeItem, false);

  const freeDownload = await request(`/api/student/resources/${ids.productFreePdf}/download`, { cookie });
  assert.equal(freeDownload.response.status, 200);
  assert.equal(freeDownload.body, '%PDF-1.7 student copy');

  const otherCookie = await registerAndLogin('rohan@example.com', 'Rohan Student');
  const deniedDownload = await request(`/api/student/resources/${ids.productFreePdf}/download`, { cookie: otherCookie });
  assert.equal(deniedDownload.response.status, 403);
  const deniedClaim = await request(`/api/student/resources/${ids.productPaidPdf}/access`, { method: 'POST', cookie: otherCookie, body: {} });
  assert.equal(deniedClaim.response.status, 409);
  assert.equal(rows.access.some((item) => sameId(item.product, ids.productPaidPdf)), false);
});

test('verified owner can download a locally uploaded PDF through the authenticated route', async () => {
  const cookie = await registerAndLogin('asha@example.com', 'Asha Student');
  const filename = `${randomUUID()}.pdf`;
  const content = Buffer.from('%PDF-1.7 locally stored course material');
  await writeFile(join(privateStorageDir, filename), content);
  rows.products[0].contentUrl = `/private/${filename}`;
  fetchedAssetUrl = null;

  const response = await request(`/api/student/resources/${ids.productPdf}/download`, { cookie });
  assert.equal(response.response.status, 200);
  assert.equal(response.body, content.toString());
  assert.equal(response.response.headers.get('content-type'), 'application/pdf');
  assert.equal(fetchedAssetUrl, null);
});

test('unpublished products or parent mappings disappear from student dashboards and downloads', async () => {
  const cookie = await registerAndLogin('asha@example.com', 'Asha Student');
  rows.products[0].topic = { _id: ids.topic, name: 'Cell structure', publicationStatus: 'published' };
  rows.products[0].topics = [{ _id: ids.topic, name: 'Cell structure', publicationStatus: 'published' }];
  const initial = await request('/api/student/dashboard', { cookie });
  assert.equal(initial.body.dashboard.purchased.materials.length, 1);

  rows.products[0].subject.publicationStatus = 'draft';
  const hiddenDashboard = await request('/api/student/dashboard', { cookie });
  assert.deepEqual(hiddenDashboard.body.dashboard.purchased.materials, []);
  const hiddenDownload = await request(`/api/student/resources/${ids.productPdf}/download`, { cookie });
  assert.equal(hiddenDownload.response.status, 404);

  rows.products[0].subject.publicationStatus = 'published';
  rows.products[0].topic.publicationStatus = 'draft';
  rows.products[0].topics[0].publicationStatus = 'draft';
  const hiddenTopicDashboard = await request('/api/student/dashboard', { cookie });
  assert.deepEqual(hiddenTopicDashboard.body.dashboard.purchased.materials, []);
  const hiddenTopicDownload = await request(`/api/student/resources/${ids.productPdf}/download`, { cookie });
  assert.equal(hiddenTopicDownload.response.status, 404);

  rows.products[0].topic.publicationStatus = 'published';
  rows.products[0].topics[0].publicationStatus = 'published';
  rows.products[0].topic.chapter = { _id: '507f1f77bcf86cd799439215', publicationStatus: 'draft' };
  const hiddenChapterDashboard = await request('/api/student/dashboard', { cookie });
  assert.deepEqual(hiddenChapterDashboard.body.dashboard.purchased.materials, []);
  const hiddenChapterDownload = await request(`/api/student/resources/${ids.productPdf}/download`, { cookie });
  assert.equal(hiddenChapterDownload.response.status, 404);

  rows.products[0].topic.chapter.publicationStatus = 'published';
  rows.products[0].publicationStatus = 'archived';
  const archivedDashboard = await request('/api/student/dashboard', { cookie });
  assert.deepEqual(archivedDashboard.body.dashboard.purchased.materials, []);
  const archivedDownload = await request(`/api/student/resources/${ids.productPdf}/download`, { cookie });
  assert.equal(archivedDownload.response.status, 404);
});

test('private download rejects paths outside the private storage namespace and oversized PDFs', async () => {
  const cookie = await registerAndLogin('asha@example.com', 'Asha Student');
  rows.products[0].contentUrl = 'https://files.example.test/private/%2e%2e/admin.pdf';
  const pathEscape = await request(`/api/student/resources/${ids.productPdf}/download`, { cookie });
  assert.equal(pathEscape.response.status, 503);
  assert.equal(fetchedAssetUrl, null);

  rows.products[0].contentUrl = 'https://files.example.test/private/biology.pdf';
  fetchedAssetResponse = new Response('%PDF-1.7', {
    status: 200,
    headers: { 'content-type': 'application/pdf', 'content-length': String(50 * 1024 * 1024 + 1) },
  });
  const oversized = await request(`/api/student/resources/${ids.productPdf}/download`, { cookie });
  assert.equal(oversized.response.status, 413);
  assert.match(oversized.body.message, /50 MB/u);
});
