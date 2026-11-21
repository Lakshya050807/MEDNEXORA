import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createVercelConfig,
  PRODUCTION_API_ORIGIN,
  PRODUCTION_SITE_ORIGIN,
  PRODUCTION_VERCEL_PROJECT_ORIGIN,
  CONTENT_SECURITY_POLICY,
  STAGING_API_ORIGIN,
  STAGING_SITE_ORIGIN,
} from '../vercel-config.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const stagingProjectHost = new URL(STAGING_SITE_ORIGIN).host;
const productionProjectHost = new URL(PRODUCTION_VERCEL_PROJECT_ORIGIN).host;

const stagingSettings = {
  deploymentEnv: 'production',
  deploymentTarget: 'staging',
  stagingApiOrigin: STAGING_API_ORIGIN,
  publicSiteUrl: STAGING_SITE_ORIGIN,
  vercelProjectProductionUrl: stagingProjectHost,
};

const productionSettings = {
  deploymentEnv: 'production',
  deploymentTarget: 'production',
  publicSiteUrl: PRODUCTION_SITE_ORIGIN,
  vercelProjectProductionUrl: productionProjectHost,
};

test('staging routes API paths only to the approved Railway staging service', () => {
  const config = createVercelConfig(stagingSettings);
  const [apiRewrite, spaRewrite] = config.rewrites;

  assert.equal(config.installCommand, 'npm ci');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'dist');
  assert.deepEqual(apiRewrite, {
    source: '/api/:path*',
    destination: `${STAGING_API_ORIGIN}/api/:path*`,
  });
  assert.equal(spaRewrite.destination, '/index.html');
  assert.equal(spaRewrite.source, '/((?!api|sitemap\\.xml$|robots\\.txt$).*)');
  assert.equal(config.rewrites.indexOf(apiRewrite) < config.rewrites.indexOf(spaRewrite), true);
  assert.equal(config.headers.find((item) => item.source === '/api/:path*')?.headers[0]?.value, '0');
  assert.equal(apiRewrite.destination.includes('mednexora-production-f06e'), false);
});

test('production remains pinned to its approved backend and ignores staging values', () => {
  const config = createVercelConfig({
    ...productionSettings,
    stagingApiOrigin: STAGING_API_ORIGIN,
  });

  assert.equal(config.rewrites[0].destination, `${PRODUCTION_API_ORIGIN}/api/:path*`);
  assert.equal(config.rewrites[0].destination.includes('mednexora-staging-api-staging'), false);
});

test('staging refuses missing, production, or unapproved API origins', () => {
  for (const stagingApiOrigin of [undefined, PRODUCTION_API_ORIGIN, 'https://other-service.up.railway.app']) {
    assert.throws(() => createVercelConfig({ ...stagingSettings, stagingApiOrigin }));
  }
});

test('staging requires every deployment identity setting', () => {
  for (const missingSetting of ['deploymentEnv', 'deploymentTarget', 'stagingApiOrigin', 'publicSiteUrl', 'vercelProjectProductionUrl']) {
    assert.throws(() => createVercelConfig({ ...stagingSettings, [missingSetting]: undefined }));
  }
});

test('staging refuses production site or production Vercel project identity', () => {
  assert.throws(() => createVercelConfig({
    ...stagingSettings,
    publicSiteUrl: PRODUCTION_SITE_ORIGIN,
  }), /approved staging site origin/u);
  assert.throws(() => createVercelConfig({
    ...stagingSettings,
    vercelProjectProductionUrl: productionProjectHost,
  }), /approved staging Vercel project domain/u);
});

test('production refuses staging project identity, missing target, and preview routing', () => {
  assert.throws(() => createVercelConfig({
    ...productionSettings,
    vercelProjectProductionUrl: stagingProjectHost,
  }), /approved production Vercel project domain/u);
  assert.throws(() => createVercelConfig({
    ...productionSettings,
    deploymentEnv: 'preview',
  }), /production API access is allowed only/u);
  assert.throws(() => createVercelConfig({
    ...productionSettings,
    deploymentTarget: undefined,
  }), /must be explicitly set/u);
});

