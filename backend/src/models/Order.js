import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyMaterial', required: true },
  titleSnapshot: { type: String, required: true, trim: true, maxlength: 200 },
  unitPricePaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  listPricePaise: { type: Number, default() { return this.unitPricePaise; }, min: 0, validate: Number.isSafeInteger },
  discountPaise: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  quantity: { type: Number, required: true, min: 1, max: 100, default: 1, validate: Number.isSafeInteger },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: { type: [orderItemSchema], required: true, validate: (items) => items.length > 0 },
  amountPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  currency: { type: String, enum: ['INR'], default: 'INR' },
  status: { type: String, enum: ['pending', 'paid', 'partially_refunded', 'failed', 'cancelled', 'refunded'], default: 'pending', index: true },
  // A payable Razorpay order keeps its reservation even after a failed attempt:
  // Razorpay Orders can be retried and cannot be cancelled through the Orders API.
  reservationStatus: { type: String, enum: ['active', 'released', 'settled'], default: 'active', index: true },
  reservationProductIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StudyMaterial' }], default: [] },
  reservationExpiresAt: { type: Date, default: null },
  paymentVerifiedAt: { type: Date, default: null, index: true },
  accessGrantedAt: { type: Date, default: null },
  totalRefundedPaise: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  appliedRefundIds: { type: [String], default: [] },
  refundReviewStatus: { type: String, enum: ['not-required', 'pending', 'keep-access', 'revoke-access'], default: 'not-required' },
  paymentProvider: { type: String, enum: ['none', 'razorpay'], default: 'none' },
  providerOrderId: { type: String, trim: true, maxlength: 200, default: '' },
  providerPaymentId: { type: String, trim: true, maxlength: 200, default: '' },
  providerOrderStatus: { type: String, enum: ['not-created', 'creating', 'ready', 'error'], default: 'not-created' },
  providerOrderCreationStartedAt: { type: Date, default: null },
  checkoutKey: { type: String, trim: true, maxlength: 100, default: undefined },
  checkoutCartHash: { type: String, trim: true, maxlength: 64, default: '' },
  entitledProductIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StudyMaterial' }], default: [] },
  paymentFailureReason: { type: String, trim: true, maxlength: 300, default: '' },
}, { timestamps: true });

orderSchema.index({ student: 1, createdAt: -1 });
// This unique multikey index provides the atomic per-student/per-resource lock.
// It also reserves every product nested in a bundle. Reservations are released
// only when no provider order was created, or settled after access was granted.
orderSchema.index(
  { student: 1, reservationProductIds: 1 },
  { unique: true, partialFilterExpression: { reservationStatus: 'active' } },
);
orderSchema.index({ student: 1, checkoutKey: 1 }, { unique: true, partialFilterExpression: { checkoutKey: { $type: 'string' } } });
orderSchema.index({ providerOrderId: 1 }, { unique: true, partialFilterExpression: { providerOrderId: { $gt: '' } } });
orderSchema.pre('validate', function validateOrderTotal() {
  const totalPaise = this.items.reduce((total, item) => total + item.unitPricePaise * item.quantity, 0);
  if (Number.isSafeInteger(totalPaise) && this.amountPaise !== totalPaise) {
    this.invalidate('amountPaise', 'Order amount must equal the sum of its item snapshots.');
  }
  if (['paid', 'partially_refunded', 'refunded'].includes(this.status) && !(this.paymentVerifiedAt instanceof Date)) {
    this.invalidate('paymentVerifiedAt', 'Captured orders require a verified payment timestamp.');
  }
  if (!['paid', 'partially_refunded', 'refunded'].includes(this.status) && this.paymentVerifiedAt) {
    this.invalidate('paymentVerifiedAt', 'Only captured orders can have a verified payment timestamp.');
  }
  if (Number.isSafeInteger(this.totalRefundedPaise) && this.totalRefundedPaise > this.amountPaise) {
    this.invalidate('totalRefundedPaise', 'Refund totals cannot exceed the captured order amount.');
  }
  for (const item of this.items) {
    if (Number.isSafeInteger(item.listPricePaise) && Number.isSafeInteger(item.discountPaise)
      && (item.discountPaise > item.listPricePaise || item.unitPricePaise !== item.listPricePaise - item.discountPaise)) {
      this.invalidate('items', 'Order item pricing snapshots must be consistent.');
    }
  }
});

export default mongoose.models.Order ?? mongoose.model('Order', orderSchema);
