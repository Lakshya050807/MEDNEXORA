import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'course-test-session-secret-with-at-least-32-bytes';
process.env.APP_ORIGIN = 'http://localhost:5173';

const [{ createApp }, session, { default: CourseProgress }, { default: Course }] = await Promise.all([
  import('../src/app.js'),
  import('express-session'),
  import('../src/models/CourseProgress.js'),
  import('../src/models/Course.js'),
]);

const examId = '507f1f77bcf86cd799439201';
const subjectId = '507f1f77bcf86cd799439202';
const paidCourseId = '507f1f77bcf86cd799439203';
const paidProductId = '507f1f77bcf86cd799439204';
const freeCourseId = '507f1f77bcf86cd799439205';
const freeProductId = '507f1f77bcf86cd799439206';
const draftCourseId = '507f1f77bcf86cd799439207';
const draftProductId = '507f1f77bcf86cd799439208';
const lessonOneId = '507f1f77bcf86cd799439211';
const lessonTwoId = '507f1f77bcf86cd799439212';
const freeLessonId = '507f1f77bcf86cd799439213';

class FakeQuery {
  constructor(value) { this.value = value; this.offset = 0; this.max = Infinity; }
  select() { return this; }
  populate() { return this; }
  sort(specification = {}) {
    const [field, direction] = Object.entries(specification)[0] ?? [];
    if (field === 'currentPricePaise' && Array.isArray(this.value)) {
      this.value = [...this.value].sort((left, right) => (Number(left[field]) - Number(right[field])) * direction);
    }
    return this;
  }
  skip(value) { this.offset = value; return this; }
  limit(value) { this.max = value; return this; }
  async lean() { return Array.isArray(this.value) ? this.value.slice(this.offset, this.offset + this.max) : this.value; }
  then(resolve, reject) { return Promise.resolve(this.value).then(resolve, reject); }
}

