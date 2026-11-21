import { randomBytes, randomInt } from 'node:crypto';
import { normalizeEmail, validEmail } from '../utils/credentials.js';
import {
  registrationDigestsMatch,
  registrationMaxAttempts,
  registrationOtpDigest,
  registrationOtpLifetimeMs,
  registrationProofDigest,
  registrationProofLifetimeMs,
  registrationInvitationRetentionMs,
} from '../services/registrationVerification.js';

const genericRequestMessage = 'If this address and request are eligible, a verification code may be sent. This response does not confirm account status or email delivery.';
const invalidCodeMessage = 'The code is invalid or expired. Request a new code and try again.';
const unavailableMessage = 'Student registration is temporarily unavailable.';

function updateMatched(result) {
  return (result?.matchedCount ?? result?.n ?? 0) > 0;
}

function validPepper(value) {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 32;
}

function genericRegistrationUnavailable(response) {
  return response.status(503).json({
    code: 'PUBLIC_LAUNCH_GATE_CLOSED',
    message: unavailableMessage,
  });
}

export function createRegistrationVerificationController({
  UserModel,
  ChallengeModel,
  emailProvider,
  registrationEnabled = false,
  stagingRestrictedRegistrationEnabled = false,
  registrationEmailVerificationEnabled = false,
  registrationOtpPepper = '',
  now = () => new Date(),
  emailOutbox,
}) {
  const restrictedMode = () => stagingRestrictedRegistrationEnabled;
  const featureAvailable = () => (registrationEnabled || stagingRestrictedRegistrationEnabled)
    && registrationEmailVerificationEnabled
    && validPepper(registrationOtpPepper)
    && typeof emailProvider?.send === 'function';

  return {
    requestOtp: async (request, response, next) => {
      if (!featureAvailable()) return genericRegistrationUnavailable(response);

      const email = normalizeEmail(request.body?.email);
      if (!validEmail(email)) return response.status(400).json({ message: 'Please enter a valid email address.' });

      const restricted = restrictedMode();
      const invitationToken = typeof request.body?.invitationToken === 'string'
        ? request.body.invitationToken.trim() : '';
      const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
      try {
        await emailOutbox.enqueue({
          type: 'registration-verification',
          payload: { email, otp, ...(restricted ? { invitationToken } : {}) },
          expiresAt: new Date(now().getTime() + registrationOtpLifetimeMs),
        });
      } catch {
        console.error('Registration verification email could not be queued.');
        return genericRegistrationUnavailable(response);
      }
      response.status(202).json({ message: genericRequestMessage });
      try { emailOutbox.wake(); } catch { /* The durable poller will retry after another wake or process restart. */ }
      return undefined;
    },

    verifyOtp: async (request, response, next) => {
      if (!featureAvailable()) return genericRegistrationUnavailable(response);

      const email = normalizeEmail(request.body?.email);
      const otp = typeof request.body?.otp === 'string' ? request.body.otp.trim() : '';
      if (!validEmail(email)) return response.status(400).json({ message: 'Please enter a valid email address.' });
      if (!/^\d{6}$/u.test(otp)) return response.status(400).json({ message: invalidCodeMessage });

      try {
        const checkedAt = now();
        const restricted = restrictedMode();
        const challengeQuery = ChallengeModel.findOne({
          email,
          status: 'active',
          activationConfirmed: true,
          expiresAt: { $gt: checkedAt },
          attempts: { $lt: registrationMaxAttempts },
          ...(restricted ? {
            invitationId: { $exists: true },
            invitations: { $elemMatch: {
              _id: { $exists: true },
              status: 'active',
              expiresAt: { $gt: checkedAt },
            } },
          } : {}),
        });
        const challenge = await (typeof challengeQuery?.select === 'function'
          ? challengeQuery.select('+otpDigest +invitationId')
          : challengeQuery);
        const invitationId = challenge?.invitationId;
        const challengeInvitation = restricted ? challenge?.invitations?.find((entry) => String(entry._id) === String(invitationId)
          && entry.status === 'active' && entry.expiresAt > checkedAt) : null;
        const usableChallenge = challenge && (!restricted || challengeInvitation) ? challenge : null;
        const invitationFilter = restricted && invitationId ? {
          invitationId,
          invitations: { $elemMatch: { _id: invitationId, status: 'active', expiresAt: { $gt: checkedAt } } },
        } : {};
        if (!usableChallenge || !registrationDigestsMatch(
          usableChallenge.otpDigest,
          registrationOtpDigest(email, otp, registrationOtpPepper),
        )) {
          if (challenge) {
            const failed = await ChallengeModel.updateOne({
              email,
              otpDigest: challenge.otpDigest,
              status: 'active',
              activationConfirmed: true,
              expiresAt: { $gt: checkedAt },
              attempts: { $lt: registrationMaxAttempts - 1 },
              ...invitationFilter,
            }, { $inc: { attempts: 1 } }, { runValidators: true, writeConcern: { w: 'majority' } });

            if (!updateMatched(failed)) {
              await ChallengeModel.updateOne({
                email,
                otpDigest: challenge.otpDigest,
                status: 'active',
                activationConfirmed: true,
                expiresAt: { $gt: checkedAt },
                attempts: registrationMaxAttempts - 1,
                ...invitationFilter,
              }, {
                $set: { attempts: registrationMaxAttempts, status: 'locked' },
              $unset: { otpDigest: 1, verificationProofDigest: 1, activationConfirmed: 1 },
              }, { runValidators: true, writeConcern: { w: 'majority' } });
            }
          }
          return response.status(400).json({ message: invalidCodeMessage });
        }

        // Do not issue proof for an address that became registered after the
        // request. The public error remains the same as for invalid codes.
        if (await UserModel.exists({ email })) {
          await ChallengeModel.updateOne({ email, otpDigest: challenge.otpDigest, status: 'active', activationConfirmed: true, ...invitationFilter }, {
            $set: { status: 'locked' },
            $unset: { otpDigest: 1, verificationProofDigest: 1, activationConfirmed: 1 },
          }, { writeConcern: { w: 'majority' } }).catch(() => {});
          return response.status(400).json({ message: invalidCodeMessage });
        }

        const token = randomBytes(32).toString('base64url');
        const verifiedAt = now();
        const proofExpiresAt = new Date(verifiedAt.getTime() + registrationProofLifetimeMs);
        const verified = await ChallengeModel.updateOne({
          email,
          otpDigest: challenge.otpDigest,
          status: 'active',
          activationConfirmed: true,
          expiresAt: { $gt: verifiedAt },
          attempts: { $lt: registrationMaxAttempts },
          ...invitationFilter,
        }, {
          $set: {
            status: 'verified',
            verificationProofDigest: registrationProofDigest(email, token, registrationOtpPepper),
            expiresAt: proofExpiresAt,
            cleanupAt: restricted
              ? new Date(challengeInvitation.expiresAt.getTime() + registrationInvitationRetentionMs)
              : new Date(verifiedAt.getTime() + 60 * 60 * 1000),
          },
          $unset: { otpDigest: 1, activationConfirmed: 1 },
        }, { runValidators: true, writeConcern: { w: 'majority' } });

        if (!updateMatched(verified)) return response.status(400).json({ message: invalidCodeMessage });
        return response.status(200).json({
          message: 'Email verified. Continue creating your student account.',
          verificationToken: token,
        });
      } catch (error) {
        return next(error);
      }
    },
  };
}

export default createRegistrationVerificationController;
