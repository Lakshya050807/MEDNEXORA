import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 80,
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 254,
    unique: true,
  },
  adminUsername: {
    type: String,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 32,
    match: /^[a-z0-9][a-z0-9._-]{2,31}$/u,
    unique: true,
    sparse: true,
  },
  adminSessionVersion: { type: Number, min: 0, default: 0, select: false },
  studentSessionVersion: { type: Number, min: 0, default: 0, select: false },
  // Historical records without this field remain treated as verified; public
  // registration explicitly sets true only after consuming a server proof.
  emailVerified: { type: Boolean, default: true },
  passwordResetOtpHash: { type: String, select: false },
  passwordResetOtpExpiresAt: { type: Date, select: false },
  passwordResetOtpStatus: { type: String, enum: ['pending', 'active'], select: false },
  // Completion requires this separate fence, set only after the active-state
  // write has returned an acknowledged result. Legacy active challenges without
  // the field remain unusable until a fresh code is requested.
  passwordResetOtpActivationConfirmed: { type: Boolean, default: false, select: false },
  passwordResetOtpAttempts: { type: Number, min: 0, default: 0, select: false },
  passwordResetOtpLastSentAt: { type: Date, select: false },
  passwordResetOtpResendWindowStartedAt: { type: Date, select: false },
  passwordResetOtpResendCount: { type: Number, min: 0, default: 0, select: false },
  passwordHash: {
    type: String,
    required: true,
    select: false,
  },
  role: {
    type: String,
    enum: ['student', 'admin'],
    default: 'student',
    immutable: true,
  },
}, {
  timestamps: true,
  toJSON: {
    transform(_document, returned) {
      delete returned.passwordHash;
      delete returned.adminSessionVersion;
      delete returned.studentSessionVersion;
      delete returned.passwordResetOtpHash;
      delete returned.passwordResetOtpExpiresAt;
      delete returned.passwordResetOtpStatus;
      delete returned.passwordResetOtpActivationConfirmed;
      delete returned.passwordResetOtpAttempts;
      delete returned.passwordResetOtpLastSentAt;
      delete returned.passwordResetOtpResendWindowStartedAt;
      delete returned.passwordResetOtpResendCount;
      delete returned.__v;
      return returned;
    },
  },
});

export default mongoose.models.User ?? mongoose.model('User', userSchema);
