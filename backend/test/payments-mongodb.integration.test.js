import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

const mongoVersion = '8.2.6';
const webhookSecret = 'payment-mongodb-integration-webhook-secret-only';
const keySecret = 'payment-mongodb-integration-key-secret-only';
const resetPepper = 'payment-mongodb-reset-pepper-only-32-bytes';
const registrationPepper = 'payment-mongodb-registration-pepper-only-32-bytes';
process.env.MONGOMS_VERSION = mongoVersion;
process.env.MONGOMS_SYSTEM_BINARY = '';
process.env.MONGOMS_DOWNLOAD_URL = '';
process.env.MONGOMS_MD5_CHECK = 'true';

const { MongoMemoryServer } = await import('mongodb-memory-server');
const [
  { default: OrderSchema },
  { default: PurchasedAccessSchema },
  { default: WebhookEventSchema },
  { default: RefundSchema },
  { default: UserSchema },
  { default: ChallengeSchema },
  { default: OutboxSchema },
  { default: ProductAccessRevocationSchema },
  { createPaymentController },
  { createEmailDeliveryOutbox },
  { ensureProductAccessRevocation },
] = await Promise.all([
  import('../src/models/Order.js'),
  import('../src/models/PurchasedAccess.js'),
  import('../src/models/PaymentWebhookEvent.js'),
  import('../src/models/PaymentRefund.js'),
  import('../src/models/User.js'),
  import('../src/models/RegistrationVerificationChallenge.js'),
  import('../src/models/EmailDeliveryOutbox.js'),
  import('../src/models/ProductAccessRevocation.js'),
  import('../src/controllers/payment.controller.js'),
  import('../src/services/emailDeliveryOutbox.js'),
  import('../src/services/productAccessRevocation.js'),
]);
const { hasVerifiedProductAccess } = await import('../src/services/verifiedProductAccess.js');

let mongoServer;
let connection;
let Order;
let PurchasedAccess;
let WebhookEvent;
let Refund;
let User;
let Challenge;
let Outbox;
let ProductAccessRevocation;
let testDatabaseName;

function assertDisposableUri(uri) {
  const parsed = new URL(uri);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//u, '').replace(/\/$/u, ''));
  if (parsed.protocol !== 'mongodb:' || parsed.hostname !== '127.0.0.1'
    || parsed.username || parsed.password
    || database !== testDatabaseName
    || !/^mednexora_payment_it_[a-f\d]{32}$/u.test(testDatabaseName)) {
    throw new Error('Refusing to connect: payment integration URI is not the disposable local database.');
  }
}

before(async () => {
  testDatabaseName = `mednexora_payment_it_${randomUUID().replaceAll('-', '')}`;
  mongoServer = await MongoMemoryServer.create({
    binary: { version: mongoVersion, checkMD5: true, systemBinary: '' },
    instance: { ip: '127.0.0.1', dbName: testDatabaseName },
  });
  const uri = mongoServer.getUri(testDatabaseName);
  assertDisposableUri(uri);
  connection = await mongoose.createConnection(uri, { autoIndex: true }).asPromise();
  if (connection.name !== testDatabaseName || connection.host !== '127.0.0.1') {
    throw new Error('Refusing to run: payment integration is not using its isolated local MongoDB instance.');
  }
  const buildInfo = await connection.db.admin().command({ buildInfo: 1 });
  assert.equal(buildInfo.version, mongoVersion);
  Order = connection.model('Order', OrderSchema.schema);
  PurchasedAccess = connection.model('PurchasedAccess', PurchasedAccessSchema.schema);
  WebhookEvent = connection.model('PaymentWebhookEvent', WebhookEventSchema.schema);
  Refund = connection.model('PaymentRefund', RefundSchema.schema);
  User = connection.model('User', UserSchema.schema);
  Challenge = connection.model('RegistrationVerificationChallenge', ChallengeSchema.schema);
  Outbox = connection.model('EmailDeliveryOutbox', OutboxSchema.schema);
  ProductAccessRevocation = connection.model('ProductAccessRevocation', ProductAccessRevocationSchema.schema);
  await Promise.all([Order.init(), PurchasedAccess.init(), WebhookEvent.init(), Refund.init(), User.init(), Challenge.init(), Outbox.init(), ProductAccessRevocation.init()]);
});

after(async () => {
  try {
    if (connection) {
      if (!/^mednexora_payment_it_[a-f\d]{32}$/u.test(connection.name) || connection.host !== '127.0.0.1') {
        throw new Error('Refusing cleanup: payment integration database target is not the disposable local database.');
      }
      await connection.dropDatabase();
      await connection.close();
    }
  } finally {
    await mongoServer?.stop();
  }
});

async function resetDatabase() {
  await Promise.all([Order.deleteMany({}), PurchasedAccess.deleteMany({}), WebhookEvent.deleteMany({}), Refund.deleteMany({}), User.deleteMany({}), Challenge.deleteMany({}), Outbox.deleteMany({}), ProductAccessRevocation.deleteMany({})]);
}

