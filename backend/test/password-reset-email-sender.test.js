import test from 'node:test';
import assert from 'node:assert/strict';
import { createPasswordResetEmailSender } from '../src/services/passwordResetEmailSender.js';

test('password reset Resend adapter sends the verified sender and reset message through mocked fetch', async () => {
  const requests = [];
  const sender = createPasswordResetEmailSender({
    configured: true,
    apiKey: 're_test_mock_key',
  }, {
    async fetchImpl(url, options) {
      requests.push({ url, options });
      return { ok: true, status: 200 };
    },
  });

  assert.equal(sender.configured, true);
  await sender.sendPasswordReset({ to: 'student@example.test', url: 'https://mednexora.site/reset-password#token=opaque' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.resend.com/emails');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer re_test_mock_key');
  assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
  assert.equal(requests[0].options.redirect, 'error');
  const message = JSON.parse(requests[0].options.body);
  assert.equal(message.from, 'no-reply@mail.mednexora.site');
  assert.deepEqual(message.to, ['student@example.test']);
  assert.match(message.text, /within 60 minutes/u);
  assert.match(message.text, /reset-password#token=opaque/u);
  assert.doesNotMatch(JSON.stringify(message), /re_test_mock_key/u);
});

test('Resend provider rejection and transport errors become fixed safe errors', async (t) => {
  for (const [name, fetchImpl] of [
    ['non-success response', async () => ({ ok: false, status: 403, text: async () => 'private provider detail' })],
    ['network failure', async () => { throw new Error('provider host and private token'); }],
  ]) {
    await t.test(name, async () => {
      const sender = createPasswordResetEmailSender({ configured: true, apiKey: 're_test_mock_key' }, { fetchImpl });
      await assert.rejects(sender.sendPasswordReset({ to: 'student@example.test', url: 'https://example.test/#token=private' }), (error) => {
        assert.equal(error.name, 'EmailDeliveryError');
        assert.equal(error.message, 'Email delivery failed.');
        assert.doesNotMatch(error.message, /provider|private|token/u);
        assert.doesNotMatch(error.message, /re_test_mock_key/u);
        return true;
      });
    });
  }
});

test('missing Resend configuration is reported without making a request', async () => {
  let fetchCalled = false;
  const sender = createPasswordResetEmailSender({
    configured: false,
    apiKey: '',
  }, { async fetchImpl() { fetchCalled = true; } });
  assert.equal(sender.configured, false);
  await assert.rejects(sender.sendPasswordReset({ to: 'student@example.test', url: 'https://example.test/#token=private' }), (error) => {
    assert.equal(error.message, 'Password reset email is not configured.');
    return true;
  });
  assert.equal(fetchCalled, false);
});
