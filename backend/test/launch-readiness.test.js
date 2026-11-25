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
const readConfig = "const { env } = await import('./src/config/env.js'); process.stdout.write(JSON.stringify({ registrationEnabled: env.publicRegistrationEnabled, paidPurchasesEnabled: env.paidPurchasesEnabled }));";
const baseEnvironment = {
  ...process.env,
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  RAZORPAY_MODE: 'test',
  SESSION_SECRET: 'launch-readiness-test-session-secret-32-bytes',
  APP_ORIGIN: 'https://mednexora.example.test',
  MONGODB_URI: 'mongodb+srv://mednexora.example.test/production',
  TRUST_PROXY: 'false',
  PRIVATE_STORAGE_DIR: resolve(process.cwd(), 'private-files'),
  DOTENV_CONFIG_PATH: resolve(process.cwd(), '.env.launch-readiness-test-does-not-exist'),
};

function runConfig({ overrides = {}, unset = [] } = {}) {
  const env = { ...baseEnvironment, ...overrides };
  for (const name of [...policyApprovalNames, 'PUBLIC_BETA_REGISTRATION_ENABLED', 'PUBLIC_BETA_PAID_PURCHASES_ENABLED']) {
    if (!Object.hasOwn(overrides, name)) delete env[name];
  }
  for (const key of unset) delete env[key];
  return spawnSync(process.execPath, ['--input-type=module', '-e', readConfig], {
    cwd: process.cwd(), env, encoding: 'utf8',
  });
}

test('production staging defaults public registration and paid purchases to closed', () => {
  const result = runConfig({ unset: [
    'PUBLIC_BETA_REGISTRATION_ENABLED', 'PUBLIC_BETA_PAID_PURCHASES_ENABLED', ...policyApprovalNames,
  ] });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { registrationEnabled: false, paidPurchasesEnabled: false });
});

test('page approvals alone never open registration or paid purchases', () => {
  const approvals = Object.fromEntries(policyApprovalNames.map((name) => [name, 'true']));
  const result = runConfig({ overrides: approvals, unset: ['PUBLIC_BETA_REGISTRATION_ENABLED', 'PUBLIC_BETA_PAID_PURCHASES_ENABLED'] });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { registrationEnabled: false, paidPurchasesEnabled: false });
});

test('production rejects enabling either public feature while any page approval is incomplete', () => {
  const approvals = Object.fromEntries(policyApprovalNames.map((name) => [name, 'true']));
  for (const feature of ['PUBLIC_BETA_REGISTRATION_ENABLED', 'PUBLIC_BETA_PAID_PURCHASES_ENABLED']) {
    const result = runConfig({ overrides: { ...approvals, [feature]: 'true' }, unset: ['PUBLIC_REFUND_POLICY_APPROVED'] });
    assert.notEqual(result.status, 0, `${feature} must fail closed`);
    assert.match(result.stderr, /require all six owner-approved public information and policy pages/u);
  }
});

test('all six explicit approvals plus explicit registration enablement opens registration only', () => {
  const approvals = Object.fromEntries(policyApprovalNames.map((name) => [name, 'true']));
  const result = runConfig({ overrides: { ...approvals, PUBLIC_BETA_REGISTRATION_ENABLED: 'true' } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { registrationEnabled: true, paidPurchasesEnabled: false });
});

test('paid purchases remain test-only in staging and open only in production app mode', () => {
  const approvals = Object.fromEntries(policyApprovalNames.map((name) => [name, 'true']));
  const staging = runConfig({ overrides: { ...approvals, PUBLIC_BETA_PAID_PURCHASES_ENABLED: 'true' } });
  assert.notEqual(staging.status, 0);
  assert.match(staging.stderr, /Paid purchases may only be enabled when APP_ENV=production/u);

  const production = runConfig({
    overrides: {
      ...approvals,
      APP_ENV: 'production',
      RAZORPAY_MODE: 'live',
      RAZORPAY_KEY_ID: 'rzp_live_test-only-config-key',
      RAZORPAY_KEY_SECRET: 'not-a-real-live-secret-used-only-in-test-process',
      RAZORPAY_WEBHOOK_SECRET: 'not-a-real-webhook-secret-used-only-in-test-process',
      PUBLIC_BETA_REGISTRATION_ENABLED: 'false',
      PUBLIC_BETA_PAID_PURCHASES_ENABLED: 'true',
    },
  });
  assert.equal(production.status, 0, production.stderr);
  assert.deepEqual(JSON.parse(production.stdout), { registrationEnabled: false, paidPurchasesEnabled: true });
});

test('development defaults remain enabled and invalid gate values are rejected', () => {
  const development = runConfig({
    overrides: { NODE_ENV: 'development', APP_ENV: 'development', APP_ORIGIN: 'http://localhost:5173' },
    unset: ['PUBLIC_BETA_REGISTRATION_ENABLED', 'PUBLIC_BETA_PAID_PURCHASES_ENABLED', ...policyApprovalNames],
  });
  assert.equal(development.status, 0, development.stderr);
  assert.deepEqual(JSON.parse(development.stdout), { registrationEnabled: true, paidPurchasesEnabled: true });

  const invalid = runConfig({ overrides: { PUBLIC_BETA_REGISTRATION_ENABLED: 'yes' } });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /PUBLIC_BETA_REGISTRATION_ENABLED must be either true or false/u);
});
