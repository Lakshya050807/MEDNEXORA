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
import { ensurePrimaryExamIndex } from './db/ensure-primary-exam-index.js';

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
  await mongoose.connect(env.mongoUri);
  await ensurePrimaryExamIndex(Exam);
  await ensurePurchaseReservationBackfill(Order);
  await Promise.all([
    User.init(), Exam.init(), Subject.init(), Chapter.init(), Topic.init(), StudyMaterial.init(), Course.init(),
    QuestionBank.init(), MockTest.init(), TestAttempt.init(), Order.init(), PurchasedAccess.init(), CourseProgress.init(), PaymentWebhookEvent.init(), PaymentRefund.init(),
  ]);

  const sessionStore = MongoStore.create({
    client: mongoose.connection.getClient(),
    dbName: mongoose.connection.name,
    collectionName: 'sessions',
    ttl: Math.ceil(env.sessionMaxAgeMs / 1000),
    autoRemove: 'native',
  });

  const serverApp = createApp({ sessionStore });
  const server = serverApp.listen(env.port, () => {
    console.log(`Nursing learning API listening on port ${env.port}`);
  });

  const shutdown = () => {
    server.close(async () => {
      await sessionStore.close();
      await mongoose.disconnect();
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

startServer().catch(async (error) => {
  console.error('The API could not start. Check MongoDB and the server environment configuration.');
  if (env.nodeEnv !== 'production') console.error(error?.name ?? 'StartupError');
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});

