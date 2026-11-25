import test from 'node:test';
import assert from 'node:assert/strict';
import { courseApi } from '../src/services/courseApi.js';

test('free course enrollment uses the authenticated student entitlement endpoint', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ access: { source: 'free' } }), { status: 201, headers: { 'content-type': 'application/json' } });
  });

  await courseApi.enroll('course/one');
  assert.equal(calls[0].url, '/api/student/courses/course%2Fone/enroll');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.deepEqual(JSON.parse(calls[0].options.body), {});
});

test('course lesson text is fetched from the no-store authenticated lesson endpoint', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ lesson: { id: 'lesson-1', contentText: 'Private lesson text.' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const result = await courseApi.lessonContent('course-1', 'lesson/one');
  assert.equal(calls[0].url, '/api/student/courses/course-1/lessons/lesson%2Fone/content');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(result.lesson.contentText, 'Private lesson text.');
});
