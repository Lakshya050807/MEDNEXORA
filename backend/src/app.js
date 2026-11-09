import express from 'express';
import session from 'express-session';
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
import PaymentWebhookEvent from './models/PaymentWebhookEvent.js';
import PaymentRefund from './models/PaymentRefund.js';
import CourseProgress from './models/CourseProgress.js';
import { env } from './config/env.js';
import { createAdminRoutes } from './routes/admin.routes.js';
import { createAuthRoutes } from './routes/auth.routes.js';
import { createCatalogRoutes } from './routes/catalog.routes.js';
import healthRoutes from './routes/health.routes.js';
import { createStudentRoutes } from './routes/student.routes.js';
import { createPracticeRoutes } from './routes/practice.routes.js';
import { createCourseRoutes } from './routes/course.routes.js';
import { createStudentCourseRoutes } from './routes/student-courses.routes.js';
import { createPaymentRoutes } from './routes/payment.routes.js';
import { createRazorpayGateway } from './services/razorpayGateway.js';

export function createApp({
  sessionStore,
  UserModel = User,
  ExamModel = Exam,
  SubjectModel = Subject,
  TopicModel = Topic,
  ChapterModel = Chapter,
  ProductModel = StudyMaterial,
  CourseModel = Course,
  QuestionBankModel = QuestionBank,
  MockTestModel = MockTest,
  TestAttemptModel = TestAttempt,
  OrderModel = Order,
  PurchasedAccessModel = PurchasedAccess,
  WebhookEventModel = PaymentWebhookEvent,
  RefundModel = PaymentRefund,
  CourseProgressModel = CourseProgress,
  privateStorageOrigin = env.privateStorageOrigin,
  privateStorageDir = env.privateStorageDir,
  privateAssetFetch = globalThis.fetch,
  trustProxy = env.trustProxy,
  secureCookies = env.secureCookies,
  paymentConfig = {
    keyId: env.razorpayKeyId,
    keySecret: env.razorpayKeySecret,
    webhookSecret: env.razorpayWebhookSecret,
    mode: env.razorpayMode,
  },
  paymentGateway,
} = {}) {
  if (!sessionStore && env.nodeEnv === 'test') sessionStore = new session.MemoryStore();
  if (!sessionStore) throw new Error('A persistent session store is required outside tests.');

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);
  app.use((_request, response, next) => {
    response.set('X-Content-Type-Options', 'nosniff');
    response.set('X-Frame-Options', 'DENY');
    response.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (env.nodeEnv === 'production') response.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use(express.json({
    limit: '1mb',
    verify(request, _response, buffer) {
      if (request.originalUrl?.split('?')[0] === '/api/payments/webhook') request.rawBody = Buffer.from(buffer);
    },
  }));
  app.use('/api/health', healthRoutes);
  const sessionOptions = {
    secret: env.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'lax',
      maxAge: env.sessionMaxAgeMs,
      path: '/',
    },
  };
  const studentSession = session({ ...sessionOptions, name: env.sessionCookieName });
  const adminSession = session({ ...sessionOptions, name: env.adminSessionCookieName });

  app.use('/api/auth', (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  }, studentSession, createAuthRoutes({ UserModel }));
  const practiceModels = { UserModel, QuestionBankModel, MockTestModel, ProductModel, PurchasedAccessModel, TestAttemptModel, ExamModel, SubjectModel, TopicModel, ChapterModel };
  app.use('/api/student/practice', (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  }, studentSession, createPracticeRoutes(practiceModels));
  const courseModels = { CourseModel, ProductModel, ExamModel, CourseProgressModel, PurchasedAccessModel };
  app.use('/api/student/courses', (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  }, studentSession, createStudentCourseRoutes({ UserModel, ...courseModels }));
  app.use('/api/student', (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  }, studentSession, createStudentRoutes({
    UserModel,
    ProductModel,
    CourseModel,
    CourseProgressModel,
    TestAttemptModel,
    PurchasedAccessModel,
    OrderModel,
    QuestionBankModel,
    MockTestModel,
    SubjectModel,
    TopicModel,
    privateStorageOrigin,
    privateStorageDir,
    assetFetch: privateAssetFetch,
  }));
  app.use('/api/payments', (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  }, studentSession, createPaymentRoutes({
    UserModel,
    OrderModel,
    ProductModel,
    PurchasedAccessModel,
    WebhookEventModel,
    RefundModel,
    paymentConfig,
    gateway: paymentGateway ?? createRazorpayGateway({ keyId: paymentConfig.keyId, keySecret: paymentConfig.keySecret }),
  }));
  const catalogueModels = { ProductModel, ExamModel, SubjectModel, ChapterModel, TopicModel, CourseModel, QuestionBankModel, MockTestModel, TestAttemptModel };
  app.use('/api/courses', createCourseRoutes(courseModels));
  app.use('/api', createCatalogRoutes(catalogueModels));
  app.use('/api/admin', (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  }, adminSession, createAdminRoutes({ UserModel, OrderModel, PurchasedAccessModel, RefundModel, CourseProgressModel, privateStorageDir, ...catalogueModels }));

  app.use((error, _request, response, next) => {
    if (response.headersSent) return next(error);
    if (error?.type === 'entity.parse.failed') {
      return response.status(400).json({ message: 'Request body must contain valid JSON.' });
    }
    if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
      return response.status(error.status).json({ message: error.message || 'The request could not be completed.' });
    }
    console.error('Unhandled API error:', error?.name ?? 'UnknownError');
    return response.status(500).json({ message: 'Something went wrong. Please try again later.' });
  });

  return app;
}


