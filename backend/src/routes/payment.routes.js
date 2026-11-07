import { Router } from 'express';
import { createPaymentController } from '../controllers/payment.controller.js';
import { requireStudentAuth } from '../middleware/requireStudentAuth.js';
import { verifyOrigin } from '../middleware/verifyOrigin.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

export function createPaymentRoutes({ UserModel, ...dependencies }) {
  const router = Router();
  const controller = createPaymentController(dependencies);

  router.use(createRateLimiter({ windowMs: 60 * 1000, max: 300 }));
  router.post('/webhook', controller.webhook);
  router.use(requireStudentAuth({ UserModel }));
  router.use(verifyOrigin);
  const checkoutLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 12 });
  const paymentActionLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
  router.post('/orders', checkoutLimiter, controller.createCheckout);
  router.get('/orders', controller.listOrders);
  router.get('/orders/:orderId', controller.getOrder);
  router.post('/orders/:orderId/verify', paymentActionLimiter, controller.verifyPayment);
  router.post('/orders/:orderId/reconcile', paymentActionLimiter, controller.reconcileOrder);
  return router;
}

export default createPaymentRoutes;
