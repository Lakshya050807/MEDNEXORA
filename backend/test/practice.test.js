import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'practice-test-session-secret-with-at-least-32-bytes';
process.env.APP_ORIGIN = 'http://localhost:5173';

const [{ createApp }, session, { default: TestAttempt }, { default: QuestionBank }, { default: MockTest }] = await Promise.all([
  import('../src/app.js'),
  import('express-session'),
  import('../src/models/TestAttempt.js'),
  import('../src/models/QuestionBank.js'),
  import('../src/models/MockTest.js'),
]);

const examId = '507f1f77bcf86cd799439101';
const subjectId = '507f1f77bcf86cd799439102';
const topicId = '507f1f77bcf86cd799439103';
const chapterId = '507f1f77bcf86cd799439108';
const bankId = '507f1f77bcf86cd799439104';
const mockTestId = '507f1f77bcf86cd799439105';
const freeProductId = '507f1f77bcf86cd799439106';
const paidProductId = '507f1f77bcf86cd799439107';
const questionIds = ['507f1f77bcf86cd799439111', '507f1f77bcf86cd799439112', '507f1f77bcf86cd799439113'];

class FakeQuery {
  constructor(value) { this.value = value; this.offset = 0; this.max = Infinity; }
  select() { return this; }
  populate() { return this; }
  sort() { return this; }
  skip(value) { this.offset = value; return this; }
  limit(value) { this.max = value; return this; }
  async lean() {
    const rows = Array.isArray(this.value) ? this.value.slice(this.offset, this.offset + this.max) : this.value;
    return rows;
  }
  then(resolve, reject) { return Promise.resolve(this.value).then(resolve, reject); }
}

const demoQuestions = [
  { _id: questionIds[0], prompt: 'Example question one?', options: ['Option A', 'Option B', 'Option C', 'Option D'], correctAnswerIndex: 1, explanation: 'Example explanation one.', topic: topicId, image: { url: 'https://images.example.test/questions/cell.png', mimeType: 'image/png', altText: 'Example cell diagram' } },
  { _id: questionIds[1], prompt: 'Example question two?', options: ['Option A', 'Option B', 'Option C'], correctAnswerIndex: 0, explanation: 'Example explanation two.', topic: topicId },
  { _id: questionIds[2], prompt: 'Example question three?', options: ['Option A', 'Option B'], correctAnswerIndex: 1, explanation: 'Example explanation three.', topic: topicId },
];
const bank = { _id: bankId, title: 'Original demonstration practice set', exam: examId, subject: subjectId, publicationStatus: 'published', questions: demoQuestions };
const products = [
  { _id: freeProductId, title: 'Free mock test', publicationStatus: 'published', currentPricePaise: 0 },
  { _id: paidProductId, title: 'Paid mock test', publicationStatus: 'published', currentPricePaise: 15000 },
];
const mockTests = [
  { _id: mockTestId, product: freeProductId, exam: examId, title: 'Configured example mock test', description: 'A configurable example test description.', instructions: 'Read each question carefully.', questionBanks: [bankId], durationMinutes: 10, questionCount: 3, marksPerQuestion: 2, totalMarks: 6, negativeMarkingEnabled: true, negativeMarksPerQuestion: 0.5, allowAnswerReview: true, revealExplanations: true, publicationStatus: 'published' },
  { _id: paidProductId, product: paidProductId, exam: examId, title: 'Paid example mock test', questionBanks: [bankId], durationMinutes: 5, questionCount: 3, marksPerQuestion: 1, totalMarks: 3, negativeMarkingEnabled: false, negativeMarksPerQuestion: 0, allowAnswerReview: false, revealExplanations: false, publicationStatus: 'published' },
];

let usersByEmail;
let usersById;
let attempts;
let accesses;
let nextUserId;
let server;
let baseUrl;

