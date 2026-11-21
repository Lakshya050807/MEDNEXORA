import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeProductAccessRevocationModel, clearFakeProductAccessRevocations } from './helpers/product-access-revocations.js';
import { createHmac } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'payments-test-session-secret-with-at-least-32-bytes';
process.env.APP_ORIGIN = 'http://localhost:5173';

const [{ createApp }, session, bcrypt] = await Promise.all([
  import('../src/app.js'),
  import('express-session'),
  import('bcryptjs'),
]);
const { registrationTestAppOptions, withVerifiedRegistration, resetRegistrationTestModels } = await import('./helpers/registration.js');
const { isVerifiedPurchasedAccess } = await import('../src/services/verifiedProductAccess.js');

const studentOneId = '507f1f77bcf86cd799439201';
const studentTwoId = '507f1f77bcf86cd799439202';
const productId = '507f1f77bcf86cd799439211';
const bundledProductId = '507f1f77bcf86cd799439212';
const overlappingBundleId = '507f1f77bcf86cd799439213';
const examId = '507f1f77bcf86cd799439221';
const subjectId = '507f1f77bcf86cd799439222';
const keySecret = 'razorpay-test-secret-used-only-by-this-test';
const webhookSecret = 'razorpay-test-webhook-secret';
const publishedExam = { _id: examId, name: 'Test Examination', publicationStatus: 'published' };
const publishedSubject = { _id: subjectId, name: 'Test Subject', publicationStatus: 'published' };
const products = [
  { _id: productId, title: 'Original entrance practice notes', resourceType: 'notes', publicationStatus: 'published', pricePaise: 29900, discountPaise: 9000, currentPricePaise: 20900, bundleItems: [], exam: publishedExam, subject: publishedSubject, chapter: null, topic: null, topics: [] },
  { _id: bundledProductId, title: 'Configured preparation bundle', resourceType: 'bundle', publicationStatus: 'published', pricePaise: 50000, discountPaise: 0, currentPricePaise: 50000, bundleItems: [productId], exam: publishedExam, subject: publishedSubject, chapter: null, topic: null, topics: [] },
  { _id: overlappingBundleId, title: 'Another configured preparation bundle', resourceType: 'bundle', publicationStatus: 'published', pricePaise: 60000, discountPaise: 0, currentPricePaise: 60000, bundleItems: [productId], exam: publishedExam, subject: publishedSubject, chapter: null, topic: null, topics: [] },
];

class FakeQuery {
  constructor(value) { this.value = value; this.offset = 0; this.max = Infinity; }
  select() { return this; }
  populate() { return this; }
  sort() { return this; }
  skip(value) { this.offset = value; return this; }
  limit(value) { this.max = value; return this; }
  lean() { return Promise.resolve(Array.isArray(this.value) ? this.value.slice(this.offset, this.offset + this.max) : this.value); }
  then(resolve, reject) { return Promise.resolve(this.value).then(resolve, reject); }
}

let usersByEmail;
let usersById;
let orders;
let accesses;
let webhookEvents;
let refunds;
let payments;
let providerOrderCounter;
let orderCounter;
let gatewayCreateCount;
let entitlementCreateGate;
let entitlementCreateAttempts;
let failNextEntitlementRevocation;
let loseCaptureAcknowledgementAfterCommit;
let loseRefundAcknowledgementAfterCommit;
let server;
let baseUrl;

class FakeUserModel {
  static findOne({ email }) { return { select: () => Promise.resolve(usersByEmail.get(email) ?? null) }; }
  static async exists({ email }) { return usersByEmail.has(email) ? { _id: usersByEmail.get(email)._id } : null; }
  static async create(data) {
    const id = usersByEmail.size ? studentTwoId : studentOneId;
    const user = { ...data, _id: id, id, role: 'student' };
    usersByEmail.set(user.email, user);
    usersById.set(id, user);
    return user;
  }
  static async findById(id) { return usersById.get(String(id)) ?? null; }
}

class FakeProductModel {
  static find(filter = {}) {
    const ids = filter._id?.$in?.map(String);
    return new FakeQuery(products.filter((product) => product.publicationStatus === filter.publicationStatus
      && (!ids || ids.includes(String(product._id)))));
  }
  static findOne(filter = {}) {
    const product = products.find((item) => String(item._id) === String(filter._id)
      && (!filter.publicationStatus || item.publicationStatus === filter.publicationStatus));
    return new FakeQuery(product ?? null);
  }
}

function matchesOrder(order, filter = {}) {
  if (filter._id && String(order._id) !== String(filter._id)) return false;
  if (filter.student && String(order.student) !== String(filter.student)) return false;
  if (filter.checkoutKey && order.checkoutKey !== filter.checkoutKey) return false;
  if (filter.providerOrderId !== undefined && order.providerOrderId !== filter.providerOrderId) return false;
  if (filter.providerPaymentId !== undefined && order.providerPaymentId !== filter.providerPaymentId) return false;
  if (filter.paymentVerifiedAt?.$ne === null && !(order.paymentVerifiedAt instanceof Date)) return false;
  if (filter.appliedRefundIds?.$ne && (order.appliedRefundIds ?? []).includes(filter.appliedRefundIds.$ne)) return false;
  if (filter.reservationStatus && order.reservationStatus !== filter.reservationStatus) return false;
  if (Array.isArray(filter.reservationProductIds)
    && (filter.reservationProductIds.length !== (order.reservationProductIds ?? []).length
      || filter.reservationProductIds.some((id, index) => String(id) !== String(order.reservationProductIds[index])))) return false;
  if (filter.reservationProductIds?.$in && !filter.reservationProductIds.$in.map(String).some((id) => (order.reservationProductIds ?? []).map(String).includes(id))) return false;
  if (filter.reservationExpiresAt?.$lte && !(order.reservationExpiresAt && new Date(order.reservationExpiresAt) <= filter.reservationExpiresAt.$lte)) return false;
  if (typeof filter.status === 'string' && order.status !== filter.status) return false;
  if (Array.isArray(filter.status?.$in) && !filter.status.$in.includes(order.status)) return false;
  if (filter.providerOrderStatus && typeof filter.providerOrderStatus === 'string' && order.providerOrderStatus !== filter.providerOrderStatus) return false;
  if (Array.isArray(filter.providerOrderStatus?.$in) && !filter.providerOrderStatus.$in.includes(order.providerOrderStatus)) return false;
  if (filter.providerOrderCreationStartedAt?.$lt && !(new Date(order.providerOrderCreationStartedAt) < filter.providerOrderCreationStartedAt.$lt)) return false;
  if (filter.$expr && !matchesOrderExpression(order, filter.$expr)) return false;
  if (filter.$or && !filter.$or.some((branch) => matchesOrder(order, branch))) return false;
  return true;
}

function matchesOrderExpression(order, expression) {
  const value = (input) => {
    if (typeof input === 'string' && input.startsWith('$')) return order[input.slice(1)];
    if (input && typeof input === 'object' && '$ifNull' in input) {
      const [field, fallback] = input.$ifNull;
      return value(field) ?? fallback;
    }
    if (input && typeof input === 'object' && '$add' in input) return input.$add.reduce((sum, item) => sum + Number(value(item) ?? 0), 0);
    return input;
  };
  if (expression.$and) return expression.$and.every((item) => matchesOrderExpression(order, item));
  if (expression.$eq) return value(expression.$eq[0]) === value(expression.$eq[1]);
  if (expression.$lte) return value(expression.$lte[0]) <= value(expression.$lte[1]);
  return true;
}

