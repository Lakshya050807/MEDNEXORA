import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createPaymentController } from '../src/controllers/payment.controller.js';

const configPath = "const { env } = await import('./src/config/env.js'); process.stdout.write(JSON.stringify({ appEnv: env.appEnv, nodeEnv: env.nodeEnv, secureCookies: env.secureCookies, mode: env.razorpayMode, keyIdConfigured: Boolean(env.razorpayKeyId), apiSecretConfigured: Boolean(env.razorpayKeySecret), webhookSecretConfigured: Boolean(env.razorpayWebhookSecret) }));";
const baseEnvironment = {
  ...process.env,
  NODE_ENV: 'production',
  APP_ENV: 'production',
  RAZORPAY_MODE: 'live',
  RAZORPAY_KEY_ID: 'rzp_live_example-key-id',
  RAZORPAY_KEY_SECRET: 'example-live-api-secret-for-tests',
  RAZORPAY_WEBHOOK_SECRET: 'example-live-webhook-secret-for-tests',
  SESSION_SECRET: 'environment-test-session-secret-with-at-least-32-bytes',
  APP_ORIGIN: 'https://mednexora.example.test',
  MONGODB_URI: 'mongodb+srv://mednexora.example.test/production',
  TRUST_PROXY: 'false',
  PRIVATE_STORAGE_DIR: resolve(process.cwd(), 'private-files'),
  DOTENV_CONFIG_PATH: resolve(process.cwd(), '.env.razorpay-test-does-not-exist'),
};

function runEnvironment({ overrides = {}, unset = [] } = {}) {
  const environment = { ...baseEnvironment, ...overrides };
  for (const key of unset) delete environment[key];
  return spawnSync(process.execPath, ['--input-type=module', '-e', configPath], {
    cwd: process.cwd(),
    env: environment,
    encoding: 'utf8',
  });
}

test('production starts only with explicitly selected live Razorpay credentials', () => {
  const result = runEnvironment();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    appEnv: 'production',
    nodeEnv: 'production',
    secureCookies: true,
    mode: 'live',
    keyIdConfigured: true,
    apiSecretConfigured: true,
    webhookSecretConfigured: true,
  });
});

test('production without APP_ENV keeps the legacy strict production policy', () => {
  const result = runEnvironment({ unset: ['APP_ENV'] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).appEnv, 'production');

  const testMode = runEnvironment({ unset: ['APP_ENV'], overrides: { RAZORPAY_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_test_example-key-id' } });
  assert.notEqual(testMode.status, 0);
  assert.match(testMode.stderr, /Set RAZORPAY_MODE=live explicitly in production/u);
});

test('production rejects Razorpay test mode and an unset mode', () => {
  const testMode = runEnvironment({ overrides: { RAZORPAY_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_test_example-key-id' } });
  assert.notEqual(testMode.status, 0);
  assert.match(testMode.stderr, /Set RAZORPAY_MODE=live explicitly in production/u);

  const missingMode = runEnvironment({ unset: ['RAZORPAY_MODE'] });
  assert.notEqual(missingMode.status, 0);
  assert.match(missingMode.stderr, /Set RAZORPAY_MODE=live explicitly in production/u);
});

test('production requires API key ID, API secret, and webhook secret', () => {
  const missingCredentials = [
    ['RAZORPAY_KEY_ID', /RAZORPAY_KEY_ID must be configured in production/u],
    ['RAZORPAY_KEY_SECRET', /RAZORPAY_KEY_SECRET must be configured in production/u],
    ['RAZORPAY_WEBHOOK_SECRET', /RAZORPAY_WEBHOOK_SECRET must be configured in production/u],
  ];

  for (const [key, expectedMessage] of missingCredentials) {
    const result = runEnvironment({ unset: [key] });
    assert.notEqual(result.status, 0, `${key} should be required`);
    assert.match(result.stderr, expectedMessage);
  }
});

test('development continues to accept Razorpay test mode without a webhook secret', () => {
  const result = runEnvironment({
    overrides: {
      NODE_ENV: 'development',
      APP_ENV: 'development',
      RAZORPAY_MODE: 'test',
      RAZORPAY_KEY_ID: 'rzp_test_example-key-id',
      RAZORPAY_KEY_SECRET: 'example-test-api-secret-for-tests',
    },
    unset: ['RAZORPAY_WEBHOOK_SECRET'],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    appEnv: 'development',
    nodeEnv: 'development',
    secureCookies: false,
    mode: 'test',
    keyIdConfigured: true,
    apiSecretConfigured: true,
    webhookSecretConfigured: false,
  });
});

test('staging runs with production runtime safeguards and no Razorpay credentials', () => {
  const result = runEnvironment({
    overrides: {
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      RAZORPAY_MODE: 'test',
    },
    unset: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    appEnv: 'staging',
    nodeEnv: 'production',
    secureCookies: true,
    mode: 'test',
    keyIdConfigured: false,
    apiSecretConfigured: false,
    webhookSecretConfigured: false,
  });
});

test('staging requires explicit test mode and rejects live mode or live credentials', () => {
  const liveMode = runEnvironment({
    overrides: { APP_ENV: 'staging', RAZORPAY_MODE: 'live', RAZORPAY_KEY_ID: 'rzp_live_example-key-id' },
  });
  assert.notEqual(liveMode.status, 0);
  assert.match(liveMode.stderr, /Set RAZORPAY_MODE=test explicitly in staging/u);

  const missingMode = runEnvironment({
    overrides: { APP_ENV: 'staging' },
    unset: ['RAZORPAY_MODE', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
  });
  assert.notEqual(missingMode.status, 0);
  assert.match(missingMode.stderr, /Set RAZORPAY_MODE=test explicitly in staging/u);

  const liveKeyWithTestMode = runEnvironment({
    overrides: { APP_ENV: 'staging', RAZORPAY_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_live_example-key-id' },
  });
  assert.notEqual(liveKeyWithTestMode.status, 0);
  assert.match(liveKeyWithTestMode.stderr, /RAZORPAY_KEY_ID must be a Razorpay Test Mode key/u);
});

test('production cannot be downgraded to staging runtime settings by an inconsistent APP_ENV', () => {
  const result = runEnvironment({
    overrides: { APP_ENV: 'development', RAZORPAY_MODE: 'test' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APP_ENV must be staging or production when NODE_ENV=production/u);
});

test('checkout, payment verification, reconciliation, and webhook are unavailable without credentials', async () => {
  const controller = createPaymentController({
    paymentConfig: { mode: 'test', keyId: '', keySecret: '', webhookSecret: 'configured-test-webhook-secret' },
    gateway: {},
  });
  const capture = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const invoke = async (handler, request) => {
    const response = capture();
    await handler(request, response, (error) => { throw error; });
    return response;
  };

  const checkout = await invoke(controller.createCheckout, { body: {} });
  assert.equal(checkout.statusCode, 503);
  assert.match(checkout.body.message, /Payments are not configured/u);

  const verify = await invoke(controller.verifyPayment, { params: {}, body: {} });
  assert.equal(verify.statusCode, 503);

  const reconcile = await invoke(controller.reconcileOrder, { params: {}, body: {} });
  assert.equal(reconcile.statusCode, 503);

  const webhook = await invoke(controller.webhook, { rawBody: Buffer.from('{}'), body: {}, get: () => '' });
  assert.equal(webhook.statusCode, 503);
  assert.match(webhook.body.message, /Payments are not configured/u);
});
