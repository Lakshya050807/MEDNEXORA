import { createHmac, randomBytes, randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { clearSessionCookie, destroyStudentSession, regenerateStudentSession } from '../utils/session.js';
import { toStudentProfile } from '../utils/student.js';
import { hashPassword, normalizeEmail, passwordValidationMessage, validEmail } from '../utils/credentials.js';
import { passwordResetOtpLifetimeMs } from '../services/emailDeliveryOutbox.js';
import {
  registrationInvitationDigest,
  registrationInvitationRetentionMs,
  registrationProofDigest,
} from '../services/registrationVerification.js';

const dummyPasswordHash = bcrypt.hashSync(randomBytes(32).toString('hex'), 12);
const passwordResetMaxVerificationAttempts = 5;
const passwordResetRequestMessage = 'If this address is eligible, a reset request is being processed. This response does not confirm account status or email delivery.';
const passwordResetInvalidOtpMessage = 'The code is invalid or expired. Request a new code and try again.';
const registrationProofInvalidMessage = 'The email verification could not be completed. Request a new code and try again.';

function updateMatched(result) {
  return (result?.matchedCount ?? result?.n ?? 0) > 0;
}

function otpDigest(email, otp, pepper) {
  return createHmac('sha256', pepper).update(`${email}\0${otp}`, 'utf8').digest('hex');
}

function validOtpPepper(pepper) {
  return typeof pepper === 'string' && Buffer.byteLength(pepper, 'utf8') >= 32;
}

function duplicateEmailError(error) {
  return error?.code === 11000 && (error?.keyPattern?.email || error?.keyValue?.email);
}

export function createAuthController({
  UserModel,
  RegistrationVerificationChallengeModel,
  registrationEnabled = false,
  stagingRestrictedRegistrationEnabled = false,
  registrationEmailVerificationEnabled = false,
  registrationOtpPepper = '',
  registrationNow = () => new Date(),
  emailProvider,
  passwordResetEmailEnabled = false,
  passwordResetOtpPepper = '',
  now = () => new Date(),
  emailOutbox,
}) {
  return {
    register: async (request, response, next) => {
      if (!registrationEmailVerificationEnabled || Buffer.byteLength(registrationOtpPepper, 'utf8') < 32) {
        return response.status(503).json({
          code: 'PUBLIC_LAUNCH_GATE_CLOSED',
          message: 'Student registration is temporarily unavailable until email verification is configured.',
        });
      }

      const body = request.body ?? {};
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const email = normalizeEmail(body.email);
      const password = typeof body.password === 'string' ? body.password : '';
      const verificationToken = typeof body.verificationToken === 'string' ? body.verificationToken : '';
      const invitationToken = typeof body.invitationToken === 'string' ? body.invitationToken.trim() : '';
      const restrictedRegistration = stagingRestrictedRegistrationEnabled;

      const missingFields = [];
      if (!name) missingFields.push('name');
      if (!email) missingFields.push('email address');
      if (!password) missingFields.push('password');
      if (missingFields.length) {
        return response.status(400).json({ message: `Missing required fields: ${missingFields.join(', ')}.` });
      }

      if (name.length < 2 || name.length > 80) {
        return response.status(400).json({ message: 'Enter your name using 2 to 80 characters.' });
      }
      if (!validEmail(email)) {
        return response.status(400).json({ message: 'Please enter a valid email address.' });
      }
      const passwordError = passwordValidationMessage(password);
      if (passwordError) return response.status(400).json({ message: passwordError });
      if (!/^[A-Za-z0-9_-]{43}$/u.test(verificationToken)) {
        return response.status(400).json({ message: registrationProofInvalidMessage });
      }
      if (restrictedRegistration && !/^[A-Za-z0-9_-]{43}$/u.test(invitationToken)) {
        return response.status(400).json({ message: registrationProofInvalidMessage });
      }

      try {
        if (await UserModel.exists({ email })) {
          return response.status(400).json({ message: registrationProofInvalidMessage });
        }

        const passwordHash = await hashPassword(password);
        const consumedAt = registrationNow();
        const proofDigest = registrationProofDigest(email, verificationToken, registrationOtpPepper);
        const invitationDigest = restrictedRegistration ? registrationInvitationDigest(invitationToken) : null;
        let verifiedChallenge = null;
        const challengeQuery = {
          email,
          status: 'verified',
          verificationProofDigest: proofDigest,
          expiresAt: { $gt: consumedAt },
        };
        if (restrictedRegistration) {
          const verifiedQuery = RegistrationVerificationChallengeModel.findOne(challengeQuery);
          verifiedChallenge = await (typeof verifiedQuery?.select === 'function'
            ? verifiedQuery.select('+invitationId')
            : verifiedQuery);
          if (!verifiedChallenge?.invitationId) {
            return response.status(400).json({ message: registrationProofInvalidMessage });
          }
          const invitation = verifiedChallenge.invitations?.find((entry) => String(entry._id) === String(verifiedChallenge.invitationId)
            && entry.status === 'active' && entry.expiresAt > consumedAt);
          if (!invitation) return response.status(400).json({ message: registrationProofInvalidMessage });
          challengeQuery.invitationId = verifiedChallenge.invitationId;
          challengeQuery.invitations = { $elemMatch: {
            _id: verifiedChallenge.invitationId,
            tokenDigest: invitationDigest,
            status: 'active',
            expiresAt: { $gt: consumedAt },
          } };
        }
        const consumed = await RegistrationVerificationChallengeModel.updateOne({
          ...challengeQuery,
        }, {
          $set: {
            status: 'consumed',
            ...(restrictedRegistration ? {
              'invitations.$.status': 'consumed',
              'invitations.$.consumedAt': consumedAt,
              cleanupAt: new Date(verifiedChallenge.invitations.find((entry) => String(entry._id) === String(verifiedChallenge.invitationId)).expiresAt.getTime() + registrationInvitationRetentionMs),
            } : {}),
          },
          $unset: {
            verificationProofDigest: 1,
            otpDigest: 1,
            activationConfirmed: 1,
            ...(restrictedRegistration ? { invitationId: 1 } : {}),
          },
        }, { runValidators: true, writeConcern: { w: 'majority' } });
        if ((consumed?.matchedCount ?? consumed?.n ?? 0) === 0) {
          return response.status(400).json({ message: registrationProofInvalidMessage });
        }

        const user = await UserModel.create({
          name,
          email,
          passwordHash,
          role: 'student',
          emailVerified: true,
        });
        await regenerateStudentSession(request, user._id ?? user.id, user.studentSessionVersion);
        return response.status(201).json({ user: toStudentProfile(user) });
      } catch (error) {
        if (duplicateEmailError(error)) {
          return response.status(400).json({ message: registrationProofInvalidMessage });
        }
        return next(error);
      }
    },

    login: async (request, response, next) => {
      const email = normalizeEmail(request.body?.email);
      const password = typeof request.body?.password === 'string' ? request.body.password : '';

      if (!validEmail(email) || !password || Buffer.byteLength(password, 'utf8') > 72) {
        return response.status(400).json({ message: 'Enter a valid email address and password.' });
      }

      try {
        const user = await UserModel.findOne({ email }).select('+passwordHash +studentSessionVersion');
        const passwordHash = user?.passwordHash ?? dummyPasswordHash;
        const passwordMatches = await bcrypt.compare(password, passwordHash);
        if (!user || !passwordMatches || user.role !== 'student') {
          return response.status(401).json({ message: 'Email or password is incorrect.' });
        }

        await regenerateStudentSession(request, user._id ?? user.id, user.studentSessionVersion);
        return response.status(200).json({ user: toStudentProfile(user) });
      } catch (error) {
        return next(error);
      }
    },

    logout: async (request, response, next) => {
      try {
        await destroyStudentSession(request);
        clearSessionCookie(response);
        return response.status(204).end();
      } catch (error) {
        return next(error);
      }
    },

    profile: (request, response) => response.status(200).json({ user: request.student }),

    requestPasswordReset: async (request, response, next) => {
      if (!passwordResetEmailEnabled || !validOtpPepper(passwordResetOtpPepper)
        || typeof emailProvider?.send !== 'function') {
        return response.status(503).json({ message: 'Password reset is temporarily unavailable.' });
      }

      const email = normalizeEmail(request.body?.email);
      if (!validEmail(email)) return response.status(400).json({ message: 'Please enter a valid email address.' });

      const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
      try {
        await emailOutbox.enqueue({
          type: 'password-reset',
          payload: { email, otp },
          expiresAt: new Date(now().getTime() + passwordResetOtpLifetimeMs),
        });
      } catch {
        console.error('Password reset email could not be queued.');
        return response.status(503).json({ message: 'Password reset is temporarily unavailable. Please try again later.' });
      }
      response.status(202).json({ message: passwordResetRequestMessage });
      try { emailOutbox.wake(); } catch { /* The durable poller will retry after this process or another instance wakes. */ }
      return undefined;
    },

    completePasswordReset: async (request, response, next) => {
      if (!passwordResetEmailEnabled || !validOtpPepper(passwordResetOtpPepper)) {
        return response.status(503).json({ message: 'Password reset is temporarily unavailable.' });
      }

      const body = request.body ?? {};
      const email = normalizeEmail(body.email);
      const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
      const missing = [];
      if (!email) missing.push('email address');
      if (!otp) missing.push('verification code');
      if (!newPassword) missing.push('new password');
      if (!confirmPassword) missing.push('confirm password');
      if (missing.length) return response.status(400).json({ message: `Missing required fields: ${missing.join(', ')}.` });
      if (!validEmail(email)) return response.status(400).json({ message: 'Please enter a valid email address.' });
      if (!/^\d{6}$/u.test(otp)) return response.status(400).json({ message: passwordResetInvalidOtpMessage });
      const passwordError = passwordValidationMessage(newPassword);
      if (passwordError) return response.status(400).json({ message: passwordError });
      if (newPassword !== confirmPassword) return response.status(400).json({ message: 'The passwords do not match.' });

      try {
        const digest = otpDigest(email, otp, passwordResetOtpPepper);
        const passwordHash = await hashPassword(newPassword);
        const completedAt = now();
        const completed = await UserModel.updateOne({
          email,
          role: 'student',
          passwordResetOtpHash: digest,
          passwordResetOtpStatus: 'active',
          passwordResetOtpActivationConfirmed: true,
          passwordResetOtpExpiresAt: { $gt: completedAt },
          passwordResetOtpAttempts: { $lt: passwordResetMaxVerificationAttempts },
        }, {
          $set: { passwordHash },
          $inc: { studentSessionVersion: 1 },
          // Keep send-window counters so a successful reset cannot bypass the
          // per-account cooldown or hourly email cap.
          // Keep the last delivery job identity as a tombstone. A stale worker
          // must not recreate this already-consumed OTP if terminal job marking
          // lost its acknowledgement and the worker later retries.
          $unset: {
            passwordResetOtpHash: 1,
            passwordResetOtpExpiresAt: 1,
            passwordResetOtpStatus: 1,
            passwordResetOtpActivationConfirmed: 1,
            passwordResetOtpAttempts: 1,
          },
        }, { runValidators: true, writeConcern: { w: 'majority' } });

        if (updateMatched(completed)) {
          return response.status(200).json({ message: 'Your password has been reset. Please log in with your new password.' });
        }

        const invalidAttemptFilter = {
          email,
          role: 'student',
          passwordResetOtpHash: { $exists: true },
          passwordResetOtpStatus: 'active',
          passwordResetOtpActivationConfirmed: true,
          passwordResetOtpExpiresAt: { $gt: completedAt },
          passwordResetOtpAttempts: { $lt: passwordResetMaxVerificationAttempts },
        };
        const attempts = await UserModel.updateOne({
          ...invalidAttemptFilter,
          passwordResetOtpAttempts: { $lt: passwordResetMaxVerificationAttempts - 1 },
        }, { $inc: { passwordResetOtpAttempts: 1 } }, { runValidators: true });
        if (!updateMatched(attempts)) {
          // On the fifth incorrect code, atomically lock and invalidate the
          // challenge. Correct and incorrect concurrent submissions serialize
          // against the same challenge fields in MongoDB.
          await UserModel.updateOne({
            ...invalidAttemptFilter,
            passwordResetOtpAttempts: passwordResetMaxVerificationAttempts - 1,
          }, {
            $set: { passwordResetOtpAttempts: passwordResetMaxVerificationAttempts },
            $unset: {
              passwordResetOtpHash: 1,
              passwordResetOtpExpiresAt: 1,
              passwordResetOtpStatus: 1,
              passwordResetOtpActivationConfirmed: 1,
            },
          }, { runValidators: true });
        }
        return response.status(400).json({ message: passwordResetInvalidOtpMessage });
      } catch (error) {
        return next(error);
      }
    },
  };
}
