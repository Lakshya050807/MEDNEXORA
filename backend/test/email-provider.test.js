import test from 'node:test';
import assert from 'node:assert/strict';
import { createResendEmailProvider } from '../src/services/emailProvider.js';

const apiKey = 're_mock-only-api-key-0123456789abcdef';
const from = 'no-reply@example.test';

test('Resend adapter sends through the injected fetch implementation', async () => {
  let request;
  const provider = createResendEmailProvider({
    apiKey,
    from,
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return { ok: true, status: 200 };
    },
  });

  const result = await provider.send({
    to: 'student@example.test',
    subject: 'Your MEDNEXORA security code',
    text: 'Mock email content.',
  });

  assert.deepEqual(result, { sent: true });
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, `Bearer ${apiKey}`);
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request.options.body), {
    from,
    to: 'student@example.test',
    subject: 'Your MEDNEXORA security code',
    text: 'Mock email content.',
  });
});

test('Resend adapter hides provider response details and network errors', async () => {
  for (const fetchImpl of [
    async () => { throw new Error(`secret=${apiKey} provider detail`); },
    async () => ({ ok: false, status: 500, text: async () => `secret=${apiKey} provider response detail` }),
  ]) {
    const provider = createResendEmailProvider({ apiKey, from, fetchImpl });
    await assert.rejects(
      provider.send({ to: 'student@example.test', subject: 'Security code', text: 'Mock body.' }),
      (error) => error.message === 'Email delivery failed.' && !error.message.includes(apiKey),
    );
  }
});

test('Resend adapter refuses to send without valid configuration or message fields', async () => {
  let sendCount = 0;
  const fetchImpl = async () => { sendCount += 1; return { ok: true }; };
  const unconfigured = createResendEmailProvider({ fetchImpl });
  await assert.rejects(
    unconfigured.send({ to: 'student@example.test', subject: 'Security code', text: 'Mock body.' }),
    /Email delivery is not configured/u,
  );

  const configured = createResendEmailProvider({ apiKey, from, fetchImpl });
  await assert.rejects(
    configured.send({ to: 'invalid recipient', subject: 'Security code', text: 'Mock body.' }),
    /valid recipient/u,
  );
  assert.equal(sendCount, 0, 'invalid or unconfigured requests do not invoke fetch');
});
