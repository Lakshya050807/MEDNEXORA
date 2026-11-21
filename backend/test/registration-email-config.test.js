import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const probe = "const { env } = await import('./src/config/env.js'); process.stdout.write(JSON.stringify({ enabled: env.registrationEmailVerificationEnabled, pepperConfigured: Boolean(env.registrationOtpPepper), providerConfigured: Boolean(env.resendApiKey && env.passwordResetFromEmail), restrictedEnabled: env.stagingRestrictedRegistrationEnabled, invitationTtlMinutes: env.stagingRegistrationInvitationTtlMinutes, publicRegistrationEnabled: env.publicRegistrationEnabled, paidPurchasesEnabled: env.paidPurchasesEnabled }));";
const registrationFixtureProbe = "const { env } = await import('./src/config/env.js'); const { registrationTestAppOptions } = await import('./test/helpers/registration.js'); const { launchConfig } = registrationTestAppOptions(); process.stdout.write(JSON.stringify({ parentRegistrationEnabled: env.publicRegistrationEnabled, parentPaidPurchasesEnabled: env.paidPurchasesEnabled, fixtureRegistrationEnabled: launchConfig.registrationEnabled, fixturePaidPurchasesEnabled: launchConfig.paidPurchasesEnabled }));";
const baseEnv = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  WINDIR: process.env.WINDIR,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  NODE_ENV: 'test',
  APP_ENV: 'test',
  SESSION_SECRET: 'registration-config-test-session-secret-minimum-32',
  APP_ORIGIN: 'http://localhost:5173',
  DOTENV_CONFIG_PATH: resolve(process.cwd(), '.env.registration-test-does-not-exist'),
};

function readConfig(overrides = {}, environment = baseEnv) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: process.cwd(),
    env: { ...environment, ...overrides },
    encoding: 'utf8',
  });
}

function readRegistrationFixture(overrides = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', registrationFixtureProbe], {
    cwd: process.cwd(),
    env: { ...baseEnv, ...overrides },
    encoding: 'utf8',
  });
}

const validProvider = {
  RESEND_API_KEY: 're_test-only-key-0123456789abcdef',
  PASSWORD_RESET_FROM_EMAIL: 'no-reply@example.test',
};
const validPepper = 'test-only-registration-pepper-32-bytes-minimum';
const stagingBase = {
  ...baseEnv,
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  APP_ORIGIN: 'https://mednexora-staging.example.test',
  PRIVATE_STORAGE_DIR: resolve(tmpdir(), 'mednexora-isolated-test-storage'),
  MONGODB_URI: 'mongodb://example.invalid/isolated-test-only',
  RAZORPAY_MODE: 'test',
};
const providerAndRegistration = {
  REGISTRATION_EMAIL_VERIFICATION_ENABLED: 'true',
  RESEND_API_KEY: validProvider.RESEND_API_KEY,
  PASSWORD_RESET_FROM_EMAIL: validProvider.PASSWORD_RESET_FROM_EMAIL,
  REGISTRATION_OTP_PEPPER: validPepper,
};

test('registration email verification defaults disabled without email credentials', () => {
  const result = readConfig();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { enabled: false, pepperConfigured: false, providerConfigured: false, restrictedEnabled: false, invitationTtlMinutes: 120, publicRegistrationEnabled: true, paidPurchasesEnabled: true });
});

