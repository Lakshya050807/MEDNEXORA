import { randomUUID } from 'node:crypto';
import { assertPrivateStorageMount as assertPrivateStorageMountDefault } from './services/privateStorageMount.js';

function waitForListening(server) {
  if (server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanupListeners = () => {
      server.removeListener('listening', onListening);
      server.removeListener('error', onError);
    };
    const onListening = () => {
      cleanupListeners();
      resolve();
    };
    const onError = (error) => {
      cleanupListeners();
      reject(error);
    };

    server.once('listening', onListening);
    server.once('error', onError);
    if (server.listening) onListening();
  });
}

function waitForSessionStore(sessionStore) {
  if (typeof sessionStore?.get !== 'function') {
    throw new TypeError('The session store does not expose its required get operation.');
  }

  // Connect-Mongo's public Store#get waits for its collection promise, which
  // includes native TTL-index initialization. A random absent SID makes this
  // a read-only readiness probe without relying on its internal collectionP.
  return new Promise((resolve, reject) => {
    sessionStore.get(`startup-readiness-${randomUUID()}`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function bestEffort(operation) {
  try {
    await operation?.();
  } catch {
    // Preserve the original startup error while still attempting every cleanup.
  }
}

function closeHttpServer(server) {
  if (!server || typeof server.close !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

export async function startApiServer({
  mongooseClient,
  envConfig,
  MongoStoreFactory,
  createApp,
  ExamModel,
  OrderModel,
  models,
  ensurePrimaryExamIndex,
  ensurePurchaseReservationBackfill,
  assertPrivateStorageMount = assertPrivateStorageMountDefault,
  onListening,
}) {
  let sessionStore;
  let serverApp;
  let server;
  let outboxStartAttempted = false;
  let outboxStopAttempted = false;
  let removePostListenHandlers;

  const cleanupAfterStartupFailure = async () => {
    await bestEffort(() => removePostListenHandlers?.());
    if (outboxStartAttempted && !outboxStopAttempted) {
      // Stop the worker before waiting for existing HTTP connections to close.
      // Mark the attempt first so cleanup can never invoke stop more than once.
      outboxStopAttempted = true;
      await bestEffort(() => serverApp?.locals?.emailOutbox?.stop?.());
    }
    await closeHttpServer(server);
    await bestEffort(() => sessionStore?.close?.());
    await bestEffort(() => mongooseClient.disconnect());
  };

  try {
    await assertPrivateStorageMount({ nodeEnv: envConfig.nodeEnv, directory: envConfig.privateStorageDir });
    await mongooseClient.connect(envConfig.mongoUri);
    await ensurePrimaryExamIndex(ExamModel);
    await ensurePurchaseReservationBackfill(OrderModel);

    // Wait for all initializers to settle before disconnecting on a failure;
    // Model.init() may create collections and indexes as part of this step.
    const initResults = await Promise.allSettled(
      models.map((model) => Promise.resolve().then(() => model.init())),
    );
    const failedInit = initResults.find((result) => result.status === 'rejected');
    if (failedInit) throw failedInit.reason;

    sessionStore = MongoStoreFactory.create({
      client: mongooseClient.connection.getClient(),
      dbName: mongooseClient.connection.name,
      collectionName: 'sessions',
      ttl: Math.ceil(envConfig.sessionMaxAgeMs / 1000),
      autoRemove: 'native',
    });
    await waitForSessionStore(sessionStore);

    serverApp = createApp({ sessionStore });
    server = serverApp.listen(envConfig.port);
    await waitForListening(server);
    if (typeof onListening === 'function') {
      const removeHandlers = await onListening({ server, serverApp, sessionStore });
      if (typeof removeHandlers === 'function') removePostListenHandlers = removeHandlers;
    }

    const emailOutbox = serverApp.locals?.emailOutbox;
    if (typeof emailOutbox?.start !== 'function' || typeof emailOutbox?.stop !== 'function') {
      throw new Error('The email delivery worker lifecycle is unavailable.');
    }
    // Set this before calling start: it may partially schedule work and then
    // throw/reject, in which case cleanup must still stop it.
    outboxStartAttempted = true;
    await emailOutbox.start();

    return { server, serverApp, sessionStore };
  } catch (error) {
    await cleanupAfterStartupFailure();
    throw error;
  }
}
