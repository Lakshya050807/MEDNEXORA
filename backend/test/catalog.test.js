import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-bytes';
process.env.APP_ORIGIN = 'http://localhost:5173';

const [{ createApp }, session, bcrypt, { default: StudyMaterial }, { default: Exam }, { default: Chapter }, { default: QuestionBank }, { default: Course }, { default: MockTest }, { default: Order }, { default: PurchasedAccess }] = await Promise.all([
  import('../src/app.js'),
  import('express-session'),
  import('bcryptjs'),
  import('../src/models/StudyMaterial.js'),
  import('../src/models/Exam.js'),
  import('../src/models/Chapter.js'),
  import('../src/models/QuestionBank.js'),
  import('../src/models/Course.js'),
  import('../src/models/MockTest.js'),
  import('../src/models/Order.js'),
  import('../src/models/PurchasedAccess.js'),
]);

const examId = '507f1f77bcf86cd799439011';
const subjectId = '507f1f77bcf86cd799439012';
const topicId = '507f1f77bcf86cd799439013';
const productId = '507f1f77bcf86cd799439014';
const chapterId = '507f1f77bcf86cd799439015';

let usersByEmail;
let usersById;
let productFilters;
let productSort;
let productSkip;
let productLimit;
let detailFilter;
let examListFilter;
let server;
let baseUrl;

class Query {
  constructor(value) { this.value = value; }
  select() { return this; }
  populate() { return this; }
  sort(value) { productSort = value; return this; }
  skip(value) { productSkip = value; return this; }
  limit(value) { productLimit = value; return this; }
  lean() { return Promise.resolve(this.value); }
}

class FakeUserModel {
  static async exists({ email }) { return usersByEmail.has(email) ? { _id: usersByEmail.get(email)._id } : null; }
  static findOne({ email }) { return { select: async () => usersByEmail.get(email) ?? null }; }
  static async create(data) {
    const user = { ...data, _id: 'student-id', id: 'student-id', role: 'student' };
    usersByEmail.set(user.email, user);
    usersById.set(user.id, user);
    return user;
  }
  static async findById(id) { return usersById.get(String(id)) ?? null; }
}

const publishedProduct = {
  _id: productId,
  slug: 'biology-notes',
  title: 'Biology revision notes',
  description: 'Published competitive exam preparation notes.',
  language: 'Hindi',
  publicationStatus: 'published',
  resourceType: 'notes',
  category: 'chapter-notes',
  detailedDescription: 'A longer product-detail description.',
  pricePaise: 12500,
  discountPaise: 2500,
  currentPricePaise: 10000,
  exam: { _id: examId, name: 'B.Sc. Nursing Entrance Examination', slug: 'bsc-nursing-entrance-examination' },
  subject: { _id: subjectId, name: 'Biology', slug: 'biology' },
  topic: { _id: topicId, name: 'Cell biology', slug: 'cell-biology' },
  topics: [{ _id: topicId, name: 'Cell biology', slug: 'cell-biology' }],
  keywords: ['biology'],
  preview: { title: 'Public excerpt', excerpt: 'Only this configured excerpt is visible.' },
  contentUrl: 'private://paid-file.pdf',
  createdAt: new Date('2026-10-01T00:00:00Z'),
};

class FakeProductModel {
  static countDocuments(filter) { productFilters = filter; return Promise.resolve(23); }
  static find(filter) { productFilters = filter; return new Query([publishedProduct]); }
  static findOne(filter) {
    detailFilter = filter;
    return new Query(filter.slug === 'biology-notes' && filter.publicationStatus === 'published' ? publishedProduct : null);
  }
}

class FakeSubjectModel {
  static find() { return new Query([{ _id: subjectId, name: 'Biology', exam: examId, publicationStatus: 'published' }]); }
  static findOne() { return new Query({ _id: subjectId, exam: examId, publicationStatus: 'published' }); }
}

class FakeTopicModel {
  static find() { return new Query([{ _id: topicId, name: 'Cell structure', subject: subjectId, chapter: chapterId, publicationStatus: 'published' }]); }
  static findOne() { return new Query(null); }
}

class FakeChapterModel {
  static find() { return new Query([{ _id: chapterId, name: 'Cell chapter', subject: subjectId, exam: examId, publicationStatus: 'published' }]); }
  static findOne() { return new Query(null); }
}