class FakeOrderModel {
  static findOne(filter = {}) { return new FakeQuery([...orders.values()].find((order) => matchesOrder(order, filter)) ?? null); }
  static findById(id) { return new FakeQuery(orders.get(String(id)) ?? null); }
  static find(filter = {}) { return new FakeQuery([...orders.values()].filter((order) => matchesOrder(order, filter))); }
  static async countDocuments(filter = {}) { return [...orders.values()].filter((order) => matchesOrder(order, filter)).length; }
  static async create(data) {
    const duplicateKey = [...orders.values()].some((order) => order.student === data.student && order.checkoutKey === data.checkoutKey);
    const duplicateReservation = [...orders.values()].some((order) => order.student === data.student
      && order.reservationStatus === 'active'
      && (order.reservationProductIds ?? []).some((id) => (data.reservationProductIds ?? []).map(String).includes(String(id))));
    if (duplicateKey || duplicateReservation) {
      const error = new Error('Duplicate checkout key'); error.code = 11000; throw error;
    }
    const id = `507f1f77bcf86cd79943${String(orderCounter++).padStart(4, '0')}`;
    const order = { ...data, _id: id, id, status: data.status ?? 'pending', providerOrderId: '', providerOrderStatus: 'not-created', providerPaymentId: '', paymentVerifiedAt: null, accessGrantedAt: null, totalRefundedPaise: 0, appliedRefundIds: [], refundReviewStatus: 'not-required', createdAt: new Date(), updatedAt: new Date() };
    orders.set(id, order);
    return order;
  }
  static async findOneAndUpdate(filter = {}, update = {}) {
    const order = [...orders.values()].find((item) => matchesOrder(item, filter));
    if (!order) return null;
    Object.assign(order, update.$set ?? {});
    for (const [key, amount] of Object.entries(update.$inc ?? {})) order[key] = Number(order[key] ?? 0) + amount;
    for (const [key, value] of Object.entries(update.$addToSet ?? {})) {
      order[key] ??= [];
      if (!order[key].includes(value)) order[key].push(value);
    }
    order.updatedAt = new Date();
    if (loseCaptureAcknowledgementAfterCommit && update.$set?.status === 'paid') {
      loseCaptureAcknowledgementAfterCommit = false;
      throw new Error('simulated lost acknowledgement after committed capture update');
    }
    if (loseRefundAcknowledgementAfterCommit && update.$set?.status === 'refunded') {
      loseRefundAcknowledgementAfterCommit = false;
      throw new Error('simulated lost acknowledgement after committed refund update');
    }
    return order;
  }
  static async updateOne(filter = {}, update = {}) {
    const order = [...orders.values()].find((item) => matchesOrder(item, filter));
    if (!order) return { matchedCount: 0 };
    Object.assign(order, update.$set ?? {});
    for (const [key, amount] of Object.entries(update.$inc ?? {})) order[key] = Number(order[key] ?? 0) + amount;
    for (const [key, value] of Object.entries(update.$addToSet ?? {})) {
      order[key] ??= [];
      if (!order[key].includes(value)) order[key].push(value);
    }
    return { matchedCount: 1 };
  }
  static async updateMany(filter = {}, update = {}) {
    const matched = [...orders.values()].filter((item) => matchesOrder(item, filter));
    for (const order of matched) Object.assign(order, update.$set ?? {});
    return { matchedCount: matched.length, modifiedCount: matched.length };
  }
}

class FakePurchasedAccessModel {
  static find(filter = {}) {
    const productIds = filter.product?.$in?.map(String) ?? [];
    return new FakeQuery(accesses.filter((item) => String(item.student) === String(filter.student)
      && item.status === filter.status && productIds.includes(String(item.product))));
  }
  static findOne(filter = {}) { return new FakeQuery(accesses.find((item) => String(item.student) === String(filter.student) && String(item.product) === String(filter.product)) ?? null); }
  static async create(data) {
    entitlementCreateAttempts += 1;
    if (accesses.some((item) => String(item.student) === String(data.student) && String(item.product) === String(data.product))) {
      const error = new Error('Duplicate student product access'); error.code = 11000; throw error;
    }
    const item = { ...data, _id: `access-${accesses.length + 1}` };
    accesses.push(item);
    if (entitlementCreateGate) {
      const gate = entitlementCreateGate;
      entitlementCreateGate = null;
      gate.markCreated();
      await gate.result;
    }
    return item;
  }
  static async findOneAndUpdate(filter = {}, update = {}) {
    const item = accesses.find((entry) => String(entry.student) === String(filter.student)
      && String(entry.product) === String(filter.product) && entry.status === filter.status);
    if (!item) return null;
    Object.assign(item, update.$set ?? {});
    return item;
  }
  static async updateMany(filter = {}, update = {}) {
    if (failNextEntitlementRevocation && filter.source === 'purchase' && filter.status === 'active') {
      failNextEntitlementRevocation = false;
      throw new Error('simulated entitlement-store outage during refund revocation');
    }
    const matched = accesses.filter((entry) => (!filter.order || String(entry.order) === String(filter.order))
      && (!filter.student || String(entry.student) === String(filter.student))
      && (!filter.product || String(entry.product) === String(filter.product))
      && (!filter.source || entry.source === filter.source)
      && (!filter.status || entry.status === filter.status));
    for (const entry of matched) Object.assign(entry, update.$set ?? {});
    return { matchedCount: matched.length, modifiedCount: matched.length };
  }
}

class FakeRefundModel {
  static find(filter = {}) {
    const orderIds = filter.order?.$in?.map(String);
    const orderId = filter.order && !filter.order.$in ? String(filter.order) : null;
    const refundIds = filter.providerRefundId?.$in?.map(String);
    return new FakeQuery(refunds.filter((item) => !filter.providerPaymentId || item.providerPaymentId === filter.providerPaymentId)
      .filter((item) => !orderIds || orderIds.includes(String(item.order)))
      .filter((item) => !orderId || String(item.order) === orderId)
      .filter((item) => !refundIds || refundIds.includes(String(item.providerRefundId)))
      .filter((item) => !filter.status || item.status === filter.status)
      .filter((item) => !filter.reconciliationStatus || item.reconciliationStatus === filter.reconciliationStatus));
  }
  static findOne(filter = {}) { return new FakeQuery(refunds.find((item) => item.providerRefundId === filter.providerRefundId) ?? null); }
  static async create(data) {
    const existing = refunds.find((item) => item.providerRefundId === data.providerRefundId);
    if (existing) { const error = new Error('Duplicate refund'); error.code = 11000; throw error; }
    const record = { ...data, _id: `refund-${refunds.length + 1}`, createdAt: new Date() };
    refunds.push(record);
    return record;
  }
  static async findOneAndUpdate(filter = {}, update = {}) {
    const record = refunds.find((item) => item._id === filter._id && (!filter.status || item.status === filter.status));
    if (!record) return null;
    Object.assign(record, update.$set ?? {});
    for (const [key, value] of Object.entries(update.$addToSet ?? {})) {
      record[key] ??= [];
      if (!record[key].includes(value)) record[key].push(value);
    }
    return record;
  }
  static async updateOne(filter = {}, update = {}) {
    const record = refunds.find((item) => item._id === filter._id || item.providerRefundId === filter.providerRefundId);
    if (!record) return { matchedCount: 0 };
    Object.assign(record, update.$set ?? {});
    for (const [key, value] of Object.entries(update.$addToSet ?? {})) {
      record[key] ??= [];
      if (!record[key].includes(value)) record[key].push(value);
    }
    return { matchedCount: 1 };
  }
}

