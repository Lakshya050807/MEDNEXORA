import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const policyApprovalNames = [
  'PUBLIC_ABOUT_PAGE_APPROVED',
  'PUBLIC_CONTACT_PAGE_APPROVED',
  'PUBLIC_FAQ_PAGE_APPROVED',
  'PUBLIC_PRIVACY_POLICY_APPROVED',
  'PUBLIC_TERMS_PAGE_APPROVED',
  'PUBLIC_REFUND_POLICY_APPROVED',
];

const booleanFlagNames = [
  'PUBLIC_BETA_REGISTRATION_ENABLED',
  'PUBLIC_BETA_PAID_PURCHASES_ENABLED',
  ...policyApprovalNames,
];

const readConfig = "const { env } = await import('./src/config/env.js'); process.stdout.write(JSON.stringify({ registrationEnabled: env.publicRegistrationEnabled, paidPurchasesEnabled: env.paidPurchasesEnabled }));";
const baseEnvironment = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  WINDIR: process.env.WINDIR,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  RAZORPAY_MODE: 'test',
  SESSION_SECRET: 'test-only-launch-readiness-session-secret-32-bytes',
  APP_ORIGIN: 'https://mednexora.example.test',
  MONGODB_URI: 'mongodb+srv://mednexora.example.test/staging',
  TRUST_PROXY: 'false',
  PRIVATE_STORAGE_DIR: resolve(process.cwd(), 'private-files'),
  DOTENV_CONFIG_PATH: resolve(process.cwd(), '.env.launch-readiness-test-does-not-exist'),
};

function runConfig({ overrides = {}, unset = [] } = {}) {
  const env = { ...baseEnvironment, ...overrides };
  for (const name of booleanFlagNames) {
    if (!Object.hasOwn(overrides, name)) delete env[name];
  }
  for (const name of unset) delete env[name];
  return spawnSync(process.execPath, ['--input-type=module', '-e', readConfig], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
}

test('staging defaults registration and paid purchases to closed', () => {
  const result = runConfig();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { registrationEnabled: false, paidPurchasesEnabled: false });
});

test('staging rejects attempts to enable registration or paid purchases', () => {
  for (const feature of ['PUBLIC_BETA_REGISTRATION_ENABLED', 'PUBLIC_BETA_PAID_PURCHASES_ENABLED']) {
    const result = runConfig({ overrides: { [feature]: 'true' } });
    assert.notEqual(result.status, 0, `${feature} must fail closed`);
    assert.match(result.stderr, /Public registration and paid purchases must remain disabled in staging/u);
  }
});

test('staging ignores the legacy REGISTRATION_ENABLED name and validates canonical boolean values', () => {
  const legacyName = runConfig({ overrides: { REGISTRATION_ENABLED: 'true' } });
  assert.equal(legacyName.status, 0, legacyName.stderr);
  assert.deepEqual(JSON.parse(legacyName.stdout), { registrationEnabled: false, paidPurchasesEnabled: false });

  const invalid = runConfig({ overrides: { PUBLIC_BETA_REGISTRATION_ENABLED: 'yes' } });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /PUBLIC_BETA_REGISTRATION_ENABLED must be either true or false/u);
});

test('production defaults public registration and paid purchases to closed', () => {
  const result = runConfig({ overrides: {
    APP_ENV: 'production',
    RAZORPAY_MODE: 'live',
    RAZORPAY_KEY_ID: 'rzp_live_launch-readiness-test-key',
    RAZORPAY_KEY_SECRET: 'test-only-production-runtime-secret',
    RAZORPAY_WEBHOOK_SECRET: 'test-only-production-webhook-secret',
  } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { registrationEnabled: false, paidPurchasesEnabled: false });
});

test('production still requires all owner approvals before either public gate can be enabled', () => {
  const productionSettings = {
    APP_ENV: 'production',
    RAZORPAY_MODE: 'live',
    RAZORPAY_KEY_ID: 'rzp_live_launch-readiness-test-key',
    RAZORPAY_KEY_SECRET: 'test-only-production-runtime-secret',
    RAZORPAY_WEBHOOK_SECRET: 'test-only-production-webhook-secret',
  };
  const approvals = Object.fromEntries(policyApprovalNames.map((name) => [name, 'true']));

  for (const feature of ['PUBLIC_BETA_REGISTRATION_ENABLED', 'PUBLIC_BETA_PAID_PURCHASES_ENABLED']) {
    const rejected = runConfig({
      overrides: { ...productionSettings, ...approvals, [feature]: 'true' },
      unset: ['PUBLIC_REFUND_POLICY_APPROVED'],
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /require all six owner-approved public information and policy pages/u);
  }

  const approved = runConfig({
    overrides: { ...productionSettings, ...approvals, PUBLIC_BETA_REGISTRATION_ENABLED: 'true' },
  });
  assert.equal(approved.status, 0, approved.stderr);
  assert.deepEqual(JSON.parse(approved.stdout), { registrationEnabled: true, paidPurchasesEnabled: false });

  const paidApproved = runConfig({
    overrides: { ...productionSettings, ...approvals, PUBLIC_BETA_PAID_PURCHASES_ENABLED: 'true' },
  });
  assert.equal(paidApproved.status, 0, paidApproved.stderr);
  assert.deepEqual(JSON.parse(paidApproved.stdout), { registrationEnabled: false, paidPurchasesEnabled: true });

  const stagingPaid = runConfig({
    overrides: {
      ...approvals,
      PUBLIC_BETA_PAID_PURCHASES_ENABLED: 'true',
    },
  });
  assert.notEqual(stagingPaid.status, 0, 'approved policy flags cannot enable purchases in staging');
  assert.match(stagingPaid.stderr, /must remain disabled in staging/u);
});

test('local development defaults remain enabled when the public gates are omitted', () => {
  const result = runConfig({
    overrides: { NODE_ENV: 'development', APP_ENV: 'development', APP_ORIGIN: 'http://localhost:5173' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { registrationEnabled: true, paidPurchasesEnabled: true });
});
