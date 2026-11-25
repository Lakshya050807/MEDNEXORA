import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAuditTarget, buildCatalogueAuditManifest } from '../scripts/audit-production-catalogue.js';

test('production Railway audit accepts APP_ENV staging with Razorpay test mode', () => {
  const auditUri = 'mongodb+srv://read-only.example.invalid/mednexora';
  assert.equal(assertAuditTarget({
    nodeEnv: 'production',
    appEnv: 'staging',
    razorpayMode: 'test',
    railwayEnvironmentName: 'production',
    railwayServiceName: 'MEDNEXORA',
    auditMongoUri: auditUri,
  }), auditUri);
});

test('production audit rejects non-production NODE_ENV', () => {
  assert.throws(() => assertAuditTarget({
    nodeEnv: 'development', railwayEnvironmentName: 'production', railwayServiceName: 'MEDNEXORA', auditMongoUri: 'mongodb://audit/db',
  }), /NODE_ENV=production/u);
});

test('production audit rejects missing or incorrect Railway environment identity', () => {
  for (const railwayEnvironmentName of [undefined, '', 'staging', 'Production']) {
    assert.throws(() => assertAuditTarget({
      nodeEnv: 'production', railwayEnvironmentName, railwayServiceName: 'MEDNEXORA', auditMongoUri: 'mongodb://audit/db',
    }), /RAILWAY_ENVIRONMENT_NAME=production/u);
  }
});

test('production audit rejects missing or incorrect Railway service identity', () => {
  for (const railwayServiceName of [undefined, '', 'mednexora', 'another-service']) {
    assert.throws(() => assertAuditTarget({
      nodeEnv: 'production', railwayEnvironmentName: 'production', railwayServiceName, auditMongoUri: 'mongodb://audit/db',
    }), /RAILWAY_SERVICE_NAME=MEDNEXORA/u);
  }
});

test('production audit requires its dedicated URI and never falls back to MONGODB_URI', () => {
  assert.throws(() => assertAuditTarget({
    nodeEnv: 'production',
    railwayEnvironmentName: 'production',
    railwayServiceName: 'MEDNEXORA',
    mongoUri: 'mongodb+srv://application.example.invalid/mednexora',
  }), /CATALOGUE_AUDIT_MONGODB_URI/u);
  assert.throws(() => assertAuditTarget({
    nodeEnv: 'production', railwayEnvironmentName: 'production', railwayServiceName: 'MEDNEXORA', auditMongoUri: 'https://not-mongodb.invalid',
  }), /CATALOGUE_AUDIT_MONGODB_URI/u);
});

const fixture = () => ({
  exams: [{ _id: 'exam-kept', name: 'Exam', slug: 'exam', publicationStatus: 'draft' }, { _id: 'exam-free', name: 'Unused exam', slug: 'unused', publicationStatus: 'draft' }],
  subjects: [{ _id: 'subject-kept', exam: 'exam-kept', name: 'Physics', slug: 'physics', publicationStatus: 'draft' }],
  chapters: [{ _id: 'chapter-kept', exam: 'exam-kept', subject: 'subject-kept', name: 'Chapter', slug: 'chapter', publicationStatus: 'draft' }],
  topics: [{ _id: 'topic-kept', exam: 'exam-kept', subject: 'subject-kept', chapter: 'chapter-kept', name: 'Topic', slug: 'topic', publicationStatus: 'draft' }],
  products: [
    { _id: 'product-bundle', exam: 'exam-kept', title: 'Bundle', slug: 'bundle', resourceType: 'bundle', publicationStatus: 'published', bundleItems: ['product-child'] },
    { _id: 'product-child', exam: 'exam-kept', subject: 'subject-kept', chapter: 'chapter-kept', topic: 'topic-kept', title: 'PDF', slug: 'pdf', resourceType: 'notes', publicationStatus: 'published' },
    { _id: 'product-free', exam: 'exam-free', title: 'Unreferenced', slug: 'free', resourceType: 'notes', publicationStatus: 'draft' },
    { _id: 'product-orphan', exam: 'missing-exam', title: 'Orphan', slug: 'orphan', resourceType: 'notes', publicationStatus: 'draft', contentUrl: '/private/secret.pdf' },
  ],
  courses: [{
    _id: 'course-kept', product: 'product-child', exam: 'exam-kept', subjects: ['subject-kept'], courseType: 'video-course', publicationStatus: 'draft',
    modules: [{ subject: 'subject-kept', chapter: 'chapter-kept', lessons: [{ _id: 'lesson-kept', topic: 'topic-kept' }] }],
  }],
  questionBanks: [{ _id: 'bank-kept', exam: 'exam-kept', subject: 'subject-kept', product: 'product-child', title: 'Bank', publicationStatus: 'draft', questions: [{ topic: 'topic-kept' }] }],
  mockTests: [{ _id: 'test-kept', product: 'product-child', exam: 'exam-kept', questionBanks: ['bank-kept'], title: 'Test', publicationStatus: 'draft' }],
  orders: [{ _id: 'order-1', status: 'pending', items: [{ product: 'product-bundle' }], reservationProductIds: ['product-child'], entitledProductIds: ['product-child'] }],
  purchasedAccesses: [{ _id: 'access-1', product: 'product-child', order: 'order-1', source: 'purchase', status: 'active' }],
  courseProgress: [{ _id: 'progress-1', course: 'course-kept', completedLessonIds: ['lesson-kept'], lastLessonId: 'lesson-stale' }],
  testAttempts: [{
    _id: 'attempt-1', mockTest: 'test-kept', questionBank: 'bank-kept',
    questions: [{ bankId: 'bank-kept', topic: 'topic-kept', subjectId: 'subject-kept', chapterId: 'chapter-kept' }],
  }],
});

