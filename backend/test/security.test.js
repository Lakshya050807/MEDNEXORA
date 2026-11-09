import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createRateLimiter } from '../src/middleware/rateLimit.js';

test('sensitive endpoint limiter enforces a bounded per-IP window and reports retry information', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
  let passed = 0;
  const run = (ip) => {
    const headers = {};
    const result = { statusCode: 200, body: null };
    const response = {
      set(name, value) { headers[name] = value; return this; },
      status(code) { result.statusCode = code; return this; },
      json(body) { result.body = body; return result; },
    };
    limiter({ ip, socket: {} }, response, () => { passed += 1; });
    return { headers, ...result };
  };

  assert.equal(run('192.0.2.10').statusCode, 200);
  assert.equal(run('192.0.2.10').headers['RateLimit-Remaining'], '0');
  const blocked = run('192.0.2.10');
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
  assert.equal(passed, 2);
  assert.equal(run('192.0.2.11').statusCode, 200);
});

test('production configuration rejects blanket proxy trust and requires HTTPS frontend origin', () => {
  const baseEnv = {
    ...process.env,
    NODE_ENV: 'production',
    RAZORPAY_MODE: 'live',
    RAZORPAY_KEY_ID: 'rzp_live_security-test-key-id',
    RAZORPAY_KEY_SECRET: 'security-test-live-api-secret',
    RAZORPAY_WEBHOOK_SECRET: 'security-test-live-webhook-secret',
    SESSION_SECRET: 'production-audit-secret-that-is-at-least-32-bytes',
    APP_ORIGIN: 'https://nursing.example.test',
    MONGODB_URI: 'mongodb+srv://nursing.example.test/production',
    TRUST_PROXY: 'true',
    PRIVATE_STORAGE_DIR: resolve(process.cwd(), 'private-files'),
  };
  const rejectedProxy = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/config/env.js')"], {
    cwd: process.cwd(), env: baseEnv, encoding: 'utf8',
  });
  assert.notEqual(rejectedProxy.status, 0);
  assert.match(rejectedProxy.stderr, /TRUST_PROXY must be false, 1 for a single trusted proxy/u);

  const rejectedHttpOrigin = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/config/env.js')"], {
    cwd: process.cwd(), env: { ...baseEnv, TRUST_PROXY: 'false', APP_ORIGIN: 'http://nursing.example.test' }, encoding: 'utf8',
  });
  assert.notEqual(rejectedHttpOrigin.status, 0);
  assert.match(rejectedHttpOrigin.stderr, /APP_ORIGIN/u);

  const rejectedLocalStorage = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/config/env.js')"], {
    cwd: process.cwd(), env: { ...baseEnv, TRUST_PROXY: 'false', PRIVATE_STORAGE_ORIGIN: 'http://localhost:8123' }, encoding: 'utf8',
  });
  assert.notEqual(rejectedLocalStorage.status, 0);
  assert.match(rejectedLocalStorage.stderr, /PRIVATE_STORAGE_ORIGIN/u);

  const rejectedPublicUploadDirectory = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/config/env.js')"], {
    cwd: process.cwd(),
    env: { ...baseEnv, TRUST_PROXY: 'false', PRIVATE_STORAGE_DIR: resolve(process.cwd(), '../frontend/public/uploads') },
    encoding: 'utf8',
  });
  assert.notEqual(rejectedPublicUploadDirectory.status, 0);
  assert.match(rejectedPublicUploadDirectory.stderr, /outside the frontend public and build directories/u);

  const acceptedProxy = spawnSync(process.execPath, ['--input-type=module', '-e', "const { env } = await import('./src/config/env.js'); if (!Array.isArray(env.trustProxy)) process.exit(2)"], {
    cwd: process.cwd(), env: { ...baseEnv, TRUST_PROXY: '127.0.0.1,10.0.0.0/8' }, encoding: 'utf8',
  });
  assert.equal(acceptedProxy.status, 0, acceptedProxy.stderr);

  const acceptedSingleProxy = spawnSync(process.execPath, ['--input-type=module', '-e', "const { env } = await import('./src/config/env.js'); if (env.trustProxy !== 1 || env.secureCookies !== true || env.sessionCookieName !== '__Host-nursing.sid') process.exit(2)"], {
    cwd: process.cwd(), env: { ...baseEnv, TRUST_PROXY: '1' }, encoding: 'utf8',
  });
  assert.equal(acceptedSingleProxy.status, 0, acceptedSingleProxy.stderr);

  const rejectedHopCount = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/config/env.js')"], {
    cwd: process.cwd(), env: { ...baseEnv, TRUST_PROXY: '2' }, encoding: 'utf8',
  });
  assert.notEqual(rejectedHopCount.status, 0);
  assert.match(rejectedHopCount.stderr, /TRUST_PROXY must be false, 1 for a single trusted proxy/u);
});

