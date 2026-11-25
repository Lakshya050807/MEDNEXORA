import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDir = resolve(frontendDir, '..');
const backendDir = join(repositoryDir, 'backend');
const testResultsDir = join(frontendDir, 'test-results', 'e2e');
const adminUsername = 'e2e-admin';
const adminEmail = 'e2e-admin@example.test';
const adminPassword = 'E2E-Only-Admin-Password-2026!';
const studentPassword = 'E2E-Only-Student-Password-2026!';

function safeChildEnvironment(overrides) {
  const environment = {};
  for (const name of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'ComSpec', 'COMSPEC', 'PATHEXT']) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return { ...environment, ...overrides };
}

function redactLog(value) {
  return String(value)
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/giu, '[REDACTED_MONGODB_URI]')
    .replace(/(SESSION_SECRET|RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET)=\S+/giu, '$1=[REDACTED]');
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const { port } = server.address();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

function startChild(command, args, { cwd, env, logFile }) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const streams = [child.stdout, child.stderr];
  for (const stream of streams) {
    stream?.on('data', (chunk) => {
      const value = redactLog(chunk.toString());
      void import('node:fs/promises').then(({ appendFile }) => appendFile(logFile, value).catch(() => {}));
    });
  }
  return child;
}

function waitForExit(child) {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null) return resolveExit(child.exitCode);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([waitForExit(child).then(() => true), new Promise((resolveWait) => setTimeout(() => resolveWait(false), 3000))]);
  if (!exited && process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    await waitForExit(killer);
  } else if (!exited) child.kill('SIGKILL');
}

async function waitForHttp(child, url, label, logFile) {
  const deadline = Date.now() + 90_000;
  let lastStatus = 'no response';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const log = await import('node:fs/promises').then(({ readFile }) => readFile(logFile, 'utf8').catch(() => ''));
      throw new Error(`${label} exited before becoming ready (code ${child.exitCode}).\n${log.slice(-5000)}`);
    }
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2500) });
      if (response.ok) return;
      lastStatus = `HTTP ${response.status}`;
    } catch (error) { lastStatus = error.message; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  const log = await import('node:fs/promises').then(({ readFile }) => readFile(logFile, 'utf8').catch(() => ''));
  throw new Error(`${label} was not ready within 90 seconds (${lastStatus}).\n${log.slice(-5000)}`);
}