class FakeUserModel {
  static async exists({ email }) { return usersByEmail.has(email) ? { _id: usersByEmail.get(email)._id } : null; }
  static findOne({ email }) { return { select: async () => usersByEmail.get(email) ?? null }; }
  static async create(data) {
    if (usersByEmail.has(data.email)) { const error = new Error('Duplicate email'); error.code = 11000; throw error; }
    const id = `507f1f77bcf86cd79943${String(nextUserId++).padStart(4, '0')}`;
    const user = { ...data, _id: id, id, role: 'student' };
    usersByEmail.set(user.email, user);
    usersById.set(id, user);
    return user;
  }
  static async findById(id) { return usersById.get(String(id)) ?? null; }
}

class FakeQuestionBankModel {
  static findOne(filter) { return new FakeQuery(String(filter._id) === bankId && filter.publicationStatus === 'published' ? bank : null); }
  static find(filter = {}) {
    const rows = [bank].filter((item) => (!filter.publicationStatus || item.publicationStatus === filter.publicationStatus)
      && (!filter.exam || String(item.exam) === String(filter.exam))
      && (!filter.subject || String(item.subject) === String(filter.subject))
      && (!filter['questions.topic'] || item.questions.some((question) => String(question.topic) === String(filter['questions.topic']))));
    return new FakeQuery(rows);
  }
  static async countDocuments(filter = {}) { return (await this.find(filter).lean()).length; }
}

class FakeMockTestModel {
  static findOne(filter) { return new FakeQuery(mockTests.find((item) => String(item._id) === String(filter._id) && item.publicationStatus === filter.publicationStatus) ?? null); }
  static find(filter = {}) { return new FakeQuery(mockTests.filter((item) => !filter.publicationStatus || item.publicationStatus === filter.publicationStatus)); }
}

class FakeProductModel {
  static findById(id) { return new FakeQuery(products.find((item) => String(item._id) === String(id)) ?? null); }
}

class FakeTopicModel {
  static findOne(filter) { return new FakeQuery(String(filter._id) === topicId && filter.publicationStatus === 'published' ? { _id: topicId, exam: examId, subject: subjectId, publicationStatus: 'published' } : null); }
  static find(filter = {}) {
    const ids = filter._id?.$in?.map(String) ?? [];
    const rows = ids.includes(topicId) ? [{ _id: topicId, exam: examId, subject: subjectId, chapter: chapterId, name: 'Cell structure', publicationStatus: 'published' }] : [];
    return new FakeQuery(rows);
  }
}

class FakeSubjectModel {
  static find(filter = {}) {
    const ids = filter._id?.$in?.map(String) ?? [];
    return new FakeQuery(ids.includes(subjectId) ? [{ _id: subjectId, name: 'Biology' }] : []);
  }
}

class FakeChapterModel {
  static find(filter = {}) {
    const ids = filter._id?.$in?.map(String) ?? [];
    return new FakeQuery(ids.includes(chapterId) ? [{ _id: chapterId, name: 'Cell biology' }] : []);
  }
}

class FakePurchasedAccessModel {
  static async exists(filter) { return accesses.some((entry) => String(entry.student) === String(filter.student) && String(entry.product) === String(filter.product) && entry.status === 'active') ? { _id: 'active-access' } : null; }
}

function matches(attempt, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && Array.isArray(value.$in)) return value.$in.some((item) => String(attempt[key] ?? '') === String(item));
    if (value && typeof value === 'object' && value.$gt) return new Date(attempt[key]).getTime() > new Date(value.$gt).getTime();
      if (value && typeof value === 'object' && Object.hasOwn(value, '$ne')) return String(attempt[key] ?? '') !== String(value.$ne);
    return String(attempt[key] ?? '') === String(value);
  });
}

function applyUpdates(document, update) {
  for (const [path, value] of Object.entries(update.$set ?? {})) {
    const parts = path.split('.');
    let target = document;
    for (const part of parts.slice(0, -1)) target = target[part];
    target[parts.at(-1)] = value;
  }
  return document;
}