class FakeWebhookEventModel {
  static async findOneAndUpdate(filter, update) {
    let event = webhookEvents.get(filter.eventId);
    if (!event) {
      event = { ...update.$setOnInsert };
      webhookEvents.set(filter.eventId, event);
    }
    return event;
  }
  static async updateOne(filter, update) {
    const event = webhookEvents.get(filter.eventId);
    if (event) Object.assign(event, update.$set ?? {});
    return { matchedCount: event ? 1 : 0 };
  }
  static findOne(filter = {}) { return new FakeQuery(webhookEvents.get(filter.eventId) ?? null); }
}

const paymentGateway = {
  async createOrder({ amount, currency, receipt }) {
    gatewayCreateCount += 1;
    return { id: `order_test_${providerOrderCounter++}`, amount, currency, receipt, status: 'created' };
  },
  async fetchPayment(paymentId) {
    const payment = payments.get(paymentId);
    if (!payment) throw Object.assign(new Error('Payment reference was not found.'), { status: 404 });
    return payment;
  },
  async listOrderPayments(orderId) { return { items: [...payments.values()].filter((payment) => payment.order_id === orderId) }; },
};

const paymentConfig = { keyId: 'rzp_test_public_key', keySecret, webhookSecret, mode: 'test' };

beforeEach(async () => {
  resetRegistrationTestModels();
  clearFakeProductAccessRevocations();
  usersByEmail = new Map();
  usersById = new Map();
  orders = new Map();
  accesses = [];
  webhookEvents = new Map();
  refunds = [];
  payments = new Map();
  providerOrderCounter = 1;
  orderCounter = 1;
  gatewayCreateCount = 0;
  entitlementCreateGate = null;
  entitlementCreateAttempts = 0;
  failNextEntitlementRevocation = false;
  loseCaptureAcknowledgementAfterCommit = false;
  loseRefundAcknowledgementAfterCommit = false;
  server = createApp({
    ...registrationTestAppOptions(),
    sessionStore: new session.MemoryStore(),
    UserModel: FakeUserModel,
    ProductModel: FakeProductModel,
    OrderModel: FakeOrderModel,
    PurchasedAccessModel: FakePurchasedAccessModel,
    ProductAccessRevocationModel: FakeProductAccessRevocationModel,
    WebhookEventModel: FakeWebhookEventModel,
    RefundModel: FakeRefundModel,
    paymentGateway,
    paymentConfig,
    launchConfig: { registrationEnabled: true, paidPurchasesEnabled: true },
  });
  await new Promise((resolve) => { server = server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(path, { method = 'GET', body, rawBody, cookie, headers = {} } = {}) {
  return requestAt(baseUrl, path, { method, body, rawBody, cookie, headers });
}

async function requestAt(url, path, { method = 'GET', body, rawBody, cookie, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined || rawBody !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (cookie) requestHeaders.Cookie = cookie;
  const response = await fetch(`${url}${path}`, { method, headers: requestHeaders, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  const setCookie = response.headers.get('set-cookie');
  return { response, body: payload, cookie: setCookie ? setCookie.split(';')[0] : null };
}

async function registerAndLogin(email = 'student@example.com') {
  const registration = await request('/api/auth/register', { method: 'POST', body: withVerifiedRegistration({ name: 'Nursing Student', email, password: 'entrance-prep-password-55' }) });
  assert.equal(registration.response.status, 201);
  const login = await request('/api/auth/login', { method: 'POST', body: { email, password: 'entrance-prep-password-55' } });
  assert.equal(login.response.status, 200);
  return login.cookie;
}

async function checkout(cookie, product = productId, idempotencyKey = 'checkout_request_01') {
  return request('/api/payments/orders', {
    method: 'POST', cookie,
    body: { idempotencyKey, items: [{ productId: product, quantity: 1, unitPricePaise: 1 }] },
  });
}

function checkoutSignature(orderId, paymentId) {
  return createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
}

test('paid-purchase gate blocks new checkout without blocking launch status or payment verification, reconciliation, and webhooks', async () => {
  const gatedApp = createApp({
    ...registrationTestAppOptions(),
    sessionStore: new session.MemoryStore(),
    UserModel: FakeUserModel,
    ProductModel: FakeProductModel,
    OrderModel: FakeOrderModel,
    PurchasedAccessModel: FakePurchasedAccessModel,
    ProductAccessRevocationModel: FakeProductAccessRevocationModel,
    WebhookEventModel: FakeWebhookEventModel,
    RefundModel: FakeRefundModel,
    paymentGateway,
    paymentConfig,
    launchConfig: { registrationEnabled: true, paidPurchasesEnabled: false },
  });
  const gatedServer = await new Promise((resolve, reject) => {
    const instance = gatedApp.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  const gatedUrl = `http://127.0.0.1:${gatedServer.address().port}`;
  try {
    const status = await requestAt(gatedUrl, '/api/launch/status');
    assert.deepEqual(status.body, { registrationEnabled: true, paidPurchasesEnabled: false });
    assert.equal(status.response.headers.get('cache-control'), 'no-store');

    const registration = await requestAt(gatedUrl, '/api/auth/register', {
      method: 'POST',
      body: withVerifiedRegistration({ name: 'Gate Test Student', email: 'gate-test@example.com', password: 'gate-test-student-password-42' }),
    });
    assert.equal(registration.response.status, 201);
    const login = await requestAt(gatedUrl, '/api/auth/login', {
      method: 'POST',
      body: { email: 'gate-test@example.com', password: 'gate-test-student-password-42' },
    });
    assert.equal(login.response.status, 200);

    const checkoutResponse = await requestAt(gatedUrl, '/api/payments/orders', {
      method: 'POST',
      cookie: login.cookie,
      body: { idempotencyKey: 'closed_gate_checkout', items: [{ productId, quantity: 1 }] },
    });
    assert.equal(checkoutResponse.response.status, 503);
    assert.deepEqual(checkoutResponse.body, {
      code: 'PUBLIC_LAUNCH_GATE_CLOSED',
      message: 'Paid purchases are temporarily unavailable.',
    });
    assert.equal(orders.size, 0);
    assert.equal(gatewayCreateCount, 0);

    const verify = await requestAt(gatedUrl, '/api/payments/orders/507f1f77bcf86cd799439299/verify', {
      method: 'POST', cookie: login.cookie, body: {},
    });
    assert.notEqual(verify.response.status, 503, 'payment verification is not blocked by the new-purchase gate');
    assert.notEqual(verify.body?.code, 'PUBLIC_LAUNCH_GATE_CLOSED');

    const reconcile = await requestAt(gatedUrl, '/api/payments/orders/507f1f77bcf86cd799439299/reconcile', {
      method: 'POST', cookie: login.cookie, body: {},
    });
    assert.notEqual(reconcile.response.status, 503, 'payment reconciliation is not blocked by the new-purchase gate');
    assert.notEqual(reconcile.body?.code, 'PUBLIC_LAUNCH_GATE_CLOSED');

    const invalidWebhook = await requestAt(gatedUrl, '/api/payments/webhook', {
      method: 'POST', rawBody: '{}', headers: { 'X-Razorpay-Signature': '0'.repeat(64) },
    });
    assert.notEqual(invalidWebhook.response.status, 503, 'webhook verification remains available independently of checkout');
    assert.notEqual(invalidWebhook.body?.code, 'PUBLIC_LAUNCH_GATE_CLOSED');
  } finally {
    await new Promise((resolve, reject) => gatedServer.close((error) => error ? reject(error) : resolve()));
  }
});

function webhookSignature(rawBody) {
  return createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
}

async function sendWebhook(event, entity, eventId, signatureOverride) {
  const rawBody = JSON.stringify({ event, payload: { refund: { entity } } });
  return request('/api/payments/webhook', {
    method: 'POST',
    rawBody,
    headers: {
      'X-Razorpay-Signature': signatureOverride ?? webhookSignature(rawBody),
      'X-Razorpay-Event-Id': eventId,
    },
  });
}

async function sendCaptureWebhook(entity, eventId, signatureOverride) {
  const rawBody = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity } } });
  return request('/api/payments/webhook', {
    method: 'POST',
    rawBody,
    headers: {
      'X-Razorpay-Signature': signatureOverride ?? webhookSignature(rawBody),
      'X-Razorpay-Event-Id': eventId,
    },
  });
}

async function captureOrder(cookie, created, paymentId = 'pay_test_refund_capture_1') {
  payments.set(paymentId, {
    id: paymentId,
    order_id: created.body.checkout.providerOrderId,
    amount: created.body.order.amountPaise,
    currency: 'INR',
    status: 'captured',
    captured: true,
  });
  const result = await request(`/api/payments/orders/${created.body.order.id}/verify`, {
    method: 'POST',
    cookie,
    body: {
      razorpay_order_id: created.body.checkout.providerOrderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: checkoutSignature(created.body.checkout.providerOrderId, paymentId),
    },
  });
  assert.equal(result.response.status, 200);
  return { paymentId, order: result.body.order };
}

test('checkout recalculates current database prices and payment verification grants access idempotently', async () => {
  const anonymous = await request('/api/payments/orders', { method: 'POST', body: { idempotencyKey: 'unauthenticated', items: [{ productId, quantity: 1 }] } });
  assert.equal(anonymous.response.status, 401);

  const cookie = await registerAndLogin();
  const created = await checkout(cookie);
  assert.equal(created.response.status, 201);
  assert.equal(created.body.order.amountPaise, 20900, 'the server uses the database list and discount prices, not the client total');
  assert.equal(created.body.order.items[0].unitPricePaise, 20900);
  assert.equal(created.body.checkout.amount, 20900);
  assert.equal(gatewayCreateCount, 1);

  const retried = await checkout(cookie);
  assert.equal(retried.response.status, 200);
  assert.equal(retried.body.checkout.providerOrderId, created.body.checkout.providerOrderId);
  assert.equal(gatewayCreateCount, 1, 'a repeated idempotency key reuses the provider order');

  const paymentId = 'pay_test_success_1';
  payments.set(paymentId, { id: paymentId, order_id: created.body.checkout.providerOrderId, amount: 20900, currency: 'INR', status: 'captured', captured: true });
  const verified = await request(`/api/payments/orders/${created.body.order.id}/verify`, {
    method: 'POST', cookie,
    body: { razorpay_order_id: created.body.checkout.providerOrderId, razorpay_payment_id: paymentId, razorpay_signature: checkoutSignature(created.body.checkout.providerOrderId, paymentId) },
  });
  assert.equal(verified.response.status, 200);
  assert.equal(verified.body.order.status, 'paid');
  assert.ok(verified.body.order.paymentVerifiedAt);
  assert.ok(verified.body.order.accessGrantedAt);
  assert.equal(accesses.length, 1);
  assert.equal(accesses[0].status, 'active');
  assert.equal(accesses[0].source, 'purchase');
  assert.equal(orders.get(created.body.order.id).reservationStatus, 'settled');

  const repeated = await request(`/api/payments/orders/${created.body.order.id}/verify`, {
    method: 'POST', cookie,
    body: { razorpay_order_id: created.body.checkout.providerOrderId, razorpay_payment_id: paymentId, razorpay_signature: checkoutSignature(created.body.checkout.providerOrderId, paymentId) },
  });
  assert.equal(repeated.response.status, 200);
  assert.equal(accesses.length, 1, 'a repeated verified callback does not duplicate purchased access');
  const newCheckout = await checkout(cookie, productId, 'checkout_request_after_purchase');
  assert.equal(newCheckout.response.status, 409, 'a new checkout cannot charge again for already-owned resources');
  const history = await request('/api/payments/orders', { cookie });
  assert.equal(history.response.status, 200);
  assert.equal(history.body.items[0].id, created.body.order.id);
});

test('concurrent tabs with different idempotency keys share one atomic resource reservation', async () => {
  const cookie = await registerAndLogin();
  const [first, second] = await Promise.all([
    checkout(cookie, productId, 'checkout_from_tab_one'),
    checkout(cookie, productId, 'checkout_from_tab_two'),
  ]);
  assert.equal(orders.size, 1, 'the database-backed reservation prevents a second payable order');
  assert.equal(gatewayCreateCount, 1, 'only one Razorpay order is created');
  assert.ok([first.response.status, second.response.status].every((status) => [200, 201, 409].includes(status)));

  const resumed = await checkout(cookie, productId, 'checkout_from_tab_two');
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.body.checkout.providerOrderId, [...orders.values()][0].providerOrderId);
  assert.equal(orders.size, 1);
  assert.equal(gatewayCreateCount, 1);
});

test('a refreshed cart with a new idempotency key resumes the existing payable checkout', async () => {
  const cookie = await registerAndLogin();
  const first = await checkout(cookie, productId, 'before_browser_refresh');
  const refreshed = await checkout(cookie, productId, 'after_browser_refresh');
  assert.equal(first.response.status, 201);
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.body.checkout.providerOrderId, first.body.checkout.providerOrderId);
  assert.equal(orders.size, 1);
  assert.equal(gatewayCreateCount, 1);
});

test('concurrent bundles reserve every nested product including overlapping bundle contents', async () => {
  const cookie = await registerAndLogin();
  const [first, second] = await Promise.all([
    checkout(cookie, bundledProductId, 'bundle_order_one'),
    checkout(cookie, overlappingBundleId, 'bundle_order_two'),
  ]);
  assert.equal(orders.size, 1);
  assert.equal(gatewayCreateCount, 1);
  const successful = [first, second].find((result) => [200, 201].includes(result.response.status));
  assert.ok(successful);
  const persisted = [...orders.values()][0];
  assert.ok(persisted.reservationProductIds.map(String).includes(productId));
});

test('an expired providerless reservation releases cleanly for a new checkout', async () => {
  const cookie = await registerAndLogin();
  const student = usersByEmail.get('student@example.com')._id;
  await FakeOrderModel.create({
    student,
    items: [{ product: productId, titleSnapshot: products[0].title, listPricePaise: 29900, discountPaise: 9000, unitPricePaise: 20900, quantity: 1 }],
    amountPaise: 20900,
    checkoutKey: 'abandoned_unprepared_checkout',
    checkoutCartHash: 'abandoned-hash',
    entitledProductIds: [productId],
    reservationProductIds: [productId],
    reservationStatus: 'active',
    reservationExpiresAt: new Date(Date.now() - 60_000),
    status: 'pending',
  });
  const retried = await checkout(cookie, productId, 'checkout_after_expiry');
  assert.equal(retried.response.status, 201);
  assert.equal(orders.size, 2, 'the expired providerless order is retained for history but no longer blocks a new one');
  const abandoned = [...orders.values()].find((order) => order.checkoutKey === 'abandoned_unprepared_checkout');
  assert.equal(abandoned.reservationStatus, 'released');
  assert.equal(abandoned.status, 'cancelled');
});

test('a local timeout never releases a Razorpay-backed reservation that may still be payable', async () => {
  const cookie = await registerAndLogin();
  const original = await checkout(cookie, productId, 'provider_order_reservation');
  assert.equal(original.response.status, 201);
  const stored = orders.get(original.body.order.id);
  stored.reservationExpiresAt = new Date(Date.now() - 60_000);

  const refreshed = await checkout(cookie, productId, 'provider_order_reservation_after_refresh');
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.body.checkout.providerOrderId, original.body.checkout.providerOrderId);
  assert.equal(stored.reservationStatus, 'active');
  assert.equal(orders.size, 1);
});

test('different students can independently reserve the same product', async () => {
  const firstCookie = await registerAndLogin('first-reservation@example.com');
  const first = await checkout(firstCookie, productId, 'student_one_checkout');
  assert.equal(first.response.status, 201);
  await request('/api/auth/logout', { method: 'POST', cookie: firstCookie });
  const secondCookie = await registerAndLogin('second-reservation@example.com');
  const second = await checkout(secondCookie, productId, 'student_two_checkout');
  assert.equal(second.response.status, 201);
  assert.equal(orders.size, 2);
  assert.equal(gatewayCreateCount, 2);
});

test('invalid checkout signatures and invalid webhook signatures never grant access', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie);
  const invalid = await request(`/api/payments/orders/${created.body.order.id}/verify`, {
    method: 'POST', cookie,
    body: { razorpay_order_id: created.body.checkout.providerOrderId, razorpay_payment_id: 'pay_test_invalid_1', razorpay_signature: '0'.repeat(64) },
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(orders.get(created.body.order.id).status, 'pending');
  assert.equal(accesses.length, 0);

  const webhookBody = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_test_invalid_1', order_id: created.body.checkout.providerOrderId, amount: 20900, currency: 'INR', status: 'captured', captured: true } } } });
  const invalidWebhook = await request('/api/payments/webhook', { method: 'POST', rawBody: webhookBody, headers: { 'X-Razorpay-Signature': '0'.repeat(64), 'X-Razorpay-Event-Id': 'evt_invalid_1' } });
  assert.equal(invalidWebhook.response.status, 400);
  assert.equal(accesses.length, 0);
});

test('failed payments remain unentitled and a delayed captured webhook is idempotently reconciled', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie);
  const failedPaymentId = 'pay_test_failed_1';
  payments.set(failedPaymentId, { id: failedPaymentId, order_id: created.body.checkout.providerOrderId, amount: 20900, currency: 'INR', status: 'failed', captured: false });
  const failure = await request(`/api/payments/orders/${created.body.order.id}/verify`, {
    method: 'POST', cookie,
    body: { razorpay_order_id: created.body.checkout.providerOrderId, razorpay_payment_id: failedPaymentId, razorpay_signature: checkoutSignature(created.body.checkout.providerOrderId, failedPaymentId) },
  });
  assert.equal(failure.response.status, 200);
  assert.equal(failure.body.order.status, 'failed');
  assert.equal(accesses.length, 0);

  const retryAfterFailure = await checkout(cookie, productId, 'checkout_after_failed_attempt');
  assert.equal(retryAfterFailure.response.status, 200);
  assert.equal(retryAfterFailure.body.checkout.providerOrderId, created.body.checkout.providerOrderId);
  assert.equal(orders.size, 1, 'a retry reuses the only still-payable provider order');

  const capturedPaymentId = 'pay_test_late_capture_1';
  const capturedEntity = { id: capturedPaymentId, order_id: created.body.checkout.providerOrderId, amount: 20900, currency: 'INR', status: 'captured', captured: true };
  const rawBody = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: capturedEntity } } });
  const headers = { 'X-Razorpay-Signature': webhookSignature(rawBody), 'X-Razorpay-Event-Id': 'evt_delayed_capture_1' };
  const firstWebhook = await request('/api/payments/webhook', { method: 'POST', rawBody, headers });
  const duplicateWebhook = await request('/api/payments/webhook', { method: 'POST', rawBody, headers });
  assert.equal(firstWebhook.response.status, 200);
  assert.equal(duplicateWebhook.response.status, 200);
  assert.equal(orders.get(created.body.order.id).status, 'paid');
  assert.equal(accesses.length, 1, 'duplicate webhook deliveries do not create duplicate entitlements');
  assert.equal(webhookEvents.get('evt_delayed_capture_1').status, 'processed');
  accesses[0].status = 'revoked';
  const replayAfterRevocation = await request('/api/payments/webhook', { method: 'POST', rawBody, headers });
  assert.equal(replayAfterRevocation.response.status, 200);
  assert.equal(accesses[0].status, 'revoked', 'a replay cannot silently restore a separately revoked entitlement');
  const eventReuse = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_test_late_capture_1', order_id: created.body.checkout.providerOrderId, amount: 20900, currency: 'INR', status: 'failed', captured: false } } } });
  const conflictingReuse = await request('/api/payments/webhook', { method: 'POST', rawBody: eventReuse, headers: { 'X-Razorpay-Signature': webhookSignature(eventReuse), 'X-Razorpay-Event-Id': 'evt_delayed_capture_1' } });
  assert.equal(conflictingReuse.response.status, 409, 'a provider event reference cannot be reused for different signed content');
  assert.equal(orders.get(created.body.order.id).status, 'paid', 'conflicting event reuse cannot downgrade a paid order');
});

