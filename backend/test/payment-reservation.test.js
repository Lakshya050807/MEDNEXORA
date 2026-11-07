import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'payment-reservation-test-secret-with-32-bytes';
process.env.APP_ORIGIN = 'http://localhost:5173';
import Order from '../src/models/Order.js';
import { findReservationConflicts, reservationStatusFor } from '../scripts/backfill-purchase-reservations.js';

test('Order schema has a unique per-student multikey index for active reservations', () => {
  const reservationIndex = Order.schema.indexes().find(([keys, options]) => (
    keys.student === 1 && keys.reservationProductIds === 1 && options.unique === true
  ));
  assert.ok(reservationIndex, 'the database index must enforce the reservation atomically');
  assert.deepEqual(reservationIndex[1].partialFilterExpression, { reservationStatus: 'active' });
});

test('reservation migration preserves payable orders and releases only terminal unpayable orders', () => {
  assert.equal(reservationStatusFor({ status: 'pending', providerOrderId: 'order_live_1' }), 'active');
  assert.equal(reservationStatusFor({ status: 'failed', providerOrderId: 'order_live_2' }), 'active');
  assert.equal(reservationStatusFor({ status: 'paid', accessGrantedAt: null }), 'active');
  assert.equal(reservationStatusFor({ status: 'paid', accessGrantedAt: new Date() }), 'settled');
  assert.equal(reservationStatusFor({ status: 'cancelled', providerOrderId: '' }), 'released');
  assert.equal(reservationStatusFor({ status: 'failed', providerOrderId: '', providerOrderStatus: 'not-created' }), 'released');
});

test('migration detects overlapping pending student/resource reservations before applying the index', () => {
  const conflicts = findReservationConflicts([
    { orderId: 'order-a', student: 'student-a', reservationStatus: 'active', reservationProductIds: ['resource-1', 'resource-2'] },
    { orderId: 'order-b', student: 'student-a', reservationStatus: 'active', reservationProductIds: ['resource-2'] },
    { orderId: 'order-c', student: 'student-b', reservationStatus: 'active', reservationProductIds: ['resource-2'] },
    { orderId: 'order-d', student: 'student-a', reservationStatus: 'settled', reservationProductIds: ['resource-2'] },
  ]);
  assert.deepEqual(conflicts, [{
    studentId: 'student-a',
    productId: 'resource-2',
    orderIds: ['order-a', 'order-b'],
  }]);
});
