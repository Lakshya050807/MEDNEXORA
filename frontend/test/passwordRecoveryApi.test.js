import test from 'node:test';
import assert from 'node:assert/strict';
import { authApi } from '../src/services/authApi.js';
import { pageMetadataFor } from '../src/utils/pageMetadata.js';

test('password recovery API uses same-origin credentials and disables caching', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ message: 'generic' }), { status: 202, headers: { 'Content-Type': 'application/json' } });
  };

  await authApi.requestPasswordReset('student@example.test');
  await authApi.resetPassword({ token: 'opaque', password: 'new-long-password', confirmPassword: 'new-long-password' });

  assert.deepEqual(calls.map(({ url }) => url), ['/api/auth/forgot-password', '/api/auth/reset-password']);
  assert.ok(calls.every(({ options }) => options.credentials === 'same-origin' && options.cache === 'no-store'));
  assert.ok(calls.every(({ options }) => options.method === 'POST' && options.headers['Content-Type'] === 'application/json'));
});

test('password recovery pages are excluded from search indexing', () => {
  assert.equal(pageMetadataFor('/forgot-password').robots, 'noindex, nofollow, noarchive');
  assert.equal(pageMetadataFor('/reset-password').robots, 'noindex, nofollow, noarchive');
});
