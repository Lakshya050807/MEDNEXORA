import { Router } from 'express';
import { createPracticeController } from '../controllers/practice.controller.js';
import { requireStudentAuth } from '../middleware/requireStudentAuth.js';
import { verifyOrigin } from '../middleware/verifyOrigin.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

export function createPracticeRoutes({ UserModel, ...models }) {
  const router = Router();
  router.use(createRateLimiter({ windowMs: 60 * 1000, max: 300 }));
  router.use(requireStudentAuth({ UserModel }));
  const controller = createPracticeController(models);
  const attemptMutationLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 120 });
  router.get('/question-banks', controller.listQuestionBanks);
  router.get('/mock-tests', controller.listMockTests);
  router.post('/attempts', verifyOrigin, attemptMutationLimiter, controller.startAttempt);
  router.get('/attempts', controller.history);
  router.get('/attempts/:id', controller.getAttempt);
  router.patch('/attempts/:id/questions/:questionId', verifyOrigin, attemptMutationLimiter, controller.updateAnswer);
  router.post('/attempts/:id/submit', verifyOrigin, attemptMutationLimiter, controller.submitAttempt);
  return router;
}

export default createPracticeRoutes;