const exam = { _id: examId, name: 'B.Sc. Nursing Entrance Examination', region: '', publicationStatus: 'published' };
const subject = { _id: subjectId, name: 'Biology', exam: examId, publicationStatus: 'published' };
const products = [
  { _id: paidProductId, title: 'Biology recorded course', slug: 'biology-course', description: 'A configured entrance preparation course.', resourceType: 'video-course', publicationStatus: 'published', pricePaise: 120000, discountPaise: 20000, currentPricePaise: 100000, thumbnailUrl: '', contentUrl: 'private://paid.pdf' },
  { _id: freeProductId, title: 'Free chemistry crash course', slug: 'free-chemistry', description: 'A free configured crash course.', resourceType: 'crash-course', publicationStatus: 'published', pricePaise: 0, discountPaise: 0, currentPricePaise: 0, thumbnailUrl: '' },
  { _id: draftProductId, title: 'B.Sc. Nursing Entrance Preparation', slug: 'bsc-nursing-entrance-preparation', description: 'A structured learning programme covering Physics, Chemistry and Biology to help students prepare for B.Sc. Nursing entrance examinations.', resourceType: 'video-course', publicationStatus: 'draft', pricePaise: null, contentUrl: 'private://draft-content-must-not-leak.pdf' },
];
const courses = [
  {
    _id: paidCourseId, product: products[0], exam, subjects: [subject, { _id: '507f1f77bcf86cd799439242', name: 'Unpublished subject', exam: examId, publicationStatus: 'draft' }], courseType: 'video-course', category: 'Government Competitive Exam Preparation', targetAudience: 'Configured test audience.', durationMinutes: 90, lessonCount: 2,
    outline: ['Original configured course outline'], publicationStatus: 'published', createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-02T00:00:00Z'),
    modules: [{ _id: '507f1f77bcf86cd799439221', title: 'Biology foundations', subject, chapter: { _id: '507f1f77bcf86cd799439231', name: 'Published foundations', slug: 'published-foundations', exam: examId, subject, publicationStatus: 'published' }, sortOrder: 0, lessons: [
      { _id: lessonOneId, title: 'Free example preview', description: 'Sample lesson.', durationMinutes: 10, videoProvider: 'youtube', videoAssetId: 'dQw4w9WgXcQ', isPreview: true, sortOrder: 0, topic: { _id: '507f1f77bcf86cd799439251', name: 'Published topic', slug: 'published-topic', exam: examId, subject: subjectId, chapter: '507f1f77bcf86cd799439231', publicationStatus: 'published' } },
      { _id: lessonTwoId, title: 'Paid lesson', description: '', durationMinutes: 20, videoProvider: 'youtube', videoAssetId: 'jNQXAC9IVRw', isPreview: false, sortOrder: 1 },
      { _id: '507f1f77bcf86cd799439252', title: 'Draft lesson', publicationStatus: 'draft', sortOrder: 2 },
      { _id: '507f1f77bcf86cd799439253', title: 'Lesson under unpublished topic', publicationStatus: 'published', sortOrder: 3, topic: { _id: '507f1f77bcf86cd799439254', name: 'Private topic', slug: 'private-topic', exam: examId, subject: subjectId, chapter: '507f1f77bcf86cd799439231', publicationStatus: 'draft' } },
    ] },
    { _id: '507f1f77bcf86cd799439232', title: 'Draft chapter module', subject, chapter: { _id: '507f1f77bcf86cd799439233', name: 'Draft chapter', publicationStatus: 'draft' }, sortOrder: 1, lessons: [{ _id: '507f1f77bcf86cd799439234', title: 'Hidden draft lesson', sortOrder: 0 }] },
    { _id: '507f1f77bcf86cd799439255', title: 'Unpublished subject module', subject: { _id: '507f1f77bcf86cd799439242', name: 'Unpublished subject', exam: examId, publicationStatus: 'draft' }, chapter: { _id: '507f1f77bcf86cd799439256', name: 'Private chapter', exam: examId, subject: { _id: '507f1f77bcf86cd799439242', name: 'Unpublished subject', exam: examId, publicationStatus: 'draft' }, publicationStatus: 'published' }, lessons: [{ _id: '507f1f77bcf86cd799439257', title: 'Hidden unpublished subject lesson' }] }],
  },
  {
    _id: freeCourseId, product: products[1], exam, subjects: [subject], courseType: 'crash-course', durationMinutes: 30, lessonCount: 1,
    outline: [], publicationStatus: 'published', createdAt: new Date('2026-10-03T00:00:00Z'), updatedAt: new Date('2026-10-03T00:00:00Z'),
    modules: [{ _id: '507f1f77bcf86cd799439222', title: 'Chemistry sample module', subject, sortOrder: 0, lessons: [
      { _id: freeLessonId, title: 'Free lesson', description: '', durationMinutes: 30, videoProvider: 'vimeo', videoAssetId: '76979871', isPreview: false, sortOrder: 0 },
    ] }],
  },
  {
    _id: draftCourseId, product: products[2], exam, subjects: [
      { _id: '507f1f77bcf86cd799439241', name: 'Physics', slug: 'physics', publicationStatus: 'draft' },
      { _id: '507f1f77bcf86cd799439242', name: 'Chemistry', slug: 'chemistry', publicationStatus: 'draft' },
      { _id: '507f1f77bcf86cd799439243', name: 'Biology', slug: 'biology', publicationStatus: 'draft' },
    ], courseType: 'video-course', category: 'Government Competitive Exam Preparation', targetAudience: 'Private draft audience', durationMinutes: 999, outline: ['Private draft outline'], publicationStatus: 'draft',
    modules: [{ _id: '507f1f77bcf86cd799439244', title: 'Private draft module', lessons: [{ _id: '507f1f77bcf86cd799439245', title: 'Unpublished lesson', videoAssetId: 'private-video-id' }] }],
  },
];

let usersByEmail;
let usersById;
let accesses;
let savedProgress;
let nextUserId;
let server;
let baseUrl;