test('concurrent capture webhooks with distinct and duplicate event IDs create one entitlement', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie, productId, 'concurrent-capture-webhook');
  const payment = {
    id: 'pay_test_capture_concurrent',
    order_id: created.body.checkout.providerOrderId,
    amount: created.body.order.amountPaise,
    currency: 'INR',
    status: 'captured',
    captured: true,
  };
  payments.set(payment.id, payment);

  const distinct = await Promise.all([
    sendCaptureWebhook(payment, 'evt_capture_concurrent_a'),
    sendCaptureWebhook(payment, 'evt_capture_concurrent_b'),
  ]);
  assert.ok(distinct.every((result) => result.response.status === 200));
  const duplicateEvent = await Promise.all([
    sendCaptureWebhook(payment, 'evt_capture_concurrent_duplicate'),
    sendCaptureWebhook(payment, 'evt_capture_concurrent_duplicate'),
  ]);
  assert.ok(duplicateEvent.every((result) => result.response.status === 200));

  const order = orders.get(created.body.order.id);
  assert.equal(order.status, 'paid');
  assert.equal(order.providerPaymentId, payment.id);
  assert.equal(order.paymentVerifiedAt instanceof Date, true);
  assert.equal(accesses.length, 1, 'the unique student/product entitlement is granted once');
  assert.equal(accesses[0].status, 'active');
  assert.equal(entitlementCreateAttempts, 1, 'the fake database serializes the unique insert operation');
  assert.equal([...webhookEvents.values()].filter((event) => event.status === 'processed').length, 3);
});

