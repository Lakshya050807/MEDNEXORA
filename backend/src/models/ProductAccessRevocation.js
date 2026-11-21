import mongoose from 'mongoose';

const productAccessRevocationSchema = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, immutable: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyMaterial', required: true, immutable: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  source: { type: String, enum: ['admin-partial-refund-review'], required: true, immutable: true },
  reason: { type: String, enum: ['product-access-revoked'], required: true, immutable: true },
  refund: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentRefund', default: null, immutable: true },
  recordedAt: { type: Date, required: true, immutable: true },
}, { versionKey: false, timestamps: false });

// One immutable access decision per product in a specific payment order.
// Monetary refund allocation remains in PaymentRefund and is never inferred
// from this access-only record.
productAccessRevocationSchema.index(
  { order: 1, product: 1 },
  { unique: true, name: 'product_access_revocation_order_product_unique' },
);
productAccessRevocationSchema.index({ student: 1, product: 1 }, { name: 'product_access_revocation_student_product' });

export default mongoose.models.ProductAccessRevocation
  ?? mongoose.model('ProductAccessRevocation', productAccessRevocationSchema);