test('audit manifest preserves the full product/course/curriculum dependency closure', () => {
  const report = buildCatalogueAuditManifest(fixture(), '2026-11-09T00:00:00.000Z');
  const byId = new Map(report.deletionManifest.map((record) => [record.id, record]));

  for (const id of ['product-bundle', 'product-child', 'course-kept', 'exam-kept', 'subject-kept', 'chapter-kept', 'topic-kept', 'bank-kept', 'test-kept']) {
    assert.equal(byId.get(id)?.assessment, 'preserve', `${id} should be preserved through protected references`);
  }
  assert.deepEqual(byId.get('product-bundle').directProtectedReferences.orders, ['order-1']);
  assert.ok(byId.get('product-child').protectedBy.includes('orders'));
  assert.ok(byId.get('course-kept').protectedBy.includes('courseProgress'));
  assert.ok(byId.get('bank-kept').protectedBy.includes('testAttempts'));
  assert.ok(byId.get('bank-kept').protectedBy.includes('orders'), 'a protected product keeps catalogue records linked back to it');
  assert.ok(byId.get('test-kept').protectedBy.includes('orders'), 'a protected product keeps linked mock tests');
  assert.equal(byId.get('product-free').assessment, 'candidate_after_dependency_cleanup');
  assert.equal(report.educationalCollectionCounts.studymaterials, 4);
  assert.ok(report.orphanedReferences.some((item) => item.sourceId === 'product-orphan' && item.targetId === 'missing-exam'));
  assert.ok(report.orphanedReferences.some((item) => item.sourceId === 'progress-1' && item.targetId === 'lesson-stale'));
});

test('audit manifest reports missing protected references and duplicate relationships', () => {
  const data = fixture();
  data.orders.push({ _id: 'order-orphan', items: [{ product: 'missing-product' }] });
  data.purchasedAccesses.push({ _id: 'access-orphan', product: 'missing-product', order: 'missing-order' });
  data.courses[0].subjects.push('subject-kept');
  data.mockTests[0].questionBanks.push('bank-kept');
  data.products[1].bundleItems = ['product-bundle', 'product-bundle'];
  const report = buildCatalogueAuditManifest(data);

  assert.ok(report.orphanedReferences.some((item) => item.sourceId === 'order-orphan' && item.targetCollection === 'studymaterials'));
  assert.ok(report.orphanedReferences.some((item) => item.sourceId === 'access-orphan' && item.targetCollection === 'orders'));
  assert.ok(report.duplicateFindings.some((item) => item.collection === 'courses' && item.field === 'subjects'));
  assert.ok(report.duplicateFindings.some((item) => item.collection === 'mocktests' && item.field === 'questionBanks'));
  assert.ok(report.duplicateFindings.some((item) => item.collection === 'studymaterials' && item.field === 'bundleItems'));
});

test('audit output whitelists fields and never exposes private file paths or question content', () => {
  const data = fixture();
  data.products[3].contentUrl = '/private/private-file.pdf';
  data.questionBanks[0].questions[0] = { topic: 'topic-kept', prompt: 'not for the manifest', correctAnswerIndex: 1 };
  const serialized = JSON.stringify(buildCatalogueAuditManifest(data));

  assert.equal(serialized.includes('private-file.pdf'), false);
  assert.equal(serialized.includes('not for the manifest'), false);
  assert.equal(serialized.includes('correctAnswerIndex'), false);
});
