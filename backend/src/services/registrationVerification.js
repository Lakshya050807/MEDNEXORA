import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const registrationOtpLifetimeMs = 10 * 60 * 1000;
export const registrationProofLifetimeMs = 10 * 60 * 1000;
export const registrationResendCooldownMs = 60 * 1000;
export const registrationResendWindowMs = 60 * 60 * 1000;
export const registrationMaxSendsPerHour = 5;
export const registrationMaxAttempts = 5;
export const registrationInvitationMaxCount = 20;
export const registrationInvitationRetentionMs = 30 * 24 * 60 * 60 * 1000;

export function registrationInvitationDigest(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function registrationOtpDigest(email, otp, pepper) {
  return createHmac('sha256', pepper)
    .update(`${email}\0registration-otp\0${otp}`, 'utf8')
    .digest('hex');
}

export function registrationProofDigest(email, token, pepper) {
  return createHmac('sha256', pepper)
    .update(`${email}\0registration-proof\0${token}`, 'utf8')
    .digest('hex');
}

export function registrationDigestsMatch(storedDigest, candidateDigest) {
  if (typeof storedDigest !== 'string' || !/^[a-f\d]{64}$/u.test(storedDigest)
    || typeof candidateDigest !== 'string' || !/^[a-f\d]{64}$/u.test(candidateDigest)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(storedDigest, 'hex'), Buffer.from(candidateDigest, 'hex'));
}

function updateMatched(result) {
  return (result?.matchedCount ?? result?.n ?? 0) > 0;
}

/**
 * Reserves an email-scoped challenge using conditional MongoDB updates. The
 * unique email index resolves simultaneous first inserts; resend counters and
 * cooldown are then re-evaluated atomically by the winning document.
 */
export async function reserveRegistrationChallenge({
  ChallengeModel,
  email,
  digest,
  now,
  matchFilter = {},
  allowCreate = true,
  invitationId,
  cleanupAt,
}) {
  const cooldownBefore = new Date(now.getTime() - registrationResendCooldownMs);
  const windowBefore = new Date(now.getTime() - registrationResendWindowMs);
  const canSend = {
    $or: [
      { lastSentAt: { $exists: false } },
      { lastSentAt: null },
      { lastSentAt: { $lte: cooldownBefore } },
    ],
  };
  const windowExpired = {
    $or: [
      { resendWindowStartedAt: { $exists: false } },
      { resendWindowStartedAt: null },
      { resendWindowStartedAt: { $lte: windowBefore } },
    ],
  };
  const challengeFields = {
    otpDigest: digest,
    status: 'pending',
    activationConfirmed: false,
    expiresAt: new Date(now.getTime() + registrationOtpLifetimeMs),
    attempts: 0,
    lastSentAt: now,
    cleanupAt: cleanupAt ?? new Date(now.getTime() + registrationResendWindowMs),
    ...(invitationId ? { invitationId } : {}),
  };

  const startWindow = async () => ChallengeModel.updateOne({
    email,
    ...matchFilter,
    $and: [canSend, windowExpired],
  }, {
    $set: {
      ...challengeFields,
      resendWindowStartedAt: now,
      resendCount: 1,
    },
    $unset: { verificationProofDigest: 1 },
  }, { runValidators: true });

  const useCurrentWindow = async () => ChallengeModel.updateOne({
    email,
    ...matchFilter,
    $and: [canSend, {
      resendWindowStartedAt: { $gt: windowBefore },
      $or: [
        { resendCount: { $lt: registrationMaxSendsPerHour } },
        { resendCount: { $exists: false } },
      ],
    }],
  }, {
    $set: challengeFields,
    $inc: { resendCount: 1 },
    $unset: { verificationProofDigest: 1 },
  }, { runValidators: true });

  if (updateMatched(await startWindow())) return true;
  if (updateMatched(await useCurrentWindow())) return true;

  if (!allowCreate) return false;

  try {
    await ChallengeModel.create({
      email,
      ...challengeFields,
      resendWindowStartedAt: now,
      resendCount: 1,
    });
    return true;
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  // Another process may have inserted the unique email record. Re-evaluate
  // the cooldown and send count against that record without a second upsert.
  if (updateMatched(await startWindow())) return true;
  return updateMatched(await useCurrentWindow());
}
