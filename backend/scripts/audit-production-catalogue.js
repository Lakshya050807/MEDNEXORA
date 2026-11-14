import mongoose from 'mongoose';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Exam from '../src/models/Exam.js';
import Subject from '../src/models/Subject.js';
import Chapter from '../src/models/Chapter.js';
import Topic from '../src/models/Topic.js';
import StudyMaterial from '../src/models/StudyMaterial.js';
import Course from '../src/models/Course.js';
import QuestionBank from '../src/models/QuestionBank.js';
import MockTest from '../src/models/MockTest.js';
import Order from '../src/models/Order.js';
import PurchasedAccess from '../src/models/PurchasedAccess.js';
import CourseProgress from '../src/models/CourseProgress.js';
import TestAttempt from '../src/models/TestAttempt.js';
import PaymentRefund from '../src/models/PaymentRefund.js';

const educationalSpecs = [
  { key: 'exams', Model: Exam, projection: '_id name slug publicationStatus' },
  { key: 'subjects', Model: Subject, projection: '_id exam name slug publicationStatus' },
  { key: 'chapters', Model: Chapter, projection: '_id exam subject name slug publicationStatus' },
  { key: 'topics', Model: Topic, projection: '_id exam subject chapter name slug publicationStatus' },
  {
    key: 'products', Model: StudyMaterial,
    projection: '_id exam subject chapter topic topics course bundleItems title slug resourceType publicationStatus',
  },
  {
    key: 'courses', Model: Course,
    projection: '_id product exam subjects courseType publicationStatus modules._id modules.subject modules.chapter modules.lessons._id modules.lessons.topic',
  },
  {
    key: 'questionBanks', Model: QuestionBank,
    projection: '_id exam subject product title publicationStatus questions.topic',
  },
  {
    key: 'mockTests', Model: MockTest,
    projection: '_id product exam questionBanks title publicationStatus',
  },
];

const protectedSpecs = [
  { key: 'orders', Model: Order, projection: '_id status items.product reservationProductIds entitledProductIds' },
  { key: 'purchasedAccesses', Model: PurchasedAccess, projection: '_id product order source status' },
  { key: 'courseProgress', Model: CourseProgress, projection: '_id course completedLessonIds lastLessonId' },
  {
    key: 'testAttempts', Model: TestAttempt,
    projection: '_id mode mockTest questionBank questions.bankId questions.topic questions.subjectId questions.chapterId',
  },
  { key: 'paymentRefunds', Model: PaymentRefund, projection: '_id order status reconciliationStatus' },
];

const allSpecs = [...educationalSpecs, ...protectedSpecs];
for (const spec of allSpecs) spec.collection = spec.Model.collection.collectionName;
const typeToCollection = new Map(allSpecs.map(({ key, collection }) => [key, collection]));
const collectionFor = (key) => typeToCollection.get(key) ?? key;
const safeFields = {
  exams: ['name', 'slug', 'publicationStatus'],
  subjects: ['name', 'slug', 'publicationStatus'],
  chapters: ['name', 'slug', 'publicationStatus'],
  topics: ['name', 'slug', 'publicationStatus'],
  products: ['title', 'slug', 'resourceType', 'publicationStatus'],
  courses: ['courseType', 'publicationStatus'],
  questionBanks: ['title', 'publicationStatus'],
  mockTests: ['title', 'publicationStatus'],
};

function idOf(value) {
  const id = value?._id ?? value?.id ?? value;
  return id === undefined || id === null || id === '' ? '' : String(id);
}

function idsOf(values) {
  return (Array.isArray(values) ? values : []).map(idOf).filter(Boolean);
}

function mapById(rows) {
  return new Map(rows.map((row) => [idOf(row), row]));
}

function addSetValue(map, key, value) {
  if (!key || !value) return;
  const values = map.get(key) ?? new Set();
  values.add(value);
  map.set(key, values);
}

function safeRecord(kind, row) {
  const record = { id: idOf(row) };
  for (const field of safeFields[kind] ?? []) {
    if (row[field] !== undefined) record[field] = row[field];
  }
  return record;
}

function duplicateScopedKeys(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const values = groups.get(key) ?? [];
    values.push(idOf(row));
    groups.set(key, values);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, recordIds: ids }));
}