class FakeTestAttemptModel {
  static async create(data) {
    const attempt = { ...structuredClone(data), _id: `507f1f77bcf86cd79943${String(attempts.size + 100).padStart(4, '0')}`, createdAt: new Date(), updatedAt: new Date() };
    attempts.set(String(attempt._id), attempt);
    return attempt;
  }
  static findOne(filter) { return new FakeQuery([...attempts.values()].find((attempt) => matches(attempt, filter)) ?? null); }
  static find(filter) { return new FakeQuery([...attempts.values()].filter((attempt) => matches(attempt, filter))); }
  static async findOneAndUpdate(filter, update) {
    const attempt = [...attempts.values()].find((item) => matches(item, filter));
    return attempt ? applyUpdates(attempt, update) : null;
  }
  static async countDocuments(filter) { return [...attempts.values()].filter((attempt) => matches(attempt, filter)).length; }
}

beforeEach(async () => {
  usersByEmail = new Map();
  usersById = new Map();
  attempts = new Map();
  accesses = [];
  bank.questions = structuredClone(demoQuestions);
  nextUserId = 1;
  const app = createApp({
    sessionStore: new session.MemoryStore(),
    UserModel: FakeUserModel,
    QuestionBankModel: FakeQuestionBankModel,
    MockTestModel: FakeMockTestModel,
    ProductModel: FakeProductModel,
    PurchasedAccessModel: FakePurchasedAccessModel,
    TestAttemptModel: FakeTestAttemptModel,
    TopicModel: FakeTopicModel,
    SubjectModel: FakeSubjectModel,
    ChapterModel: FakeChapterModel,
  });
  server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null };
}

async function register(name, email) {
  const result = await request('/api/auth/register', { method: 'POST', body: { name, email, password: 'safe-practice-password-42' } });
  assert.equal(result.response.status, 201);
  return result.cookie;
}

test('practice routes require an authenticated student and expose published bank metadata only', async () => {
  const anonymous = await request('/api/student/practice/question-banks');
  assert.equal(anonymous.response.status, 401);
  const cookie = await register('Practice Student', 'practice@example.com');
  const result = await request(`/api/student/practice/question-banks?examId=${examId}&subjectId=${subjectId}&topicId=${topicId}`, { cookie });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.items[0].questionCount, 3);
  assert.equal(JSON.stringify(result.payload).includes('correctAnswerIndex'), false);
  assert.equal(JSON.stringify(result.payload).includes('Example explanation'), false);
  const listedTests = await request('/api/student/practice/mock-tests', { cookie });
  const listedMock = listedTests.payload.items.find((item) => item.id === mockTestId);
  assert.equal(listedMock.description, 'A configurable example test description.');
  assert.equal(listedMock.instructions, 'Read each question carefully.');
  assert.equal(JSON.stringify(listedTests.payload).includes('correctAnswerIndex'), false);
});