test('frontend response security headers preserve app and checkout resources without unsafe-eval', () => {
  const config = createVercelConfig(stagingSettings);
  const headers = config.headers.find((item) => item.source === '/(.*)')?.headers ?? [];
  const values = Object.fromEntries(headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(values['content-security-policy'], CONTENT_SECURITY_POLICY);
  assert.match(values['content-security-policy'], /frame-ancestors 'none'/u);
  assert.match(values['content-security-policy'], /script-src 'self' https:\/\/checkout\.razorpay\.com/u);
  assert.match(values['content-security-policy'], /https:\/\/fonts\.googleapis\.com/u);
  assert.match(values['content-security-policy'], /https:\/\/fonts\.gstatic\.com/u);
  assert.match(values['content-security-policy'], /https:\/\/www\.youtube-nocookie\.com/u);
  assert.match(values['content-security-policy'], /https:\/\/player\.vimeo\.com/u);
  assert.match(values['content-security-policy'], /style-src 'self' 'unsafe-inline'/u);
  assert.doesNotMatch(values['content-security-policy'], /unsafe-eval|\*/u);
  assert.equal(values['x-frame-options'], 'DENY');
  assert.equal(values['x-content-type-options'], 'nosniff');
  assert.equal(values['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(values['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
});

test('production canonical origin is the purchased apex domain while Vercel identity remains pinned', () => {
  const config = createVercelConfig(productionSettings);
  assert.equal(PRODUCTION_SITE_ORIGIN, 'https://mednexora.site');
  assert.equal(PRODUCTION_VERCEL_PROJECT_ORIGIN, 'https://mednexora-8ams.vercel.app');
  assert.equal(config.rewrites[0].destination, `${PRODUCTION_API_ORIGIN}/api/:path*`);
  assert.throws(() => createVercelConfig({
    ...productionSettings,
    publicSiteUrl: PRODUCTION_VERCEL_PROJECT_ORIGIN,
  }), /approved production site origin/u);
});

test('the Vercel config module reads staging settings and fails closed on project mismatch', () => {
  const configModule = new URL('../vercel.mjs', import.meta.url).href;
  const stagingProcess = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { config } from ${JSON.stringify(configModule)};
    process.stdout.write(JSON.stringify(config));
  `], {
    encoding: 'utf8',
    env: {
      ...process.env,
      VERCEL_ENV: 'production',
      MEDNEXORA_DEPLOYMENT_TARGET: 'staging',
      MEDNEXORA_STAGING_API_ORIGIN: STAGING_API_ORIGIN,
      PUBLIC_SITE_URL: STAGING_SITE_ORIGIN,
      VERCEL_PROJECT_PRODUCTION_URL: stagingProjectHost,
    },
  });
  assert.equal(stagingProcess.status, 0, stagingProcess.stderr);
  assert.equal(JSON.parse(stagingProcess.stdout).rewrites[0].destination, `${STAGING_API_ORIGIN}/api/:path*`);

  const mismatchedProjectProcess = spawnSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(configModule)};`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      VERCEL_ENV: 'production',
      MEDNEXORA_DEPLOYMENT_TARGET: 'staging',
      MEDNEXORA_STAGING_API_ORIGIN: STAGING_API_ORIGIN,
      PUBLIC_SITE_URL: STAGING_SITE_ORIGIN,
      VERCEL_PROJECT_PRODUCTION_URL: productionProjectHost,
    },
  });
  assert.notEqual(mismatchedProjectProcess.status, 0);
});

test('only the dynamic Vercel config is active and the prior JSON is preserved as an inert reference', async () => {
  await access(join(testDirectory, '../vercel.mjs'));
  await access(join(testDirectory, '../vercel-config.mjs'));
  await access(join(testDirectory, '../vercel.static-reference.json'));
  for (const configFile of ['vercel.json', 'vercel.ts', 'vercel.js', 'vercel.cjs', 'vercel.mts', 'vercel.toml']) {
    await assert.rejects(access(join(testDirectory, '..', configFile)));
  }

  const legacyConfig = JSON.parse(await readFile(join(testDirectory, '../vercel.static-reference.json'), 'utf8'));
  assert.equal(legacyConfig.rewrites[0].source, '/api/:path*');
  assert.equal(legacyConfig.rewrites[0].destination, `${PRODUCTION_API_ORIGIN}/api/:path*`);
});