/**
 * Build a deletion-review manifest from already-read documents. This function
 * is intentionally pure so its dependency and orphan handling can be tested
 * without connecting to any database.
 */
export function buildCatalogueAuditManifest(snapshot, generatedAt = new Date().toISOString()) {
  const data = Object.fromEntries(allSpecs.map(({ key }) => [key, snapshot?.[key] ?? []]));
  const entities = Object.fromEntries(educationalSpecs.map(({ key }) => [key, mapById(data[key])]));
  const protectedRows = Object.fromEntries(protectedSpecs.map(({ key }) => [key, data[key]]));
  const educationalEdges = [];
  const protectedEdges = [];
  const orphanReferences = [];
  const consistencyFindings = [];
  const duplicateFindings = [];

  const addEducationalEdge = (sourceType, sourceId, field, targetType, targetValue) => {
    const targetId = idOf(targetValue);
    if (!targetId) return;
    educationalEdges.push({ sourceType, sourceId, field, targetType, targetId });
  };
  const addProtectedEdge = (sourceType, sourceId, field, targetType, targetValue) => {
    const targetId = idOf(targetValue);
    if (!targetId) return;
    protectedEdges.push({ sourceType, sourceId, field, targetType, targetId });
  };

  for (const row of data.subjects) addEducationalEdge('subjects', idOf(row), 'exam', 'exams', row.exam);
  for (const row of data.chapters) {
    addEducationalEdge('chapters', idOf(row), 'exam', 'exams', row.exam);
    addEducationalEdge('chapters', idOf(row), 'subject', 'subjects', row.subject);
  }
  for (const row of data.topics) {
    addEducationalEdge('topics', idOf(row), 'exam', 'exams', row.exam);
    addEducationalEdge('topics', idOf(row), 'subject', 'subjects', row.subject);
    addEducationalEdge('topics', idOf(row), 'chapter', 'chapters', row.chapter);
  }
  for (const row of data.products) {
    const sourceId = idOf(row);
    for (const field of ['exam', 'subject', 'chapter', 'topic', 'course']) {
      const targetType = field === 'exam' ? 'exams'
        : field === 'subject' ? 'subjects'
          : field === 'chapter' ? 'chapters'
            : field === 'topic' ? 'topics' : 'courses';
      addEducationalEdge('products', sourceId, field, targetType, row[field]);
    }
    idsOf(row.topics).forEach((targetId) => addEducationalEdge('products', sourceId, 'topics[]', 'topics', targetId));
    idsOf(row.bundleItems).forEach((targetId) => addEducationalEdge('products', sourceId, 'bundleItems[]', 'products', targetId));
  }
  for (const row of data.courses) {
    const sourceId = idOf(row);
    addEducationalEdge('courses', sourceId, 'product', 'products', row.product);
    addEducationalEdge('courses', sourceId, 'exam', 'exams', row.exam);
    idsOf(row.subjects).forEach((targetId) => addEducationalEdge('courses', sourceId, 'subjects[]', 'subjects', targetId));
    for (const [moduleIndex, module] of (row.modules ?? []).entries()) {
      const modulePath = `modules[${moduleIndex}]`;
      addEducationalEdge('courses', sourceId, `${modulePath}.subject`, 'subjects', module.subject);
      addEducationalEdge('courses', sourceId, `${modulePath}.chapter`, 'chapters', module.chapter);
      for (const [lessonIndex, lesson] of (module.lessons ?? []).entries()) {
        addEducationalEdge('courses', sourceId, `${modulePath}.lessons[${lessonIndex}].topic`, 'topics', lesson.topic);
      }
    }
  }
  for (const row of data.questionBanks) {
    const sourceId = idOf(row);
    addEducationalEdge('questionBanks', sourceId, 'exam', 'exams', row.exam);
    addEducationalEdge('questionBanks', sourceId, 'subject', 'subjects', row.subject);
    addEducationalEdge('questionBanks', sourceId, 'product', 'products', row.product);
    for (const [questionIndex, question] of (row.questions ?? []).entries()) {
      addEducationalEdge('questionBanks', sourceId, `questions[${questionIndex}].topic`, 'topics', question.topic);
    }
  }
  for (const row of data.mockTests) {
    const sourceId = idOf(row);
    addEducationalEdge('mockTests', sourceId, 'product', 'products', row.product);
    addEducationalEdge('mockTests', sourceId, 'exam', 'exams', row.exam);
    idsOf(row.questionBanks).forEach((targetId) => addEducationalEdge('mockTests', sourceId, 'questionBanks[]', 'questionBanks', targetId));
  }

  const requireReference = (collection, row, field, targetCollection, value) => {
    if (!idOf(value)) orphanReferences.push({
      sourceCollection: collectionFor(collection),
      sourceId: idOf(row),
      field,
      targetCollection: collectionFor(targetCollection),
      targetId: null,
      issue: 'required_reference_missing',
    });
  };
  for (const row of data.subjects) requireReference('subjects', row, 'exam', 'exams', row.exam);
  for (const row of data.chapters) {
    requireReference('chapters', row, 'exam', 'exams', row.exam);
    requireReference('chapters', row, 'subject', 'subjects', row.subject);
  }
  for (const row of data.topics) {
    requireReference('topics', row, 'exam', 'exams', row.exam);
    requireReference('topics', row, 'subject', 'subjects', row.subject);
  }
  for (const row of data.products) requireReference('products', row, 'exam', 'exams', row.exam);
  for (const row of data.courses) {
    requireReference('courses', row, 'product', 'products', row.product);
    requireReference('courses', row, 'exam', 'exams', row.exam);
  }
  for (const row of data.questionBanks) {
    requireReference('questionBanks', row, 'exam', 'exams', row.exam);
    requireReference('questionBanks', row, 'subject', 'subjects', row.subject);
  }
  for (const row of data.mockTests) {
    requireReference('mockTests', row, 'product', 'products', row.product);
    requireReference('mockTests', row, 'exam', 'exams', row.exam);
  }
  for (const row of protectedRows.purchasedAccesses) {
    requireReference('purchasedAccesses', row, 'product', 'products', row.product);
    if (row.source === 'purchase') requireReference('purchasedAccesses', row, 'order', 'orders', row.order);
  }
  for (const row of protectedRows.courseProgress) requireReference('courseProgress', row, 'course', 'courses', row.course);
  for (const row of protectedRows.testAttempts) {
    if (row.mode === 'mock') requireReference('testAttempts', row, 'mockTest', 'mockTests', row.mockTest);
    if (row.mode === 'practice') requireReference('testAttempts', row, 'questionBank', 'questionBanks', row.questionBank);
  }
  for (const row of protectedRows.orders) {
    for (const [index, item] of (row.items ?? []).entries()) {
      requireReference('orders', row, `items[${index}].product`, 'products', item.product);
    }
  }
  for (const row of protectedRows.paymentRefunds) requireReference('paymentRefunds', row, 'order', 'orders', row.order);

  for (const row of protectedRows.orders) {
    const sourceId = idOf(row);
    for (const [index, item] of (row.items ?? []).entries()) {
      addProtectedEdge('orders', sourceId, `items[${index}].product`, 'products', item.product);
    }
    idsOf(row.reservationProductIds).forEach((targetId) => addProtectedEdge('orders', sourceId, 'reservationProductIds[]', 'products', targetId));
    idsOf(row.entitledProductIds).forEach((targetId) => addProtectedEdge('orders', sourceId, 'entitledProductIds[]', 'products', targetId));
  }
  for (const row of protectedRows.purchasedAccesses) {
    addProtectedEdge('purchasedAccesses', idOf(row), 'product', 'products', row.product);
  }
  for (const row of protectedRows.courseProgress) {
    addProtectedEdge('courseProgress', idOf(row), 'course', 'courses', row.course);
  }
  for (const row of protectedRows.testAttempts) {
    const sourceId = idOf(row);
    addProtectedEdge('testAttempts', sourceId, 'mockTest', 'mockTests', row.mockTest);
    addProtectedEdge('testAttempts', sourceId, 'questionBank', 'questionBanks', row.questionBank);
    for (const [questionIndex, question] of (row.questions ?? []).entries()) {
      addProtectedEdge('testAttempts', sourceId, `questions[${questionIndex}].bankId`, 'questionBanks', question.bankId);
      addProtectedEdge('testAttempts', sourceId, `questions[${questionIndex}].topic`, 'topics', question.topic);
      addProtectedEdge('testAttempts', sourceId, `questions[${questionIndex}].subjectId`, 'subjects', question.subjectId);
      addProtectedEdge('testAttempts', sourceId, `questions[${questionIndex}].chapterId`, 'chapters', question.chapterId);
    }
  }

  const allEdges = [
    ...educationalEdges.map((edge) => ({ ...edge, protectedSource: false })),
    ...protectedEdges.map((edge) => ({ ...edge, protectedSource: true })),
  ];
  const outgoing = new Map();
  const incoming = new Map();
  const directProtection = new Map();
  const protectionCategories = new Map();
  const preservationParents = new Map();
  const entityKey = (type, id) => `${type}:${id}`;
  const entityExists = (type, id) => Boolean(entities[type]?.has(id));

  for (const edge of allEdges) {
    const sourceKey = entityKey(edge.sourceType, edge.sourceId);
    const targetKey = entityKey(edge.targetType, edge.targetId);
    const sourceRefs = outgoing.get(sourceKey) ?? [];
    sourceRefs.push(edge);
    outgoing.set(sourceKey, sourceRefs);
    const targetRefs = incoming.get(targetKey) ?? [];
    targetRefs.push(edge);
    incoming.set(targetKey, targetRefs);
    if (!entityExists(edge.targetType, edge.targetId)) {
      orphanReferences.push({
        sourceCollection: typeToCollection.get(edge.sourceType) ?? edge.sourceType,
        sourceId: edge.sourceId,
        field: edge.field,
        targetCollection: typeToCollection.get(edge.targetType) ?? edge.targetType,
        targetId: edge.targetId,
      });
    }
    if (edge.protectedSource && entityExists(edge.targetType, edge.targetId)) {
      const category = edge.sourceType;
      const target = entityKey(edge.targetType, edge.targetId);
      const details = directProtection.get(target) ?? new Map();
      const ids = details.get(category) ?? new Set();
      ids.add(edge.sourceId);
      details.set(category, ids);
      directProtection.set(target, details);
      addSetValue(protectionCategories, target, category);
    }
  }

  // Preserve the connected catalogue dependency group in both directions:
  // a paid product can be referenced by a course, question bank, mock test or
  // bundle, and deleting either side would break the other side's mapping.
  const queue = [...protectionCategories.entries()].flatMap(([key, categories]) => [...categories].map((category) => ({ key, category })));
  const visited = new Set(queue.map(({ key, category }) => `${key}:${category}`));
  while (queue.length) {
    const { key: sourceKey, category } = queue.shift();
    const neighbors = [
      ...(outgoing.get(sourceKey) ?? []).filter((edge) => !edge.protectedSource).map((edge) => ({
        edge,
        targetKey: entityKey(edge.targetType, edge.targetId),
        targetType: edge.targetType,
        targetId: edge.targetId,
        parent: { sourceCollection: typeToCollection.get(edge.sourceType), sourceId: edge.sourceId, field: edge.field },
      })),
      ...(incoming.get(sourceKey) ?? []).filter((edge) => !edge.protectedSource).map((edge) => ({
        edge,
        targetKey: entityKey(edge.sourceType, edge.sourceId),
        targetType: edge.sourceType,
        targetId: edge.sourceId,
        parent: { sourceCollection: typeToCollection.get(edge.targetType), sourceId: edge.targetId, field: edge.field },
      })),
    ];
    for (const { targetKey, targetType, targetId, parent } of neighbors) {
      if (!entityExists(targetType, targetId)) continue;
      const parents = preservationParents.get(targetKey) ?? [];
      if (!parents.some((existing) => existing.sourceCollection === parent.sourceCollection && existing.sourceId === parent.sourceId && existing.field === parent.field)) {
        parents.push(parent);
        preservationParents.set(targetKey, parents);
      }
      addSetValue(protectionCategories, targetKey, category);
      const visitKey = `${targetKey}:${category}`;
      if (!visited.has(visitKey)) {
        visited.add(visitKey);
        queue.push({ key: targetKey, category });
      }
    }
  }

  const checkOrderReferences = () => {
    const ordersById = mapById(protectedRows.orders);
    for (const access of protectedRows.purchasedAccesses) {
      if (idOf(access.order) && !ordersById.has(idOf(access.order))) {
        orphanReferences.push({ sourceCollection: collectionFor('purchasedAccesses'), sourceId: idOf(access), field: 'order', targetCollection: collectionFor('orders'), targetId: idOf(access.order) });
      }
    }
    for (const refund of protectedRows.paymentRefunds) {
      if (idOf(refund.order) && !ordersById.has(idOf(refund.order))) {
        orphanReferences.push({ sourceCollection: collectionFor('paymentRefunds'), sourceId: idOf(refund), field: 'order', targetCollection: collectionFor('orders'), targetId: idOf(refund.order) });
      }
    }
    const coursesById = entities.courses;
    for (const progress of protectedRows.courseProgress) {
      const course = coursesById.get(idOf(progress.course));
      if (!course) continue;
      const lessonIds = new Set((course.modules ?? []).flatMap((module) => (module.lessons ?? []).map((lesson) => idOf(lesson))).filter(Boolean));
      for (const lessonId of [...idsOf(progress.completedLessonIds), idOf(progress.lastLessonId)].filter(Boolean)) {
        if (!lessonIds.has(lessonId)) {
          orphanReferences.push({ sourceCollection: collectionFor('courseProgress'), sourceId: idOf(progress), field: 'completedLessonIds/lastLessonId', targetCollection: `${collectionFor('courses')}.modules.lessons`, targetId: lessonId, courseId: idOf(progress.course) });
        }
      }
    }
  };
  checkOrderReferences();

  const entityInconsistency = (kind, row, field, targetKind, targetId, message) => {
    if (!targetId || !entityExists(targetKind, targetId)) return;
    consistencyFindings.push({ collection: typeToCollection.get(kind), recordId: idOf(row), field, relatedCollection: typeToCollection.get(targetKind), relatedId: targetId, message });
  };
  for (const row of data.chapters) {
    const subject = entities.subjects.get(idOf(row.subject));
    if (subject && idOf(subject.exam) !== idOf(row.exam)) entityInconsistency('chapters', row, 'exam/subject', 'subjects', idOf(row.subject), 'Chapter exam does not match its subject exam.');
  }
  for (const row of data.topics) {
    const subject = entities.subjects.get(idOf(row.subject));
    const chapter = entities.chapters.get(idOf(row.chapter));
    if (subject && idOf(subject.exam) !== idOf(row.exam)) entityInconsistency('topics', row, 'exam/subject', 'subjects', idOf(row.subject), 'Topic exam does not match its subject exam.');
    if (chapter && (idOf(chapter.exam) !== idOf(row.exam) || idOf(chapter.subject) !== idOf(row.subject))) entityInconsistency('topics', row, 'exam/subject/chapter', 'chapters', idOf(row.chapter), 'Topic chapter does not match its exam and subject.');
  }
  for (const row of data.products) {
    const subject = entities.subjects.get(idOf(row.subject));
    const chapter = entities.chapters.get(idOf(row.chapter));
    const topic = entities.topics.get(idOf(row.topic));
    if (subject && idOf(subject.exam) !== idOf(row.exam)) entityInconsistency('products', row, 'exam/subject', 'subjects', idOf(row.subject), 'Product exam does not match its subject exam.');
    if (chapter && (idOf(chapter.exam) !== idOf(row.exam) || idOf(chapter.subject) !== idOf(row.subject))) entityInconsistency('products', row, 'exam/subject/chapter', 'chapters', idOf(row.chapter), 'Product chapter does not match its exam and subject.');
    if (topic && (idOf(topic.exam) !== idOf(row.exam) || idOf(topic.subject) !== idOf(row.subject))) entityInconsistency('products', row, 'exam/subject/topic', 'topics', idOf(row.topic), 'Product topic does not match its exam and subject.');
    for (const topicId of idsOf(row.topics)) {
      const mappedTopic = entities.topics.get(topicId);
      if (mappedTopic && (idOf(mappedTopic.exam) !== idOf(row.exam) || idOf(mappedTopic.subject) !== idOf(row.subject))) entityInconsistency('products', row, 'exam/subject/topics[]', 'topics', topicId, 'Product topic mapping does not match its exam and subject.');
    }
  }
  for (const row of data.courses) {
    const product = entities.products.get(idOf(row.product));
    if (product && (idOf(product.exam) !== idOf(row.exam) || product.resourceType !== row.courseType)) entityInconsistency('courses', row, 'product/exam/courseType', 'products', idOf(row.product), 'Course product does not match its exam or course type.');
    for (const subjectId of idsOf(row.subjects)) {
      const subject = entities.subjects.get(subjectId);
      if (subject && idOf(subject.exam) !== idOf(row.exam)) entityInconsistency('courses', row, 'exam/subjects[]', 'subjects', subjectId, 'Course subject does not belong to the course exam.');
    }
    for (const [moduleIndex, module] of (row.modules ?? []).entries()) {
      const subjectId = idOf(module.subject);
      const chapterId = idOf(module.chapter);
      const chapter = entities.chapters.get(chapterId);
      if (subjectId && !idsOf(row.subjects).includes(subjectId)) entityInconsistency('courses', row, `modules[${moduleIndex}].subject`, 'subjects', subjectId, 'Course module subject is not in the course subject list.');
      if (chapter && (idOf(chapter.exam) !== idOf(row.exam) || idOf(chapter.subject) !== subjectId)) entityInconsistency('courses', row, `modules[${moduleIndex}].chapter`, 'chapters', chapterId, 'Course module chapter does not match its exam and subject.');
      for (const [lessonIndex, lesson] of (module.lessons ?? []).entries()) {
        const topic = entities.topics.get(idOf(lesson.topic));
        if (topic && (idOf(topic.exam) !== idOf(row.exam) || idOf(topic.subject) !== subjectId || idOf(topic.chapter) !== chapterId)) {
          entityInconsistency('courses', row, `modules[${moduleIndex}].lessons[${lessonIndex}].topic`, 'topics', idOf(lesson.topic), 'Lesson topic does not match its course exam, module subject and chapter.');
        }
      }
    }
  }
  for (const row of data.questionBanks) {
    const subject = entities.subjects.get(idOf(row.subject));
    const product = entities.products.get(idOf(row.product));
    if (subject && idOf(subject.exam) !== idOf(row.exam)) entityInconsistency('questionBanks', row, 'exam/subject', 'subjects', idOf(row.subject), 'Question bank exam does not match its subject exam.');
    if (product && idOf(product.exam) !== idOf(row.exam)) entityInconsistency('questionBanks', row, 'exam/product', 'products', idOf(row.product), 'Question bank product belongs to another exam.');
    for (const [index, question] of (row.questions ?? []).entries()) {
      const topic = entities.topics.get(idOf(question.topic));
      if (topic && (idOf(topic.exam) !== idOf(row.exam) || idOf(topic.subject) !== idOf(row.subject))) entityInconsistency('questionBanks', row, `questions[${index}].topic`, 'topics', idOf(question.topic), 'Question topic does not match its question bank exam and subject.');
    }
  }
  for (const row of data.mockTests) {
    const product = entities.products.get(idOf(row.product));
    if (product && (idOf(product.exam) !== idOf(row.exam) || product.resourceType !== 'mock-test')) entityInconsistency('mockTests', row, 'product/exam', 'products', idOf(row.product), 'Mock test product does not match its exam or resource type.');
  }

  const addDuplicateFinding = (collection, kind, duplicates) => {
    for (const duplicate of duplicates) duplicateFindings.push({ collection, constraint: kind, ...duplicate });
  };
  addDuplicateFinding(collectionFor('exams'), 'slug', duplicateScopedKeys(data.exams, (row) => row.slug));
  addDuplicateFinding(collectionFor('subjects'), 'exam+slug', duplicateScopedKeys(data.subjects, (row) => `${idOf(row.exam)}:${row.slug}`));
  addDuplicateFinding(collectionFor('chapters'), 'subject+slug', duplicateScopedKeys(data.chapters, (row) => `${idOf(row.subject)}:${row.slug}`));
  addDuplicateFinding(collectionFor('topics'), 'subject+slug', duplicateScopedKeys(data.topics, (row) => `${idOf(row.subject)}:${row.slug}`));
  addDuplicateFinding(collectionFor('products'), 'exam+slug', duplicateScopedKeys(data.products, (row) => `${idOf(row.exam)}:${row.slug}`));
  addDuplicateFinding(collectionFor('courses'), 'product', duplicateScopedKeys(data.courses, (row) => idOf(row.product)));
  addDuplicateFinding(collectionFor('mockTests'), 'product', duplicateScopedKeys(data.mockTests, (row) => idOf(row.product)));
  const duplicateArrayEntries = (collection, rows, field) => {
    for (const row of rows) {
      const refs = idsOf(row[field]);
      const repeated = [...new Set(refs.filter((value, index) => refs.indexOf(value) !== index))];
      if (repeated.length) duplicateFindings.push({ collection, recordId: idOf(row), field, duplicateReferenceIds: repeated });
    }
  };
  duplicateArrayEntries(collectionFor('courses'), data.courses, 'subjects');
  duplicateArrayEntries(collectionFor('mockTests'), data.mockTests, 'questionBanks');
  duplicateArrayEntries(collectionFor('products'), data.products, 'topics');
  duplicateArrayEntries(collectionFor('products'), data.products, 'bundleItems');

  const manifest = [];
  for (const spec of educationalSpecs) {
    for (const row of data[spec.key]) {
      const key = entityKey(spec.key, idOf(row));
      const direct = directProtection.get(key) ?? new Map();
      const inherited = [...(preservationParents.get(key) ?? [])];
      const protectedCategories = [...(protectionCategories.get(key) ?? [])].sort();
      const missingForRecord = orphanReferences.filter((reference) => reference.sourceCollection === spec.collection && reference.sourceId === idOf(row));
      const inconsistentForRecord = consistencyFindings.filter((finding) => finding.collection === spec.collection && finding.recordId === idOf(row));
      const inbound = (incoming.get(key) ?? []).map((edge) => ({
        sourceCollection: typeToCollection.get(edge.sourceType) ?? edge.sourceType,
        sourceId: edge.sourceId,
        field: edge.field,
        protectedSource: edge.protectedSource,
      }));
      const outbound = (outgoing.get(key) ?? []).map((edge) => ({
        field: edge.field,
        targetCollection: typeToCollection.get(edge.targetType) ?? edge.targetType,
        targetId: edge.targetId,
        exists: entityExists(edge.targetType, edge.targetId),
        protectedSource: edge.protectedSource,
      }));
      let assessment;
      let reasons;
      if (protectedCategories.length) {
        assessment = 'preserve';
        reasons = [
          ...(direct.size ? ['Directly referenced by protected student, order, ownership or test-history records.'] : []),
          ...(inherited.length ? ['Connected through catalogue relationships to a record referenced by protected data; retain both sides until reviewed.'] : []),
        ];
      } else if (missingForRecord.length || inconsistentForRecord.length) {
        assessment = 'manual_review_required';
        reasons = ['This record has missing or inconsistent references; resolve and review them before deletion.'];
      } else if (inbound.length || outbound.length) {
        assessment = 'candidate_after_dependency_cleanup';
        reasons = ['No protected dependency was found, but catalogue references remain; review and remove dependent catalogue records first.'];
      } else {
        assessment = 'candidate_for_manual_review';
        reasons = ['No protected or catalogue references were found in the audited data; manual owner review is still required.'];
      }
      manifest.push({
        ...safeRecord(spec.key, row),
        collection: spec.collection,
        assessment,
        reasons,
        protectedBy: protectedCategories,
        directProtectedReferences: Object.fromEntries([...direct.entries()].map(([category, ids]) => [category, [...ids].sort()])),
        preservationDependencies: inherited,
        inboundReferences: inbound,
        outboundReferences: outbound,
        missingReferences: missingForRecord,
        consistencyFindings: inconsistentForRecord,
      });
    }
  }

  const countByCategory = (category) => protectedEdges.filter((edge) => edge.sourceType === category).length;
  const relationshipCounts = Object.fromEntries(educationalSpecs.map(({ key, collection }) => [collection, {
    outgoingReferences: educationalEdges.filter((edge) => edge.sourceType === key).length,
    incomingReferences: educationalEdges.filter((edge) => edge.targetType === key).length,
    protectedIncomingReferences: protectedEdges.filter((edge) => edge.targetType === key).length,
  }]));

  return {
    reportType: 'mednexora-production-catalogue-audit',
    generatedAt,
    mode: 'read-only; no database writes or index changes are performed',
    consistencyNote: 'Run while catalogue writes are paused. Reads are not wrapped in a cross-collection snapshot transaction.',
    educationalCollectionCounts: Object.fromEntries(educationalSpecs.map(({ key, collection }) => [collection, data[key].length])),
    protectedCollectionCounts: Object.fromEntries(protectedSpecs.map(({ key, collection }) => [collection, data[key].length])),
    protectedReferenceCounts: {
      orderProductReferences: countByCategory('orders'),
      purchasedAccessProductReferences: countByCategory('purchasedAccesses'),
      courseProgressCourseReferences: countByCategory('courseProgress'),
      testAttemptEducationalReferences: countByCategory('testAttempts'),
    },
    relationshipCounts,
    orphanedReferences: orphanReferences,
    consistencyFindings,
    duplicateFindings,
    deletionManifest: manifest,
  };
}

