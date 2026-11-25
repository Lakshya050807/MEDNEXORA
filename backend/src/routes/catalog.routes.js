import { Router } from 'express';
import { createCatalogController } from '../controllers/catalog.controller.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

export function createCatalogRoutes(models) {
  const router = Router();
  const limitCatalogRequests = createRateLimiter({ windowMs: 60 * 1000, max: 300 });
  const controller = createCatalogController(models);
  router.get('/products', limitCatalogRequests, controller.listProducts);
  router.get('/products/:id', limitCatalogRequests, controller.getProduct);
  router.get('/exams', limitCatalogRequests, controller.listExams);
  router.get('/exams/:id', limitCatalogRequests, controller.getExam);
  router.get('/subjects', limitCatalogRequests, controller.listSubjects);
  router.get('/chapters', limitCatalogRequests, controller.listChapters);
  router.get('/topics', limitCatalogRequests, controller.listTopics);
  return router;
}

export default createCatalogRoutes;
