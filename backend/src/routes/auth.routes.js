import { Router } from 'express';
import { createAuthController } from '../controllers/auth.controller.js';
import { createRegistrationVerificationController } from '../controllers/registration-verification.controller.js';
import { requireStudentAuth } from '../middleware/requireStudentAuth.js';
import { verifyOrigin } from '../middleware/verifyOrigin.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { createMongoRateLimiter } from '../middleware/mongoRateLimit.js';

export function createAuthRoutes({
  UserModel,
  RegistrationVerificationChallengeModel,
  PasswordResetRateLimitModel,
  registrationEnabled = false,
  stagingRestrictedRegistrationEnabled = false,
  registrationEmailVerificationEnabled = false,
  registrationOtpPepper = '',
  registrationEmailProvider,
  registrationNow,
  passwordResetEmailEnabled = false,
  passwordResetOtpPepper = '',
  passwordResetEmailProvider,
  passwordResetRateLimitSecret,
  passwordResetNow,
}) {
  const router = Router();
  const controller = createAuthController({
    UserModel,
    RegistrationVerificationChallengeModel,
    registrationEnabled,
    stagingRestrictedRegistrationEnabled,
    registrationEmailVerificationEnabled,
    registrationOtpPepper,
    registrationNow,
    emailProvider: passwordResetEmailProvider,
    passwordResetEmailEnabled,
    passwordResetOtpPepper,
    now: passwordResetNow,
  });
  const registrationController = createRegistrationVerificationController({
    UserModel,
    ChallengeModel: RegistrationVerificationChallengeModel,
    emailProvider: registrationEmailProvider ?? passwordResetEmailProvider,
    registrationEnabled,
    stagingRestrictedRegistrationEnabled,
    registrationEmailVerificationEnabled,
    registrationOtpPepper,
    now: registrationNow,
  });
  const requireStudent = requireStudentAuth({ UserModel });
  router.use(createRateLimiter({ windowMs: 60 * 1000, max: 300 }));
  const signInLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
  const resetRequestLimiter = createMongoRateLimiter({
    RateLimitModel: PasswordResetRateLimitModel,
    secret: passwordResetRateLimitSecret,
    scope: 'request',
    windowMs: 15 * 60 * 1000,
    max: 10,
  });
  const resetCompletionLimiter = createMongoRateLimiter({
    RateLimitModel: PasswordResetRateLimitModel,
    secret: passwordResetRateLimitSecret,
    scope: 'complete',
    windowMs: 15 * 60 * 1000,
    max: 20,
  });
  const registrationRequestLimiter = createMongoRateLimiter({
    RateLimitModel: PasswordResetRateLimitModel,
    secret: passwordResetRateLimitSecret,
    scope: 'registration-request',
    windowMs: 15 * 60 * 1000,
    max: 10,
    unavailableMessage: 'Student registration is temporarily unavailable.',
  });
  const registrationCompletionLimiter = createMongoRateLimiter({
    RateLimitModel: PasswordResetRateLimitModel,
    secret: passwordResetRateLimitSecret,
    scope: 'registration-complete',
    windowMs: 15 * 60 * 1000,
    max: 20,
    unavailableMessage: 'Student registration is temporarily unavailable.',
  });

  const requireRegistrationEnabled = (request, response, next) => {
    if (!registrationEnabled && !stagingRestrictedRegistrationEnabled) {
      return response.status(503).json({
        code: 'PUBLIC_LAUNCH_GATE_CLOSED',
        message: 'New student registration is temporarily unavailable.',
      });
    }
    if (!registrationEmailVerificationEnabled) {
      return response.status(503).json({
        code: 'REGISTRATION_EMAIL_VERIFICATION_UNAVAILABLE',
        message: 'Student registration is temporarily unavailable.',
      });
    }
    return next();
  };

  router.post('/registration/request-otp', verifyOrigin, requireRegistrationEnabled, registrationRequestLimiter, registrationController.requestOtp);
  router.post('/registration/verify-otp', verifyOrigin, requireRegistrationEnabled, registrationCompletionLimiter, registrationController.verifyOtp);
  router.post('/register', verifyOrigin, requireRegistrationEnabled, registrationCompletionLimiter, signInLimiter, controller.register);
  router.post('/login', verifyOrigin, signInLimiter, controller.login);
  router.post('/logout', verifyOrigin, controller.logout);
  router.post('/password-reset/request', verifyOrigin, resetRequestLimiter, controller.requestPasswordReset);
  router.post('/password-reset/complete', verifyOrigin, resetCompletionLimiter, controller.completePasswordReset);
  router.get('/me', requireStudent, controller.profile);

  return router;
}

export default createAuthRoutes;