class FakeExamModel {
  static find(filter = {}) { examListFilter = filter; return new Query(filter.publicationStatus === 'published' ? [{ _id: examId, name: 'B.Sc. Nursing Entrance Examination', slug: 'bsc-nursing-entrance-examination', publicationStatus: 'published', region: '' }] : []); }
  static findOne() { return new Query({ _id: examId, name: 'B.Sc. Nursing Entrance Examination', publicationStatus: 'published', region: '' }); }
}

class EmptyModel {}

let origin;

beforeEach(async () => {
  usersByEmail = new Map();
  usersById = new Map();
  productFilters = null;
  productSort = null;
  productSkip = null;
  productLimit = null;
  detailFilter = null;
  examListFilter = null;
  const app = createApp({
    sessionStore: new session.MemoryStore(),
    UserModel: FakeUserModel,
    ProductModel: FakeProductModel,
    ExamModel: FakeExamModel,
    SubjectModel: FakeSubjectModel,
    ChapterModel: FakeChapterModel,
    TopicModel: FakeTopicModel,
    CourseModel: EmptyModel,
    QuestionBankModel: EmptyModel,
    MockTestModel: EmptyModel,
  });
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  origin = undefined;
});

afterEach(async () => {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null };
}

test('public product listing applies exam, subject, topic, category, type, paise, search, sorting and pagination filters', async () => {
  const result = await request(`/api/products?q=Biology&examId=${examId}&subjectId=${subjectId}&topicId=${topicId}&resourceType=notes&category=chapter-notes&minPricePaise=5000&maxPricePaise=15000&sort=price-asc&page=2&limit=5`);
  assert.equal(result.response.status, 200);
  assert.equal(productFilters.publicationStatus, 'published');
  assert.equal(productFilters.exam, examId);
  assert.equal(productFilters.subject, subjectId);
  assert.deepEqual(productFilters.$and[0].$or, [{ topic: topicId }, { topics: topicId }]);
  assert.equal(productFilters.resourceType, 'notes');
  assert.equal(productFilters.category, 'chapter-notes');
  assert.deepEqual(productFilters.currentPricePaise, { $gte: 5000, $lte: 15000 });
  assert.equal(productFilters.$and[1].$or.some((part) => part.$text?.$search === 'Biology'), true);
  assert.deepEqual(productSort, { currentPricePaise: 1, createdAt: -1 });
  assert.equal(productSkip, 5);
  assert.equal(productLimit, 5);
  assert.deepEqual(result.payload.pagination, { page: 2, limit: 5, total: 23, pages: 5 });
  assert.equal(result.payload.items[0].currentPricePaise, 10000);
  assert.equal(result.payload.items[0].paperLabel, null);
  assert.equal('contentUrl' in result.payload.items[0], false);
});

test('product detail queries only published listings and returns only the configured public preview excerpt', async () => {
  const found = await request('/api/products/biology-notes?previewPage=999');
  assert.equal(found.response.status, 200);
  assert.equal(detailFilter.publicationStatus, 'published');
  assert.equal(found.payload.product.subject.name, 'Biology');
  assert.equal(found.payload.product.language, 'Hindi');
  assert.equal(found.payload.product.detailedDescription, 'A longer product-detail description.');
  assert.deepEqual(found.payload.product.preview, { title: 'Public excerpt', excerpt: 'Only this configured excerpt is visible.' });
  assert.equal('contentUrl' in found.payload.product, false);
  const missing = await request('/api/products/unpublished-resource');
  assert.equal(missing.response.status, 404);
});

test('public target exam hierarchy returns published subjects, chapters, and chapter topics only', async () => {
  const exams = await request('/api/exams');
  assert.equal(exams.response.status, 200);
  const subjects = await request(`/api/subjects?examId=${examId}`);
  assert.equal(subjects.response.status, 200);
  const chapters = await request(`/api/chapters?subjectId=${subjectId}`);
  assert.equal(chapters.response.status, 200);
  assert.equal(chapters.payload.items[0].name, 'Cell chapter');
  const topics = await request(`/api/topics?subjectId=${subjectId}&chapterId=${chapterId}`);
  assert.equal(topics.response.status, 200);
  const detail = await request('/api/exams/bsc-nursing-entrance-examination');
  assert.equal(detail.response.status, 200);
  assert.equal(detail.payload.exam.name, 'B.Sc. Nursing Entrance Examination');
  assert.equal(Object.hasOwn(detail.payload.exam, 'publishedWithoutVerifiedSource'), false);
  assert.equal(Object.hasOwn(detail.payload.exam, 'officialSources'), false);
  assert.equal(detail.payload.subjects[0].chapters[0].name, 'Cell chapter');
  assert.equal(detail.payload.subjects[0].chapters[0].topics[0].name, 'Cell structure');
});

