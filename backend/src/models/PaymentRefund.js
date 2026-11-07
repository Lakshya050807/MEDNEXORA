import mongoose from 'mongoose';

const paymentRefundSchema = new mongoose.Schema({
  provider: { type: String, enum: ['razorpay'], default: 'razorpay', required: true },
  providerRefundId: { type: String, required: true, trim: true, maxlength: 200 },
  providerPaymentId: { type: String, required: true, trim: true, maxlength: 200 },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  currency: { type: String, enum: ['INR'], required: true },
  status: { type: String, enum: ['pending', 'processed', 'failed'], required: true, index: true },
  reconciliationStatus: { type: String, enum: ['awaiting-capture', 'verified', 'rejected'], default: 'awaiting-capture', index: true },
  eventIds: { type: [String], default: [] },
  processedAt: { type: Date, default: null },
}, { timestamps: true });

paymentRefundSchema.index({ provider: 1, providerRefundId: 1 }, { unique: true });
paymentRefundSchema.index({ providerPaymentId: 1, reconciliationStatus: 1, status: 1 });
paymentRefundSchema.index({ order: 1, createdAt: -1 });

export default mongoose.models.PaymentRefund ?? mongoose.model('PaymentRefund', paymentRefundSchema);
