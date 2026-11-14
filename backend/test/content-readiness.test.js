import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { calculateContentReadiness } from '../src/services/contentReadiness.js';

const ids = {
  exam: '507f1f77bcf86cd799439001', subject: '507f1f77bcf86cd799439002',
  chapter: '507f1f77bcf86cd799439003', topic: '507f1f77bcf86cd799439004',
  course: '507f1f77bcf86cd799439005', courseProduct: '507f1f77bcf86cd799439006',
  bank: '507f1f77bcf86cd799439007', mockProduct: '507f1f77bcf86cd799439008',
  mockTest: '507f1f77bcf86cd799439009', material: '507f1f77bcf86cd799439010',
};

function fixture() {
  return {
    exams: [{ _id: ids.exam, name: 'Configured examination', publicationStatus: 'published' }],
    subjects: [{ _id: ids.subject, name: 'Configured subject', exam: ids.exam, publicationStatus: 'published' }],
    chapters: [{ _id: ids.chapter, name: 'Configured chapter', subject: ids.subject, exam: ids.exam, publicationStatus: 'published' }],
    topics: [{ _id: ids.topic, name: 'Configured topic', chapter: ids.chapter, subject: ids.subject, exam: ids.exam, publicationStatus: 'published' }],
    courses: [{
      _id: ids.course, product: ids.courseProduct, exam: ids.exam, subjects: [ids.subject], publicationStatus: 'draft',
      modules: [{ subject: ids.subject, chapter: ids.chapter, lessons: [
        { _id: '507f1f77bcf86cd799439011', title: 'Legacy text lesson', topic: ids.topic, contentText: 'lesson content', videoProvider: 'none' },
        { _id: '507f1f77bcf86cd799439012', title: 'Empty lesson', topic: ids.topic, publicationStatus: 'draft', contentText: '', videoProvider: 'none' },
      ] }],
    }],
    studyMaterials: [
      { _id: ids.courseProduct, title: 'Configured course product', resourceType: 'video-course', publicationStatus: 'draft', exam: ids.exam, course: ids.course },
      { _id: ids.mockProduct, title: 'Mock test listing', resourceType: 'mock-test', publicationStatus: 'draft', exam: ids.exam },
      { _id: ids.material, title: 'Draft notes', resourceType: 'notes', publicationStatus: 'draft', exam: ids.exam, subject: ids.subject },
    ],
    questionBanks: [{
      _id: ids.bank, title: 'Configured MCQs', exam: ids.exam, subject: ids.subject, publicationStatus: 'published', questions: [
        { _id: '507f1f77bcf86cd799439013', options: ['A', 'B', 'C', 'D'], correctAnswerIndex: 2, explanation: 'An explanation.', topic: ids.topic },
        { _id: '507f1f77bcf86cd799439014', options: ['A', 'B'], correctAnswerIndex: 4, explanation: '', topic: ids.topic },
        { _id: '507f1f77bcf86cd799439015', options: ['A', 'B'], correctAnswerIndex: 1, explanation: '', topic: null },
      ],
    }],
    mockTests: [{
      _id: ids.mockTest, title: 'Insufficient question test', product: ids.mockProduct, exam: ids.exam,
      questionBanks: [ids.bank], questionCount: 3, publicationStatus: 'published',
    }],
  };
}

test('readiness calculates content totals, publication counts, and incomplete records from configured data', () => {
  const result = calculateContentReadiness(fixture());
  assert.deepEqual(result.counts.courses, { total: 1, published: 0, draft: 1, archived: 0 });
  assert.deepEqual(result.counts.lessons, { total: 2, published: 1, draft: 1, archived: 0 });
  assert.deepEqual(result.counts.mcqs, { total: 3, published: 3, draft: 0, archived: 0 });
  assert.deepEqual(result.counts.studyMaterials, { total: 1, published: 0, draft: 1, archived: 0 });

  const issueCounts = Object.fromEntries(result.issues.map((issue) => [issue.key, issue.count]));
  assert.equal(issueCounts['lessons-without-content'], 1);
  assert.equal(issueCounts['mcqs-without-explanations'], 2);
  assert.equal(issueCounts['mcqs-with-invalid-answers'], 1);
  assert.equal(issueCounts['mock-tests-with-insufficient-questions'], 1);
  assert.equal(issueCounts['topics-without-learning-content'], 0);
});