test('mock answers stay private until submission; score, negative marks, changes, review marks and history persist', async () => {
  const cookie = await register('Result Student', 'result@example.com');
  const started = await request('/api/student/practice/attempts', { method: 'POST', cookie, body: { mode: 'mock', mockTestId } });
  assert.equal(started.response.status, 201);
  const attemptId = started.payload.attempt.id;
  assert.equal(started.payload.attempt.status, 'in-progress');
  assert.equal(started.payload.attempt.description, 'A configurable example test description.');
  assert.equal(started.payload.attempt.instructions, 'Read each question carefully.');
  assert.equal(JSON.stringify(started.payload).includes('correctAnswerIndex'), false);
  assert.equal(JSON.stringify(started.payload).includes('Example explanation'), false);
  const initialDeadline = started.payload.attempt.expiresAt;
  const assignedQuestions = structuredClone(started.payload.attempt.questions);
  assert.deepEqual(assignedQuestions.map((question) => question.order), [0, 1, 2]);
  const imageQuestion = assignedQuestions.find((question) => question.id === questionIds[0]);
  assert.deepEqual(imageQuestion.image, { url: 'https://images.example.test/questions/cell.png', mimeType: 'image/png', altText: 'Example cell diagram' });
  assert.equal(imageQuestion.subjectId, subjectId);
  assert.equal(imageQuestion.subjectName, 'Biology');
  assert.equal(imageQuestion.topicId, topicId);
  assert.equal(imageQuestion.topicName, 'Cell structure');
  assert.equal(imageQuestion.chapterId, chapterId);
  assert.equal(imageQuestion.chapterName, 'Cell biology');
  assert.deepEqual(imageQuestion.options, demoQuestions[0].options);
  const resumed = await request('/api/student/practice/attempts', { method: 'POST', cookie, body: { mode: 'mock', mockTestId } });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.resumed, true);
  assert.equal(resumed.payload.attempt.id, attemptId);
  assert.equal(resumed.payload.attempt.expiresAt, initialDeadline);
  assert.deepEqual(resumed.payload.attempt.questions, assignedQuestions);

  const q1 = questionIds[0];
  const q2 = questionIds[1];
  const q3 = questionIds[2];
  await request(`/api/student/practice/attempts/${attemptId}/questions/${q1}`, { method: 'PATCH', cookie, body: { selectedOptionIndex: 0, markedForReview: true } });
  await request(`/api/student/practice/attempts/${attemptId}/questions/${q1}`, { method: 'PATCH', cookie, body: { selectedOptionIndex: 1 } });
  await request(`/api/student/practice/attempts/${attemptId}/questions/${q2}`, { method: 'PATCH', cookie, body: { selectedOptionIndex: 2 } });
  const bankBeforeEdit = structuredClone(bank.questions);
  bank.questions[0].prompt = 'Edited question bank prompt after attempt start.';
  bank.questions[0].options = ['Edited option', 'Another edited option'];
  bank.questions[0].image.url = 'https://images.example.test/questions/edited.webp';
  const stableSnapshot = await request(`/api/student/practice/attempts/${attemptId}`, { cookie });
  assert.deepEqual(stableSnapshot.payload.attempt.questions.map(({ id, order, prompt, options, image, subjectId: savedSubject, subjectName, chapterId: savedChapter, chapterName }) => ({ id, order, prompt, options, image, subjectId: savedSubject, subjectName, chapterId: savedChapter, chapterName })), assignedQuestions.map(({ id, order, prompt, options, image, subjectId: savedSubject, subjectName, chapterId: savedChapter, chapterName }) => ({ id, order, prompt, options, image, subjectId: savedSubject, subjectName, chapterId: savedChapter, chapterName })));
  bank.questions = bankBeforeEdit;
  const submitted = await request(`/api/student/practice/attempts/${attemptId}/submit`, { method: 'POST', cookie, body: {} });
  assert.equal(submitted.response.status, 200);
  const { timeSpentSeconds, ...scoreBreakdown } = submitted.payload.attempt.result;
  assert.deepEqual(scoreBreakdown, { score: 1.5, maximumMarks: 6, correctAnswers: 1, incorrectAnswers: 1, unansweredQuestions: 1, accuracyPercent: 50 });
  assert.ok(Number.isSafeInteger(timeSpentSeconds));
  assert.ok(Number.isSafeInteger(submitted.payload.attempt.timeSpentSeconds));
  assert.equal(submitted.payload.attempt.timeSpentSeconds, timeSpentSeconds);
  const reviewedQ1 = submitted.payload.attempt.questions.find((item) => item.id === q1);
  assert.equal(reviewedQ1.markedForReview, true);
  assert.equal(reviewedQ1.review.correctAnswerIndex, 1);
  assert.equal(reviewedQ1.review.explanation, 'Example explanation one.');
  assert.equal(submitted.payload.attempt.questions.find((item) => item.id === q3).selectedOptionIndex, null);

  const repeated = await request(`/api/student/practice/attempts/${attemptId}/submit`, { method: 'POST', cookie, body: {} });
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.payload.idempotent, true);
  assert.deepEqual(repeated.payload.attempt.result, submitted.payload.attempt.result);
  const afterSubmission = await request(`/api/student/practice/attempts/${attemptId}/questions/${q1}`, { method: 'PATCH', cookie, body: { selectedOptionIndex: null } });
  assert.equal(afterSubmission.response.status, 409);
  const history = await request('/api/student/practice/attempts', { cookie });
  assert.equal(history.payload.items.length, 1);
  assert.deepEqual(history.payload.items[0].result, submitted.payload.attempt.result);
  const persisted = await request(`/api/student/practice/attempts/${attemptId}`, { cookie });
  assert.equal(persisted.payload.attempt.status, 'submitted');
});