function gatewayFor(payment) {
  return {
    async fetchPayment(paymentId) {
      if (!payment || payment.id !== paymentId) throw Object.assign(new Error('not found'), { status: 404 });
      return payment;
    },
  };
}

function modelProxy(model, overrides = {}) {
  return new Proxy(model, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function createWebhookController({ orderModel = Order, accessModel = PurchasedAccess, revocationModel = ProductAccessRevocation, payment } = {}) {
  return createPaymentController({
    OrderModel: orderModel,
    ProductModel: {},
    PurchasedAccessModel: accessModel,
    ProductAccessRevocationModel: revocationModel,
    WebhookEventModel: WebhookEvent,
    RefundModel: Refund,
    gateway: gatewayFor(payment),
    paymentConfig: { keyId: 'rzp_test_public', keySecret, webhookSecret, mode: 'test' },
    paidPurchasesEnabled: false,
  });
}

async function makeOrder() {
  const student = new mongoose.Types.ObjectId();
  const product = new mongoose.Types.ObjectId();
  const amountPaise = 20_900;
  const providerOrderId = `order_test_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const order = await Order.create({
    student,
    items: [{ product, titleSnapshot: 'Integration resource', unitPricePaise: amountPaise, listPricePaise: amountPaise, discountPaise: 0, quantity: 1 }],
    amountPaise,
    currency: 'INR',
    status: 'pending',
    reservationStatus: 'active',
    reservationProductIds: [product],
    paymentProvider: 'razorpay',
    providerOrderId,
    providerOrderStatus: 'ready',
    entitledProductIds: [product],
  });
  return { order, student, product, amountPaise, providerOrderId };
}

function paymentEntity(fixture, idSuffix = 'captured') {
  return {
    id: `pay_test_${idSuffix}`,
    order_id: fixture.providerOrderId,
    amount: fixture.amountPaise,
    currency: 'INR',
    status: 'captured',
    captured: true,
  };
}

async function deliverEvent(controller, eventType, entity, eventId) {
  const event = eventType.startsWith('payment.')
    ? { event: eventType, payload: { payment: { entity } } }
    : { event: eventType, payload: { refund: { entity } } };
  const rawBody = Buffer.from(JSON.stringify(event));
  const headers = {
    'x-razorpay-signature': createHmac('sha256', webhookSecret).update(rawBody).digest('hex'),
    'x-razorpay-event-id': eventId,
  };
  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  try {
    await controller.webhook({
      body: event,
      rawBody,
      get(name) { return headers[name.toLowerCase()]; },
    }, response, (error) => { throw error; });
  } catch {
    response.statusCode = 500;
    response.payload = { message: 'simulated database or webhook processing failure' };
  }
  return response;
}

test('real MongoDB unique entitlement index makes concurrent distinct and duplicate capture events idempotent', async () => {
  await resetDatabase();
  const fixture = await makeOrder();
  const payment = paymentEntity(fixture, 'concurrent_mongo');
  const controller = createWebhookController({ payment });

  const distinct = await Promise.all([
    deliverEvent(controller, 'payment.captured', payment, 'evt_mongo_capture_a'),
    deliverEvent(controller, 'payment.captured', payment, 'evt_mongo_capture_b'),
  ]);
  assert.ok(distinct.every((result) => result.statusCode === 200));
  const duplicate = await Promise.all([
    deliverEvent(controller, 'payment.captured', payment, 'evt_mongo_capture_duplicate'),
    deliverEvent(controller, 'payment.captured', payment, 'evt_mongo_capture_duplicate'),
  ]);
  assert.ok(duplicate.every((result) => result.statusCode === 200));

  const order = await Order.findById(fixture.order._id);
  const entitlements = await PurchasedAccess.find({ order: fixture.order._id, source: 'purchase' });
  const events = await WebhookEvent.find({ provider: 'razorpay' });
  assert.equal(order.status, 'paid');
  assert.equal(order.providerPaymentId, payment.id);
  assert.ok(order.paymentVerifiedAt instanceof Date);
  assert.equal(entitlements.length, 1);
  assert.equal(entitlements[0].status, 'active');
  assert.equal(events.length, 3);
  assert.ok(events.every((event) => event.status === 'processed'));
});

test('real MongoDB capture commit with simulated lost acknowledgement reconciles on retry exactly once', async () => {
  await resetDatabase();
  const fixture = await makeOrder();
  const payment = paymentEntity(fixture, 'lost_ack');
  let loseAck = true;
  const orderModel = modelProxy(Order, {
    findOneAndUpdate: async (...args) => {
      const result = await Order.findOneAndUpdate(...args);
      if (loseAck && args[1]?.$set?.status === 'paid') {
        loseAck = false;
        throw new Error('simulated acknowledgement loss after real MongoDB commit');
      }
      return result;
    },
  });
  const controller = createWebhookController({ orderModel, payment });

  const first = await deliverEvent(controller, 'payment.captured', payment, 'evt_mongo_capture_lost_ack');
  assert.equal(first.statusCode, 500);
  assert.equal((await Order.findById(fixture.order._id)).status, 'paid', 'the real write committed before the injected acknowledgement loss');
  assert.equal(await PurchasedAccess.countDocuments({ order: fixture.order._id }), 0, 'uncertain handling stops before entitlement grant');

  const retry = await deliverEvent(controller, 'payment.captured', payment, 'evt_mongo_capture_lost_ack');
  assert.equal(retry.statusCode, 200);
  assert.equal(await PurchasedAccess.countDocuments({ order: fixture.order._id }), 1);
  assert.equal(await WebhookEvent.countDocuments({ provider: 'razorpay', eventId: 'evt_mongo_capture_lost_ack', status: 'processed' }), 1);
});

test('real MongoDB concurrent full refund and capture never leave active access', async () => {
  await resetDatabase();
  const fixture = await makeOrder();
  const payment = paymentEntity(fixture, 'refund_race');
  let signalAccessCreated;
  let releaseAccessCreation;
  const accessCreated = new Promise((resolve) => { signalAccessCreated = resolve; });
  const holdAccess = new Promise((resolve) => { releaseAccessCreation = resolve; });
  let holdOnce = true;
  const accessModel = modelProxy(PurchasedAccess, {
    create: async (...args) => {
      const created = await PurchasedAccess.create(...args);
      if (holdOnce) {
        holdOnce = false;
        signalAccessCreated();
        await holdAccess;
      }
      return created;
    },
  });
  const controller = createWebhookController({ accessModel, payment });
  const capture = deliverEvent(controller, 'payment.captured', payment, 'evt_mongo_race_capture');
  await accessCreated;
  const refundEntity = {
    id: 'rfnd_test_mongo_race_full',
    payment_id: payment.id,
    amount: fixture.amountPaise,
    currency: 'INR',
    status: 'processed',
  };
  const refund = await deliverEvent(controller, 'refund.processed', refundEntity, 'evt_mongo_race_refund');
  assert.equal(refund.statusCode, 200);
  assert.equal((await Order.findById(fixture.order._id)).status, 'refunded');
  releaseAccessCreation();
  const captureResult = await capture;
  assert.equal(captureResult.statusCode, 200);

  const order = await Order.findById(fixture.order._id);
  const entitlements = await PurchasedAccess.find({ order: fixture.order._id, source: 'purchase' });
  assert.equal(order.status, 'refunded');
  assert.equal(order.reservationStatus, 'released', 'the full refund releases the captured order reservation');
  assert.equal(order.totalRefundedPaise, fixture.amountPaise);
  assert.equal(entitlements.length, 1);
  assert.equal(entitlements[0].status, 'revoked');
});

test('real MongoDB pre-capture full refund releases its reservation and permits a subsequent reservation', async () => {
  await resetDatabase();
  const fixture = await makeOrder();
  const payment = paymentEntity(fixture, 'pre_capture_refund');
  const controller = createWebhookController({ payment });
  const refundEntity = {
    id: 'rfnd_test_mongo_pre_capture_full',
    payment_id: payment.id,
    amount: fixture.amountPaise,
    currency: 'INR',
    status: 'processed',
  };

  const earlyRefund = await deliverEvent(controller, 'refund.processed', refundEntity, 'evt_mongo_pre_capture_refund');
  assert.equal(earlyRefund.statusCode, 200);
  assert.equal((await Order.findById(fixture.order._id)).reservationStatus, 'active', 'an unresolved refund keeps the pending order reservation');
  assert.equal((await Refund.findOne({ providerRefundId: refundEntity.id })).reconciliationStatus, 'awaiting-capture');

  const capture = await deliverEvent(controller, 'payment.captured', payment, 'evt_mongo_capture_after_refund');
  assert.equal(capture.statusCode, 200);
  let order = await Order.findById(fixture.order._id);
  assert.equal(order.status, 'refunded');
  assert.equal(order.reservationStatus, 'released');
  assert.equal(order.totalRefundedPaise, fixture.amountPaise);
  assert.deepEqual(order.appliedRefundIds, [refundEntity.id]);
  assert.equal(await PurchasedAccess.countDocuments({ order: fixture.order._id }), 0, 'a refund reconciled before capture does not grant access');
  assert.equal((await Refund.findOne({ providerRefundId: refundEntity.id })).reconciliationStatus, 'verified');

  // Represent the prior partially repaired state and prove webhook replay
  // repairs the reservation through the real MongoDB conditional update.
  await Order.updateOne({ _id: fixture.order._id, status: 'refunded' }, { $set: { reservationStatus: 'active' } });
  const replay = await deliverEvent(controller, 'refund.processed', refundEntity, 'evt_mongo_pre_capture_refund');
  assert.equal(replay.statusCode, 200);
  order = await Order.findById(fixture.order._id);
  assert.equal(order.reservationStatus, 'released', 'duplicate webhook processing does not reacquire the reservation');
  assert.equal(order.totalRefundedPaise, fixture.amountPaise);
  assert.deepEqual(order.appliedRefundIds, [refundEntity.id]);

  const nextOrder = await Order.create({
    student: fixture.student,
    items: [{
      product: fixture.product,
      titleSnapshot: 'Retry after refunded checkout',
      unitPricePaise: fixture.amountPaise,
      listPricePaise: fixture.amountPaise,
      discountPaise: 0,
      quantity: 1,
    }],
    amountPaise: fixture.amountPaise,
    currency: 'INR',
    status: 'pending',
    reservationStatus: 'active',
    reservationProductIds: [fixture.product],
    paymentProvider: 'razorpay',
    providerOrderId: `order_test_retry_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    providerOrderStatus: 'ready',
    checkoutKey: `retry_${randomUUID().replaceAll('-', '')}`,
    entitledProductIds: [fixture.product],
  });
  assert.equal(nextOrder.reservationStatus, 'active', 'the MongoDB unique reservation index allows the next order after release');
});

