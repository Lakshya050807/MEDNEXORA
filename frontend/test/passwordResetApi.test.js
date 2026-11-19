import test from 'node:test';
import assert from 'node:assert/strict';
import { authApi } from '../src/services/authApi.js';

test('password-reset API methods use same-origin no-store requests and the existing endpoint contracts', async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ message: 'If an account exists, an email with password reset instructions will be sent.' }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await authApi.requestPasswordReset({ email: 'student@example.test' });
  await authApi.completePasswordReset({
    email: 'student@example.test',
    otp: '012345',
    newPassword: 'a-long-test-password',
    confirmPassword: 'a-long-test-password',
  });

  assert.deepEqual(calls.map(({ url }) => url), [
    '/api/auth/password-reset/request',
    '/api/auth/password-reset/complete',
  ]);
  assert.ok(calls.every(({ options }) => options.method === 'POST'));
  assert.ok(calls.every(({ options }) => options.credentials === 'same-origin' && options.cache === 'no-store'));
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'student@example.test' });
  assert.equal(JSON.parse(calls[1].options.body).otp, '012345');
});