test('simultaneous submissions finalize one attempt once and return the same persisted result', async () => {
  const cookie = await register('Concurrent Student', 'concurrent@example.com');
  const started = await request('/api/student/practice/attempts', { method: 'POST', cookie, body: { mode: 'mock', mockTestId } });
  const attemptId = started.payload.attempt.id;
  const [first, second] = await Promise.all([
    request(`/api/student/practice/attempts/${attemptId}/submit`, { method: 'POST', cookie, body: {} }),
    request(`/api/student/practice/attempts/${attemptId}/submit`, { method: 'POST', cookie, body: {} }),
  ]);

  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(first.payload.attempt.status, 'submitted');
  assert.equal(second.payload.attempt.status, 'submitted');
  assert.deepEqual(first.payload.attempt.result, second.payload.attempt.result);
  assert.equal(attempts.size, 1);
  assert.equal(attempts.get(attemptId).submissionLocked, false);
});

test('a refreshed attempt restores saved answers, assigned order, and its original server deadline', async () => {
  const cookie = await register('Resume Student', 'resume@example.com');
  const started = await request('/api/student/practice/attempts', { method: 'POST', cookie, body: { mode: 'mock', mockTestId } });
  const attemptId = started.payload.attempt.id;
  const deadline = started.payload.attempt.expiresAt;
  const assignedOrder = started.payload.attempt.questions.map(({ id, order, options }) => ({ id, order, options }));
  const firstQuestion = started.payload.attempt.questions[0];
  const questionId = firstQuestion.id;
  const selectedOptionIndex = firstQuestion.options.length - 1;
  const saved = await request(`/api/student/practice/attempts/${attemptId}/questions/${questionId}`, { method: 'PATCH', cookie, body: { selectedOptionIndex, markedForReview: true } });
  assert.equal(saved.response.status, 200);

  const refreshed = await request(`/api/student/practice/attempts/${attemptId}`, { cookie });
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.payload.attempt.expiresAt, deadline);
  assert.deepEqual(refreshed.payload.attempt.questions.map(({ id, order, options }) => ({ id, order, options })), assignedOrder);
  const restoredAnswer = refreshed.payload.attempt.questions.find((question) => question.id === questionId);
  assert.equal(restoredAnswer.selectedOptionIndex, selectedOptionIndex);
  assert.equal(restoredAnswer.markedForReview, true);

  const resumed = await request('/api/student/practice/attempts', { method: 'POST', cookie, body: { mode: 'mock', mockTestId } });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.resumed, true);
  assert.equal(resumed.payload.attempt.expiresAt, deadline);
  assert.equal(attempts.size, 1);
});

test('practice mode reveals an explanation immediately after an answer is saved', async () => {
  const cookie = await register('Practice Student', 'practice-mode@example.com');
  const started = await request('/api/student/practice/attempts', { method: 'POST', cookie, body: { mode: 'practice', questionBankId: bankId, topicId } });
  assert.equal(started.response.status, 201);
  assert.equal(started.payload.attempt.questions[0].review, undefined);
  const questionId = started.payload.attempt.questions[0].id;
  const answered = await request(`/api/student/practice/attempts/${started.payload.attempt.id}/questions/${questionId}`, { method: 'PATCH', cookie, body: { selectedOptionIndex: 1 } });
  assert.equal(answered.response.status, 200);
  assert.equal(answered.payload.attempt.questions[0].review.isCorrect, true);
  assert.equal(answered.payload.attempt.questions[0].review.explanation, 'Example explanation one.');
});