test('real MongoDB atomic full-refund reservation release recovers after a committed write loses acknowledgement', async () => {
  await resetDatabase();
  const fixture = await makeOrder();
  const payment = paymentEntity(fixture, 'refund_reservation_lost_ack');
  const captureController = createWebhookController({ payment });
  assert.equal((await deliverEvent(captureController, 'payment.captured', payment, 'evt_mongo_capture_before_reservation_refund')).statusCode, 200);

  // Model a captured order whose reservation release has not yet been recorded.
  // This is the state the combined refund write must resolve atomically.
  const reservationExpiresAt = new Date(Date.now() + 60_000);
  await Order.updateOne({ _id: fixture.order._id, status: 'paid' }, { $set: {
    reservationStatus: 'active',
    reservationExpiresAt,
  } });
  const capturedOrder = await Order.findById(fixture.order._id);
  assert.equal(capturedOrder.status, 'paid');
  assert.equal(capturedOrder.reservationStatus, 'active');
  assert.equal(capturedOrder.providerPaymentId, payment.id);
  assert.ok(capturedOrder.paymentVerifiedAt instanceof Date);
  assert.equal((await PurchasedAccess.findOne({ order: fixture.order._id, product: fixture.product })).status, 'active');

  const refundEntity = {
    id: 'rfnd_test_reservation_lost_ack',
    payment_id: payment.id,
    amount: fixture.amountPaise,
    currency: 'INR',
    status: 'processed',
  };
  let loseAck = true;
  let atomicReleaseCommitted = false;
  const orderModel = modelProxy(Order, {
    findOneAndUpdate: async (...args) => {
      const result = await Order.findOneAndUpdate(...args);
      const update = args[1];
      if (loseAck && update?.$set?.status === 'refunded' && update?.$set?.reservationStatus === 'released') {
        assert.equal(String(args[0]?._id), String(fixture.order._id));
        assert.equal(String(args[0]?.student), String(fixture.student));
        assert.equal(args[0]?.reservationStatus, 'active');
        assert.deepEqual(args[0]?.reservationProductIds?.map(String), [String(fixture.product)]);
        assert.equal(args[2]?.writeConcern?.w, 'majority');
        loseAck = false;
        atomicReleaseCommitted = true;
        throw new Error('simulated acknowledgement loss after atomic refund and reservation commit');
      }
      return result;
    },
  });
  const controller = createWebhookController({ orderModel, payment });

  const first = await deliverEvent(controller, 'refund.processed', refundEntity, 'evt_mongo_refund_reservation_lost_ack');
  assert.equal(first.statusCode, 500);
  assert.equal(atomicReleaseCommitted, true, 'the injected failure occurs only after the real MongoDB write commits');
  let order = await Order.findById(fixture.order._id);
  assert.equal(order.status, 'refunded');
  assert.equal(order.reservationStatus, 'released');
  assert.equal(order.reservationExpiresAt, null);
  assert.equal(order.totalRefundedPaise, fixture.amountPaise);
  assert.deepEqual(order.appliedRefundIds, [refundEntity.id]);
  assert.equal((await PurchasedAccess.findOne({ order: fixture.order._id, product: fixture.product })).status, 'active',
    'the lost acknowledgement stops subsequent cleanup, while authoritative access checks fail closed on refunded order state');
  assert.equal(await hasVerifiedProductAccess({
    PurchasedAccessModel: PurchasedAccess,
    OrderModel: Order,
    ProductAccessRevocationModel: ProductAccessRevocation,
    studentId: fixture.student,
    productId: fixture.product,
  }), false);

  const retry = await deliverEvent(controller, 'refund.processed', refundEntity, 'evt_mongo_refund_reservation_lost_ack');
  assert.equal(retry.statusCode, 200, 'replaying the signed refund event completes reconciliation idempotently');
  order = await Order.findById(fixture.order._id);
  const entitlement = await PurchasedAccess.findOne({ order: fixture.order._id, product: fixture.product });
  assert.equal(order.status, 'refunded');
  assert.equal(order.reservationStatus, 'released');
  assert.equal(order.reservationExpiresAt, null);
  assert.equal(order.totalRefundedPaise, fixture.amountPaise, 'retry does not double-count the refund');
  assert.deepEqual(order.appliedRefundIds, [refundEntity.id], 'retry does not apply the provider refund twice');
  assert.equal(entitlement.status, 'revoked');
  assert.equal(await PurchasedAccess.countDocuments({ order: fixture.order._id, source: 'purchase', status: 'active' }), 0);
  assert.equal(await Refund.countDocuments({ order: fixture.order._id, providerRefundId: refundEntity.id }), 1);
  assert.equal(await WebhookEvent.countDocuments({ provider: 'razorpay', eventId: 'evt_mongo_refund_reservation_lost_ack', status: 'processed' }), 1);
  assert.equal(await hasVerifiedProductAccess({
    PurchasedAccessModel: PurchasedAccess,
    OrderModel: Order,
    ProductAccessRevocationModel: ProductAccessRevocation,
    studentId: fixture.student,
    productId: fixture.product,
  }), false);

  const nextOrder = await Order.create({
    student: fixture.student,
    items: [{
      product: fixture.product,
      titleSnapshot: 'Retry after acknowledged full refund',
      unitPricePaise: fixture.amountPaise,
      listPricePaise: fixture.amountPaise,
      discountPaise: 0,
      quantity: 1,
    }],
    amountPaise: fixture.amountPaise,
    currency: 'INR',
    status: 'pending',
    reservationStatus: 'active',
    reservationProductIds: [fixture.product],
    paymentProvider: 'razorpay',
    providerOrderId: `order_test_retry_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    providerOrderStatus: 'ready',
    checkoutKey: `retry_${randomUUID().replaceAll('-', '')}`,
    entitledProductIds: [fixture.product],
  });
  assert.equal(nextOrder.reservationStatus, 'active', 'the unique active-reservation index permits a new order for the released product');
  assert.equal(String(nextOrder.student), String(fixture.student));
  assert.equal(String(nextOrder.reservationProductIds[0]), String(fixture.product));
});

test('real MongoDB refund commit with simulated lost acknowledgement is retried without duplicate amount or access', async () => {
  await resetDatabase();
  const fixture = await makeOrder();
  const payment = paymentEntity(fixture, 'refund_lost_ack');
  const baseController = createWebhookController({ payment });
  assert.equal((await deliverEvent(baseController, 'payment.captured', payment, 'evt_mongo_capture_before_refund')).statusCode, 200);
  const refundEntity = {
    id: 'rfnd_test_mongo_lost_ack',
    payment_id: payment.id,
    amount: fixture.amountPaise,
    currency: 'INR',
    status: 'processed',
  };
  let loseAck = true;
  const orderModel = modelProxy(Order, {
    findOneAndUpdate: async (...args) => {
      const result = await Order.findOneAndUpdate(...args);
      if (loseAck && args[1]?.$set?.status === 'refunded') {
        loseAck = false;
        throw new Error('simulated acknowledgement loss after real refund commit');
      }
      return result;
    },
  });
  const controller = createWebhookController({ orderModel, payment });

  const first = await deliverEvent(controller, 'refund.processed', refundEntity, 'evt_mongo_refund_lost_ack');
  assert.equal(first.statusCode, 500);
  assert.equal((await Order.findById(fixture.order._id)).totalRefundedPaise, fixture.amountPaise);
  const retry = await deliverEvent(controller, 'refund.processed', refundEntity, 'evt_mongo_refund_lost_ack');
  assert.equal(retry.statusCode, 200);
  const order = await Order.findById(fixture.order._id);
  const entitlement = await PurchasedAccess.findOne({ order: fixture.order._id, source: 'purchase' });
  assert.equal(order.totalRefundedPaise, fixture.amountPaise);
  assert.deepEqual(order.appliedRefundIds, [refundEntity.id]);
  assert.equal(entitlement.status, 'revoked');
  assert.equal(await Refund.countDocuments({ order: fixture.order._id }), 1);
});

test('real MongoDB full-refund revocation failure denies stale access and retries repair only the refunded order', async () => {
  await resetDatabase();
  const fixture = await makeOrder();
  const payment = paymentEntity(fixture, 'refund_revoke_retry');
  const initialController = createWebhookController({ payment });
  assert.equal((await deliverEvent(initialController, 'payment.captured', payment, 'evt_mongo_revoke_capture')).statusCode, 200);

  const independent = await makeOrder();
  const independentOrder = await Order.findByIdAndUpdate(independent.order._id, { $set: {
    student: fixture.student,
    status: 'paid',
    reservationStatus: 'settled',
    paymentVerifiedAt: new Date(),
    providerPaymentId: 'pay_test_independent_valid_order',
  } }, { new: true });
  await PurchasedAccess.create({
    student: fixture.student,
    product: independent.product,
    order: independentOrder._id,
    source: 'purchase',
    status: 'active',
    grantedAt: new Date(),
  });

  let failOnce = true;
  const accessModel = modelProxy(PurchasedAccess, {
    updateMany: async (...args) => {
      if (failOnce && args[0]?.order && args[0]?.status === 'active') {
        failOnce = false;
        throw new Error('simulated access store outage after full refund commit');
      }
      return PurchasedAccess.updateMany(...args);
    },
  });
  const controller = createWebhookController({ accessModel, payment });
  const refundEntity = {
    id: 'rfnd_test_revoke_retry_1',
    payment_id: payment.id,
    amount: fixture.amountPaise,
    currency: 'INR',
    status: 'processed',
  };
  const failed = await deliverEvent(controller, 'refund.processed', refundEntity, 'evt_mongo_revoke_failure');
  assert.equal(failed.statusCode, 500);
  const refundedOrder = await Order.findById(fixture.order._id);
  const staleEntitlement = await PurchasedAccess.findOne({ order: fixture.order._id, product: fixture.product });
  assert.equal(refundedOrder.status, 'refunded');
  assert.equal(staleEntitlement.status, 'active', 'the injected failure is after the order commit but before revocation');
  assert.equal(await hasVerifiedProductAccess({ PurchasedAccessModel: PurchasedAccess, OrderModel: Order, ProductAccessRevocationModel: ProductAccessRevocation, studentId: fixture.student, productId: fixture.product }), false,
    'the real MongoDB order lookup fails closed while its entitlement remains active');
  assert.equal(await hasVerifiedProductAccess({ PurchasedAccessModel: PurchasedAccess, OrderModel: Order, ProductAccessRevocationModel: ProductAccessRevocation, studentId: fixture.student, productId: independent.product }), true,
    'another active entitlement linked to a different valid paid order remains usable');

  const retried = await deliverEvent(controller, 'refund.processed', refundEntity, 'evt_mongo_revoke_retry');
  assert.equal(retried.statusCode, 200);
  assert.equal((await PurchasedAccess.findOne({ order: fixture.order._id, product: fixture.product })).status, 'revoked');
  assert.equal((await PurchasedAccess.findOne({ order: independentOrder._id, product: independent.product })).status, 'active');
  assert.equal((await Order.findById(fixture.order._id)).totalRefundedPaise, fixture.amountPaise);
  assert.equal(await Refund.countDocuments({ order: fixture.order._id }), 1);

  await PurchasedAccess.updateOne({ order: fixture.order._id, product: fixture.product }, { $set: { status: 'active', revokedAt: null } });
  const reply = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await controller.reconcileOrder({ params: { orderId: String(fixture.order._id) }, user: { _id: fixture.student }, body: {} }, reply, (error) => { throw error; });
  assert.equal(reply.statusCode, 200);
  assert.equal((await PurchasedAccess.findOne({ order: fixture.order._id, product: fixture.product })).status, 'revoked',
    'explicit reconciliation repairs access even after a prior webhook completed');
  assert.equal((await PurchasedAccess.findOne({ order: independentOrder._id, product: independent.product })).status, 'active');
});

test('real MongoDB product-level revocation is idempotent and keeps unselected order products accessible', async () => {
  await resetDatabase();
  const student = new mongoose.Types.ObjectId();
  const actor = new mongoose.Types.ObjectId();
  const courseA = new mongoose.Types.ObjectId();
  const courseB = new mongoose.Types.ObjectId();
  const order = await Order.create({
    student,
    items: [
      { product: courseA, titleSnapshot: 'Course A', unitPricePaise: 5000, listPricePaise: 5000, discountPaise: 0, quantity: 1 },
      { product: courseB, titleSnapshot: 'Course B', unitPricePaise: 7000, listPricePaise: 7000, discountPaise: 0, quantity: 1 },
    ],
    amountPaise: 12000,
    currency: 'INR',
    status: 'partially_refunded',
    paymentVerifiedAt: new Date(),
    providerPaymentId: 'pay_test_product_revocation',
    entitledProductIds: [courseA, courseB],
    refundReviewStatus: 'product-specific',
  });
  const accessA = await PurchasedAccess.create({ student, product: courseA, order: order._id, source: 'purchase', status: 'active', grantedAt: new Date() });
  const accessB = await PurchasedAccess.create({ student, product: courseB, order: order._id, source: 'purchase', status: 'active', grantedAt: new Date() });
  const decisions = await Promise.all(Array.from({ length: 5 }, () => ensureProductAccessRevocation({
    Model: ProductAccessRevocation,
    orderId: order._id,
    studentId: student,
    productId: courseA,
    actorId: actor,
    recordedAt: new Date(),
  })));
  assert.equal(decisions.length, 5);
  assert.equal(await ProductAccessRevocation.countDocuments({ order: order._id, product: courseA }), 1,
    'the unique order/product index protects concurrent admin retries');

  const options = { PurchasedAccessModel: PurchasedAccess, OrderModel: Order, ProductAccessRevocationModel: ProductAccessRevocation, studentId: student };
  assert.equal(await hasVerifiedProductAccess({ ...options, productId: courseA }), false);
  assert.equal(await hasVerifiedProductAccess({ ...options, productId: courseB }), true);
  assert.equal(await hasVerifiedProductAccess({ ...options, productId: new mongoose.Types.ObjectId() }), false,
    'a valid order cannot authorize a product outside its entitlement snapshot');

  await PurchasedAccess.updateMany({ _id: accessA._id, status: 'active' }, { $set: { status: 'revoked', revokedAt: new Date() } });
  assert.equal((await PurchasedAccess.findById(accessA._id)).status, 'revoked');
  assert.equal((await PurchasedAccess.findById(accessB._id)).status, 'active');

  await Order.updateOne({ _id: order._id }, { $set: { status: 'refunded' } });
  assert.equal(await hasVerifiedProductAccess({ ...options, productId: courseA }), false);
  assert.equal(await hasVerifiedProductAccess({ ...options, productId: courseB }), false,
    'a full-order refund denies every remaining product even before cleanup completes');
});

test('real MongoDB email outbox data stays encrypted across a worker restart and accepted delivery activates the challenge', async () => {
  await resetDatabase();
  const email = 'outbox-restart@example.test';
  const otp = '908172';
  const user = await User.create({ name: 'Outbox Integration Student', email, passwordHash: 'test-only-hash', role: 'student' });
  const provider = { async send(message) { assert.equal(message.to, email); assert.ok(message.text.includes(otp)); return { sent: true }; } };
  const common = {
    OutboxModel: Outbox, UserModel: User, ChallengeModel: Challenge,
    emailProvider: provider, passwordResetEmailProvider: provider, registrationEmailProvider: provider,
    passwordResetOtpPepper: resetPepper, registrationOtpPepper: registrationPepper,
    passwordResetEmailEnabled: true, registrationEmailVerificationEnabled: false,
  };
  const originalProcess = createEmailDeliveryOutbox(common);
  const now = new Date();
  const job = await originalProcess.enqueue({ type: 'password-reset', payload: { email, otp }, expiresAt: new Date(now.getTime() + 600_000) });
  const rawJob = await Outbox.collection.findOne({ _id: job.id });
  assert.ok(rawJob.payloadCiphertext);
  assert.equal(rawJob.cleanupAt, undefined, 'queued jobs are not eligible for TTL cleanup');
  assert.equal(JSON.stringify(rawJob).includes(email), false);
  assert.equal(JSON.stringify(rawJob).includes(otp), false);
  assert.equal(rawJob.status, 'queued');

  const restartedProcess = createEmailDeliveryOutbox({ ...common, now: () => new Date() });
  await restartedProcess.processDue();
  const updated = await User.findById(user._id).select('+passwordResetOtpHash +passwordResetOtpStatus +passwordResetOtpActivationConfirmed');
  const terminalJob = await Outbox.collection.findOne({ _id: job.id });
  assert.equal(updated.passwordResetOtpStatus, 'active');
  assert.equal(updated.passwordResetOtpActivationConfirmed, true);
  assert.equal(terminalJob.status, 'delivered');
  assert.equal(terminalJob.payloadCiphertext, undefined);
  assert.ok(terminalJob.cleanupAt instanceof Date, 'only terminal jobs receive a delayed cleanup timestamp');
  const outboxIndexes = await Outbox.collection.indexes();
  assert.ok(outboxIndexes.some((index) => index.key.cleanupAt === 1 && index.expireAfterSeconds === 0));
});

test('real MongoDB delivery-job tombstones prevent a stale reset job from recreating a consumed OTP', async () => {
  await resetDatabase();
  const email = 'outbox-consumed@example.test';
  const user = await User.create({ name: 'Consumed Outbox Student', email, passwordHash: 'test-only-hash', role: 'student' });
  let sends = 0;
  const provider = { async send() { sends += 1; return { sent: true }; } };
  const service = createEmailDeliveryOutbox({
    OutboxModel: Outbox,
    UserModel: User,
    ChallengeModel: Challenge,
    emailProvider: provider,
    passwordResetEmailProvider: provider,
    registrationEmailProvider: provider,
    passwordResetOtpPepper: resetPepper,
    passwordResetEmailEnabled: true,
    now: () => new Date(),
  });
  const queuedAt = new Date();
  const job = await service.enqueue({
    type: 'password-reset',
    payload: { email, otp: '861402' },
    expiresAt: new Date(queuedAt.getTime() + 600_000),
  });
  const rawJob = await Outbox.collection.findOne({ _id: job.id });
  await User.updateOne({ _id: user._id }, { $set: {
    passwordResetOtpDeliveryJobId: job.id,
    passwordResetOtpDeliveryJobCreatedAt: rawJob.createdAt,
    passwordResetOtpLastSentAt: new Date(queuedAt.getTime() - 120_000),
    passwordResetOtpResendWindowStartedAt: new Date(queuedAt.getTime() - 3_700_000),
    passwordResetOtpResendCount: 1,
  } });
  await Outbox.updateOne({ _id: job.id }, { $set: { providerAcceptedAt: queuedAt } });

  const restartedWorker = createEmailDeliveryOutbox({
    OutboxModel: Outbox,
    UserModel: User,
    ChallengeModel: Challenge,
    emailProvider: provider,
    passwordResetEmailProvider: provider,
    registrationEmailProvider: provider,
    passwordResetOtpPepper: resetPepper,
    passwordResetEmailEnabled: true,
  });
  await restartedWorker.processDue();
  const state = await User.findById(user._id).select('+passwordResetOtpHash +passwordResetOtpStatus +passwordResetOtpDeliveryJobId');
  const completedJob = await Outbox.collection.findOne({ _id: job.id });
  assert.equal(sends, 0);
  assert.equal(state.passwordResetOtpHash, undefined);
  assert.equal(state.passwordResetOtpStatus, undefined);
  assert.equal(state.passwordResetOtpDeliveryJobId, job.id, 'the consumed-job tombstone remains until a new request supersedes it');
  assert.equal(completedJob.status, 'suppressed');
});

test('real MongoDB outbox lease takeover fences stale workers after a provider send is held beyond expiry', async () => {
  await resetDatabase();
  const email = 'outbox-lease@example.test';
  const user = await User.create({ name: 'Outbox Lease Student', email, passwordHash: 'test-only-hash', role: 'student' });
  let workerTime = new Date();
  let releaseFirstSend;
  let signalFirstSend;
  let releaseSecondSend;
  let signalSecondSend;
  const firstSendStarted = new Promise((resolve) => { signalFirstSend = resolve; });
  const firstSendGate = new Promise((resolve) => { releaseFirstSend = resolve; });
  const secondSendStarted = new Promise((resolve) => { signalSecondSend = resolve; });
  const secondSendGate = new Promise((resolve) => { releaseSecondSend = resolve; });
  let firstSendCount = 0;
  let secondSendCount = 0;
  const firstProvider = {
    async send(message) {
      assert.equal(message.to, email);
      firstSendCount += 1;
      signalFirstSend();
      await firstSendGate;
      return { sent: true };
    },
  };
  const secondProvider = {
    async send(message) {
      assert.equal(message.to, email);
      secondSendCount += 1;
      signalSecondSend();
      await secondSendGate;
      return { sent: true };
    },
  };
  const common = {
    OutboxModel: Outbox,
    UserModel: User,
    ChallengeModel: Challenge,
    passwordResetOtpPepper: resetPepper,
    passwordResetEmailEnabled: true,
    logger: { error() {} },
    now: () => new Date(workerTime),
  };
  const firstWorker = createEmailDeliveryOutbox({ ...common, emailProvider: firstProvider, passwordResetEmailProvider: firstProvider });
  const secondWorker = createEmailDeliveryOutbox({ ...common, emailProvider: secondProvider, passwordResetEmailProvider: secondProvider });
  const expiresAt = new Date(workerTime.getTime() + 10 * 60_000);
  const job = await firstWorker.enqueue({ type: 'password-reset', payload: { email, otp: '694281' }, expiresAt });

  const firstRun = firstWorker.processDue();
  await firstSendStarted;
  const initialClaim = await Outbox.collection.findOne({ _id: job.id });
  assert.equal(initialClaim.status, 'processing');
  assert.equal(initialClaim.attempts, 1);
  const originalToken = initialClaim.lockToken;
  await secondWorker.processDue();
  assert.equal(secondSendCount, 0, 'a competing worker cannot claim a live lease');

  workerTime = new Date(workerTime.getTime() + 60_001);
  const secondRun = secondWorker.processDue();
  await secondSendStarted;
  assert.equal(secondSendCount, 1, 'a second worker can recover the job after the lease expires');
  const takeover = await Outbox.collection.findOne({ _id: job.id });
  assert.equal(takeover.status, 'processing');
  assert.equal(takeover.attempts, 2);
  assert.notEqual(takeover.lockToken, originalToken, 'lease takeover installs a new fencing token');
  releaseSecondSend();
  await secondRun;
  const delivered = await Outbox.collection.findOne({ _id: job.id });
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.attempts, 2);
  assert.equal(delivered.lockToken, undefined);
  assert.equal(delivered.payloadCiphertext, undefined);
  assert.equal(delivered.lockToken, undefined);

  releaseFirstSend();
  await firstRun;
  const afterStaleWorker = await Outbox.collection.findOne({ _id: job.id });
  const activatedUser = await User.findById(user._id).select('+passwordResetOtpStatus +passwordResetOtpActivationConfirmed');
  assert.equal(firstSendCount, 1);
  assert.equal(afterStaleWorker.status, 'delivered', 'the former owner cannot overwrite the new worker result');
  assert.equal(afterStaleWorker.attempts, 2, 'a stale retry cannot alter the newer attempt count');
  assert.equal(activatedUser.passwordResetOtpStatus, 'active');
  assert.equal(activatedUser.passwordResetOtpActivationConfirmed, true);
});
