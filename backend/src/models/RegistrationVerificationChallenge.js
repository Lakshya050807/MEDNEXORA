import mongoose from 'mongoose';

const registrationInvitationSchema = new mongoose.Schema({
  tokenDigest: { type: String, required: true, select: false, minlength: 64, maxlength: 64 },
  status: { type: String, required: true, enum: ['active', 'consumed', 'revoked'] },
  issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  consumedAt: Date,
  revokedAt: Date,
});

const registrationVerificationChallengeSchema = new mongoose.Schema({
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  otpDigest: { type: String, select: false, minlength: 64, maxlength: 64 },
  verificationProofDigest: { type: String, select: false, minlength: 64, maxlength: 64 },
  invitations: { type: [registrationInvitationSchema], default: [] },
  invitationId: { type: mongoose.Schema.Types.ObjectId, select: false },
  status: {
    type: String,
    required: true,
    enum: ['invited', 'pending', 'active', 'verified', 'consumed', 'locked'],
  },
  // A challenge is usable only after activation has been acknowledged and this
  // fence is durably written. An ambiguous activation leaves it false.
  activationConfirmed: { type: Boolean, default: false, select: false },
  deliveryJobId: { type: String, select: false, maxlength: 64 },
  deliveryJobCreatedAt: { type: Date, select: false },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, required: true, default: 0, min: 0, max: 5 },
  lastSentAt: Date,
  resendWindowStartedAt: Date,
  resendCount: { type: Number, default: 0, min: 0, max: 5 },
  cleanupAt: { type: Date, required: true },
}, {
  timestamps: true,
  toJSON: {
    transform(_document, returned) {
      delete returned.otpDigest;
      delete returned.verificationProofDigest;
      delete returned.invitationId;
      delete returned.activationConfirmed;
      delete returned.deliveryJobId;
      delete returned.deliveryJobCreatedAt;
      for (const invitation of returned.invitations ?? []) delete invitation.tokenDigest;
      delete returned.__v;
      return returned;
    },
  },
});

registrationVerificationChallengeSchema.index(
  { email: 1 },
  { unique: true, name: 'uniq_registration_verification_email' },
);
registrationVerificationChallengeSchema.index(
  { cleanupAt: 1 },
  { expireAfterSeconds: 0, name: 'ttl_registration_verification_cleanup' },
);
registrationVerificationChallengeSchema.index(
  { 'invitations._id': 1 },
  { name: 'registration_invitation_id' },
);

export default mongoose.models.RegistrationVerificationChallenge
  ?? mongoose.model('RegistrationVerificationChallenge', registrationVerificationChallengeSchema);
