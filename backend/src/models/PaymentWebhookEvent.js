import mongoose from 'mongoose';

const paymentWebhookEventSchema = new mongoose.Schema({
  provider: { type: String, enum: ['razorpay'], default: 'razorpay', required: true },
  eventId: { type: String, required: true, trim: true, maxlength: 200 },
  eventType: { type: String, required: true, trim: true, maxlength: 100 },
  payloadHash: { type: String, required: true, match: /^[a-f0-9]{64}$/u },
  status: { type: String, enum: ['received', 'processed', 'ignored'], default: 'received', index: true },
  refundId: { type: String, trim: true, maxlength: 200, default: '' },
  paymentId: { type: String, trim: true, maxlength: 200, default: '' },
  refundAmountPaise: { type: Number, min: 1, validate: Number.isSafeInteger, default: null },
  refundCurrency: { type: String, trim: true, maxlength: 3, default: '' },
  refundStatus: { type: String, enum: ['pending', 'processed', 'failed', ''], default: '' },
  refundReconciliationStatus: { type: String, enum: ['awaiting-capture', 'verified', 'rejected', ''], default: '' },
  processedAt: { type: Date, default: null },
}, { timestamps: true });

paymentWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
paymentWebhookEventSchema.index({ status: 1, createdAt: 1 });
paymentWebhookEventSchema.index({ paymentId: 1, refundReconciliationStatus: 1, refundStatus: 1 });

export default mongoose.models.PaymentWebhookEvent ?? mongoose.model('PaymentWebhookEvent', paymentWebhookEventSchema);
