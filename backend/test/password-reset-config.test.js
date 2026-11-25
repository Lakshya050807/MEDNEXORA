import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const probe = "import { env } from './src/config/env.js'; process.stdout.write(JSON.stringify({ enabled: env.passwordResetEmailEnabled, configured: env.passwordResetEmail.configured }));";

function runConfig(values = {}) {
  const env = {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    TEMP: process.env.TEMP ?? '',
    TMP: process.env.TMP ?? '',
    NODE_ENV: 'test',
    APP_ORIGIN: 'http://localhost:5173',
    SESSION_SECRET: 'temporary-test-only-session-secret-123456789',
    PUBLIC_BETA_REGISTRATION_ENABLED: 'false',
    PUBLIC_BETA_PAID_PURCHASES_ENABLED: 'false',
    ...values,
  };
  return spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: backendDirectory,
    env,
    encoding: 'utf8',
  });
}

test('password reset email configuration is disabled by default without Resend credentials', () => {
  const result = runConfig();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { enabled: false, configured: false });
});

test('enabling password reset email without a Resend API key fails closed', () => {
  const result = runConfig({ PASSWORD_RESET_EMAIL_ENABLED: 'true' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Configure a valid RESEND_API_KEY before enabling PASSWORD_RESET_EMAIL_ENABLED/u);
});

test('Resend configuration is available only when its API key is present', () => {
  const result = runConfig({ RESEND_API_KEY: 're_test_key_for_configuration_only' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { enabled: false, configured: true });
  assert.doesNotMatch(result.stdout, /re_test_key/u);
});

test('enabled reset email accepts a syntactically valid Resend API key without exposing it', () => {
  const result = runConfig({
    PASSWORD_RESET_EMAIL_ENABLED: 'true',
    RESEND_API_KEY: 're_test_key_for_configuration_only',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { enabled: true, configured: true });
  assert.doesNotMatch(result.stdout, /re_test_key/u);
});

test('blank or whitespace-containing Resend keys cannot enable password reset email', () => {
  for (const apiKey of ['', 'resend key with spaces']) {
    const result = runConfig({ PASSWORD_RESET_EMAIL_ENABLED: 'true', RESEND_API_KEY: apiKey });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Configure a valid RESEND_API_KEY/u);
    assert.doesNotMatch(result.stderr, /resend key with spaces/u);
  }
});