test('capture committed with a lost database acknowledgement is safely reconciled on retry', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie, productId, 'capture-lost-ack');
  const payment = {
    id: 'pay_test_capture_lost_ack',
    order_id: created.body.checkout.providerOrderId,
    amount: created.body.order.amountPaise,
    currency: 'INR',
    status: 'captured',
    captured: true,
  };
  payments.set(payment.id, payment);
  loseCaptureAcknowledgementAfterCommit = true;

  const first = await sendCaptureWebhook(payment, 'evt_capture_lost_ack');
  assert.equal(first.response.status, 500, 'the simulated post-commit acknowledgement loss is not treated as success');
  assert.equal(orders.get(created.body.order.id).status, 'paid', 'the database mutation committed before the simulated error');
  assert.equal(accesses.length, 0, 'the uncertain request does not continue to entitlement grants');

  const retry = await sendCaptureWebhook(payment, 'evt_capture_lost_ack');
  assert.equal(retry.response.status, 200);
  assert.equal(orders.get(created.body.order.id).status, 'paid');
  assert.equal(accesses.length, 1);
  assert.equal(accesses[0].status, 'active');
  assert.equal(entitlementCreateAttempts, 1);
});

test('full refund committed with a lost acknowledgement is not double-counted on retry', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie, productId, 'refund-lost-ack');
  const { paymentId } = await captureOrder(cookie, created, 'pay_test_refund_lost_ack');
  loseRefundAcknowledgementAfterCommit = true;
  const refundEntity = {
    id: 'rfnd_test_refund_lost_ack',
    payment_id: paymentId,
    amount: created.body.order.amountPaise,
    currency: 'INR',
    status: 'processed',
  };

  const first = await sendWebhook('refund.processed', refundEntity, 'evt_refund_lost_ack');
  assert.equal(first.response.status, 500, 'the request reports the uncertain post-commit outcome');
  assert.equal(orders.get(created.body.order.id).status, 'refunded');
  assert.equal(orders.get(created.body.order.id).totalRefundedPaise, created.body.order.amountPaise);

  const retry = await sendWebhook('refund.processed', refundEntity, 'evt_refund_lost_ack');
  assert.equal(retry.response.status, 200);
  assert.equal(orders.get(created.body.order.id).totalRefundedPaise, created.body.order.amountPaise);
  assert.deepEqual(orders.get(created.body.order.id).appliedRefundIds, [refundEntity.id]);
  assert.equal(refunds.length, 1);
  assert.equal(accesses.length, 1);
  assert.equal(accesses[0].status, 'revoked');
  assert.equal(entitlementCreateAttempts, 1, 'retry does not repeat entitlement creation');
});

