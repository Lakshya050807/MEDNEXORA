import { Router } from 'express';
import { createStudentCourseController } from '../controllers/course.controller.js';
import { requireStudentAuth } from '../middleware/requireStudentAuth.js';
import { verifyOrigin } from '../middleware/verifyOrigin.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

export function createStudentCourseRoutes({ UserModel, ...models }) {
  const router = Router();
  const controller = createStudentCourseController(models);
  router.use(createRateLimiter({ windowMs: 60 * 1000, max: 300 }));
  router.use(requireStudentAuth({ UserModel }));
  router.get('/', controller.listMyCourses);
  router.get('/:courseId/progress', controller.getProgress);
  router.post('/:courseId/lessons/:lessonId/complete', verifyOrigin, controller.completeLesson);
  router.get('/:courseId/lessons/:lessonId/playback', controller.getLessonPlayback);
  return router;
}

export default createStudentCourseRoutes;
