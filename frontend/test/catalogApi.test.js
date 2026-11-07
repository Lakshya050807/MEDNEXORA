import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogApi, CatalogApiError } from '../src/services/catalogApi.js';
import { normalizeProduct } from '../src/data/catalog.js';

function mockJson(t, payload, { status = 200 } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return calls;
}

test('Target Exams catalogue requests published exam data dynamically', async (t) => {
  const configuredExam = { _id: 'nursing-exam', name: 'Configured exam', publicationStatus: 'published' };
  const calls = mockJson(t, { items: [configuredExam] });

  assert.deepEqual(await catalogApi.listExams(), [configuredExam]);
  assert.equal(calls[0].url, '/api/exams');
  assert.equal(calls[0].options.credentials, 'same-origin');
});

test('Target Exams detail loads the published subject, chapter and topic outline by encoded exam ID', async (t) => {
  const outline = {
    exam: { _id: 'exam/primary', name: 'Configured exam' },
    subjects: [{ _id: 'biology', chapters: [{ _id: 'chapter-1', topics: [{ _id: 'topic-1', name: 'Configured topic' }] }] }],
  };
  const calls = mockJson(t, outline);

  assert.deepEqual(await catalogApi.getExam('exam/primary'), outline);
  assert.equal(calls[0].url, '/api/exams/exam%2Fprimary');
});

test('catalogue subject, chapter and topic filters are sent to the API', async (t) => {
  const calls = mockJson(t, { items: [] });

  assert.deepEqual(await catalogApi.listSubjects('exam-1'), []);
  assert.deepEqual(await catalogApi.listChapters('subject-1'), []);
  assert.deepEqual(await catalogApi.listTopics('subject-1', { chapterId: 'chapter-1' }), []);
  assert.equal(new URL(calls[0].url, 'http://local').searchParams.get('examId'), 'exam-1');
  assert.equal(new URL(calls[1].url, 'http://local').searchParams.get('subjectId'), 'subject-1');
  assert.equal(new URL(calls[2].url, 'http://local').searchParams.get('chapterId'), 'chapter-1');

  assert.deepEqual(await catalogApi.listTopics(''), []);
  assert.equal(calls.length, 3, 'missing subject should not make a topic request');
});

test('catalogue API preserves safe server errors for loading and retry states', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ message: 'Exam catalogue is unavailable.' }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  }));

  await assert.rejects(catalogApi.listExams(), (error) => {
    assert.ok(error instanceof CatalogApiError);
    assert.equal(error.status, 503);
    assert.equal(error.message, 'Exam catalogue is unavailable.');
    return true;
  });
});

test('draft products with an unset price do not become free resources in frontend normalization', () => {
  const product = normalizeProduct({
    title: 'Unpriced course draft',
    resourceType: 'video-course',
    pricePaise: null,
    discountPaise: 0,
    currentPricePaise: null,
  });
  assert.equal(product.pricePaise, null);
  assert.equal(product.currentPricePaise, null);
  assert.equal(product.price, null);
  assert.equal(product.isFree, false);
});