test('a full refund racing capture and entitlement creation leaves no active access', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie, productId, 'capture-refund-race');
  const paymentId = 'pay_test_capture_refund_race';
  const capturedPayment = {
    id: paymentId,
    order_id: created.body.checkout.providerOrderId,
    amount: created.body.order.amountPaise,
    currency: 'INR',
    status: 'captured',
    captured: true,
  };
  payments.set(paymentId, capturedPayment);

  let signalEntitlementCreated;
  let releaseEntitlement;
  const entitlementCreated = new Promise((resolve) => { signalEntitlementCreated = resolve; });
  const entitlementGate = new Promise((resolve) => { releaseEntitlement = resolve; });
  entitlementCreateGate = { markCreated: signalEntitlementCreated, result: entitlementGate };

  const captureRawBody = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: capturedPayment } } });
  const captureRequest = request('/api/payments/webhook', {
    method: 'POST',
    rawBody: captureRawBody,
    headers: { 'X-Razorpay-Signature': webhookSignature(captureRawBody), 'X-Razorpay-Event-Id': 'evt_capture_refund_race' },
  });
  await entitlementCreated;
  assert.equal(accesses[0].status, 'active', 'the test holds capture after a provisional entitlement insert');

  const refund = await sendWebhook('refund.processed', {
    id: 'rfnd_test_capture_refund_race',
    payment_id: paymentId,
    amount: created.body.order.amountPaise,
    currency: 'INR',
    status: 'processed',
  }, 'evt_refund_during_entitlement_grant');
  assert.equal(refund.response.status, 200);
  assert.equal(orders.get(created.body.order.id).status, 'refunded');
  assert.equal(accesses[0].status, 'revoked');

  releaseEntitlement();
  const capture = await captureRequest;
  assert.equal(capture.response.status, 200);
  assert.equal(orders.get(created.body.order.id).status, 'refunded');
  assert.equal(accesses[0].status, 'revoked', 'capture reconciliation rechecks the order and cannot restore access');
  assert.equal(accesses.length, 1, 'concurrent capture does not create a duplicate entitlement');

  const replay = await request('/api/payments/webhook', {
    method: 'POST',
    rawBody: captureRawBody,
    headers: { 'X-Razorpay-Signature': webhookSignature(captureRawBody), 'X-Razorpay-Event-Id': 'evt_capture_refund_race_replay' },
  });
  assert.equal(replay.response.status, 200);
  assert.equal(accesses[0].status, 'revoked');
});

test('orders and purchase verification are isolated to the authenticated student', async () => {
  const firstCookie = await registerAndLogin('first@example.com');
  const created = await checkout(firstCookie);
  await request('/api/auth/logout', { method: 'POST', cookie: firstCookie });
  const secondCookie = await registerAndLogin('second@example.com');
  const order = await request(`/api/payments/orders/${created.body.order.id}`, { cookie: secondCookie });
  assert.equal(order.response.status, 404);
  const verify = await request(`/api/payments/orders/${created.body.order.id}/verify`, { method: 'POST', cookie: secondCookie, body: {} });
  assert.equal(verify.response.status, 404);
  assert.equal(accesses.length, 0);
});

test('bundle purchase snapshots include its published resources', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie, bundledProductId, 'bundle_checkout_request');
  assert.equal(created.response.status, 201);
  const paymentId = 'pay_test_bundle_1';
  payments.set(paymentId, { id: paymentId, order_id: created.body.checkout.providerOrderId, amount: 50000, currency: 'INR', status: 'captured', captured: true });
  const verified = await request(`/api/payments/orders/${created.body.order.id}/verify`, {
    method: 'POST', cookie,
    body: { razorpay_order_id: created.body.checkout.providerOrderId, razorpay_payment_id: paymentId, razorpay_signature: checkoutSignature(created.body.checkout.providerOrderId, paymentId) },
  });
  assert.equal(verified.body.order.status, 'paid');
  assert.deepEqual(new Set(accesses.map((item) => item.product)), new Set([bundledProductId, productId]));
});

test('a verified full refund revokes the purchase entitlement and blocks PDF downloads', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie);
  const { paymentId } = await captureOrder(cookie, created);
  assert.equal(accesses[0].status, 'active');

  const refund = await sendWebhook('refund.processed', {
    id: 'rfnd_test_full_refund_1', payment_id: paymentId, amount: 20900, currency: 'INR', status: 'processed',
  }, 'evt_test_full_refund_1');
  assert.equal(refund.response.status, 200);
  const order = orders.get(created.body.order.id);
  assert.equal(order.status, 'refunded');
  assert.equal(order.totalRefundedPaise, 20900);
  assert.equal(order.refundReviewStatus, 'not-required');
  assert.equal(accesses[0].status, 'revoked');

  const paymentEntity = payments.get(paymentId);
  const captureBody = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: paymentEntity } } });
  const duplicateCapture = await request('/api/payments/webhook', {
    method: 'POST', rawBody: captureBody,
    headers: { 'X-Razorpay-Signature': webhookSignature(captureBody), 'X-Razorpay-Event-Id': 'evt_test_capture_after_full_refund' },
  });
  assert.equal(duplicateCapture.response.status, 200);
  assert.equal(accesses[0].status, 'revoked', 'a later duplicate capture event must not restore refunded access');

  const download = await request(`/api/student/resources/${productId}/download`, { cookie });
  assert.equal(download.response.status, 403);
});

