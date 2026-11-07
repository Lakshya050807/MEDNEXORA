import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import mongoose from 'mongoose';

function idOf(value) {
  if (value && typeof value.toHexString === 'function') return value.toHexString();
  const id = value?._id ?? value?.id ?? value;
  if (id && typeof id.toHexString === 'function') return id.toHexString();
  return id == null ? '' : String(id);
}

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function runQuery(query, fields) {
  if (fields && typeof query?.select === 'function') query = query.select(fields);
  if (typeof query?.lean === 'function') query = query.lean();
  return query;
}

function safeOrder(order) {
  return {
    id: idOf(order),
    status: order.status,
    paymentProvider: order.paymentProvider,
    currency: order.currency,
    amountPaise: order.amountPaise,
    items: (order.items ?? []).map((item) => ({
      productId: idOf(item.product),
      title: item.titleSnapshot,
      quantity: item.quantity,
      listPricePaise: item.listPricePaise,
      discountPaise: item.discountPaise,
      unitPricePaise: item.unitPricePaise,
    })),
    paymentVerifiedAt: order.paymentVerifiedAt ?? null,
    accessGrantedAt: order.accessGrantedAt ?? null,
    totalRefundedPaise: order.totalRefundedPaise ?? 0,
    remainingCapturedPaise: Math.max(0, (order.amountPaise ?? 0) - (order.totalRefundedPaise ?? 0)),
    refundReviewStatus: order.refundReviewStatus ?? 'not-required',
    paymentFailureReason: order.status === 'failed' ? (order.paymentFailureReason || 'Payment was not completed.') : '',
    createdAt: order.createdAt ?? null,
    updatedAt: order.updatedAt ?? null,
  };
}

function validProviderId(value, prefix) {
  return typeof value === 'string' && value.length <= 200 && new RegExp(`^${prefix}_[A-Za-z0-9_-]{3,190}$`, 'u').test(value);
}

function checkHexSignature(received, expected) {
  if (typeof received !== 'string' || !/^[a-f\d]{64}$/iu.test(received)) return false;
  const suppliedBytes = Buffer.from(received, 'hex');
  return suppliedBytes.length === expected.length && timingSafeEqual(suppliedBytes, expected);
}

function hasVerifiedCapture(order) {
  return ['paid', 'partially_refunded', 'refunded'].includes(order?.status) && order.paymentVerifiedAt instanceof Date;
}

