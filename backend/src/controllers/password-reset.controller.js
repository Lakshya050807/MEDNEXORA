import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, normalizeEmail, passwordValidationMessage, validEmail } from '../utils/credentials.js';

const resetLifetimeMs = 60 * 60 * 1000;
const genericRequestMessage = 'If an account exists for that email, reset instructions will be sent.';
const unavailableMessage = 'Password recovery email is temporarily unavailable. Please try again later.';
const invalidTokenMessage = 'This password reset link is invalid or expired.';

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
  clock = () => new Date(),
}) {
  const unavailable = (response) => response.status(503).json({ message: unavailableMessage });

  return {
    request: async (request, response, next) => {
      if (!emailEnabled || !emailSender?.configured) return unavailable(response);
      const email = normalizeEmail(request.body?.email);
      try {
        if (validEmail(email)) {
          const user = await UserModel.findOne({ email, role: 'student' });
          if (user) {
            const now = clock();
            const token = issueToken(now);
            const pending = await UserModel.findOneAndUpdate({ _id: user._id ?? user.id, role: 'student' }, {
              $set: {
                passwordResetTokenHash: token.digest,
                passwordResetExpiresAt: token.expiresAt,
                passwordResetStatus: 'pending',
                passwordResetActivationConfirmed: false,
              },
            }, { new: true, writeConcern: { w: 'majority' } });

            if (pending) {
              try {
                await emailSender.sendPasswordReset({ to: email, url: resetUrl(appOrigin, token.token) });
                const activationFilter = {
                  _id: user._id ?? user.id,
                  role: 'student',
                  passwordResetTokenHash: token.digest,
                  passwordResetExpiresAt: { $gt: clock() },
                  passwordResetStatus: 'pending',
                  passwordResetActivationConfirmed: false,
                };
                const active = await UserModel.findOneAndUpdate(activationFilter, {
                  $set: { passwordResetStatus: 'active' },
                }, { new: true, writeConcern: { w: 'majority' } });
                if (active) {
                  await UserModel.findOneAndUpdate({
                    _id: user._id ?? user.id,
                    role: 'student',
                    passwordResetTokenHash: token.digest,
                    passwordResetExpiresAt: { $gt: clock() },
                    passwordResetStatus: 'active',
                    passwordResetActivationConfirmed: false,
                  }, {
                    $set: { passwordResetActivationConfirmed: true },
                  }, { new: true, writeConcern: { w: 'majority' } });
                }
              } catch {
                // A pending challenge is never accepted. Cleanup is conditional so
                // this request cannot erase a newer reset request's token.
                try {
                  await UserModel.findOneAndUpdate({
                    _id: user._id ?? user.id,
                    passwordResetTokenHash: token.digest,
                  }, {
                    $unset: {
                      passwordResetTokenHash: 1,
                      passwordResetExpiresAt: 1,
                      passwordResetStatus: 1,
                      passwordResetActivationConfirmed: 1,
                    },
                  }, { new: true, writeConcern: { w: 'majority' } });
                } catch {
                  // Fail closed even if cleanup is unavailable: reset requires
                  // both active status and the confirmation fence.
                }
                console.error('Password reset email delivery or activation failed.');
              }
            }
          }
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
