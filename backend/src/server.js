import mongoose from 'mongoose';
import MongoStore from 'connect-mongo';
import { createApp } from './app.js';
import { env } from './config/env.js';
import User from './models/User.js';
import Exam from './models/Exam.js';
import Subject from './models/Subject.js';
import Topic from './models/Topic.js';
import Chapter from './models/Chapter.js';
import StudyMaterial from './models/StudyMaterial.js';
import Course from './models/Course.js';
import QuestionBank from './models/QuestionBank.js';
import MockTest from './models/MockTest.js';
import TestAttempt from './models/TestAttempt.js';
import Order from './models/Order.js';
import PurchasedAccess from './models/PurchasedAccess.js';
import CourseProgress from './models/CourseProgress.js';
import PaymentWebhookEvent from './models/PaymentWebhookEvent.js';
import PaymentRefund from './models/PaymentRefund.js';
import PasswordResetRateLimit from './models/PasswordResetRateLimit.js';
import RegistrationVerificationChallenge from './models/RegistrationVerificationChallenge.js';
import EmailDeliveryOutbox from './models/EmailDeliveryOutbox.js';
import ProductAccessRevocation from './models/ProductAccessRevocation.js';
import { ensurePrimaryExamIndex } from './db/ensure-primary-exam-index.js';
import { startApiServer } from './server-lifecycle.js';

async function ensurePurchaseReservationBackfill(OrderModel) {
  const legacyActiveOrders = await OrderModel.countDocuments({
    status: { $in: ['pending', 'failed', 'paid'] },
    $or: [
      { reservationProductIds: { $exists: false } },
      { reservationProductIds: { $size: 0 } },
    ],
  });
  if (legacyActiveOrders > 0) {
    throw new Error('Payment reservation migration is required. Run `npm run payments:reservations:backfill -- --apply` before starting the API.');
  }
}

async function startServer() {
  await startApiServer({
    mongooseClient: mongoose,
    envConfig: env,
    MongoStoreFactory: MongoStore,
    createApp,
    ExamModel: Exam,
    OrderModel: Order,
    models: [
      User, Exam, Subject, Chapter, Topic, StudyMaterial, Course,
      QuestionBank, MockTest, TestAttempt, Order, PurchasedAccess, ProductAccessRevocation, CourseProgress,
      PaymentWebhookEvent, PaymentRefund, PasswordResetRateLimit, RegistrationVerificationChallenge, EmailDeliveryOutbox,
    ],
    ensurePrimaryExamIndex,
    ensurePurchaseReservationBackfill,
    onListening({ server, serverApp, sessionStore }) {
      console.log(`Nursing learning API listening on port ${env.port}`);
      const shutdown = () => {
        server.close(async () => {
          await serverApp.locals.emailOutbox.stop();
          await sessionStore.close();
          await mongoose.disconnect();
          process.exit(0);
        });
      };
      process.once('SIGINT', shutdown);
      try {
        process.once('SIGTERM', shutdown);
      } catch (error) {
        process.removeListener('SIGINT', shutdown);
        throw error;
      }
      return () => {
        process.removeListener('SIGINT', shutdown);
        process.removeListener('SIGTERM', shutdown);
      };
    },
  });
}

startServer().catch(async (error) => {
  console.error('The API could not start. Check MongoDB and the server environment configuration.');
  if (env.nodeEnv !== 'production') console.error(error?.name ?? 'StartupError');
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});