test('public exam listing includes published configured exams without a geographic restriction', async () => {
  const result = await request('/api/exams');
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.items.length, 1);
  assert.equal(result.payload.items[0].name, 'B.Sc. Nursing Entrance Examination');
  assert.equal(Object.hasOwn(result.payload.items[0], 'publishedWithoutVerifiedSource'), false);
  assert.equal(Object.hasOwn(result.payload, 'allowUnverifiedExamPublishing'), false);
  assert.deepEqual(examListFilter, { publicationStatus: 'published' });
  assert.equal(examListFilter.publicationStatus, 'published');
  assert.equal(Object.hasOwn(examListFilter, 'region'), false);
});

test('admin mutations require a server-authenticated administrator role', async () => {
  const anonymous = await request('/api/admin/products', { method: 'POST', body: { title: 'Test' } });
  assert.equal(anonymous.response.status, 401);

  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Catalog Student', email: 'catalog@example.com', password: 'a-safe-student-password' },
  });
  assert.equal(registration.response.status, 201);
  const studentMutation = await request('/api/admin/products', { method: 'POST', cookie: registration.cookie, body: { title: 'Test' } });
  assert.equal(studentMutation.response.status, 401);
  assert.deepEqual(studentMutation.payload, { message: 'Please log in to continue.' });
});

