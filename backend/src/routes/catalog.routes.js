import { Router } from 'express';
import { createCatalogController } from '../controllers/catalog.controller.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

export function createCatalogRoutes(models) {
  const router = Router();
  router.use(createRateLimiter({ windowMs: 60 * 1000, max: 300 }));
  const controller = createCatalogController(models);
  router.get('/products', controller.listProducts);
  router.get('/products/:id', controller.getProduct);
  router.get('/exams', controller.listExams);
  router.get('/exams/:id', controller.getExam);
  router.get('/subjects', controller.listSubjects);
  router.get('/chapters', controller.listChapters);
  router.get('/topics', controller.listTopics);
  return router;
}

export default createCatalogRoutes;