test('production configuration requires an explicit absolute private storage path', () => {
  const baseEnv = {
    ...process.env,
    NODE_ENV: 'production',
    RAZORPAY_MODE: 'live',
    RAZORPAY_KEY_ID: 'rzp_live_security-test-key-id',
    RAZORPAY_KEY_SECRET: 'security-test-live-api-secret',
    RAZORPAY_WEBHOOK_SECRET: 'security-test-live-webhook-secret',
    SESSION_SECRET: 'production-audit-secret-that-is-at-least-32-bytes',
    APP_ORIGIN: 'https://nursing.example.test',
    MONGODB_URI: 'mongodb+srv://nursing.example.test/production',
    TRUST_PROXY: 'false',
    DOTENV_CONFIG_PATH: resolve(process.cwd(), '.test-env-does-not-exist'),
  };
  const importConfig = "await import('./src/config/env.js')";
  const missing = spawnSync(process.execPath, ['--input-type=module', '-e', importConfig], {
    cwd: process.cwd(), env: baseEnv, encoding: 'utf8',
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Set PRIVATE_STORAGE_DIR to an explicit mounted storage path/u);

  const relative = spawnSync(process.execPath, ['--input-type=module', '-e', importConfig], {
    cwd: process.cwd(), env: { ...baseEnv, PRIVATE_STORAGE_DIR: 'private-files' }, encoding: 'utf8',
  });
  assert.notEqual(relative.status, 0);
  assert.match(relative.stderr, /PRIVATE_STORAGE_DIR must be an absolute path/u);

  const accepted = spawnSync(process.execPath, ['--input-type=module', '-e', importConfig], {
    cwd: process.cwd(), env: { ...baseEnv, PRIVATE_STORAGE_DIR: resolve(process.cwd(), 'private-files') }, encoding: 'utf8',
  });
  assert.equal(accepted.status, 0, accepted.stderr);
});

test('the retired examination-source override no longer affects direct publication', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { env } = await import('./src/config/env.js');
    const Exam = (await import('./src/models/Exam.js')).default;
    if ('allowUnverifiedExamPublishing' in env) process.exit(2);
    const exam = new Exam({ name: 'Configured exam', slug: 'configured-exam', publicationStatus: 'published' });
    await exam.validate();
    if (exam.publicationStatus !== 'published') process.exit(3);
  `], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      RAZORPAY_MODE: 'live',
      RAZORPAY_KEY_ID: 'rzp_live_security-test-key-id',
      RAZORPAY_KEY_SECRET: 'security-test-live-api-secret',
      RAZORPAY_WEBHOOK_SECRET: 'security-test-live-webhook-secret',
      ALLOW_UNVERIFIED_EXAM_PUBLISHING: 'true',
      SESSION_SECRET: 'exam-publishing-test-secret-that-is-at-least-32-bytes',
      APP_ORIGIN: 'https://mednexora.example.test',
      MONGODB_URI: 'mongodb+srv://mednexora.example.test/production',
      PRIVATE_STORAGE_DIR: resolve(process.cwd(), 'private-files'),
      DOTENV_CONFIG_PATH: resolve(process.cwd(), '.test-env-does-not-exist'),
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});