async function readProjected(Model, projection) {
  return Model.find({}).select(projection).lean().exec();
}

async function readLiveIndexes(Model) {
  try {
    return await Model.collection.indexes();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') return [];
    return { unavailable: true, errorName: error?.name ?? 'IndexReadError', code: Number.isInteger(error?.code) ? error.code : undefined };
  }
}

export async function collectCatalogueAuditSnapshot() {
  const rows = await Promise.all(allSpecs.map(({ key, Model, projection }) => readProjected(Model, projection).then((items) => [key, items])));
  return Object.fromEntries(rows);
}

export class AuditEnvironmentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuditEnvironmentError';
  }
}

export function assertAuditTarget({ nodeEnv, railwayEnvironmentName, railwayServiceName, auditMongoUri }) {
  if (nodeEnv !== 'production') {
    throw new AuditEnvironmentError('This audit requires NODE_ENV=production.');
  }
  if (railwayEnvironmentName !== 'production') {
    throw new AuditEnvironmentError('This audit requires RAILWAY_ENVIRONMENT_NAME=production.');
  }
  if (railwayServiceName !== 'MEDNEXORA') {
    throw new AuditEnvironmentError('This audit requires RAILWAY_SERVICE_NAME=MEDNEXORA.');
  }
  const uri = typeof auditMongoUri === 'string' ? auditMongoUri.trim() : '';
  if (!/^mongodb(?:\+srv)?:\/\//u.test(uri)) {
    throw new AuditEnvironmentError('Set CATALOGUE_AUDIT_MONGODB_URI to a valid Atlas URI for a read-only database user.');
  }
  return uri;
}