async function run() {
  await rm(testResultsDir, { recursive: true, force: true });
  await mkdir(testResultsDir, { recursive: true });
  const tempRoot = await mkdtemp(join(tmpdir(), 'mednexora-e2e-'));
  const emptyEnvDir = join(tempRoot, 'empty-env');
  const privateStorageDir = join(tempRoot, 'private-files');
  await mkdir(emptyEnvDir, { recursive: true });
  await mkdir(privateStorageDir, { recursive: true });
  const mongoLog = join(testResultsDir, 'mongodb.log');
  const backendLog = join(testResultsDir, 'backend.log');
  const frontendLog = join(testResultsDir, 'vite.log');
  await Promise.all([mongoLog, backendLog, frontendLog].map((file) => writeFile(file, '')));

  let mongo;
  let backend;
  let frontend;
  let exitCode = 1;
  try {
    mongo = await MongoMemoryServer.create({
      instance: { ip: '127.0.0.1', dbName: 'mednexora_e2e' },
      autoStart: true,
    });
    const mongoUri = mongo.getUri('mednexora_e2e');
    const parsedMongoUri = new URL(mongoUri);
    if (parsedMongoUri.hostname !== '127.0.0.1' || parsedMongoUri.pathname !== '/mednexora_e2e'
      || parsedMongoUri.username || parsedMongoUri.password || parsedMongoUri.search) {
      throw new Error('Refusing to start E2E: MongoDB did not provide a local disposable database URI.');
    }

    const backendPort = await freePort();
    const frontendPort = await freePort();
    const appOrigin = `http://127.0.0.1:${frontendPort}`;
    const backendOrigin = `http://127.0.0.1:${backendPort}`;
    const missingDotenvFile = join(tempRoot, 'no-local-env-file');
    const childCommon = {
      NODE_ENV: 'test',
      APP_ENV: 'test',
      E2E_RUN: '1',
      MONGODB_URI: mongoUri,
      E2E_MONGODB_URI: mongoUri,
      DOTENV_CONFIG_PATH: missingDotenvFile,
      SESSION_SECRET: 'mednexora-e2e-only-session-secret-32-bytes-minimum',
      SESSION_MAX_AGE_DAYS: '1',
      APP_ORIGIN: appOrigin,
      TRUST_PROXY: 'false',
      RAZORPAY_MODE: 'test',
      PUBLIC_BETA_REGISTRATION_ENABLED: 'true',
      PUBLIC_BETA_PAID_PURCHASES_ENABLED: 'false',
      PRIVATE_STORAGE_DIR: privateStorageDir,
      PORT: String(backendPort),
      E2E_ADMIN_USERNAME: adminUsername,
      E2E_ADMIN_EMAIL: adminEmail,
      E2E_ADMIN_PASSWORD: adminPassword,
      E2E_STUDENT_PASSWORD: studentPassword,
      E2E_BASE_URL: appOrigin,
    };
    const backendEnv = safeChildEnvironment(childCommon);
    const seed = spawn(process.execPath, ['scripts/seed-e2e-admin.js'], {
      cwd: backendDir,
      env: backendEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    for (const stream of [seed.stdout, seed.stderr]) stream?.on('data', (chunk) => {
      void import('node:fs/promises').then(({ appendFile }) => appendFile(backendLog, redactLog(chunk.toString())).catch(() => {}));
    });
    const seedExit = await waitForExit(seed);
    if (seedExit !== 0) throw new Error(`Could not create isolated E2E administrator (exit ${seedExit}).`);

    backend = startChild(process.execPath, ['src/server.js'], { cwd: backendDir, env: backendEnv, logFile: backendLog });
    await waitForHttp(backend, `${backendOrigin}/api/health`, 'Backend', backendLog);

    const frontendEnv = safeChildEnvironment({
      NODE_ENV: 'development',
      E2E_ENV_DIR: emptyEnvDir,
      API_PROXY_TARGET: backendOrigin,
      E2E_BASE_URL: appOrigin,
      E2E_ADMIN_USERNAME: adminUsername,
      E2E_ADMIN_PASSWORD: adminPassword,
      E2E_STUDENT_PASSWORD: studentPassword,
    });
    frontend = startChild(process.execPath, [join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], {
      cwd: frontendDir,
      env: frontendEnv,
      logFile: frontendLog,
    });
    await waitForHttp(frontend, `${appOrigin}/`, 'Vite frontend', frontendLog);

    const playwrightCli = join(frontendDir, 'node_modules', '@playwright', 'test', 'cli.js');
    const tests = startChild(process.execPath, [playwrightCli, 'test', '--config=playwright.config.js'], {
      cwd: frontendDir,
      env: safeChildEnvironment({
        NODE_ENV: 'test',
        E2E_RUN: '1',
        E2E_BASE_URL: appOrigin,
        E2E_ADMIN_USERNAME: adminUsername,
        E2E_ADMIN_PASSWORD: adminPassword,
        E2E_STUDENT_PASSWORD: studentPassword,
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? '0',
      }),
      logFile: join(testResultsDir, 'playwright.log'),
    });
    const logWriter = async (stream) => stream?.on('data', (chunk) => {
      const value = redactLog(chunk.toString());
      process.stdout.write(value);
    });
    await Promise.all([logWriter(tests.stdout), logWriter(tests.stderr)]);
    exitCode = await waitForExit(tests);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    exitCode = 1;
  } finally {
    await Promise.all([stopChild(frontend), stopChild(backend)]);
    if (mongo) await mongo.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
  process.exitCode = exitCode;
}

run();
