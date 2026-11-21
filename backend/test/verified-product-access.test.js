import test from 'node:test';
import assert from 'node:assert/strict';
import { hasVerifiedProductAccess, isVerifiedPurchasedAccess } from '../src/services/verifiedProductAccess.js';

const studentId = '507f1f77bcf86cd799439001';
const orderId = '507f1f77bcf86cd799439002';
const otherOrderId = '507f1f77bcf86cd799439099';
const courseA = '507f1f77bcf86cd799439003';
const courseB = '507f1f77bcf86cd799439004';

function order(overrides = {}) {
  return {
    _id: orderId,
    student: studentId,
    status: 'partially_refunded',
    paymentVerifiedAt: new Date(),
    entitledProductIds: [courseA, courseB],
    items: [{ product: courseA }, { product: courseB }],
    refundReviewStatus: 'product-specific',
    ...overrides,
  };
}

function access(productId, overrides = {}) {
  return { student: studentId, product: productId, order: orderId, source: 'purchase', status: 'active', ...overrides };
}

function makeOrderModel(record) {
  return { findOne: async () => record };
}

function makeAccessModel(record) {
  return { findOne: async () => record };
}

function makeRevocationModel(rows = []) {
  return { findOne: async (filter) => rows.find((row) => String(row.order) === String(filter.order) && String(row.product) === String(filter.product)) ?? null };
}

test('product-specific revocation denies Course A while an unselected Course B remains accessible', async () => {
  const revoked = makeRevocationModel([{ order: orderId, student: studentId, product: courseA }]);
  assert.equal(await isVerifiedPurchasedAccess({ access: access(courseA), OrderModel: makeOrderModel(order()), ProductAccessRevocationModel: revoked, studentId, productId: courseA }), false);
  assert.equal(await isVerifiedPurchasedAccess({ access: access(courseB), OrderModel: makeOrderModel(order()), ProductAccessRevocationModel: revoked, studentId, productId: courseB }), true);
});

test('partial monetary refund without a product revocation preserves paid access for pending and keep-access review states', async () => {
  for (const refundReviewStatus of ['pending', 'keep-access', 'product-specific']) {
    assert.equal(await isVerifiedPurchasedAccess({
      access: access(courseB),
      OrderModel: makeOrderModel(order({ refundReviewStatus })),
      ProductAccessRevocationModel: makeRevocationModel(),
      studentId,
      productId: courseB,
    }), true);
  }
});

test('full-order refund and legacy order-wide revoke state deny stale active entitlements', async () => {
  for (const orderRecord of [order({ status: 'refunded' }), order({ refundReviewStatus: 'revoke-access' })]) {
    assert.equal(await isVerifiedPurchasedAccess({
      access: access(courseB),
      OrderModel: makeOrderModel(orderRecord),
      ProductAccessRevocationModel: makeRevocationModel(),
      studentId,
      productId: courseB,
    }), false);
  }
});

test('missing, inconsistent and unavailable payment or revocation data never grants paid access', async () => {
  assert.equal(await isVerifiedPurchasedAccess({ access: access(courseA), OrderModel: makeOrderModel(null), ProductAccessRevocationModel: makeRevocationModel(), studentId, productId: courseA }), false);
  assert.equal(await isVerifiedPurchasedAccess({ access: access(courseA), OrderModel: makeOrderModel(order({ student: '507f1f77bcf86cd799439099' })), ProductAccessRevocationModel: makeRevocationModel(), studentId, productId: courseA }), false);
  assert.equal(await isVerifiedPurchasedAccess({ access: access(courseA), OrderModel: makeOrderModel(order({ entitledProductIds: [courseB] })), ProductAccessRevocationModel: makeRevocationModel(), studentId, productId: courseA }), false);
  assert.equal(await isVerifiedPurchasedAccess({ access: access(courseA, { order: otherOrderId }), OrderModel: makeOrderModel(order()), ProductAccessRevocationModel: makeRevocationModel(), studentId, productId: courseA }), false,
    'a different valid order cannot authorize the product linked to this entitlement');
  assert.equal(await isVerifiedPurchasedAccess({ access: access(courseA), OrderModel: makeOrderModel(order()), ProductAccessRevocationModel: undefined, studentId, productId: courseA }), false);
  await assert.rejects(() => isVerifiedPurchasedAccess({
    access: access(courseA),
    OrderModel: makeOrderModel(order()),
    ProductAccessRevocationModel: { findOne: async () => { throw new Error('database unavailable'); } },
    studentId,
    productId: courseA,
  }), /database unavailable/u);
});

test('free claims remain independent of paid-order and revocation records', async () => {
  assert.equal(await isVerifiedPurchasedAccess({
    access: { student: studentId, product: courseA, order: null, source: 'free', status: 'active' },
    studentId,
    productId: courseA,
  }), true);
  assert.equal(await isVerifiedPurchasedAccess({
    access: { student: studentId, product: courseA, order: orderId, source: 'free', status: 'active' },
    studentId,
    productId: courseA,
  }), false);
});

test('hasVerifiedProductAccess uses the same revocation check as route-level access', async () => {
  const revoked = makeRevocationModel([{ order: orderId, student: studentId, product: courseA }]);
  assert.equal(await hasVerifiedProductAccess({
    PurchasedAccessModel: makeAccessModel(access(courseA)),
    OrderModel: makeOrderModel(order()),
    ProductAccessRevocationModel: revoked,
    studentId,
    productId: courseA,
  }), false);
});
