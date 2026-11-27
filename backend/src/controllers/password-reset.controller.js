import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hashPassword, normalizeEmail, passwordValidationMessage, validEmail } from '../utils/credentials.js';

const resetLifetimeMs = 60 * 60 * 1000;
const genericRequestMessage = 'If an account exists for that email, reset instructions will be sent.';
const unavailableMessage = 'Password recovery email is temporarily unavailable. Please try again later.';
const invalidTokenMessage = 'This password reset link is invalid or expired.';
const recoveryDiagnosticEvents = new Set([
  'recovery_request_received',
  'student_lookup_matched',
  'student_lookup_not_matched',
  'student_lookup_failed',
  'challenge_write_acknowledged',
  'challenge_write_failed',
  'sender_invoked',
  'sender_accepted',
  'sender_failed',
  'challenge_activation_succeeded',
  'challenge_activation_failed',
  'challenge_cleanup_succeeded',
  'challenge_cleanup_failed',
]);

function emitRecoveryDiagnostic(logger, event, requestId) {
  if (!recoveryDiagnosticEvents.has(event)) return;
  try {
    logger(JSON.stringify({ event, requestId }));
  } catch {
    // Diagnostics must never change password-reset behavior.
  }
}

async function cleanupChallenge(UserModel, userId, digest, emit) {
  try {
    await UserModel.findOneAndUpdate({
      _id: userId,
      passwordResetTokenHash: digest,
    }, {
      $unset: {
        passwordResetTokenHash: 1,
        passwordResetExpiresAt: 1,
        passwordResetStatus: 1,
        passwordResetActivationConfirmed: 1,
      },
    }, { new: true, writeConcern: { w: 'majority' } });
    emit('challenge_cleanup_succeeded');
  } catch {
    emit('challenge_cleanup_failed');
    // Cleanup is best-effort. Completion still requires active status and the
    // activation-confirmation fence, so uncertain challenges remain unusable.
  }
}

function issueToken(now) {
  const token = randomBytes(32).toString('hex');
  return {
    token,
    digest: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(now.getTime() + resetLifetimeMs),
  };
}

function digestToken(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/iu.test(token)) return null;
  return createHash('sha256').update(token).digest('hex');
}

function resetUrl(appOrigin, token) {
  const url = new URL('/reset-password', appOrigin);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

export function createPasswordResetController({
  UserModel,
  emailSender,
  emailEnabled = false,
  appOrigin,
  diagnosticLogger = (line) => console.info(line),
  clock = () => new Date(),
}) {
  const unavailable = (response) => response.status(503).json({ message: unavailableMessage });

  return {
    request: async (request, response, next) => {
      const requestId = randomUUID();
      const emit = (event) => emitRecoveryDiagnostic(diagnosticLogger, event, requestId);
      emit('recovery_request_received');
      if (!emailEnabled || !emailSender?.configured) return unavailable(response);
      const email = normalizeEmail(request.body?.email);
      try {
        if (!validEmail(email)) {
          emit('student_lookup_not_matched');
          return response.status(202).json({ message: genericRequestMessage });
        }

        let user;
        try {
          user = await UserModel.findOne({ email, role: 'student' });
        } catch (error) {
          emit('student_lookup_failed');
          throw error;
        }
        if (!user) {
          emit('student_lookup_not_matched');
          return response.status(202).json({ message: genericRequestMessage });
        }
        emit('student_lookup_matched');

        const userId = user._id ?? user.id;
        const token = issueToken(clock());
        let pending;
        try {
          pending = await UserModel.findOneAndUpdate({ _id: userId, role: 'student' }, {
            $set: {
              passwordResetTokenHash: token.digest,
              passwordResetExpiresAt: token.expiresAt,
              passwordResetStatus: 'pending',
              passwordResetActivationConfirmed: false,
            },
          }, { new: true, writeConcern: { w: 'majority' } });
        } catch (error) {
          emit('challenge_write_failed');
          throw error;
        }
        if (!pending) {
          emit('challenge_write_failed');
          return response.status(202).json({ message: genericRequestMessage });
        }
        emit('challenge_write_acknowledged');

        emit('sender_invoked');
        try {
          await emailSender.sendPasswordReset({ to: email, url: resetUrl(appOrigin, token.token) });
        } catch {
          emit('sender_failed');
          await cleanupChallenge(UserModel, userId, token.digest, emit);
          return response.status(202).json({ message: genericRequestMessage });
        }
        emit('sender_accepted');

        try {
          const activationFilter = {
            _id: userId,
            role: 'student',
            passwordResetTokenHash: token.digest,
            passwordResetExpiresAt: { $gt: clock() },
            passwordResetStatus: 'pending',
            passwordResetActivationConfirmed: false,
          };
          const active = await UserModel.findOneAndUpdate(activationFilter, {
            $set: { passwordResetStatus: 'active' },
          }, { new: true, writeConcern: { w: 'majority' } });
          if (!active) {
            emit('challenge_activation_failed');
            return response.status(202).json({ message: genericRequestMessage });
          }

          const confirmed = await UserModel.findOneAndUpdate({
            _id: userId,
            role: 'student',
            passwordResetTokenHash: token.digest,
            passwordResetExpiresAt: { $gt: clock() },
            passwordResetStatus: 'active',
            passwordResetActivationConfirmed: false,
          }, {
            $set: { passwordResetActivationConfirmed: true },
          }, { new: true, writeConcern: { w: 'majority' } });
          if (!confirmed) {
            emit('challenge_activation_failed');
            return response.status(202).json({ message: genericRequestMessage });
          }
          emit('challenge_activation_succeeded');
        } catch {
          emit('challenge_activation_failed');
          await cleanupChallenge(UserModel, userId, token.digest, emit);
        }
        return response.status(202).json({ message: genericRequestMessage });
      } catch (error) {
        return next(error);
      }
    },

    complete: async (request, response, next) => {
      if (!emailEnabled) return unavailable(response);
      const body = request.body ?? {};
      const digest = digestToken(body.token);
      if (!digest) return response.status(400).json({ message: invalidTokenMessage });
      const passwordError = passwordValidationMessage(body.password);
      if (passwordError) return response.status(400).json({ message: passwordError });
      if (body.password !== body.confirmPassword) return response.status(400).json({ message: 'Passwords do not match.' });

      try {
        const passwordHash = await hashPassword(body.password);
        const user = await UserModel.findOneAndUpdate({
          passwordResetTokenHash: digest,
          passwordResetExpiresAt: { $gt: clock() },
          passwordResetStatus: 'active',
          passwordResetActivationConfirmed: true,
          role: 'student',
        }, {
          $set: { passwordHash },
          $inc: { studentSessionVersion: 1 },
          $unset: {
            passwordResetTokenHash: 1,
            passwordResetExpiresAt: 1,
            passwordResetStatus: 1,
            passwordResetActivationConfirmed: 1,
          },
        }, { new: true, writeConcern: { w: 'majority' } });
        if (!user) return response.status(400).json({ message: invalidTokenMessage });
        return response.status(200).json({ message: 'Your password has been updated. Please log in again.' });
      } catch (error) {
        return next(error);
      }
    },
  };
}