test('readiness checklist flags missing published subjects, incomplete curriculum, and underfilled mock tests without publishing anything', () => {
  const records = fixture();
  records.courses.push({ _id: '507f1f77bcf86cd799439016', product: ids.courseProduct, exam: ids.exam, subjects: [], publicationStatus: 'draft', modules: [] });
  const result = calculateContentReadiness(records);
  const missingSubjects = result.issues.find((issue) => issue.key === 'courses-without-published-subjects');
  assert.equal(missingSubjects.count, 1);
  const course = result.courses.find((item) => item.id === ids.course);
  assert.equal(course.publicationStatus, 'draft');
  assert.equal(course.checks.length, 7);
  assert.equal(course.checks.find((item) => item.label === 'Mock tests have enough published questions').status, 'warning');
  assert.equal(records.courses[0].publicationStatus, 'draft');
});

test('readiness output contains no lesson text, MCQ prompts or answer keys', () => {
  const records = fixture();
  records.courses[0].modules[0].lessons[0].contentText = 'PRIVATE LESSON TEXT MUST NOT BE RETURNED';
  records.questionBanks[0].questions[0].prompt = 'PRIVATE QUESTION PROMPT MUST NOT BE RETURNED';
  const response = JSON.stringify(calculateContentReadiness(records));
  assert.equal(response.includes('PRIVATE LESSON TEXT MUST NOT BE RETURNED'), false);
  assert.equal(response.includes('PRIVATE QUESTION PROMPT MUST NOT BE RETURNED'), false);
  assert.equal(response.includes('correctAnswerIndex'), false);
});

test('readiness reports published records whose parent hierarchy is not published', () => {
  const records = fixture();
  records.exams[0].publicationStatus = 'draft';
  records.subjects[0].publicationStatus = 'published';
  records.chapters[0].publicationStatus = 'published';
  records.topics[0].publicationStatus = 'published';
  const result = calculateContentReadiness(records);
  const issue = result.issues.find((item) => item.key === 'published-content-with-unpublished-parents');
  assert.ok(issue.count >= 3);
});

test('readiness resolves native MongoDB ObjectId references across the curriculum hierarchy', () => {
  const records = fixture();
  const objectId = (id) => new mongoose.Types.ObjectId(id);
  const refs = {
    exam: objectId(ids.exam), subject: objectId(ids.subject), chapter: objectId(ids.chapter),
    topic: objectId(ids.topic), course: objectId(ids.course), courseProduct: objectId(ids.courseProduct),
    bank: objectId(ids.bank), mockProduct: objectId(ids.mockProduct),
  };
  records.exams[0]._id = refs.exam;
  records.subjects[0]._id = refs.subject;
  records.subjects[0].exam = refs.exam;
  records.chapters[0]._id = refs.chapter;
  records.chapters[0].exam = refs.exam;
  records.chapters[0].subject = refs.subject;
  records.topics[0]._id = refs.topic;
  records.topics[0].exam = refs.exam;
  records.topics[0].subject = refs.subject;
  records.topics[0].chapter = refs.chapter;
  records.courses[0]._id = refs.course;
  records.courses[0].product = refs.courseProduct;
  records.courses[0].exam = refs.exam;
  records.courses[0].subjects = [refs.subject];
  records.courses[0].modules[0].subject = refs.subject;
  records.courses[0].modules[0].chapter = refs.chapter;
  records.courses[0].modules[0].lessons[0].topic = refs.topic;
  records.courses[0].modules[0].lessons[1].topic = refs.topic;
  records.studyMaterials[0].exam = refs.exam;
  records.studyMaterials[0].course = refs.course;
  records.studyMaterials[1].exam = refs.exam;
  records.studyMaterials[2].exam = refs.exam;
  records.studyMaterials[2].subject = refs.subject;
  records.questionBanks[0]._id = refs.bank;
  records.questionBanks[0].exam = refs.exam;
  records.questionBanks[0].subject = refs.subject;
  records.questionBanks[0].questions[0].topic = refs.topic;
  records.mockTests[0].product = refs.mockProduct;
  records.mockTests[0].exam = refs.exam;
  records.mockTests[0].questionBanks = [refs.bank];

  const result = calculateContentReadiness(records);
  assert.equal(result.issues.find((issue) => issue.key === 'topics-without-learning-content').count, 0);
  assert.equal(result.issues.find((issue) => issue.key === 'mock-tests-with-insufficient-questions').count, 1);
  assert.equal(result.courses[0].checks.find((item) => item.label === 'Configured subjects published').status, 'complete');
});