export function createPaymentController({
  OrderModel,
  ProductModel,
  PurchasedAccessModel,
  WebhookEventModel,
  RefundModel,
  gateway,
  paymentConfig,
  clock = () => new Date(),
  reservationSetupWindowMs = 10 * 60 * 1000,
}) {
  const paymentEnabled = Boolean(paymentConfig?.keyId && paymentConfig?.keySecret);

  async function findOwnedOrder(orderId, studentId) {
    if (!mongoose.isValidObjectId(orderId)) throw apiError(400, 'Enter a valid order ID.');
    const order = await runQuery(OrderModel.findOne({ _id: orderId, student: studentId }));
    if (!order) throw apiError(404, 'This order could not be found.');
    return order;
  }

  async function loadPublishedProducts(ids) {
    const query = ProductModel.find({ _id: { $in: ids }, publicationStatus: 'published' });
    return (await runQuery(query, 'title resourceType pricePaise discountPaise currentPricePaise publicationStatus bundleItems')) ?? [];
  }

  function reservationIdsFor(order) {
    const ids = order?.reservationProductIds?.length
      ? order.reservationProductIds
      : order?.entitledProductIds?.length
        ? order.entitledProductIds
        : (order?.items ?? []).map((item) => item.product);
    return [...new Set(ids.map(idOf).filter(Boolean))];
  }

  async function releaseExpiredProviderlessReservations() {
    // Only release reservations that expired before a provider order could be
    // created. Razorpay Orders remain payable after failed attempts and cannot
    // safely be released based on a local timeout alone.
    if (typeof OrderModel.updateMany !== 'function') return;
    await OrderModel.updateMany({
      reservationStatus: 'active',
      reservationExpiresAt: { $lte: clock() },
      providerOrderId: '',
      providerOrderStatus: 'not-created',
      status: 'pending',
    }, { $set: { reservationStatus: 'released', reservationExpiresAt: null, status: 'cancelled' } });
  }

  async function findReservationConflict(studentId, productIds) {
    return runQuery(OrderModel.findOne({
      student: studentId,
      reservationStatus: 'active',
      reservationProductIds: { $in: productIds },
    }));
  }

  async function resumeReservedOrder(order) {
    if (!order) return null;
    if (order.status === 'paid') return order;
    const reservationProductIds = reservationIdsFor(order);
    const safeToReopenReleased = !order.providerOrderId
      && order.reservationStatus === 'released'
      && ['failed', 'cancelled'].includes(order.status);
    const safeToRetryProviderOrder = order.reservationStatus === 'active'
      && ['pending', 'failed'].includes(order.status);
    if (!safeToReopenReleased && !safeToRetryProviderOrder) return null;

    const set = {
      status: 'pending',
      reservationStatus: 'active',
      reservationProductIds,
      paymentFailureReason: '',
    };
    if (safeToReopenReleased) set.reservationExpiresAt = new Date(clock().getTime() + reservationSetupWindowMs);
    const resumed = await OrderModel.findOneAndUpdate({
      _id: order._id,
      status: order.status,
      reservationStatus: order.reservationStatus,
    }, { $set: set }, { new: true, runValidators: true });
    if (resumed) return resumed;
    return runQuery(OrderModel.findById(order._id));
  }

  async function resolveEntitlements(rootIds) {
    const found = new Set();
    const queue = [...new Set(rootIds.map(String))];
    const pending = [...queue];
    while (pending.length) {
      const batch = [...new Set(pending.splice(0, 50))];
      const resources = await loadPublishedProducts(batch);
      if (resources.length !== batch.length) throw apiError(409, 'One or more selected resources are no longer available. Refresh your cart.');
      for (const resource of resources) {
        const resourceId = idOf(resource);
        if (found.has(resourceId)) continue;
        found.add(resourceId);
        if (found.size > 100) throw apiError(409, 'This preparation bundle contains too many nested resources. Contact support before checkout.');
        for (const child of resource.bundleItems ?? []) {
          const childId = idOf(child);
          if (!childId || childId === resourceId) throw apiError(409, 'This preparation bundle is not configured correctly.');
          if (!found.has(childId)) pending.push(childId);
        }
      }
      if (pending.length && found.size + pending.length > 150) throw apiError(409, 'This preparation bundle contains too many resources.');
    }
    return [...found];
  }

  async function ensureEntitlement(studentId, productId, orderId) {
    const filter = { student: studentId, product: productId };
    const current = await runQuery(PurchasedAccessModel.findOne(filter));
    if (current?.status === 'active') return;
    const values = { order: orderId, source: 'purchase', status: 'active', grantedAt: clock(), revokedAt: null };
    if (current) {
      const restored = await PurchasedAccessModel.findOneAndUpdate(
        { ...filter, status: current.status }, { $set: values }, { new: true, runValidators: true },
      );
      if (restored) return;
      const latest = await runQuery(PurchasedAccessModel.findOne(filter));
      if (latest?.status === 'active') return;
    }
    try {
      await PurchasedAccessModel.create({ ...filter, ...values });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const latest = await runQuery(PurchasedAccessModel.findOne(filter));
      if (latest?.status === 'active') return;
      throw error;
    }
  }

  async function revokeOrderAccess(orderId) {
    if (typeof PurchasedAccessModel.updateMany !== 'function') return;
    await PurchasedAccessModel.updateMany(
      { order: orderId, source: 'purchase', status: 'active' },
      { $set: { status: 'revoked', revokedAt: clock() } },
    );
  }

  async function setRefundReconciliation(refund, status) {
    await RefundModel.updateOne({ _id: refund._id }, { $set: { reconciliationStatus: status } });
    refund.reconciliationStatus = status;
  }

  async function applyProcessedRefund(refund, order) {
    for (let retry = 0; retry < 6; retry += 1) {
      const current = await runQuery(OrderModel.findById(order._id));
      if (!current || current.providerPaymentId !== refund.providerPaymentId
        || !(current.paymentVerifiedAt instanceof Date)) {
        await setRefundReconciliation(refund, 'awaiting-capture');
        return current ?? order;
      }
      if ((current.appliedRefundIds ?? []).includes(refund.providerRefundId)) {
        await setRefundReconciliation(refund, 'verified');
        if (current.status === 'refunded') await revokeOrderAccess(current._id);
        return current;
      }
      const currentTotal = Number(current.totalRefundedPaise ?? 0);
      const nextTotal = currentTotal + refund.amountPaise;
      if (!Number.isSafeInteger(nextTotal) || nextTotal > current.amountPaise) {
        await setRefundReconciliation(refund, 'rejected');
        await OrderModel.updateOne(
          { _id: current._id, status: { $in: ['paid', 'partially_refunded', 'refunded'] } },
          { $set: { refundReviewStatus: 'pending' } },
        );
        return await runQuery(OrderModel.findById(current._id)) ?? current;
      }
      if (!['paid', 'partially_refunded'].includes(current.status)) {
        await setRefundReconciliation(refund, 'rejected');
        return current;
      }
      const full = nextTotal === current.amountPaise;
      const reviewStatus = full ? 'not-required'
        : current.refundReviewStatus === 'revoke-access' ? 'revoke-access' : 'pending';
      const updated = await OrderModel.findOneAndUpdate({
        _id: current._id,
        providerPaymentId: refund.providerPaymentId,
        status: { $in: ['paid', 'partially_refunded'] },
        appliedRefundIds: { $ne: refund.providerRefundId },
        $expr: { $and: [
          { $eq: [{ $ifNull: ['$totalRefundedPaise', 0] }, currentTotal] },
          { $lte: [{ $add: [{ $ifNull: ['$totalRefundedPaise', 0] }, refund.amountPaise] }, '$amountPaise'] },
        ] },
      }, {
        $inc: { totalRefundedPaise: refund.amountPaise },
        $addToSet: { appliedRefundIds: refund.providerRefundId },
        $set: { status: full ? 'refunded' : 'partially_refunded', refundReviewStatus: reviewStatus },
      }, { new: true, runValidators: true });
      if (!updated) continue;
      await setRefundReconciliation(refund, 'verified');
      if (full) await revokeOrderAccess(current._id);
      return updated;
    }
    throw apiError(503, 'Refund reconciliation is busy. The signed event can be retried safely.');
  }

  async function reconcileAwaitingRefunds(order, paymentId) {
    if (!RefundModel?.find) return order;
    let query = RefundModel.find({ order: order._id, providerPaymentId: paymentId, reconciliationStatus: 'awaiting-capture' });
    if (typeof query?.sort === 'function') query = query.sort({ createdAt: 1, _id: 1 });
    const refunds = await runQuery(query) ?? [];
    let latest = order;
    for (const refund of refunds) {
      if (refund.status === 'processed') latest = await applyProcessedRefund(refund, latest);
      else await setRefundReconciliation(refund, 'verified');
    }
    return latest;
  }

  async function grantOrderAccess(order) {
    // Reload before touching entitlements. A capture callback can race a full
    // refund callback that has already moved the order to `refunded`.
    const currentOrder = await runQuery(OrderModel.findById(order._id));
    if (!currentOrder || !['paid', 'partially_refunded'].includes(currentOrder.status)
      || !(currentOrder.paymentVerifiedAt instanceof Date)
      || currentOrder.providerPaymentId !== order.providerPaymentId) return currentOrder ?? order;
    const productIds = currentOrder.entitledProductIds?.length
      ? currentOrder.entitledProductIds.map(idOf)
      : (currentOrder.items ?? []).map((item) => idOf(item.product));
    for (const productId of [...new Set(productIds)]) {
      await ensureEntitlement(currentOrder.student, productId, currentOrder._id);
    }
    await OrderModel.updateOne(
      { _id: currentOrder._id, status: { $in: ['paid', 'partially_refunded'] }, providerPaymentId: currentOrder.providerPaymentId },
      { $set: { accessGrantedAt: clock(), reservationStatus: 'settled', reservationExpiresAt: null } },
    );
    const latest = await runQuery(OrderModel.findById(currentOrder._id));
    if (!latest || !['paid', 'partially_refunded'].includes(latest.status)
      || latest.providerPaymentId !== currentOrder.providerPaymentId) {
      await revokeOrderAccess(currentOrder._id);
      return latest ?? currentOrder;
    }
    return latest;
  }

  async function markCaptured(order, payment) {
    if (!payment || payment.order_id !== order.providerOrderId
      || payment.amount !== order.amountPaise || payment.currency !== order.currency) {
      throw apiError(409, 'The captured payment does not match this order.');
    }
    if (payment.status !== 'captured' || payment.captured !== true) {
      if (payment.status === 'failed') return markFailed(order, payment);
      return order;
    }
    if (!validProviderId(payment.id, 'pay')) throw apiError(409, 'The payment provider returned an invalid payment reference.');

    let paid = await OrderModel.findOneAndUpdate(
      { _id: order._id, status: { $in: ['pending', 'failed'] } },
      { $set: { status: 'paid', reservationStatus: 'active', paymentVerifiedAt: clock(), providerPaymentId: payment.id, paymentFailureReason: '', reservationExpiresAt: null } },
      { new: true, runValidators: true },
    );
    if (!paid) paid = await runQuery(OrderModel.findById(order._id));
    if (paid?.providerPaymentId === payment.id && ['paid', 'partially_refunded', 'refunded'].includes(paid.status)) {
      paid = await reconcileAwaitingRefunds(paid, payment.id);
      if (['paid', 'partially_refunded'].includes(paid?.status) && !paid.accessGrantedAt) {
        await grantOrderAccess(paid);
        paid = await runQuery(OrderModel.findById(order._id)) ?? paid;
      }
    }
    return paid ?? order;
  }

  async function markFailed(order, payment) {
    if (payment?.status !== 'failed' || payment?.order_id !== order.providerOrderId
      || (payment.amount !== undefined && payment.amount !== order.amountPaise)
      || (payment.currency !== undefined && payment.currency !== order.currency)) {
      throw apiError(409, 'The payment notification does not match this order.');
    }
    const failed = await OrderModel.findOneAndUpdate(
      { _id: order._id, status: 'pending' },
      // Keep the reservation active: a Razorpay Order can accept another
      // payment attempt, so a failed attempt is not proof the order is dead.
      { $set: { status: 'failed', reservationStatus: 'active', reservationExpiresAt: null, providerPaymentId: payment.id ?? '', paymentFailureReason: 'Payment was not completed.' } },
      { new: true, runValidators: true },
    );
    return failed ?? await runQuery(OrderModel.findById(order._id)) ?? order;
  }

  function checkoutResponse(order) {
    return {
      order: safeOrder(order),
      checkout: {
        keyId: paymentConfig.keyId,
        providerOrderId: order.providerOrderId,
        amount: order.amountPaise,
        currency: order.currency,
        name: 'MEDNEXORA',
        description: 'Government Competitive Exam Preparation resources',
      },
    };
  }

  async function prepareProviderOrder(order) {
    if (order.providerOrderStatus === 'ready' && order.providerOrderId) return checkoutResponse(order);
    const now = clock();
    const staleBefore = new Date(now.getTime() - 2 * 60 * 1000);
    const claimed = await OrderModel.findOneAndUpdate({
      _id: order._id,
      status: 'pending',
      reservationStatus: 'active',
      $or: [
        { providerOrderStatus: { $in: ['not-created', 'error'] } },
        { providerOrderStatus: 'creating', providerOrderCreationStartedAt: { $lt: staleBefore } },
      ],
    }, { $set: { providerOrderStatus: 'creating', providerOrderCreationStartedAt: now, reservationExpiresAt: null } }, { new: true });
    if (!claimed) {
      const latest = await runQuery(OrderModel.findById(order._id));
      if (latest?.providerOrderStatus === 'ready' && latest.providerOrderId) return checkoutResponse(latest);
      throw apiError(409, 'Checkout is already being prepared. Please wait a moment and try again.');
    }

    try {
      const providerOrder = await gateway.createOrder({ amount: order.amountPaise, currency: 'INR', receipt: idOf(order) });
      if (!validProviderId(providerOrder?.id, 'order') || providerOrder.amount !== order.amountPaise || providerOrder.currency !== 'INR') {
        throw apiError(502, 'The payment provider returned an order that did not match the purchase.');
      }
      const saved = await OrderModel.findOneAndUpdate(
        { _id: order._id, providerOrderStatus: 'creating' },
        { $set: { providerOrderId: providerOrder.id, providerOrderStatus: 'ready' } },
        { new: true, runValidators: true },
      );
      if (!saved) throw apiError(409, 'Checkout changed while the provider order was being created.');
      return checkoutResponse(saved);
    } catch (error) {
      await OrderModel.findOneAndUpdate({ _id: order._id, providerOrderStatus: 'creating' }, { $set: { providerOrderStatus: 'error' } });
      throw error;
    }
  }

  const refundStatusRank = { pending: 1, failed: 2, processed: 3 };

  async function saveRefundEvent({ entity, eventType, eventId, order }) {
    const refundId = entity?.id;
    const paymentId = entity?.payment_id;
    const amountPaise = entity?.amount;
    const currency = entity?.currency;
    const providerStatus = entity?.status;
    const requiredStatus = eventType === 'refund.processed' ? 'processed'
      : eventType === 'refund.failed' ? 'failed' : null;
    if (!validProviderId(refundId, 'rfnd') || !validProviderId(paymentId, 'pay')
      || !Number.isSafeInteger(amountPaise) || amountPaise <= 0 || currency !== 'INR'
      || !Object.hasOwn(refundStatusRank, providerStatus)
      || (requiredStatus && providerStatus !== requiredStatus)) {
      throw apiError(400, 'The refund notification is missing valid refund details.');
    }
    if (!RefundModel) throw apiError(503, 'Refund reconciliation is not available on this server.');

    let stored = await runQuery(RefundModel.findOne({ providerRefundId: refundId }));
    if (stored && (stored.providerPaymentId !== paymentId || stored.amountPaise !== amountPaise
      || stored.currency !== currency || idOf(stored.order) !== idOf(order))) {
      throw apiError(409, 'The refund reference does not match its recorded payment.');
    }
    if (!stored) {
      try {
        stored = await RefundModel.create({
          providerRefundId: refundId,
          providerPaymentId: paymentId,
          order: order._id,
          amountPaise,
          currency,
          status: providerStatus,
          reconciliationStatus: 'awaiting-capture',
          eventIds: [eventId],
          processedAt: providerStatus === 'processed' ? clock() : null,
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        stored = await runQuery(RefundModel.findOne({ providerRefundId: refundId }));
        if (!stored || stored.providerPaymentId !== paymentId || stored.amountPaise !== amountPaise
          || stored.currency !== currency || idOf(stored.order) !== idOf(order)) {
          throw apiError(409, 'The refund reference is already linked to a different payment.');
        }
      }
    }
    if (stored.status !== providerStatus && refundStatusRank[providerStatus] > refundStatusRank[stored.status]) {
      const upgraded = await RefundModel.findOneAndUpdate(
        { _id: stored._id, status: stored.status },
        { $set: { status: providerStatus, processedAt: providerStatus === 'processed' ? clock() : stored.processedAt }, $addToSet: { eventIds: eventId } },
        { new: true, runValidators: true },
      );
      stored = upgraded ?? await runQuery(RefundModel.findOne({ providerRefundId: refundId }));
    } else {
      await RefundModel.updateOne({ _id: stored._id }, { $addToSet: { eventIds: eventId } });
      stored = await runQuery(RefundModel.findOne({ providerRefundId: refundId })) ?? stored;
    }

    const locallyCaptured = ['paid', 'partially_refunded', 'refunded'].includes(order.status)
      && order.providerPaymentId === paymentId && order.paymentVerifiedAt instanceof Date;
    let latest = order;
    if (locallyCaptured) {
      if (stored.status === 'processed') latest = await applyProcessedRefund(stored, order);
      else await setRefundReconciliation(stored, 'verified');
    } else {
      await setRefundReconciliation(stored, 'awaiting-capture');
    }
    await WebhookEventModel.updateOne({ provider: 'razorpay', eventId }, { $set: {
      status: 'processed', processedAt: clock(), refundId, paymentId,
      refundAmountPaise: amountPaise, refundCurrency: currency,
      refundStatus: stored.status, refundReconciliationStatus: stored.reconciliationStatus,
    } });
    return latest;
  }

  async function processRefundWebhook(eventType, entity, eventId) {
    const refundId = entity?.id;
    const paymentId = entity?.payment_id;
    if (!validProviderId(refundId, 'rfnd') || !validProviderId(paymentId, 'pay')) {
      throw apiError(400, 'The refund notification has no valid refund or payment reference.');
    }
    let payment;
    try {
      payment = await gateway.fetchPayment(paymentId);
    } catch (error) {
      if (error?.status === 404) throw apiError(503, 'The related payment is not available yet. The refund notification can be retried.');
      throw error;
    }
    if (!payment || payment.id !== paymentId || !validProviderId(payment.order_id, 'order')
      || !Number.isSafeInteger(payment.amount) || payment.amount <= 0
      || !['captured', 'refunded', 'authorized', 'created'].includes(payment.status)
      || entity.amount > payment.amount || payment.currency !== entity.currency) {
      throw apiError(409, 'The refund details do not match a valid Razorpay payment.');
    }
    const order = await runQuery(OrderModel.findOne({ providerOrderId: payment.order_id }));
    if (!order) throw apiError(503, 'The related order is not available yet. Retry the refund notification.');
    if (order.amountPaise !== payment.amount || order.currency !== payment.currency
      || (['paid', 'partially_refunded', 'refunded'].includes(order.status) && order.providerPaymentId !== paymentId)) {
      throw apiError(409, 'The refund payment does not match the stored order.');
    }
    return saveRefundEvent({ entity, eventType, eventId, order });
  }

  return {
    createCheckout: async (request, response, next) => {
      try {
        if (!paymentEnabled) return response.status(503).json({ message: 'Payments are not configured yet. Add Razorpay test credentials to the backend environment.' });
        const body = request.body ?? {};
        const checkoutKey = body.idempotencyKey;
        if (typeof checkoutKey !== 'string' || checkoutKey.length < 8 || checkoutKey.length > 100 || !/^[A-Za-z0-9_-]+$/u.test(checkoutKey)) {
          return response.status(400).json({ message: 'A valid checkout request key is required.' });
        }
        if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) {
          return response.status(400).json({ message: 'Add between 1 and 30 resources to your cart.' });
        }
        await releaseExpiredProviderlessReservations();
        const requested = [];
        const idSet = new Set();
        for (const item of body.items) {
          if (!mongoose.isValidObjectId(item?.productId) || item?.quantity !== 1) {
            return response.status(400).json({ message: 'Each digital resource can be checked out once per order.' });
          }
          const productId = String(item.productId);
          if (idSet.has(productId)) return response.status(400).json({ message: 'Remove duplicate resources from your cart before checkout.' });
          idSet.add(productId);
          requested.push({ productId, quantity: 1 });
        }
        const fingerprint = createHash('sha256').update(JSON.stringify([...requested].sort((left, right) => left.productId.localeCompare(right.productId)))).digest('hex');
        let order = await runQuery(OrderModel.findOne({ student: request.user._id, checkoutKey }));
        if (order) {
          if (order.checkoutCartHash !== fingerprint) return response.status(409).json({ message: 'This checkout key was already used for a different cart.' });
          if (order.status === 'paid') return response.status(200).json({ order: safeOrder(order), checkout: null });
          const resumed = await resumeReservedOrder(order);
          if (!resumed) return response.status(409).json({ message: 'This checkout is no longer available. Start a new checkout.' });
          return response.status(200).json(await prepareProviderOrder(resumed));
        }

        const products = await loadPublishedProducts(requested.map((item) => item.productId));
        if (products.length !== requested.length) return response.status(409).json({ message: 'One or more resources are unavailable. Refresh your cart.' });
        const productById = new Map(products.map((product) => [idOf(product), product]));
        const items = requested.map(({ productId, quantity }) => {
          const product = productById.get(productId);
          const listPricePaise = product?.pricePaise;
          const discountPaise = Number(product?.discountPaise ?? 0);
          if (!Number.isSafeInteger(listPricePaise) || !Number.isSafeInteger(discountPaise)
            || listPricePaise < 0 || discountPaise < 0 || discountPaise > listPricePaise) {
            throw apiError(409, 'A resource has invalid pricing. Refresh your cart or contact support.');
          }
          return {
            product: product._id,
            titleSnapshot: product.title,
            listPricePaise,
            discountPaise,
            unitPricePaise: listPricePaise - discountPaise,
            quantity,
          };
        });
        const amountPaise = items.reduce((sum, item) => sum + item.unitPricePaise * item.quantity, 0);
        if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > 100_000_000) {
          return response.status(409).json({ message: 'This cart total cannot be checked out. Free resources do not require payment.' });
        }
        const entitledProductIds = await resolveEntitlements(requested.map((item) => item.productId));
        const activeAccess = await runQuery(PurchasedAccessModel.find({
          student: request.user._id,
          product: { $in: entitledProductIds },
          status: 'active',
        }), 'product');
        if (activeAccess?.length) return response.status(409).json({ message: 'Your account already has access to one or more resources in this cart. Remove them before checkout.' });

        // A different idempotency key (another tab, refresh, or device) still
        // resolves to the one existing reservation when the cart is identical.
        // A partially overlapping cart must not create a second payable order.
        let existingReservation = await findReservationConflict(request.user._id, entitledProductIds);
        if (existingReservation) {
          if (existingReservation.checkoutCartHash !== fingerprint) {
            return response.status(409).json({ message: 'A checkout for one or more of these resources is already active. Continue that checkout before changing the cart.' });
          }
          if (existingReservation.status === 'paid') {
            return response.status(200).json({ order: safeOrder(existingReservation), checkout: null });
          }
          const resumed = await resumeReservedOrder(existingReservation);
          if (!resumed) return response.status(409).json({ message: 'This resource is reserved by another active checkout. Please retry in a moment.' });
          return response.status(200).json(await prepareProviderOrder(resumed));
        }
        try {
          order = await OrderModel.create({
            student: request.user._id,
            items,
            amountPaise,
            currency: 'INR',
            status: 'pending',
            paymentProvider: 'razorpay',
            checkoutKey,
            checkoutCartHash: fingerprint,
            entitledProductIds,
            reservationProductIds: entitledProductIds,
            reservationStatus: 'active',
            reservationExpiresAt: new Date(clock().getTime() + reservationSetupWindowMs),
          });
        } catch (error) {
          if (error?.code !== 11000) throw error;
          order = await runQuery(OrderModel.findOne({ student: request.user._id, checkoutKey }));
          if (order?.checkoutCartHash === fingerprint) {
            const resumed = await resumeReservedOrder(order);
            if (resumed) return response.status(200).json(await prepareProviderOrder(resumed));
          }
          const conflict = await findReservationConflict(request.user._id, entitledProductIds);
          if (conflict?.checkoutCartHash === fingerprint) {
            const resumed = await resumeReservedOrder(conflict);
            if (resumed) return response.status(200).json(await prepareProviderOrder(resumed));
          }
          return response.status(409).json({ message: 'A checkout for one or more of these resources is already active. Continue that checkout before changing the cart.' });
        }
        return response.status(201).json(await prepareProviderOrder(order));
      } catch (error) {
        if (error?.status) return response.status(error.status).json({ message: error.message });
        if (error?.name === 'ValidationError') return response.status(400).json({ message: 'The order could not be validated. Refresh your cart and try again.' });
        return next(error);
      }
    },

    verifyPayment: async (request, response, next) => {
      try {
        if (!paymentEnabled) return response.status(503).json({ message: 'Payments are not configured on this server.' });
        const order = await findOwnedOrder(request.params.orderId, request.user._id);
        const paymentId = request.body?.razorpay_payment_id;
        const callbackOrderId = request.body?.razorpay_order_id;
        const signature = request.body?.razorpay_signature;
        if (!validProviderId(paymentId, 'pay') || callbackOrderId !== order.providerOrderId || typeof signature !== 'string') {
          return response.status(400).json({ message: 'The payment response is incomplete or does not match this order.' });
        }
        const expected = createHmac('sha256', paymentConfig.keySecret).update(`${order.providerOrderId}|${paymentId}`).digest();
        if (!checkHexSignature(signature, expected)) return response.status(400).json({ message: 'The payment signature could not be verified.' });
        const payment = await gateway.fetchPayment(paymentId);
        const updated = payment.status === 'captured' && payment.captured === true
          ? await markCaptured(order, payment)
          : payment.status === 'failed' ? await markFailed(order, payment) : order;
        return response.status(200).json({ order: safeOrder(updated), verified: hasVerifiedCapture(updated) });
      } catch (error) {
        if (error?.status) return response.status(error.status).json({ message: error.message });
        return next(error);
      }
    },

    reconcileOrder: async (request, response, next) => {
      try {
        if (!paymentEnabled) return response.status(503).json({ message: 'Payments are not configured on this server.' });
        const order = await findOwnedOrder(request.params.orderId, request.user._id);
        if (['paid', 'partially_refunded', 'refunded'].includes(order.status)) {
          if (order.status !== 'refunded' && order.paymentProvider === 'razorpay' && order.providerPaymentId && !order.accessGrantedAt) await grantOrderAccess(order);
          const latest = await runQuery(OrderModel.findById(order._id));
          return response.status(200).json({ order: safeOrder(latest ?? order), verified: true });
        }
        let payments;
        const requestedPaymentId = request.body?.paymentId;
        if (requestedPaymentId !== undefined) {
          if (!validProviderId(requestedPaymentId, 'pay')) return response.status(400).json({ message: 'Payment reference is invalid.' });
          payments = [await gateway.fetchPayment(requestedPaymentId)];
        } else {
          const result = await gateway.listOrderPayments(order.providerOrderId);
          payments = result.items ?? [];
        }
        for (const payment of payments) {
          if (payment.order_id !== order.providerOrderId || payment.amount !== order.amountPaise || payment.currency !== order.currency) continue;
          if (payment.status === 'captured' && payment.captured === true) {
            const updated = await markCaptured(order, payment);
            return response.status(200).json({ order: safeOrder(updated), verified: hasVerifiedCapture(updated) });
          }
          if (payment.status === 'failed') {
            const updated = await markFailed(order, payment);
            return response.status(200).json({ order: safeOrder(updated), verified: false });
          }
        }
        const latest = await runQuery(OrderModel.findById(order._id));
        return response.status(200).json({ order: safeOrder(latest ?? order), verified: false });
      } catch (error) {
        if (error?.status) return response.status(error.status).json({ message: error.message });
        return next(error);
      }
    },

    webhook: async (request, response, next) => {
      try {
        const secret = paymentConfig?.webhookSecret;
        if (!secret) return response.status(503).json({ message: 'Razorpay webhook verification is not configured.' });
        if (!Buffer.isBuffer(request.rawBody)) return response.status(400).json({ message: 'Webhook request body was not available for verification.' });
        const signature = request.get('x-razorpay-signature') ?? '';
        const expected = createHmac('sha256', secret).update(request.rawBody).digest();
        if (!checkHexSignature(signature, expected)) return response.status(400).json({ message: 'Webhook signature could not be verified.' });
        const payload = request.body;
        const eventType = payload?.event;
        if (typeof eventType !== 'string' || !eventType) return response.status(400).json({ message: 'Webhook event type is missing.' });
        const headerEventId = request.get('x-razorpay-event-id');
        const eventId = typeof headerEventId === 'string' && headerEventId.length >= 1 && headerEventId.length <= 200
          ? headerEventId
          : `body-${createHash('sha256').update(request.rawBody).digest('hex')}`;
        const payloadHash = createHash('sha256').update(request.rawBody).digest('hex');
        let storedEvent;
        try {
          storedEvent = await WebhookEventModel.findOneAndUpdate(
            { provider: 'razorpay', eventId },
            { $setOnInsert: { provider: 'razorpay', eventId, eventType, payloadHash, status: 'received' } },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          );
        } catch (error) {
          if (error?.code !== 11000) throw error;
          storedEvent = await runQuery(WebhookEventModel.findOne({ provider: 'razorpay', eventId }));
        }
        if (storedEvent && (storedEvent.payloadHash !== payloadHash || storedEvent.eventType !== eventType)) {
          return response.status(409).json({ message: 'This webhook event reference was already used for a different event.' });
        }

        const isRefundEvent = ['refund.created', 'refund.processed', 'refund.failed'].includes(eventType);
        const entity = eventType === 'payment.captured' || eventType === 'payment.failed'
          ? payload?.payload?.payment?.entity
          : isRefundEvent ? payload?.payload?.refund?.entity : null;
        if (isRefundEvent && !entity) return response.status(400).json({ message: 'Refund webhook has no refund record.' });
        if (entity) {
          if (eventType === 'payment.captured' && (entity.status !== 'captured' || entity.captured !== true)) {
            return response.status(409).json({ message: 'The payment capture notification has not reached a captured state.' });
          }
          if (eventType === 'payment.failed' && entity.status !== 'failed') {
            return response.status(409).json({ message: 'The payment failure notification does not have a failed state.' });
          }
          if (isRefundEvent) {
            await processRefundWebhook(eventType, entity, eventId);
          } else {
            if (!validProviderId(entity.order_id, 'order')) return response.status(400).json({ message: 'Payment webhook has no valid order reference.' });
            const order = await runQuery(OrderModel.findOne({ providerOrderId: entity.order_id }));
            if (!order) return response.status(503).json({ message: 'The order reference is not available yet. Retry the webhook later.' });
            if (eventType === 'payment.captured') await markCaptured(order, entity);
            else await markFailed(order, entity);
            await WebhookEventModel.updateOne({ provider: 'razorpay', eventId }, { $set: { status: 'processed', processedAt: clock() } });
          }
        } else {
          await WebhookEventModel.updateOne({ provider: 'razorpay', eventId }, { $set: { status: 'ignored', processedAt: clock() } });
        }
        return response.status(200).json({ received: true });
      } catch (error) {
        if (error?.status) return response.status(error.status).json({ message: error.message });
        return next(error);
      }
    },

    listOrders: async (request, response, next) => {
      try {
        const page = Number(request.query.page ?? 1);
        const limit = Number(request.query.limit ?? 20);
        if (!Number.isSafeInteger(page) || page < 1 || page > 1000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
          return response.status(400).json({ message: 'Page must be 1 to 1000 and limit must be 1 to 50.' });
        }
        const filter = { student: request.user._id };
        const query = OrderModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit);
        const [orders, total] = await Promise.all([runQuery(query), OrderModel.countDocuments(filter)]);
        return response.status(200).json({ items: (orders ?? []).map(safeOrder), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
      } catch (error) { return next(error); }
    },

    getOrder: async (request, response, next) => {
      try {
        const order = await findOwnedOrder(request.params.orderId, request.user._id);
        return response.status(200).json({ order: safeOrder(order) });
      } catch (error) {
        if (error?.status) return response.status(error.status).json({ message: error.message });
        return next(error);
      }
    },
  };
}

export default createPaymentController;
