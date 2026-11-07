import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import Order from '../src/models/Order.js';
import StudyMaterial from '../src/models/StudyMaterial.js';
import { env } from '../src/config/env.js';

const SETUP_WINDOW_MS = 10 * 60 * 1000;

export function reservationStatusFor(order) {
  if (order.status === 'paid' && order.accessGrantedAt) return 'settled';
  if (['cancelled', 'refunded'].includes(order.status)) return 'released';
  if (order.status === 'failed' && !order.providerOrderId && order.providerOrderStatus === 'not-created') return 'released';
  return 'active';
}

export function findReservationConflicts(rows) {
  const seen = new Map();
  const conflicts = new Map();
  for (const row of rows) {
    if (row.reservationStatus !== 'active') continue;
    for (const productId of row.reservationProductIds) {
      const key = `${row.student}:${productId}`;
      const ordersForKey = seen.get(key) ?? new Set();
      ordersForKey.add(row.orderId);
      seen.set(key, ordersForKey);
      if (ordersForKey.size > 1) conflicts.set(key, { studentId: row.student, productId, orderIds: [...ordersForKey] });
    }
  }
  return [...conflicts.values()];
}

async function buildRows(OrderModel, ProductModel) {
  const orders = await OrderModel.find({}).select('_id student items entitledProductIds reservationProductIds reservationStatus reservationExpiresAt status providerOrderId providerOrderStatus accessGrantedAt createdAt').lean();
  const rootsByOrder = orders.map((order) => ({
    order,
    roots: [...new Set([
      ...(order.reservationProductIds ?? []),
      ...(order.entitledProductIds ?? []),
      ...(order.items ?? []).map((item) => item.product),
    ].map(String).filter(Boolean))],
  }));
  const graph = new Map();
  let queue = [...new Set(rootsByOrder.flatMap((row) => row.roots))];
  while (queue.length) {
    const batch = [...new Set(queue.splice(0, 500))].filter((id) => !graph.has(id));
    if (!batch.length) break;
    const products = await ProductModel.find({ _id: { $in: batch } }).select('_id bundleItems').lean();
    for (const product of products) {
      const children = (product.bundleItems ?? []).map(String).filter(Boolean);
      graph.set(String(product._id), children);
      queue.push(...children);
    }
    for (const id of batch) if (!graph.has(id)) graph.set(id, []);
  }

  return rootsByOrder.map(({ order, roots }) => {
    const reservationStatus = reservationStatusFor(order);
    const productIds = new Set(roots);
    const pending = [...roots];
    while (pending.length) {
      const productId = pending.pop();
      for (const child of graph.get(productId) ?? []) {
        if (productIds.has(child)) continue;
        productIds.add(child);
        pending.push(child);
      }
    }
    const providerlessSetup = reservationStatus === 'active'
      && order.status === 'pending'
      && !order.providerOrderId
      && order.providerOrderStatus === 'not-created';
    const reservationExpiresAt = providerlessSetup && order.createdAt
      ? new Date(new Date(order.createdAt).getTime() + SETUP_WINDOW_MS)
      : null;
    return {
      orderId: order._id,
      student: String(order.student),
      reservationProductIds: [...productIds].sort(),
      reservationStatus,
      reservationExpiresAt,
    };
  });
}

export async function runReservationBackfill({ OrderModel = Order, ProductModel = StudyMaterial, apply = false } = {}) {
  const rows = await buildRows(OrderModel, ProductModel);
  const conflicts = findReservationConflicts(rows);
  if (conflicts.length) return { total: rows.length, conflicts, applied: false };
  if (apply && rows.length) {
    await OrderModel.bulkWrite(rows.map((row) => ({
      updateOne: {
        filter: { _id: row.orderId },
        update: { $set: {
          reservationProductIds: row.reservationProductIds,
          reservationStatus: row.reservationStatus,
          reservationExpiresAt: row.reservationExpiresAt,
        } },
      },
    })), { ordered: true });
  }
  return { total: rows.length, conflicts, applied: Boolean(apply) };
}

async function main() {
  const apply = process.argv.includes('--apply');
  try {
    // A dry run must remain read-only, and an apply must preflight collisions
    // before the API startup creates the unique index.
    Order.schema.set('autoIndex', false);
    StudyMaterial.schema.set('autoIndex', false);
    await mongoose.connect(env.mongoUri);
    const result = await runReservationBackfill({ apply });
    if (result.conflicts.length) {
      console.error(`Found ${result.conflicts.length} overlapping active student/resource reservation(s). No records were changed.`);
      for (const conflict of result.conflicts) {
        console.error(`Orders ${conflict.orderIds.join(', ')} overlap on resource ${conflict.productId} for student ${conflict.studentId}. Reconcile these orders before applying the migration.`);
      }
      process.exitCode = 2;
      return;
    }
    console.log(`${apply ? 'Updated' : 'Would update'} ${result.total} existing order reservation record(s).`);
    if (!apply) console.log('Dry run only. Stop the API, review the output, then rerun with --apply to backfill.');
  } catch (error) {
    console.error('Purchase reservation backfill failed. No secrets or database details are printed.');
    if (env.nodeEnv !== 'production') console.error(error?.name ?? 'MigrationError');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