test('disabled registration email verification does not require provider credentials or pepper', () => {
  const result = readConfig({ REGISTRATION_EMAIL_VERIFICATION_ENABLED: 'false' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { enabled: false, pepperConfigured: false, providerConfigured: false, restrictedEnabled: false, invitationTtlMinutes: 120, publicRegistrationEnabled: true, paidPurchasesEnabled: true });
});

test('registration test fixtures override an inherited closed gate and keep paid purchases closed', () => {
  const result = readRegistrationFixture({
    PUBLIC_BETA_REGISTRATION_ENABLED: 'false',
    PUBLIC_BETA_PAID_PURCHASES_ENABLED: 'true',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    parentRegistrationEnabled: false,
    parentPaidPurchasesEnabled: true,
    fixtureRegistrationEnabled: true,
    fixturePaidPurchasesEnabled: false,
  });
});

test('enabled registration email verification requires its distinct pepper and shared email provider configuration', () => {
  for (const missing of ['REGISTRATION_OTP_PEPPER', 'RESEND_API_KEY', 'PASSWORD_RESET_FROM_EMAIL']) {
    const values = {
      REGISTRATION_EMAIL_VERIFICATION_ENABLED: 'true',
      ...validProvider,
      REGISTRATION_OTP_PEPPER: validPepper,
    };
    delete values[missing];
    const result = readConfig(values);
    assert.notEqual(result.status, 0, missing + ' should be required');
    assert.match(result.stderr, new RegExp(missing, 'u'));
    assert.equal(result.stderr.includes(validPepper), false);
    assert.equal(result.stderr.includes(validProvider.RESEND_API_KEY), false);
  }
});

test('enabled registration verification accepts valid config without printing secrets', () => {
  const result = readConfig({
    REGISTRATION_EMAIL_VERIFICATION_ENABLED: 'true',
    ...validProvider,
    REGISTRATION_OTP_PEPPER: validPepper,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { enabled: true, pepperConfigured: true, providerConfigured: true, restrictedEnabled: false, invitationTtlMinutes: 120, publicRegistrationEnabled: true, paidPurchasesEnabled: true });
  assert.equal(result.stdout.includes(validPepper), false);
  assert.equal(result.stdout.includes(validProvider.RESEND_API_KEY), false);
});

test('registration and password-reset OTP peppers must be distinct when registration verification is enabled', () => {
  const result = readConfig({
    REGISTRATION_EMAIL_VERIFICATION_ENABLED: 'true',
    ...validProvider,
    REGISTRATION_OTP_PEPPER: validPepper,
    PASSWORD_RESET_OTP_PEPPER: validPepper,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /REGISTRATION_OTP_PEPPER must be different from PASSWORD_RESET_OTP_PEPPER/u);
  assert.equal(result.stderr.includes(validPepper), false);
});

test('enabled registration verification rejects malformed flags and short peppers', () => {
  const malformedFlag = readConfig({ REGISTRATION_EMAIL_VERIFICATION_ENABLED: 'yes' });
  assert.notEqual(malformedFlag.status, 0);
  assert.match(malformedFlag.stderr, /REGISTRATION_EMAIL_VERIFICATION_ENABLED must be either true or false/u);
  const shortPepper = readConfig({
    REGISTRATION_EMAIL_VERIFICATION_ENABLED: 'true',
    ...validProvider,
    REGISTRATION_OTP_PEPPER: 'too-short',
  });
  assert.notEqual(shortPepper.status, 0);
  assert.match(shortPepper.stderr, /REGISTRATION_OTP_PEPPER must be a unique secret/u);
  assert.equal(shortPepper.stderr.includes(validProvider.RESEND_API_KEY), false);
});

test('restricted staging registration defaults off and does not open the public registration or purchase gates', () => {
  const result = readConfig({}, stagingBase);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    enabled: false,
    pepperConfigured: false,
    providerConfigured: false,
    restrictedEnabled: false,
    invitationTtlMinutes: 120,
    publicRegistrationEnabled: false,
    paidPurchasesEnabled: false,
  });
});

test('restricted registration accepts complete OTP configuration in staging while public gates stay closed', () => {
  const result = readConfig({
    STAGING_RESTRICTED_REGISTRATION_ENABLED: 'true',
    ...providerAndRegistration,
  }, stagingBase);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    enabled: true,
    pepperConfigured: true,
    providerConfigured: true,
    restrictedEnabled: true,
    invitationTtlMinutes: 120,
    publicRegistrationEnabled: false,
    paidPurchasesEnabled: false,
  });
  assert.equal(result.stdout.includes(validPepper), false);
  assert.equal(result.stdout.includes(validProvider.RESEND_API_KEY), false);
});

test('restricted invitation testing cannot override the staging public registration or paid purchase gates', () => {
  for (const gate of ['PUBLIC_BETA_REGISTRATION_ENABLED', 'PUBLIC_BETA_PAID_PURCHASES_ENABLED']) {
    const result = readConfig({
      STAGING_RESTRICTED_REGISTRATION_ENABLED: 'true',
      ...providerAndRegistration,
      [gate]: 'true',
    }, stagingBase);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Public registration and paid purchases must remain disabled in staging/u);
    assert.equal(result.stderr.includes(validPepper), false);
  }
});

test('restricted staging registration requires OTP configuration and cannot be enabled outside staging', () => {
  const missingOtp = readConfig({ STAGING_RESTRICTED_REGISTRATION_ENABLED: 'true' }, stagingBase);
  assert.notEqual(missingOtp.status, 0);
  assert.match(missingOtp.stderr, /REGISTRATION_EMAIL_VERIFICATION_ENABLED must be true/u);

  for (const outside of [
    { ...baseEnv, NODE_ENV: 'test', APP_ENV: 'test' },
    { ...stagingBase, APP_ENV: 'production' },
  ]) {
    const result = readConfig({ STAGING_RESTRICTED_REGISTRATION_ENABLED: 'true' }, outside);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /STAGING_RESTRICTED_REGISTRATION_ENABLED may only be enabled when APP_ENV=staging/u);
  }
});

test('invitation lifetime is constrained to five minutes through 24 hours', () => {
  for (const value of ['4', '1441', '2.5', 'not-a-number']) {
    const result = readConfig({ STAGING_REGISTRATION_INVITATION_TTL_MINUTES: value }, stagingBase);
    assert.notEqual(result.status, 0, `${value} must be rejected`);
    assert.match(result.stderr, /STAGING_REGISTRATION_INVITATION_TTL_MINUTES must be an integer from 5 to 1440/u);
  }
});