class FakeUserModel {
  static async exists({ email }) { return usersByEmail.has(email) ? { _id: usersByEmail.get(email)._id } : null; }
  static findOne({ email }) { return new FakeQuery(usersByEmail.get(email) ?? null); }
  static async create(data) {
    const id = `507f1f77bcf86cd79943${String(nextUserId++).padStart(4, '0')}`;
    const user = { ...data, _id: id, id, role: 'student' };
    usersByEmail.set(user.email, user);
    usersById.set(id, user);
    return user;
  }
  static async findById(id) { return usersById.get(String(id)) ?? null; }
}

class FakeExamModel {
  static find(filter = {}) { return new FakeQuery([exam].filter((item) => (!filter.publicationStatus || item.publicationStatus === filter.publicationStatus) && (!filter.region || item.region === filter.region))); }
}

class FakeProductModel {
  static findOne(filter = {}) {
    return new FakeQuery(products.find((item) => Object.entries(filter).every(([key, value]) => String(item[key]) === String(value))) ?? null);
  }
  static find(filter = {}) {
    const rows = products.filter((item) => (!filter.publicationStatus || item.publicationStatus === filter.publicationStatus)
      && (!filter.resourceType || filter.resourceType.$in?.includes(item.resourceType))
      && (!Object.hasOwn(filter, 'currentPricePaise') || item.currentPricePaise === filter.currentPricePaise)
      && (!filter._id || filter._id.$in?.some((id) => String(id) === String(item._id))));
    return new FakeQuery(rows);
  }
}

function matchCourse(course, filter = {}) {
  return (!filter.publicationStatus || course.publicationStatus === filter.publicationStatus)
    && (!filter.exam || filter.exam.$in?.some((id) => String(id) === String(course.exam._id)) || String(filter.exam) === String(course.exam._id))
    && (!filter.courseType || course.courseType === filter.courseType)
    && (!filter.product || (filter.product.$in
      ? filter.product.$in.some((id) => String(id) === String(course.product._id))
      : String(filter.product) === String(course.product._id)))
    && (!filter.category || course.category === filter.category)
    && (!filter._id || String(filter._id) === String(course._id));
}

class FakeCourseModel {
  static find(filter = {}) { return new FakeQuery(courses.filter((course) => matchCourse(course, filter))); }
  static findOne(filter = {}) { return new FakeQuery(courses.find((course) => matchCourse(course, filter)) ?? null); }
  static async countDocuments(filter = {}) { return courses.filter((course) => matchCourse(course, filter)).length; }
  static async distinct(field, filter = {}) { return [...new Set(courses.filter((course) => matchCourse(course, filter)).map((course) => field === 'product' ? course.product._id : course[field]))]; }
}

class FakePurchasedAccessModel {
  static find(filter = {}) { return new FakeQuery(accesses.filter((entry) => String(entry.student) === String(filter.student) && entry.status === filter.status)); }
  static async exists(filter = {}) {
    return accesses.some((entry) => String(entry.student) === String(filter.student) && String(entry.product) === String(filter.product) && entry.status === filter.status) ? { _id: 'active-entitlement' } : null;
  }
}

class FakeCourseProgressModel {
  static find(filter = {}) { return new FakeQuery(savedProgress.filter((entry) => String(entry.student) === String(filter.student))); }
  static findOne(filter = {}) { return new FakeQuery(savedProgress.find((entry) => String(entry.student) === String(filter.student) && String(entry.course) === String(filter.course)) ?? null); }
  static async findOneAndUpdate(filter, update) {
    let row = savedProgress.find((entry) => String(entry.student) === String(filter.student) && String(entry.course) === String(filter.course));
    if (!row) {
      row = { student: filter.student, course: filter.course, completedLessonIds: [], createdAt: new Date() };
      savedProgress.push(row);
    }
    Object.assign(row, update.$set);
    for (const lessonId of Object.values(update.$addToSet ?? {})) {
      if (!row.completedLessonIds.some((value) => String(value) === String(lessonId))) row.completedLessonIds.push(lessonId);
    }
    row.updatedAt = new Date();
    return row;
  }
}