test('timer expiry automatically persists a timed-out result', async () => {
  const cookie = await register('Timer Student', 'timer@example.com');
  const started = await request('/api/student/practice/attempts', { method: 'POST', cookie, body: { mode: 'mock', mockTestId } });
  const attemptId = started.payload.attempt.id;
  attempts.get(attemptId).expiresAt = new Date(Date.now() - 1000);
  const lateAnswer = await request(`/api/student/practice/attempts/${attemptId}/questions/${questionIds[0]}`, { method: 'PATCH', cookie, body: { selectedOptionIndex: 1 } });
  assert.equal(lateAnswer.response.status, 409);
  const expired = await request(`/api/student/practice/attempts/${attemptId}`, { cookie });
  assert.equal(expired.response.status, 200);
  assert.equal(expired.payload.attempt.status, 'timed-out');
  assert.equal(expired.payload.attempt.result.unansweredQuestions, 3);
  assert.ok(expired.payload.attempt.submittedAt);
  assert.ok(Number.isSafeInteger(expired.payload.attempt.result.timeSpentSeconds));
  assert.ok(expired.payload.attempt.result.timeSpentSeconds <= 10 * 60);
});

test('paid mock tests reject students without active purchased access', async () => {
  const cookie = await register('Paid Test Student', 'paid-test@example.com');
  const lockedList = await request('/api/student/practice/mock-tests', { cookie });
  assert.equal(lockedList.payload.items.find((item) => item.id === paidProductId).locked, true);
  const denied = await request('/api/student/practice/attempts', { method: 'POST', cookie, body: { mode: 'mock', mockTestId: paidProductId } });
  assert.equal(denied.response.status, 403);
  accesses.push({ student: usersByEmail.get('paid-test@example.com')._id, product: paidProductId, status: 'active' });
  const allowed = await request('/api/student/practice/attempts', { method: 'POST', cookie, body: { mode: 'mock', mockTestId: paidProductId } });
  assert.equal(allowed.response.status, 201);
  const submitted = await request(`/api/student/practice/attempts/${allowed.payload.attempt.id}/submit`, { method: 'POST', cookie, body: {} });
  assert.equal(submitted.response.status, 200);
  assert.equal(submitted.payload.attempt.questions[0].review, undefined);
});

test('students cannot read or modify another student’s attempt; invalid answers are rejected', async () => {
  const firstCookie = await register('Owner Student', 'owner@example.com');
  const started = await request('/api/student/practice/attempts', { method: 'POST', cookie: firstCookie, body: { mode: 'mock', mockTestId } });
  const attemptId = started.payload.attempt.id;
  const otherCookie = await register('Other Student', 'other@example.com');
  const read = await request(`/api/student/practice/attempts/${attemptId}`, { cookie: otherCookie });
  assert.equal(read.response.status, 404);
  const modify = await request(`/api/student/practice/attempts/${attemptId}/questions/${questionIds[0]}`, { method: 'PATCH', cookie: otherCookie, body: { selectedOptionIndex: 1 } });
  assert.equal(modify.response.status, 404);
  const invalidOption = await request(`/api/student/practice/attempts/${attemptId}/questions/${questionIds[0]}`, { method: 'PATCH', cookie: firstCookie, body: { selectedOptionIndex: 9 } });
  assert.equal(invalidOption.response.status, 400);
  const unassignedQuestion = await request(`/api/student/practice/attempts/${attemptId}/questions/507f1f77bcf86cd799439114`, { method: 'PATCH', cookie: firstCookie, body: { selectedOptionIndex: 0 } });
  assert.equal(unassignedQuestion.response.status, 400);
});

test('attempt schema hides answer keys by default and validates required snapshots', async () => {
  const attempt = new TestAttempt({
    student: '507f1f77bcf86cd799439121',
    mode: 'practice',
    titleSnapshot: 'Original demonstration set',
    questions: [{ questionId: questionIds[0], order: 0, prompt: 'Example?', options: ['A', 'B'], topic: topicId, topicName: 'Cell structure', subjectId, subjectName: 'Biology', chapterId, chapterName: 'Cell biology', image: { url: 'https://images.example.test/diagram.png', mimeType: 'image/png', altText: 'Example diagram' } }],
    answers: [{ questionId: questionIds[0], selectedOptionIndex: null }],
    answerKey: [{ questionId: questionIds[0], correctAnswerIndex: 1, explanation: 'Example explanation.' }],
    startedAt: new Date(),
    marksPerQuestion: 1,
    maximumMarks: 1,
  });
  await attempt.validate();
  assert.equal(TestAttempt.schema.path('answerKey').options.select, false);
  assert.equal(attempt.toJSON().answerKey, undefined);
  assert.equal(attempt.toJSON().questions[0].subjectName, 'Biology');
  assert.equal(attempt.toJSON().questions[0].chapterName, 'Cell biology');
  assert.equal(attempt.toJSON().questions[0].image.mimeType, 'image/png');
});

