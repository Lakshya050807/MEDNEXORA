import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const configProbe = "const { env } = await import('./src/config/env.js'); process.stdout.write(JSON.stringify({ enabled: env.passwordResetEmailEnabled, apiKeyConfigured: Boolean(env.resendApiKey), fromEmail: env.passwordResetFromEmail, pepperConfigured: Boolean(env.passwordResetOtpPepper) }));";
const baseEnvironment = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  WINDIR: process.env.WINDIR,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  NODE_ENV: 'test',
  APP_ENV: 'test',
  SESSION_SECRET: 'password-reset-config-test-session-secret-32-bytes',
  APP_ORIGIN: 'http://localhost:5173',
  PASSWORD_RESET_EMAIL_ENABLED: 'false',
  DOTENV_CONFIG_PATH: resolve(process.cwd(), '.env.password-reset-test-does-not-exist'),
};

function readConfig(overrides = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', configProbe], {
    cwd: process.cwd(),
    env: { ...baseEnvironment, ...overrides },
    encoding: 'utf8',
  });
}

test('password reset email defaults to disabled and starts without provider credentials', () => {
  const { PASSWORD_RESET_EMAIL_ENABLED: _ignored, ...withoutFlag } = baseEnvironment;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', configProbe], {
    cwd: process.cwd(), env: withoutFlag, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { enabled: false, apiKeyConfigured: false, fromEmail: '', pepperConfigured: false });
});

test('disabled password reset email does not require configured credentials', () => {
  const result = readConfig();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { enabled: false, apiKeyConfigured: false, fromEmail: '', pepperConfigured: false });
});

test('enabled password reset email requires every credential without exposing supplied secrets', () => {
  const apiKey = 're_test-only-api-key-0123456789abcdef';
  const pepper = 'test-only-password-reset-pepper-0123456789';
  for (const missing of ['RESEND_API_KEY', 'PASSWORD_RESET_FROM_EMAIL', 'PASSWORD_RESET_OTP_PEPPER']) {
    const credentials = {
      PASSWORD_RESET_EMAIL_ENABLED: 'true',
      RESEND_API_KEY: apiKey,
      PASSWORD_RESET_FROM_EMAIL: 'no-reply@example.test',
      PASSWORD_RESET_OTP_PEPPER: pepper,
    };
    delete credentials[missing];
    const result = readConfig(credentials);
    assert.notEqual(result.status, 0, `${missing} should be required`);
    assert.match(result.stderr, new RegExp(missing, 'u'));
    assert.equal(result.stderr.includes(apiKey), false);
    assert.equal(result.stderr.includes(pepper), false);
  }
});

test('enabled password reset email accepts valid configuration but probe output contains no secrets', () => {
  const apiKey = 're_test-only-api-key-0123456789abcdef';
  const pepper = 'test-only-password-reset-pepper-0123456789';
  const result = readConfig({
    PASSWORD_RESET_EMAIL_ENABLED: 'true',
    RESEND_API_KEY: apiKey,
    PASSWORD_RESET_FROM_EMAIL: 'no-reply@example.test',
    PASSWORD_RESET_OTP_PEPPER: pepper,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    enabled: true,
    apiKeyConfigured: true,
    fromEmail: 'no-reply@example.test',
    pepperConfigured: true,
  });
  assert.equal(result.stdout.includes(apiKey), false);
  assert.equal(result.stdout.includes(pepper), false);
});

test('enabled password reset email rejects malformed API key, sender address, and short pepper', () => {
  const common = {
    PASSWORD_RESET_EMAIL_ENABLED: 'true',
    RESEND_API_KEY: 're_test-only-api-key-0123456789abcdef',
    PASSWORD_RESET_FROM_EMAIL: 'no-reply@example.test',
    PASSWORD_RESET_OTP_PEPPER: 'test-only-password-reset-pepper-0123456789',
  };
  const invalidCases = [
    [{ RESEND_API_KEY: 'not-a-resend-key' }, /RESEND_API_KEY must be a valid/u],
    [{ PASSWORD_RESET_FROM_EMAIL: 'not-an-email' }, /PASSWORD_RESET_FROM_EMAIL must be a valid/u],
    [{ PASSWORD_RESET_OTP_PEPPER: 'too-short' }, /PASSWORD_RESET_OTP_PEPPER must be a unique secret/u],
  ];
  for (const [overrides, expectedMessage] of invalidCases) {
    const result = readConfig({ ...common, ...overrides });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expectedMessage);
    assert.equal(result.stderr.includes(common.RESEND_API_KEY), false);
    assert.equal(result.stderr.includes(common.PASSWORD_RESET_OTP_PEPPER), false);
  }
});
