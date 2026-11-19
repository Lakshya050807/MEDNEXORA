import mongoose from 'mongoose';

const passwordResetRateLimitSchema = new mongoose.Schema({
  scope: { type: String, required: true, enum: ['request', 'complete', 'registration-request', 'registration-complete', 'staging-invitation-write'] },
  ipHash: { type: String, required: true, minlength: 64, maxlength: 64 },
  windowStart: { type: Date, required: true },
  count: { type: Number, required: true, min: 1 },
  expiresAt: { type: Date, required: true },
}, {
  versionKey: false,
  timestamps: false,
});

passwordResetRateLimitSchema.index({ scope: 1, ipHash: 1, windowStart: 1 }, { unique: true });
passwordResetRateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.PasswordResetRateLimit
  ?? mongoose.model('PasswordResetRateLimit', passwordResetRateLimitSchema);