test('money is stored in paise and published previous-year papers require verification', async () => {
  const practice = new StudyMaterial({
    exam: examId,
    subject: subjectId,
    title: 'Original practice paper',
    slug: 'original-practice-paper',
    description: 'An original paper written for practice.',
    resourceType: 'practice-paper',
    paperClassification: 'original-practice',
    publicationStatus: 'published',
    pricePaise: 12500,
    discountPaise: 2500,
  });
  await practice.validate();
  assert.equal(practice.currentPricePaise, 10000);

  const unverifiedPreviousYearPaper = new StudyMaterial({
    exam: examId,
    subject: subjectId,
    title: 'Previous-year paper',
    slug: 'previous-year-paper',
    description: 'A previous-year entrance examination paper.',
    resourceType: 'previous-year-paper',
    publicationStatus: 'published',
    pricePaise: 0,
  });
  await assert.rejects(unverifiedPreviousYearPaper.validate(), /verified|legal-availability/i);

  const verifiedPreviousYearPaper = new StudyMaterial({
    exam: examId,
    subject: subjectId,
    title: 'Verified previous-year paper',
    slug: 'verified-previous-year-paper',
    description: 'A legally verified previous-year paper with its source recorded.',
    resourceType: 'previous-year-paper',
    paperClassification: 'verified-previous-year',
    previousYearSource: {
      title: 'Example verification record',
      url: 'https://example.test/previous-paper',
      legalAvailabilityConfirmed: true,
      verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    publicationStatus: 'published',
    pricePaise: 0,
  });
  await verifiedPreviousYearPaper.validate();
  assert.equal(verifiedPreviousYearPaper.paperClassification, 'verified-previous-year');

  verifiedPreviousYearPaper.paperClassification = 'original-practice';
  await assert.rejects(verifiedPreviousYearPaper.validate(), /paperClassification/);
});

test('ordinary notes and worksheet categories validate without paperClassification while the enum rejects blank strings', async () => {
  for (const [index, category] of ['chapter-notes', 'revision-notes', 'formula-sheets', 'practice-worksheets'].entries()) {
    const material = new StudyMaterial({
      exam: examId,
      subject: subjectId,
      title: `Ordinary material ${index + 1}`,
      slug: `ordinary-material-${index + 1}`,
      description: 'An ordinary notes resource without a paper classification.',
      resourceType: 'notes',
      category,
      publicationStatus: 'draft',
    });
    await material.validate();
    assert.equal(material.paperClassification, null);

    material.paperClassification = '';
    await assert.rejects(material.validate(), /paperClassification/);
  }
});

test('study material metadata validates categories, integer paise, preview excerpt, and upload size', async () => {
  const material = new StudyMaterial({
    exam: examId,
    subject: subjectId,
    title: 'Cellular biology chapter notes',
    slug: 'cellular-biology-chapter-notes',
    description: 'A short material card description for configured notes.',
    detailedDescription: 'A longer admin-authored description for the material detail page.',
    category: 'chapter-notes',
    difficultyLevel: 'intermediate',
    language: 'English',
    resourceType: 'notes',
    pricePaise: 12500,
    discountPaise: 2500,
    fileSizeBytes: 1024,
    preview: { title: 'Sample excerpt', excerpt: 'Only this administrator-authored text is shown publicly.' },
  });
  await material.validate();
  assert.equal(material.currentPricePaise, 10000);
  assert.equal(material.fileSizeBytes, 1024);

  material.category = 'unverified-syllabus';
  await assert.rejects(material.validate(), /category/i);
  material.category = 'chapter-notes';
  material.fileSizeBytes = 52428801;
  await assert.rejects(material.validate(), /fileSizeBytes/i);
});

test('StudyMaterial text search uses an isolated language override and language metadata stays ordinary', async () => {
  const textIndex = StudyMaterial.schema.indexes().find(([keys]) => Object.values(keys).includes('text'));
  assert.ok(textIndex, 'the existing full-text search index remains configured');
  assert.equal(textIndex[1].language_override, 'textIndexLanguage');
  assert.equal(textIndex[1].default_language, 'none');
  assert.equal(StudyMaterial.schema.path('textIndexLanguage'), undefined, 'documents do not set a per-document text language');

  for (const language of ['', 'English', 'Hindi']) {
    const material = new StudyMaterial({
      exam: examId,
      subject: subjectId,
      title: `Language metadata ${language || 'unset'}`,
      slug: `language-metadata-${language.toLowerCase() || 'unset'}`,
      description: 'A study material for checking optional language metadata.',
      resourceType: 'notes',
      language,
      publicationStatus: 'draft',
    });
    await material.validate();
    assert.equal(material.language, language);
    assert.equal(material.toObject().language, language);
  }
});

test('free library entitlements do not masquerade as paid orders', async () => {
  const freeAccess = new PurchasedAccess({ student: productId, product: topicId, source: 'free', status: 'active', grantedAt: new Date() });
  await freeAccess.validate();
  assert.equal(freeAccess.order, null);

  const invalidFreeAccess = new PurchasedAccess({ student: productId, product: topicId, source: 'free', order: chapterId, status: 'active' });
  await assert.rejects(invalidFreeAccess.validate(), /cannot reference a payment order/i);
  const invalidPurchase = new PurchasedAccess({ student: productId, product: topicId, source: 'purchase', status: 'active' });
  await assert.rejects(invalidPurchase.validate(), /must reference its verified order/i);
});

test('published exam configurations need no source metadata and question answers must index an option', async () => {
  const publishedExam = new Exam({ name: 'B.Sc. Nursing Entrance Examination', slug: 'bsc-nursing-entrance-examination', publicationStatus: 'published' });
  await publishedExam.validate();
  assert.equal(publishedExam.publicationStatus, 'published');
  assert.equal(Exam.schema.path('officialSources').options.select, false, 'legacy source metadata remains hidden and unvalidated');
  const primaryIndex = Exam.schema.indexes().find(([fields, options]) => fields.isPrimary === 1 && options.unique);
  assert.ok(primaryIndex, 'primary exam must be protected by a unique partial index');

  const invalidChapter = new Chapter({ exam: examId, subject: subjectId, name: 'Cells', slug: 'bad slug' });
  await assert.rejects(invalidChapter.validate(), /slug/i);

  const invalidQuestionBank = new QuestionBank({
    exam: examId,
    subject: subjectId,
    title: 'Biology practice questions',
    questions: [{ prompt: 'Question?', options: ['A', 'B'], correctAnswerIndex: 2 }],
  });
  await assert.rejects(invalidQuestionBank.validate(), /answer index/i);
});

test('multi-subject draft course products may remain unpriced, while publication requires a price', async () => {
  const draft = new StudyMaterial({
    exam: examId,
    title: 'B.Sc. Nursing Entrance Preparation',
    slug: 'bsc-nursing-entrance-preparation',
    description: 'A structured course covering Physics, Chemistry and Biology.',
    resourceType: 'video-course',
    subject: null,
    pricePaise: null,
    publicationStatus: 'draft',
  });
  await draft.validate();
  assert.equal(draft.currentPricePaise, null);
  assert.equal(draft.isFree, undefined);

  draft.publicationStatus = 'published';
  await assert.rejects(draft.validate(), /pricePaise|listed price/i);
  const regularResource = new StudyMaterial({
    exam: examId,
    title: 'Unmapped notes',
    slug: 'unmapped-notes',
    description: 'A draft resource without a subject mapping.',
    resourceType: 'notes',
    pricePaise: null,
    publicationStatus: 'draft',
  });
  await assert.rejects(regularResource.validate(), /subject/i);
});

test('course metadata supports category and target audience without inventing duration or lessons', async () => {
  const course = new Course({
    product: productId,
    exam: examId,
    subjects: [subjectId],
    courseType: 'video-course',
    category: 'Government Competitive Exam Preparation',
    targetAudience: 'Students preparing for B.Sc. Nursing entrance examinations.',
    durationMinutes: null,
    lessonCount: null,
    modules: [],
    publicationStatus: 'draft',
  });
  await course.validate();
  assert.equal(course.category, 'Government Competitive Exam Preparation');
  assert.equal(course.durationMinutes, null);
  assert.equal(course.lessonCount, null);
  assert.deepEqual(course.modules, []);
});

test('course lessons and mock-test marking metadata validate without accepting private video URLs', async () => {
  const course = new Course({
    product: productId,
    exam: examId,
    courseType: 'video-course',
    modules: [{ title: 'Biology', lessons: [{ title: 'Cell structure', videoProvider: 'private-hosted', videoAssetId: 'asset-reference-001', durationMinutes: 20 }] }],
  });
  await course.validate();
  const unsafeVideo = new Course({ product: productId, exam: examId, courseType: 'video-course', modules: [{ title: 'Module', lessons: [{ title: 'Lesson', videoProvider: 'private-hosted', videoAssetId: 'https://private.example/video' }] }] });
  await assert.rejects(unsafeVideo.validate(), /videoAssetId/i);

  const mockTest = new MockTest({ product: productId, exam: examId, title: 'Biology mock test', marksPerQuestion: 2, negativeMarkingEnabled: true, negativeMarksPerQuestion: 0.5 });
  await mockTest.validate();
  const invalidMock = new MockTest({ product: productId, exam: examId, title: 'Invalid mock test', marksPerQuestion: 2, negativeMarkingEnabled: true, negativeMarksPerQuestion: 0 });
  await assert.rejects(invalidMock.validate(), /positive penalty/i);
});

test('paid order records require verification timestamps before they can count as revenue', async () => {
  const order = new Order({
    student: '507f1f77bcf86cd799439015',
    items: [{ product: productId, titleSnapshot: 'Biology notes', unitPricePaise: 10000, quantity: 1 }],
    amountPaise: 10000,
    status: 'paid',
    paymentVerifiedAt: new Date('2026-10-01T00:00:00Z'),
  });
  await order.validate();
  const unverifiedPaidOrder = new Order({
    student: '507f1f77bcf86cd799439015',
    items: [{ product: productId, titleSnapshot: 'Biology notes', unitPricePaise: 10000, quantity: 1 }],
    amountPaise: 10000,
    status: 'paid',
  });
  await assert.rejects(unverifiedPaidOrder.validate(), /verified payment timestamp/i);
});

test('catalogue query validation rejects invalid pagination and unsupported resource types', async () => {
  const invalidPage = await request('/api/products?page=0');
  assert.equal(invalidPage.response.status, 400);
  const invalidType = await request('/api/products?resourceType=semester-notes');
  assert.equal(invalidType.response.status, 400);
  const invalidCategory = await request('/api/products?category=unverified-syllabus');
  assert.equal(invalidCategory.response.status, 400);
});
