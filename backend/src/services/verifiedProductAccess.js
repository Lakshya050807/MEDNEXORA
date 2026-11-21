import { findProductAccessRevocation } from './productAccessRevocation.js';

function idOf(value) {
  if (value && typeof value.toHexString === 'function') return value.toHexString();
  const id = value?._id ?? value?.id ?? value;
  if (id && typeof id.toHexString === 'function') return id.toHexString();
  return id == null ? '' : String(id);
}

function selected(query, fields) {
  return typeof query?.select === 'function' ? query.select(fields) : query;
}

function majorityRead(query) {
  if (typeof query?.readConcern === 'function') return query.readConcern('majority');
  if (typeof query?.setOptions === 'function') return query.setOptions({ readConcern: { level: 'majority' } });
  return query;
}

function orderContainsProduct(order, productId) {
  const target = idOf(productId);
  const entitled = Array.isArray(order.entitledProductIds) ? order.entitledProductIds : [];
  // Newer orders snapshot the full bundle entitlement set. Once present, it
  // is authoritative; a conflicting line item must not widen that set.
  const allowedIds = entitled.length ? entitled : (order.items ?? []).map((item) => item.product);
  return allowedIds.some((id) => idOf(id) === target);
}

/**
 * A purchased-access row is only an index into the authoritative payment
 * record. A stale active entitlement must not grant access after its order has
 * been fully refunded, is missing, or does not include the requested product.
 * Free claims remain independent from payment-order state.
 */
export async function isVerifiedPurchasedAccess({ access, OrderModel, ProductAccessRevocationModel, studentId, productId }) {
  if (!access || access.status !== 'active'
    || idOf(access.student) !== idOf(studentId)
    || idOf(access.product) !== idOf(productId)) return false;

  if (access.source === 'free') return !access.order;
  if (access.source !== 'purchase' || !access.order || !OrderModel?.findOne) return false;

  const filter = {
    _id: access.order,
    student: studentId,
    paymentVerifiedAt: { $ne: null },
  };
  const order = await majorityRead(selected(OrderModel.findOne(filter), '_id student status paymentVerifiedAt entitledProductIds items.product refundReviewStatus'));
  if (!order
    || idOf(order._id ?? order.id) !== idOf(access.order)
    || idOf(order.student) !== idOf(studentId)
    || !(order.paymentVerifiedAt instanceof Date)
    || !orderContainsProduct(order, productId)) return false;

  if (order.status === 'refunded' || order.refundReviewStatus === 'revoke-access') return false;
  if (!['paid', 'partially_refunded'].includes(order.status)) return false;

  // Paid access fails closed if the authoritative revocation store is absent.
  // Majority reads make a committed admin decision visible even when the
  // denormalized PurchasedAccess update failed or lost its acknowledgement.
  if (!ProductAccessRevocationModel?.findOne) return false;
  const revocation = await findProductAccessRevocation({
    Model: ProductAccessRevocationModel,
    orderId: access.order,
    productId,
  });
  if (revocation) {
    if (idOf(revocation.order) !== idOf(access.order)
      || idOf(revocation.student) !== idOf(studentId)
      || idOf(revocation.product) !== idOf(productId)) return false;
    return false;
  }

  // Legacy partial refunds without product decisions preserve access only
  // when their order explicitly records the pending/keep/product-specific
  // policy. Missing or unknown review state fails closed.
  if (order.status === 'partially_refunded'
    && !['pending', 'keep-access', 'product-specific'].includes(order.refundReviewStatus)) return false;

  return true;
}

export async function hasVerifiedProductAccess({ PurchasedAccessModel, OrderModel, ProductAccessRevocationModel, studentId, productId }) {
  if (!PurchasedAccessModel?.findOne) return false;
  const access = await selected(PurchasedAccessModel.findOne({
    student: studentId,
    product: productId,
    status: 'active',
  }), 'student product order source status');
  return isVerifiedPurchasedAccess({ access, OrderModel, ProductAccessRevocationModel, studentId, productId });
}
