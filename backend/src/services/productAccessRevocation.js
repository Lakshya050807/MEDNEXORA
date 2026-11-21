function idOf(value) {
  if (value && typeof value.toHexString === 'function') return value.toHexString();
  const id = value?._id ?? value?.id ?? value;
  if (id && typeof id.toHexString === 'function') return id.toHexString();
  return id == null ? '' : String(id);
}

function queryWithMajorityRead(query) {
  if (typeof query?.readConcern === 'function') return query.readConcern('majority');
  if (typeof query?.setOptions === 'function') return query.setOptions({ readConcern: { level: 'majority' } });
  return query;
}

function unavailable(message = 'Product access review is temporarily unavailable. Retry safely.') {
  const error = new Error(message);
  error.status = 503;
  return error;
}

export async function findProductAccessRevocation({ Model, orderId, productId }) {
  if (!Model?.findOne) throw unavailable('Product access verification is temporarily unavailable.');
  const query = queryWithMajorityRead(Model.findOne({ order: orderId, product: productId }));
  return await query;
}

/**
 * Persist the access decision before touching the denormalized entitlement.
 * The unique order/product index makes retries and concurrent admin requests
 * idempotent. If a write acknowledgement is ambiguous, a majority read can
 * confirm the committed immutable record before cleanup proceeds.
 */
export async function ensureProductAccessRevocation({ Model, orderId, studentId, productId, actorId, refundId = null, recordedAt = new Date() }) {
  if (!Model?.updateOne || !Model?.findOne) throw unavailable();
  const filter = { order: orderId, product: productId };
  const values = {
    ...filter,
    student: studentId,
    actor: actorId,
    source: 'admin-partial-refund-review',
    reason: 'product-access-revoked',
    refund: refundId,
    recordedAt,
  };

  try {
    await Model.updateOne(filter, { $setOnInsert: values }, {
      upsert: true,
      runValidators: true,
      writeConcern: { w: 'majority' },
    });
  } catch (writeError) {
    let existing;
    try {
      existing = await findProductAccessRevocation({ Model, orderId, productId });
    } catch {
      throw unavailable();
    }
    if (!existing) {
      if (writeError?.code === 11000) throw unavailable();
      throw writeError;
    }
  }

  const record = await findProductAccessRevocation({ Model, orderId, productId });
  if (!record
    || idOf(record.order) !== idOf(orderId)
    || idOf(record.student) !== idOf(studentId)
    || idOf(record.product) !== idOf(productId)) throw unavailable();
  return record;
}
