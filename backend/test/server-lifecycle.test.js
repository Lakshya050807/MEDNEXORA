import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startApiServer } from '../src/server-lifecycle.js';

function createHarness({
  listenError,
  readinessError,
  initError,
  workerStartError,
  workerStopBehavior,
  delayServerClose = false,
  onListening,
} = {}) {
  const events = [];
  const server = new EventEmitter();
  server.listening = false;
  let delayedCloseCallback;
  const completeServerClose = () => {
    const callback = delayedCloseCallback;
    delayedCloseCallback = undefined;
    callback?.();
  };
  server.close = (callback) => {
    events.push('server-close-start');
    server.listening = false;
    const completeClose = () => {
      events.push('server-close-complete');
      callback?.();
    };
    if (delayServerClose) delayedCloseCallback = completeClose;
    else queueMicrotask(completeClose);
    return server;
  };

  const store = {
    get(sid, callback) {
      assert.match(sid, /^startup-readiness-/u);
      events.push('session-store-ready');
      callback(readinessError ?? null, null);
    },
    async close() { events.push('session-store-close'); },
  };
  const emailOutbox = {
    async start() {
      events.push('worker-start');
      if (workerStartError) throw workerStartError;
    },
    stop() {
      events.push('worker-stop');
      if (workerStopBehavior === 'throw') throw new Error('simulated worker stop throw');
      if (workerStopBehavior === 'reject') return Promise.reject(new Error('simulated worker stop rejection'));
    },
  };
  const mongooseClient = {
    connection: {
      name: 'mednexora_lifecycle_test',
      getClient() { return {}; },
    },
    async connect(uri) { events.push(`db-connect:${uri}`); },
    async disconnect() { events.push('db-disconnect'); },
  };
  const models = Array.from({ length: 2 }, (_, index) => ({
    async init() {
      events.push(`model-init-${index}`);
      if (index === 1 && initError) throw initError;
    },
  }));
  const createApp = () => ({
    locals: { emailOutbox },
    listen(port) {
      events.push(`listen:${port}`);
      process.nextTick(() => {
        if (listenError) {
          events.push('listen-error');
          server.emit('error', listenError);
        } else {
          server.listening = true;
          events.push('listening');
          server.emit('listening');
        }
      });
      return server;
    },
  });
  const mongoStoreFactory = {
    create(options) {
      assert.equal(options.collectionName, 'sessions');
      assert.equal(options.autoRemove, 'native');
      events.push('session-store-create');
      return store;
    },
  };

  const start = () => startApiServer({
    mongooseClient,
    envConfig: { mongoUri: 'mongodb://test-only', sessionMaxAgeMs: 60_000, port: 8080 },
    MongoStoreFactory: mongoStoreFactory,
    createApp,
    ExamModel: { id: 'Exam' },
    OrderModel: { id: 'Order' },
    models,
    async ensurePrimaryExamIndex() { events.push('primary-index-check'); },
    async ensurePurchaseReservationBackfill() { events.push('reservation-check'); },
    onListening: onListening ?? (() => {
      events.push('post-listen-setup');
      return () => events.push('post-listen-cleanup');
    }),
  });

  return { events, server, store, start, completeServerClose };
}

test('worker starts only after the HTTP server emits listening and normal startup completes', async () => {
  const { events, server, start } = createHarness();
  const runtime = await start();

  assert.equal(runtime.server, server);
  assert.ok(events.indexOf('session-store-ready') < events.indexOf('listen:8080'));
  assert.ok(events.indexOf('listening') < events.indexOf('post-listen-setup'));
  assert.ok(events.indexOf('post-listen-setup') < events.indexOf('worker-start'));
  assert.equal(events.includes('db-disconnect'), false);
  server.close(() => {});
});

