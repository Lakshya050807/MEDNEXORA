import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const configPath = "const { env } = await import('./src/config/env.js'); process.stdout.write(JSON.stringify({ mode: env.razorpayMode, keyIdConfigured: Boolean(env.razorpayKeyId), apiSecretConfigured: Boolean(env.razorpayKeySecret), webhookSecretConfigured: Boolean(env.razorpayWebhookSecret) }));";
const baseEnvironment = {
  ...process.env,
  NODE_ENV: 'production',
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
    mode: 'live',
    keyIdConfigured: true,
    apiSecretConfigured: true,
    webhookSecretConfigured: true,
  });
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
      RAZORPAY_MODE: 'test',
      RAZORPAY_KEY_ID: 'rzp_test_example-key-id',
      RAZORPAY_KEY_SECRET: 'example-test-api-secret-for-tests',
    },
    unset: ['RAZORPAY_WEBHOOK_SECRET'],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    mode: 'test',
    keyIdConfigured: true,
    apiSecretConfigured: true,
    webhookSecretConfigured: false,
  });
});
