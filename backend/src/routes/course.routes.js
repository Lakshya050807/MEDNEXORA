import { Router } from 'express';
import { createCourseController } from '../controllers/course.controller.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

export function createCourseRoutes(models) {
  const router = Router();
  router.use(createRateLimiter({ windowMs: 60 * 1000, max: 300 }));
  const controller = createCourseController(models);
  router.get('/flagship-preview', controller.getFlagshipDraftPreview);
  router.get('/', controller.listCourses);
  router.get('/:id', controller.getCourse);
  router.get('/:courseId/lessons/:lessonId/preview', controller.getPreviewPlayback);
  return router;
}

export default createCourseRoutes;
