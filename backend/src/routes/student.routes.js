import { Router } from 'express';
import { createStudentController } from '../controllers/student.controller.js';
import { requireStudentAuth } from '../middleware/requireStudentAuth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { verifyOrigin } from '../middleware/verifyOrigin.js';

export function createStudentRoutes({ UserModel, ...models }) {
  const router = Router();
  router.use(createRateLimiter({ windowMs: 60 * 1000, max: 300 }));
  router.use(requireStudentAuth({ UserModel }));
  const controller = createStudentController(models);
  router.get('/dashboard', controller.getStudentDashboard);
  router.post('/resources/:productId/access', verifyOrigin, createRateLimiter({ windowMs: 60 * 1000, max: 30 }), controller.claimFreeMaterial);
  router.get('/resources/:productId/download', controller.downloadPurchasedResource);
  return router;
}

export default createStudentRoutes;
