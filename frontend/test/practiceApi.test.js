import test from 'node:test';
import assert from 'node:assert/strict';
import { practiceApi } from '../src/services/practiceApi.js';

test('attempt reads use the existing endpoint and return the response server date as timer metadata', async (t) => {
  const serverNow = Date.UTC(2026, 10, 5, 10, 0, 0);
  const responseDate = new Date(serverNow).toUTCString();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ attempt: { id: 'attempt/one', status: 'in-progress', expiresAt: new Date(serverNow + 60_000).toISOString() } }), {
      status: 200,
      headers: { 'content-type': 'application/json', date: responseDate },
    });
  });

  const result = await practiceApi.getAttempt('attempt/one');
  assert.equal(calls[0].url, '/api/student/practice/attempts/attempt%2Fone');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(result.serverNow, serverNow);
  assert.equal(result.attempt.status, 'in-progress');
});

test('answer clearing uses the existing answer endpoint and sends an explicit null selection', async (t) => {
  let requestBody;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ attempt: { id: 'attempt-1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json', date: new Date(Date.UTC(2026, 10, 5, 10, 0, 0)).toUTCString() },
    });
  });

  await practiceApi.saveAnswer('attempt-1', 'question-1', { selectedOptionIndex: null });
  assert.deepEqual(requestBody, { selectedOptionIndex: null });
});