test('full refund remains fail-closed when revocation fails, then webhook retry and reconciliation repair it idempotently', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie);
  const { paymentId } = await captureOrder(cookie, created);
  const originalAccess = accesses[0];
  const otherProduct = '507f1f77bcf86cd799439299';
  const otherOrderId = '507f1f77bcf86cd799439298';
  const studentId = usersByEmail.get('student@example.com')._id;
  orders.set(otherOrderId, {
    _id: otherOrderId,
    student: studentId,
    status: 'paid',
    paymentVerifiedAt: new Date(),
    entitledProductIds: [otherProduct],
    items: [{ product: otherProduct }],
  });
  accesses.push({ student: studentId, product: otherProduct, order: otherOrderId, source: 'purchase', status: 'active' });

  failNextEntitlementRevocation = true;
  const refundEntity = {
    id: 'rfnd_test_revoke_outage_1', payment_id: paymentId,
    amount: created.body.order.amountPaise, currency: 'INR', status: 'processed',
  };
  const failedDelivery = await sendWebhook('refund.processed', refundEntity, 'evt_test_revoke_outage_1');
  assert.equal(failedDelivery.response.status, 500, 'webhook does not claim completion when entitlement repair fails');
  assert.equal(orders.get(created.body.order.id).status, 'refunded', 'the authoritative order state records the full refund first');
  assert.equal(originalAccess.status, 'active', 'the test models a crash/outage after refund commit and before revocation');

  const repairedByWebhook = await sendWebhook('refund.processed', refundEntity, 'evt_test_revoke_outage_retry');
  assert.equal(repairedByWebhook.response.status, 200);
  assert.equal(originalAccess.status, 'revoked');
  assert.equal(orders.get(created.body.order.id).totalRefundedPaise, created.body.order.amountPaise);
  assert.deepEqual(orders.get(created.body.order.id).appliedRefundIds, [refundEntity.id]);
  assert.equal(refunds[0].reconciliationStatus, 'verified');
  assert.equal(accesses[1].status, 'active', 'repair is scoped to the refunded order and preserves another valid entitlement');

  originalAccess.status = 'active';
  originalAccess.revokedAt = null;
  const repairedByReconciliation = await request(`/api/payments/orders/${created.body.order.id}/reconcile`, { method: 'POST', cookie, body: {} });
  assert.equal(repairedByReconciliation.response.status, 200);
  assert.equal(originalAccess.status, 'revoked', 'owner reconciliation repairs an incomplete revocation even when the order is already refunded');
  assert.equal(accesses[1].status, 'active');
});

test('partial refunds accumulate, retain access pending review, and revoke only when total reaches capture', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie);
  const { paymentId } = await captureOrder(cookie, created);
  // Model the short captured-but-not-yet-settled reservation window.
  orders.get(created.body.order.id).reservationStatus = 'active';

  const first = await sendWebhook('refund.processed', {
    id: 'rfnd_test_partial_refund_1', payment_id: paymentId, amount: 5000, currency: 'INR', status: 'processed',
  }, 'evt_test_partial_refund_1');
  assert.equal(first.response.status, 200);
  let order = orders.get(created.body.order.id);
  assert.equal(order.status, 'partially_refunded');
  assert.equal(order.totalRefundedPaise, 5000);
  assert.equal(order.refundReviewStatus, 'pending');
  assert.equal(order.reservationStatus, 'active', 'a partial refund keeps the active reservation intact');
  assert.equal(accesses[0].status, 'active', 'partial refund does not automatically revoke access');

  const second = await sendWebhook('refund.processed', {
    id: 'rfnd_test_partial_refund_2', payment_id: paymentId, amount: 15900, currency: 'INR', status: 'processed',
  }, 'evt_test_partial_refund_2');
  assert.equal(second.response.status, 200);
  order = orders.get(created.body.order.id);
  assert.equal(order.status, 'refunded');
  assert.equal(order.totalRefundedPaise, 20900);
  assert.equal(order.refundReviewStatus, 'not-required');
  assert.equal(order.reservationStatus, 'released', 'a full refund releases the active reservation');
  assert.equal(accesses[0].status, 'revoked');
});

test('capture retry cannot restore a product with a durable product-level access revocation', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie);
  const { paymentId } = await captureOrder(cookie, created);
  const partial = await sendWebhook('refund.processed', {
    id: 'rfnd_test_product_revoke_1', payment_id: paymentId, amount: 1000, currency: 'INR', status: 'processed',
  }, 'evt_test_product_revoke_1');
  assert.equal(partial.response.status, 200);
  const order = orders.get(created.body.order.id);
  const access = accesses.find((entry) => entry.order === order._id);
  order.refundReviewStatus = 'product-specific';
  const actorId = '507f1f77bcf86cd799439088';
  await FakeProductAccessRevocationModel.updateOne(
    { order: order._id, product: access.product },
    { $setOnInsert: {
      order: order._id,
      student: order.student,
      product: access.product,
      actor: actorId,
      source: 'admin-partial-refund-review',
      reason: 'product-access-revoked',
      refund: null,
      recordedAt: new Date(),
    } },
    { upsert: true },
  );
  access.status = 'active';
  access.revokedAt = null;
  order.accessGrantedAt = null;

  const retry = await sendCaptureWebhook({
    id: paymentId,
    order_id: order.providerOrderId,
    amount: order.amountPaise,
    currency: order.currency,
    status: 'captured',
    captured: true,
  }, 'evt_test_capture_after_product_revoke');
  assert.equal(retry.response.status, 200);
  assert.equal(access.status, 'revoked', 'capture reconciliation repairs stale entitlement without regranting it');
  assert.equal(await isVerifiedPurchasedAccess({
    access,
    OrderModel: FakeOrderModel,
    ProductAccessRevocationModel: FakeProductAccessRevocationModel,
    studentId: order.student,
    productId: access.product,
  }), false);
});

test('refund webhook processing is idempotent for duplicate event delivery and distinct event IDs for one refund', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie);
  const { paymentId } = await captureOrder(cookie, created);
  const refundEntity = {
    id: 'rfnd_test_idempotent_1', payment_id: paymentId, amount: 3000, currency: 'INR', status: 'processed',
  };

  const first = await sendWebhook('refund.processed', refundEntity, 'evt_test_idempotent_1');
  const sameDelivery = await sendWebhook('refund.processed', refundEntity, 'evt_test_idempotent_1');
  const providerRedelivery = await sendWebhook('refund.processed', refundEntity, 'evt_test_idempotent_2');
  assert.equal(first.response.status, 200);
  assert.equal(sameDelivery.response.status, 200);
  assert.equal(providerRedelivery.response.status, 200);
  assert.equal(orders.get(created.body.order.id).totalRefundedPaise, 3000);
  assert.deepEqual(orders.get(created.body.order.id).appliedRefundIds, [refundEntity.id]);
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].eventIds.length, 2);
});

test('refunds arriving before payment capture wait for capture and then reconcile without premature access', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie);
  const paymentId = 'pay_test_refund_before_capture';
  payments.set(paymentId, {
    id: paymentId, order_id: created.body.checkout.providerOrderId,
    amount: 20900, currency: 'INR', status: 'captured', captured: true,
  });
  const early = await sendWebhook('refund.processed', {
    id: 'rfnd_test_before_capture_1', payment_id: paymentId, amount: 20900, currency: 'INR', status: 'processed',
  }, 'evt_test_refund_before_capture_1');
  assert.equal(early.response.status, 200);
  assert.equal(orders.get(created.body.order.id).status, 'pending');
  assert.equal(orders.get(created.body.order.id).reservationStatus, 'active', 'an unresolved refund does not release a pending reservation');
  assert.equal(refunds[0].reconciliationStatus, 'awaiting-capture');
  assert.equal(accesses.length, 0, 'refund events never grant entitlements');

  const captureEntity = payments.get(paymentId);
  const rawBody = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: captureEntity } } });
  const captureWebhook = await request('/api/payments/webhook', {
    method: 'POST', rawBody,
    headers: { 'X-Razorpay-Signature': webhookSignature(rawBody), 'X-Razorpay-Event-Id': 'evt_test_capture_after_refund' },
  });
  assert.equal(captureWebhook.response.status, 200);
  assert.equal(orders.get(created.body.order.id).status, 'refunded');
  assert.equal(orders.get(created.body.order.id).reservationStatus, 'released', 'full refund reconciliation atomically releases the captured order reservation');
  assert.equal(accesses.length, 0, 'a full refund reconciled before capture prevents access grant');

  // Simulate a legacy/partially repaired refunded order so replay also proves
  // the idempotent repair path releases a still-active reservation.
  orders.get(created.body.order.id).reservationStatus = 'active';
  const duplicateRefund = await sendWebhook('refund.processed', {
    id: 'rfnd_test_before_capture_1', payment_id: paymentId, amount: 20900, currency: 'INR', status: 'processed',
  }, 'evt_test_refund_after_capture_replay');
  assert.equal(duplicateRefund.response.status, 200);
  assert.equal(orders.get(created.body.order.id).reservationStatus, 'released', 'refund replay does not reacquire the old reservation');
  assert.equal(orders.get(created.body.order.id).totalRefundedPaise, 20900);

  const nextCheckout = await checkout(cookie, productId, 'checkout_after_full_refund');
  assert.equal(nextCheckout.response.status, 201, 'a new order can reserve the product after the full refund');
  assert.equal(orders.get(nextCheckout.body.order.id).reservationStatus, 'active');
});

