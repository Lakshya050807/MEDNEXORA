import test from 'node:test';
import assert from 'node:assert/strict';
import { adminApi } from '../src/services/adminApi.js';

function mockJson(t) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ items: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return calls;
}

test('admin API sends valid integer pagination and omits missing or empty values', async (t) => {
  const calls = mockJson(t);
  await adminApi.list('chapters', { page: 1, limit: 50 });
  await adminApi.list('students', { page: undefined, limit: null });
  await adminApi.list('orders', { page: '', limit: '' });

  assert.equal(calls[0].url, '/api/admin/chapters?page=1&limit=50');
  assert.equal(calls[1].url, '/api/admin/students');
  assert.equal(calls[2].url, '/api/admin/orders');
});

test('admin API omits invalid pagination so backend defaults apply without weakening server validation', async (t) => {
  const calls = mockJson(t);
  await adminApi.list('chapters', { page: 0, limit: 100 });
  await adminApi.list('students', { page: 1.5, limit: Number.NaN });
  await adminApi.list('orders', { page: Number.POSITIVE_INFINITY, limit: 'not-a-number' });

  assert.deepEqual(calls.map(({ url }) => url), [
    '/api/admin/chapters',
    '/api/admin/students',
    '/api/admin/orders',
  ]);
});

test('staging invitation management uses authenticated same-origin no-store admin endpoints', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ invitations: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await adminApi.listStagingRegistrationInvitations();
  await adminApi.issueStagingRegistrationInvitation('student@example.test');
  await adminApi.revokeStagingRegistrationInvitation('invitation-id');
  assert.deepEqual(calls.map(({ url }) => url), [
    '/api/admin/staging-registration-invitations',
    '/api/admin/staging-registration-invitations',
    '/api/admin/staging-registration-invitations/invitation-id',
  ]);
  assert.deepEqual(calls.map(({ options }) => options.method ?? 'GET'), ['GET', 'POST', 'DELETE']);
  for (const { options } of calls) {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
  }
  assert.deepEqual(JSON.parse(calls[1].options.body), { email: 'student@example.test' });
});