test('published practice content requires questions and a timed, consistently scored mock-test configuration', async () => {
  const emptyBank = new QuestionBank({ exam: examId, subject: subjectId, title: 'Empty bank', publicationStatus: 'published' });
  await assert.rejects(emptyBank.validate(), /at least one question/i);
  const publishedBank = new QuestionBank({ exam: examId, subject: subjectId, title: 'Original example questions', questions: [{ prompt: 'Example?', options: ['A', 'B'], correctAnswerIndex: 0 }], publicationStatus: 'published' });
  await publishedBank.validate();
  const configuredTest = new MockTest({ product: freeProductId, exam: examId, title: 'Timed example test', questionBanks: [bankId], durationMinutes: 5, questionCount: 1, marksPerQuestion: 2, totalMarks: 2, publicationStatus: 'published' });
  await configuredTest.validate();
  const describedTest = new MockTest({ product: freeProductId, exam: examId, title: 'Configured description test', description: 'Configured test details.', instructions: 'Answer carefully.', questionBanks: [bankId], durationMinutes: 5, questionCount: 1, publicationStatus: 'draft' });
  await describedTest.validate();
  assert.equal(describedTest.description, 'Configured test details.');
  assert.equal(describedTest.instructions, 'Answer carefully.');
  const untimedTest = new MockTest({ product: freeProductId, exam: examId, title: 'Untimed test', questionBanks: [bankId], questionCount: 1, publicationStatus: 'published' });
  await assert.rejects(untimedTest.validate(), /requires a duration/i);
  const inconsistentScore = new MockTest({ product: freeProductId, exam: examId, title: 'Incorrect maximum', questionBanks: [bankId], durationMinutes: 5, questionCount: 2, marksPerQuestion: 2, totalMarks: 3, publicationStatus: 'published' });
  await assert.rejects(inconsistentScore.validate(), /possible score/i);

  const validImageBank = new QuestionBank({ exam: examId, subject: subjectId, title: 'Image question bank', questions: [{ prompt: 'What is shown?', options: ['A', 'B'], correctAnswerIndex: 0, image: { url: 'https://images.example.test/diagram.webp', mimeType: 'image/webp', altText: 'Example diagram' } }] });
  await validImageBank.validate();
  const unsupportedImageBank = new QuestionBank({ exam: examId, subject: subjectId, title: 'Unsupported image bank', questions: [{ prompt: 'What is shown?', options: ['A', 'B'], correctAnswerIndex: 0, image: { url: 'https://images.example.test/diagram.svg', mimeType: 'image/svg+xml', altText: 'Unsupported vector image' } }] });
  await assert.rejects(unsupportedImageBank.validate(), /allowed image format|enum/i);
  const mismatchedImageBank = new QuestionBank({ exam: examId, subject: subjectId, title: 'Mismatched image bank', questions: [{ prompt: 'What is shown?', options: ['A', 'B'], correctAnswerIndex: 0, image: { url: 'https://images.example.test/diagram.png', mimeType: 'image/webp' } }] });
  await assert.rejects(mismatchedImageBank.validate(), /extension must match/i);
  const unsafeImageBank = new QuestionBank({ exam: examId, subject: subjectId, title: 'Unsafe image bank', questions: [{ prompt: 'What is shown?', options: ['A', 'B'], correctAnswerIndex: 0, image: { url: 'javascript:alert(1)', mimeType: 'image/png' } }] });
  await assert.rejects(unsafeImageBank.validate(), /safe HTTPS URL/i);
});