test('invalid refund signatures, mismatched payment references and amounts are rejected', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie);
  const { paymentId } = await captureOrder(cookie, created);
  const validEntity = {
    id: 'rfnd_test_invalid_signature_1', payment_id: paymentId, amount: 1000, currency: 'INR', status: 'processed',
  };

  const invalidSignature = await sendWebhook('refund.processed', validEntity, 'evt_test_invalid_refund_signature', '0'.repeat(64));
  assert.equal(invalidSignature.response.status, 400);
  assert.equal(orders.get(created.body.order.id).totalRefundedPaise, 0);

  const wrongPaymentId = 'pay_test_other_capture_1';
  payments.set(wrongPaymentId, {
    id: wrongPaymentId, order_id: created.body.checkout.providerOrderId,
    amount: 20900, currency: 'INR', status: 'captured', captured: true,
  });
  const mismatched = await sendWebhook('refund.processed', {
    ...validEntity, id: 'rfnd_test_wrong_payment_1', payment_id: wrongPaymentId,
  }, 'evt_test_wrong_refund_payment');
  assert.equal(mismatched.response.status, 409);
  assert.equal(orders.get(created.body.order.id).totalRefundedPaise, 0);

  const excessive = await sendWebhook('refund.processed', {
    ...validEntity, id: 'rfnd_test_excessive_1', amount: 20901,
  }, 'evt_test_excessive_refund');
  assert.equal(excessive.response.status, 409);
  assert.equal(orders.get(created.body.order.id).totalRefundedPaise, 0);
});

test('failed refunds do not revoke access or increase the verified refunded total', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie);
  const { paymentId } = await captureOrder(cookie, created);
  orders.get(created.body.order.id).reservationStatus = 'active';
  const pending = await sendWebhook('refund.created', {
    id: 'rfnd_test_failed_1', payment_id: paymentId, amount: 20900, currency: 'INR', status: 'pending',
  }, 'evt_test_pending_refund_1');
  assert.equal(pending.response.status, 200);
  assert.equal(orders.get(created.body.order.id).status, 'paid');
  assert.equal(orders.get(created.body.order.id).reservationStatus, 'active', 'a pending refund does not release the active reservation');
  assert.equal(accesses[0].status, 'active');

  const result = await sendWebhook('refund.failed', {
    id: 'rfnd_test_failed_1', payment_id: paymentId, amount: 20900, currency: 'INR', status: 'failed',
  }, 'evt_test_failed_refund_1');
  assert.equal(result.response.status, 200);
  assert.equal(orders.get(created.body.order.id).status, 'paid');
  assert.equal(orders.get(created.body.order.id).reservationStatus, 'active', 'a failed refund does not release the active reservation');
  assert.equal(orders.get(created.body.order.id).totalRefundedPaise, 0);
  assert.equal(refunds[0].reconciliationStatus, 'verified');
  assert.equal(accesses[0].status, 'active');
});

test('cumulative refund attempts cannot exceed the captured amount', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie);
  const { paymentId } = await captureOrder(cookie, created);
  await sendWebhook('refund.processed', {
    id: 'rfnd_test_cap_1', payment_id: paymentId, amount: 12000, currency: 'INR', status: 'processed',
  }, 'evt_test_cap_1');
  const overflow = await sendWebhook('refund.processed', {
    id: 'rfnd_test_cap_2', payment_id: paymentId, amount: 10000, currency: 'INR', status: 'processed',
  }, 'evt_test_cap_2');
  assert.equal(overflow.response.status, 200, 'signed provider events are acknowledged after recording reconciliation status');
  assert.equal(orders.get(created.body.order.id).totalRefundedPaise, 12000);
  assert.equal(orders.get(created.body.order.id).status, 'partially_refunded');
  assert.equal(refunds.find((item) => item.providerRefundId === 'rfnd_test_cap_2').reconciliationStatus, 'rejected');
  assert.ok(orders.get(created.body.order.id).totalRefundedPaise <= orders.get(created.body.order.id).amountPaise);
  assert.equal(accesses[0].status, 'active');
});

test('a rejected excessive refund cannot erase a legacy order-wide access-revocation decision', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie);
  const { paymentId } = await captureOrder(cookie, created);
  await sendWebhook('refund.processed', {
    id: 'rfnd_test_legacy_revoke_partial', payment_id: paymentId, amount: 1000, currency: 'INR', status: 'processed',
  }, 'evt_test_legacy_revoke_partial');
  const order = orders.get(created.body.order.id);
  const access = accesses.find((entry) => entry.order === order._id);
  order.refundReviewStatus = 'revoke-access';

  const excessive = await sendWebhook('refund.processed', {
    id: 'rfnd_test_legacy_revoke_excessive', payment_id: paymentId, amount: order.amountPaise, currency: 'INR', status: 'processed',
  }, 'evt_test_legacy_revoke_excessive');
  assert.equal(excessive.response.status, 200);
  assert.equal(refunds.find((refund) => refund.providerRefundId === 'rfnd_test_legacy_revoke_excessive').reconciliationStatus, 'rejected');
  assert.equal(order.refundReviewStatus, 'revoke-access', 'a rejected money event cannot weaken a previous admin decision');
  assert.equal(await isVerifiedPurchasedAccess({
    access,
    OrderModel: FakeOrderModel,
    ProductAccessRevocationModel: FakeProductAccessRevocationModel,
    studentId: order.student,
    productId: access.product,
  }), false);
});

test('simultaneous distinct partial refunds cannot race the captured-amount ceiling', async () => {
  const cookie = await registerAndLogin();
  const created = await checkout(cookie);
  const { paymentId } = await captureOrder(cookie, created);
  const [first, second] = await Promise.all([
    sendWebhook('refund.processed', {
      id: 'rfnd_test_concurrent_1', payment_id: paymentId, amount: 12000, currency: 'INR', status: 'processed',
    }, 'evt_test_concurrent_refund_1'),
    sendWebhook('refund.processed', {
      id: 'rfnd_test_concurrent_2', payment_id: paymentId, amount: 10000, currency: 'INR', status: 'processed',
    }, 'evt_test_concurrent_refund_2'),
  ]);
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  const order = orders.get(created.body.order.id);
  assert.ok([10000, 12000].includes(order.totalRefundedPaise));
  assert.ok(order.totalRefundedPaise <= order.amountPaise);
  assert.equal(refunds.filter((refund) => refund.reconciliationStatus === 'verified').length, 1);
  assert.equal(refunds.filter((refund) => refund.reconciliationStatus === 'rejected').length, 1);
  assert.equal(accesses[0].status, 'active');
});
