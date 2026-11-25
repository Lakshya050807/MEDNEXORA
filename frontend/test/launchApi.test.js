import test from 'node:test';
import assert from 'node:assert/strict';
import { launchApi } from '../src/services/launchApi.js';

test('launch status is requested from a relative no-store endpoint with same-origin credentials', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ registrationEnabled: false, paidPurchasesEnabled: true, secret: 'must-not-be-returned' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  assert.deepEqual(await launchApi.getStatus(), { registrationEnabled: false, paidPurchasesEnabled: true });
  assert.equal(calls[0].url, '/api/launch/status');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.cache, 'no-store');
});

test('launch status failures do not open gated public actions', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));
  await assert.rejects(launchApi.getStatus(), /availability could not be checked/u);
});