async function main() {
  let connected = false;
  try {
    const { env } = await import('../src/config/env.js');
    const auditUri = assertAuditTarget({
      nodeEnv: env.nodeEnv,
      railwayEnvironmentName: process.env.RAILWAY_ENVIRONMENT_NAME,
      railwayServiceName: process.env.RAILWAY_SERVICE_NAME,
      auditMongoUri: process.env.CATALOGUE_AUDIT_MONGODB_URI,
    });

    // Disable Mongoose collection/index creation for this process. The URI
    // must belong to a database user with read-only Atlas privileges.
    for (const { Model } of allSpecs) {
      Model.schema.set('autoIndex', false);
      Model.schema.set('autoCreate', false);
    }
    await mongoose.connect(auditUri, {
      autoIndex: false,
      autoCreate: false,
      readPreference: 'secondaryPreferred',
      readConcern: { level: 'majority' },
      serverSelectionTimeoutMS: 15000,
    });
    connected = true;

    const snapshot = await collectCatalogueAuditSnapshot();
    const report = buildCatalogueAuditManifest(snapshot);
    const indexes = Object.fromEntries(await Promise.all(educationalSpecs.map(async ({ key, collection, Model }) => [
      collection,
      await readLiveIndexes(Model),
    ])));
    report.databaseName = mongoose.connection.name;
    report.liveIndexes = indexes;
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error('Catalogue audit stopped. No database records or indexes were modified.');
    console.error(`Reason: ${error instanceof AuditEnvironmentError ? error.message : `${error?.name ?? 'AuditError'}; check Railway diagnostics without sharing connection strings.`}`);
    process.exitCode = 1;
  } finally {
    if (connected) await mongoose.disconnect().catch(() => {});
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) await main();