beforeEach(async () => {
  usersByEmail = new Map();
  usersById = new Map();
  accesses = [];
  savedProgress = [];
  nextUserId = 1;
  const app = createApp({
    sessionStore: new session.MemoryStore(),
    UserModel: FakeUserModel,
    ExamModel: FakeExamModel,
    ProductModel: FakeProductModel,
    CourseModel: FakeCourseModel,
    CourseProgressModel: FakeCourseProgressModel,
    PurchasedAccessModel: FakePurchasedAccessModel,
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

async function register(email) {
  const result = await request('/api/auth/register', { method: 'POST', body: { name: 'Course Student', email, password: 'safe-course-password-42' } });
  assert.equal(result.response.status, 201);
  return result.cookie;
}

test('public courses list and detail return published course data without private video references', async () => {
  const listing = await request('/api/courses?limit=10');
  assert.equal(listing.response.status, 200);
  assert.equal(listing.payload.items.length, 2);
  assert.equal(listing.payload.items[0].product.title, 'Biology recorded course');
  const detail = await request(`/api/courses/${paidCourseId}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.payload.course.modules[0].lessons[0].isPreview, true);
  assert.equal(detail.payload.course.modules.length, 1, 'modules under unpublished chapters are not exposed');
  assert.equal(detail.payload.course.modules[0].chapter.name, 'Published foundations');
  assert.deepEqual(detail.payload.course.modules[0].lessons[0].topic, { id: '507f1f77bcf86cd799439251', name: 'Published topic', slug: 'published-topic' });
  assert.equal(detail.payload.course.category, 'Government Competitive Exam Preparation');
  assert.equal(detail.payload.course.targetAudience, 'Configured test audience.');
  assert.equal(detail.payload.course.lessonCount, 2);
  assert.deepEqual(detail.payload.course.subjects.map((item) => item.name), ['Biology']);
  for (const hiddenLabel of ['Draft lesson', 'Lesson under unpublished topic', 'Unpublished subject', 'Private chapter', 'Hidden unpublished subject lesson']) {
    assert.equal(JSON.stringify(detail.payload).includes(hiddenLabel), false, `${hiddenLabel} must be filtered from student course data`);
  }
  const serialized = JSON.stringify(detail.payload);
  assert.equal(serialized.includes('dQw4w9WgXcQ'), false);
  assert.equal(serialized.includes('private://paid.pdf'), false);
  assert.equal(serialized.includes('videoAssetId'), false);
  const priceAscending = await request('/api/courses?sort=price-asc&limit=1');
  assert.equal(priceAscending.payload.items[0].id, freeCourseId);
  assert.equal(priceAscending.payload.pagination.total, 2);
  const priceDescending = await request('/api/courses?sort=price-desc&limit=1');
  assert.equal(priceDescending.payload.items[0].id, paidCourseId);
});

test('lesson topic mapping is optional and embedded lesson IDs remain enabled for legacy course data', async () => {
  const lessonSchema = Course.schema.path('modules').schema.path('lessons').schema;
  assert.equal(lessonSchema.path('topic').options.ref, 'Topic');
  assert.equal(lessonSchema.options._id, true);
  assert.equal(lessonSchema.path('publicationStatus').defaultValue, undefined);
  const legacyCourse = new Course({ product: paidProductId, exam: examId, courseType: 'video-course', modules: [{ title: 'Existing module', lessons: [{ title: 'Existing lesson without topic' }] }] });
  await legacyCourse.validate();
  const legacyLesson = legacyCourse.modules[0].lessons[0];
  assert.ok(legacyLesson._id);
  assert.equal(legacyLesson.topic, undefined);
});

test('legacy lessons without topics remain visible while unpublished mapped lessons cannot be opened', async () => {
  const detail = await request(`/api/courses/${paidCourseId}`);
  assert.equal(detail.response.status, 200);
  assert.deepEqual(detail.payload.course.modules[0].lessons.map((lesson) => lesson.id), [lessonOneId, lessonTwoId]);
  const hiddenDraftLesson = await request(`/api/courses/${paidCourseId}/lessons/507f1f77bcf86cd799439252/preview`);
  assert.equal(hiddenDraftLesson.response.status, 404);
  const hiddenTopicLesson = await request(`/api/student/courses/${paidCourseId}/lessons/507f1f77bcf86cd799439253/complete`, { method: 'POST', body: {} });
  assert.equal(hiddenTopicLesson.response.status, 401);
  const cookie = await register('hidden-curriculum@example.com');
  const hiddenLessonForStudent = await request(`/api/student/courses/${paidCourseId}/lessons/507f1f77bcf86cd799439253/complete`, { method: 'POST', cookie, body: {} });
  assert.equal(hiddenLessonForStudent.response.status, 404);
  const studentId = usersByEmail.get('hidden-curriculum@example.com')._id;
  accesses.push({ student: studentId, product: paidProductId, status: 'active' });
  const savedHiddenProgress = { student: studentId, course: paidCourseId, completedLessonIds: ['507f1f77bcf86cd799439252'], lastLessonId: '507f1f77bcf86cd799439253' };
  savedProgress.push(savedHiddenProgress);
  const progress = await request(`/api/student/courses/${paidCourseId}/progress`, { cookie });
  assert.equal(progress.response.status, 200);
  assert.deepEqual(progress.payload.progress.completedLessonIds, []);
  assert.equal(progress.payload.progress.lastLessonId, null);
  const myCourses = await request('/api/student/courses', { cookie });
  assert.equal(myCourses.payload.items.find((item) => item.id === paidCourseId).continueLessonId, null);
  assert.equal(savedProgress[0].lastLessonId, '507f1f77bcf86cd799439253', 'stored progress stays intact while hidden content is filtered from responses');
});

test('draft flagship preview returns only approved overview fields and no unpublished course content', async () => {
  const result = await request('/api/courses/flagship-preview');
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(result.payload.preview, {
    title: 'B.Sc. Nursing Entrance Preparation',
    description: 'A structured learning programme covering Physics, Chemistry and Biology to help students prepare for B.Sc. Nursing entrance examinations.',
    category: 'Government Competitive Exam Preparation',
    subjects: ['Physics', 'Chemistry', 'Biology'],
    status: 'draft',
  });
  const serialized = JSON.stringify(result.payload);
  for (const privateValue of ['private draft audience', 'Private draft outline', 'Private draft module', 'Unpublished lesson', 'private-video-id', 'private://draft-content-must-not-leak.pdf', 'pricePaise', 'durationMinutes']) {
    assert.equal(serialized.includes(privateValue), false, `${privateValue} must not be exposed in a draft overview`);
  }
});

test('draft flagship preview is unavailable after publication or when its three approved subjects do not match', async () => {
  const originalProductStatus = products[2].publicationStatus;
  products[2].publicationStatus = 'published';
  const publishedProductResponse = await request('/api/courses/flagship-preview');
  products[2].publicationStatus = originalProductStatus;
  assert.equal(publishedProductResponse.response.status, 404);

  const originalSubjects = courses[2].subjects;
  courses[2].subjects = originalSubjects.slice(0, 2);
  const invalidSubjectsResponse = await request('/api/courses/flagship-preview');
  courses[2].subjects = originalSubjects;
  assert.equal(invalidSubjectsResponse.response.status, 404);
});

test('only configured free previews play publicly; full paid playback requires student auth and purchase', async () => {
  const anonymousPlayback = await request(`/api/student/courses/${paidCourseId}/lessons/${lessonTwoId}/playback`);
  assert.equal(anonymousPlayback.response.status, 401);
  const preview = await request(`/api/courses/${paidCourseId}/lessons/${lessonOneId}/preview`);
  assert.equal(preview.response.status, 200);
  assert.equal(preview.payload.available, true);
  assert.equal(preview.payload.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  const deniedPreview = await request(`/api/courses/${paidCourseId}/lessons/${lessonTwoId}/preview`);
  assert.equal(deniedPreview.response.status, 403);

  const cookie = await register('course-access@example.com');
  const denied = await request(`/api/student/courses/${paidCourseId}/lessons/${lessonTwoId}/playback`, { cookie });
  assert.equal(denied.response.status, 403);
  const studentId = usersByEmail.get('course-access@example.com')._id;
  accesses.push({ student: studentId, product: paidProductId, status: 'active' });
  const authorized = await request(`/api/student/courses/${paidCourseId}/lessons/${lessonTwoId}/playback`, { cookie });
  assert.equal(authorized.response.status, 200);
  assert.equal(authorized.payload.available, false);
  assert.match(authorized.payload.message, /signed video provider/u);
  assert.equal(JSON.stringify(authorized.payload).includes('jNQXAC9IVRw'), false);
});

test('purchased and free course progress persists, is idempotent, and belongs to the student', async () => {
  const firstCookie = await register('course-progress@example.com');
  const studentId = usersByEmail.get('course-progress@example.com')._id;
  accesses.push({ student: studentId, product: paidProductId, status: 'active' });

  const before = await request(`/api/student/courses/${paidCourseId}/progress`, { cookie: firstCookie });
  assert.equal(before.response.status, 200);
  assert.equal(before.payload.progress.percent, 0);
  const marked = await request(`/api/student/courses/${paidCourseId}/lessons/${lessonOneId}/complete`, { method: 'POST', cookie: firstCookie, body: {} });
  assert.equal(marked.response.status, 200);
  assert.equal(marked.payload.progress.percent, 50);
  const repeated = await request(`/api/student/courses/${paidCourseId}/lessons/${lessonOneId}/complete`, { method: 'POST', cookie: firstCookie, body: {} });
  assert.equal(repeated.payload.progress.completedCount, 1);
  courses[0].modules[0].lessons[0].sortOrder = 1;
  courses[0].modules[0].lessons[1].sortOrder = 0;
  const persisted = await request(`/api/student/courses/${paidCourseId}/progress`, { cookie: firstCookie });
  assert.equal(persisted.payload.progress.completedLessonIds[0], lessonOneId);
  assert.equal(persisted.payload.progress.percent, 50);

  const otherCookie = await register('another-course-student@example.com');
  const otherStudentProgress = await request(`/api/student/courses/${paidCourseId}/progress`, { cookie: otherCookie });
  assert.equal(otherStudentProgress.response.status, 403);
  const otherStudentId = usersByEmail.get('another-course-student@example.com')._id;
  accesses.push({ student: otherStudentId, product: paidProductId, status: 'active' });
  const ownedProgress = await request(`/api/student/courses/${paidCourseId}/progress`, { cookie: otherCookie });
  assert.equal(ownedProgress.response.status, 200);
  assert.equal(ownedProgress.payload.progress.percent, 0);
  const invalidLesson = await request(`/api/student/courses/${paidCourseId}/lessons/${freeLessonId}/complete`, { method: 'POST', cookie: firstCookie, body: {} });
  assert.equal(invalidLesson.response.status, 404);

  const myCourses = await request('/api/student/courses', { cookie: firstCookie });
  assert.equal(myCourses.response.status, 200);
  assert.equal(myCourses.payload.items.length, 2);
  assert.equal(myCourses.payload.items.find((item) => item.id === paidCourseId).progress.percent, 50);
});

test('free course video plays only with a valid configured provider ID and public completion saves progress', async () => {
  const cookie = await register('free-course@example.com');
  const playback = await request(`/api/student/courses/${freeCourseId}/lessons/${freeLessonId}/playback`, { cookie });
  assert.equal(playback.response.status, 200);
  assert.equal(playback.payload.available, true);
  assert.equal(playback.payload.embedUrl, 'https://player.vimeo.com/video/76979871');
  const saved = await request(`/api/student/courses/${freeCourseId}/lessons/${freeLessonId}/complete`, { method: 'POST', cookie, body: {} });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.payload.progress.percent, 100);
  const savedSchema = CourseProgress.schema;
  assert.ok(savedSchema.indexes().some(([keys, options]) => keys.student === 1 && keys.course === 1 && options.unique === true));
});
