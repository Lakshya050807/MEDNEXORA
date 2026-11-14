import { Router } from 'express';
import { createAuthController } from '../controllers/auth.controller.js';
import { requireStudentAuth } from '../middleware/requireStudentAuth.js';
import { verifyOrigin } from '../middleware/verifyOrigin.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

export function createAuthRoutes({ UserModel, registrationEnabled = false }) {
  const router = Router();
  const controller = createAuthController({ UserModel });
  const requireStudent = requireStudentAuth({ UserModel });
  router.use(createRateLimiter({ windowMs: 60 * 1000, max: 300 }));
  const signInLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

  router.post('/register', verifyOrigin, signInLimiter, (request, response, next) => {
    if (!registrationEnabled) {
      return response.status(503).json({
        code: 'PUBLIC_LAUNCH_GATE_CLOSED',
        message: 'New student registration is temporarily unavailable.',
      });
    }
    return controller.register(request, response, next);
  });
  router.post('/login', verifyOrigin, signInLimiter, controller.login);
  router.post('/logout', verifyOrigin, controller.logout);
  router.get('/me', requireStudent, controller.profile);

  return router;
}

export default createAuthRoutes;
