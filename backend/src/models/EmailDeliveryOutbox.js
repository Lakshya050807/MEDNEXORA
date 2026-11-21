import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const emailDeliveryOutboxSchema = new mongoose.Schema({
  _id: { type: String, default: randomUUID },
  type: { type: String, required: true, enum: ['password-reset', 'registration-verification'] },
  payloadVersion: { type: Number, required: true, enum: [1], default: 1 },
  payloadNonce: { type: String, required() { return ['queued', 'processing'].includes(this.status); }, select: false },
  payloadCiphertext: { type: String, required() { return ['queued', 'processing'].includes(this.status); }, select: false },
  payloadTag: { type: String, required() { return ['queued', 'processing'].includes(this.status); }, select: false },
  status: { type: String, required: true, enum: ['queued', 'processing', 'delivered', 'suppressed', 'expired', 'failed'], default: 'queued' },
  attempts: { type: Number, required: true, min: 0, default: 0 },
  availableAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  lockToken: { type: String, select: false },
  lockUntil: { type: Date, select: false },
  providerAcceptedAt: { type: Date, select: false },
  cleanupAt: { type: Date },
}, {
  timestamps: true,
  toJSON: {
    transform(_document, returned) {
      delete returned.payloadNonce;
      delete returned.payloadCiphertext;
      delete returned.payloadTag;
      delete returned.lockToken;
      delete returned.lockUntil;
      delete returned.providerAcceptedAt;
      delete returned.__v;
      return returned;
    },
  },
});

emailDeliveryOutboxSchema.index(
  { status: 1, availableAt: 1, createdAt: 1 },
  { name: 'email_outbox_due_jobs' },
);
emailDeliveryOutboxSchema.index(
  { status: 1, lockUntil: 1 },
  { name: 'email_outbox_expired_leases' },
);
// cleanupAt is only written when a job reaches a terminal state. Queued and
// processing jobs never receive this field and therefore cannot be TTL-deleted.
emailDeliveryOutboxSchema.index(
  { cleanupAt: 1 },
  { expireAfterSeconds: 0, name: 'email_outbox_terminal_ttl' },
);

export default mongoose.models.EmailDeliveryOutbox
  ?? mongoose.model('EmailDeliveryOutbox', emailDeliveryOutboxSchema);