test('a server startup error prevents worker start and closes initialized resources', async () => {
  const failure = Object.assign(new Error('simulated listen failure'), { code: 'EADDRINUSE' });
  const { events, start } = createHarness({ listenError: failure });

  await assert.rejects(start(), (error) => error === failure);
  assert.equal(events.includes('worker-start'), false);
  assert.ok(events.includes('server-close-start'));
  assert.ok(events.includes('session-store-close'));
  assert.ok(events.includes('db-disconnect'));
});

test('session-store readiness failure closes the store and database before listening', async () => {
  const failure = new Error('simulated session-store readiness failure');
  const { events, start } = createHarness({ readinessError: failure });

  await assert.rejects(start(), (error) => error === failure);
  assert.equal(events.some((event) => event.startsWith('listen:')), false);
  assert.equal(events.includes('worker-start'), false);
  assert.ok(events.includes('session-store-close'));
  assert.ok(events.includes('db-disconnect'));
});

test('model initialization failure waits for initializers then disconnects without creating the worker', async () => {
  const failure = new Error('simulated model index initialization failure');
  const { events, start } = createHarness({ initError: failure });

  await assert.rejects(start(), (error) => error === failure);
  assert.ok(events.includes('model-init-0'));
  assert.ok(events.includes('model-init-1'));
  assert.equal(events.includes('session-store-create'), false);
  assert.equal(events.includes('worker-start'), false);
  assert.ok(events.includes('db-disconnect'));
});

test('worker is stopped and all resources close if a post-listen worker startup step fails', async () => {
  const failure = new Error('simulated partial worker startup failure');
  const { events, start } = createHarness({ workerStartError: failure });

  await assert.rejects(start(), (error) => error === failure);
  assert.ok(events.indexOf('listening') < events.indexOf('worker-start'));
  assert.ok(events.indexOf('worker-start') < events.indexOf('worker-stop'));
  assert.ok(events.includes('server-close-start'));
  assert.ok(events.includes('session-store-close'));
  assert.ok(events.includes('db-disconnect'));
  assert.ok(events.includes('post-listen-cleanup'));
  assert.equal(events.filter((event) => event === 'worker-stop').length, 1);
});

test('startup failure stops the worker before a delayed HTTP close callback completes', async () => {
  const failure = new Error('simulated partial worker startup failure');
  const { events, start, completeServerClose } = createHarness({
    workerStartError: failure,
    delayServerClose: true,
  });

  const startup = start();
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(events.indexOf('worker-stop') < events.indexOf('server-close-start'));
  assert.equal(events.includes('server-close-complete'), false);
  assert.equal(events.filter((event) => event === 'worker-stop').length, 1);

  completeServerClose();
  await assert.rejects(startup, (error) => error === failure);
  assert.ok(events.indexOf('server-close-complete') < events.indexOf('session-store-close'));
  assert.ok(events.includes('db-disconnect'));
});

for (const workerStopBehavior of ['throw', 'reject']) {
  test(`startup cleanup continues when worker stop ${workerStopBehavior}s`, async () => {
    const failure = new Error('simulated partial worker startup failure');
    const { events, start } = createHarness({ workerStartError: failure, workerStopBehavior });

    await assert.rejects(start(), (error) => error === failure);
    assert.equal(events.filter((event) => event === 'worker-stop').length, 1);
    assert.ok(events.includes('server-close-start'));
    assert.ok(events.includes('server-close-complete'));
    assert.ok(events.includes('session-store-close'));
    assert.ok(events.includes('db-disconnect'));
  });
}

test('a post-listen setup failure cleans the listener and initialized resources without starting the worker', async () => {
  const failure = new Error('simulated post-listen setup failure');
  const { events, start } = createHarness({ onListening() { throw failure; } });

  await assert.rejects(start(), (error) => error === failure);
  assert.ok(events.indexOf('listening') < events.indexOf('server-close-start'));
  assert.equal(events.includes('worker-start'), false);
  assert.ok(events.includes('session-store-close'));
  assert.ok(events.includes('db-disconnect'));
});
