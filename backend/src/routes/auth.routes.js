import { Router } from 'express';
import { createAuthController } from '../controllers/auth.controller.js';
import { createRegistrationVerificationController } from '../controllers/registration-verification.controller.js';
import { requireStudentAuth } from '../middleware/requireStudentAuth.js';
import { verifyOrigin } from '../middleware/verifyOrigin.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { createMongoRateLimiter } from '../middleware/mongoRateLimit.js';
import { normalizeEmail } from '../utils/credentials.js';

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
  emailOutbox,
  backgroundTaskScheduler,
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
    emailOutbox,
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
    emailOutbox,
  });
  const requireStudent = requireStudentAuth({ UserModel });
  router.use(createRateLimiter({ windowMs: 60 * 1000, max: 300 }));
  const studentLoginIpLimiter = createMongoRateLimiter({
    RateLimitModel: PasswordResetRateLimitModel,
    secret: passwordResetRateLimitSecret,
    scope: 'student-login-ip',
    windowMs: 15 * 60 * 1000,
    max: 20,
    unavailableMessage: 'Sign-in is temporarily unavailable.',
  });
  const studentLoginAccountLimiter = createMongoRateLimiter({
    RateLimitModel: PasswordResetRateLimitModel,
    secret: passwordResetRateLimitSecret,
    scope: 'student-login-account',
    keyResolver: (request) => normalizeEmail(request.body?.email),
    windowMs: 15 * 60 * 1000,
    max: 20,
    unavailableMessage: 'Sign-in is temporarily unavailable.',
  });
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
  router.post('/register', verifyOrigin, requireRegistrationEnabled, registrationCompletionLimiter, controller.register);
  router.post('/login', verifyOrigin, studentLoginIpLimiter, studentLoginAccountLimiter, controller.login);
  router.post('/logout', verifyOrigin, controller.logout);
  router.post('/password-reset/request', verifyOrigin, resetRequestLimiter, controller.requestPasswordReset);
  router.post('/password-reset/complete', verifyOrigin, resetCompletionLimiter, controller.completePasswordReset);
  router.get('/me', requireStudent, controller.profile);

  return router;
}

export default createAuthRoutes;
