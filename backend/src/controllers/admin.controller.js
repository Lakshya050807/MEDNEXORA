import mongoose from 'mongoose';
import { serializeProduct } from './catalog.controller.js';
import { materialCategories, resourceTypes } from '../models/StudyMaterial.js';

function parsePage(value, fallback, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > max) {
    const error = new Error(`Value must be an integer from 1 to ${max}.`);
    error.status = 400;
    throw error;
  }
  return result;
}

function searchPattern(value) {
  const query = typeof value === 'string' ? value.trim() : '';
  if (query.length > 100) {
    const error = new Error('Search text must be 100 characters or fewer.');
    error.status = 400;
    throw error;
  }
  return query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu') : null;
}

function buildEntityList(Model, { searchFields, populate = [], baseFilter = {} }) {
  return async function listEntity(request, response, next) {
    try {
      const page = parsePage(request.query.page, 1, 1000);
      const limit = parsePage(request.query.limit, 20, 50);
      const filter = { ...baseFilter };
      if (request.query.status) {
        if (!['draft', 'published', 'archived'].includes(request.query.status)) {
          return response.status(400).json({ message: 'Choose a supported publication status.' });
        }
        filter.publicationStatus = request.query.status;
      }
      const pattern = searchPattern(request.query.q);
      if (pattern) filter.$or = searchFields.map((field) => ({ [field]: pattern }));
      if (request.query.examId) {
        if (!mongoose.isValidObjectId(request.query.examId)) return response.status(400).json({ message: 'examId must be a valid ID.' });
        if (Model.modelName === 'StudyMaterial' || Model.modelName === 'Subject' || Model.modelName === 'Chapter' || Model.modelName === 'Topic' || Model.modelName === 'Course' || Model.modelName === 'QuestionBank' || Model.modelName === 'MockTest') filter.exam = request.query.examId;
      }
      if (request.query.subjectId) {
        if (!mongoose.isValidObjectId(request.query.subjectId)) return response.status(400).json({ message: 'subjectId must be a valid ID.' });
        if (Model.modelName === 'StudyMaterial' || Model.modelName === 'Chapter' || Model.modelName === 'Topic' || Model.modelName === 'QuestionBank') filter.subject = request.query.subjectId;
      }
      if (request.query.chapterId) {
        if (!mongoose.isValidObjectId(request.query.chapterId)) return response.status(400).json({ message: 'chapterId must be a valid ID.' });
        if (Model.modelName === 'StudyMaterial' || Model.modelName === 'Topic') filter.chapter = request.query.chapterId;
      }
      if (request.query.resourceType && Model.modelName === 'StudyMaterial') {
        if (!resourceTypes.includes(request.query.resourceType)) return response.status(400).json({ message: 'Choose a supported resource type.' });
        filter.resourceType = request.query.resourceType;
      }
      if (request.query.category && Model.modelName === 'StudyMaterial') {
        if (!materialCategories.includes(request.query.category)) return response.status(400).json({ message: 'Choose a supported study material category.' });
        filter.category = request.query.category;
      }
      if (request.query.courseType && Model.modelName === 'Course') {
        if (!['video-course', 'crash-course'].includes(request.query.courseType)) return response.status(400).json({ message: 'Choose a supported course type.' });
        filter.courseType = request.query.courseType;
      }
      const skip = (page - 1) * limit;
      const field = ['StudyMaterial', 'QuestionBank', 'MockTest'].includes(Model.modelName)
        ? 'title'
        : Model.modelName === 'Course' ? 'courseType' : 'name';
      const sortOptions = {
        'updated-newest': { updatedAt: -1, _id: -1 },
        'updated-oldest': { updatedAt: 1, _id: 1 },
        'name-asc': { [field]: 1, _id: 1 },
        'name-desc': { [field]: -1, _id: 1 },
      };
      if (['Subject', 'Chapter', 'Topic'].includes(Model.modelName)) sortOptions['display-order'] = { sortOrder: 1, name: 1, _id: 1 };
      if (Model.modelName === 'StudyMaterial') {
        sortOptions['price-asc'] = { currentPricePaise: 1, updatedAt: -1, _id: -1 };
        sortOptions['price-desc'] = { currentPricePaise: -1, updatedAt: -1, _id: -1 };
      }
      const sortKey = request.query.sort ?? 'updated-newest';
      if (!Object.hasOwn(sortOptions, sortKey)) return response.status(400).json({ message: 'Choose a supported sort order.' });
      let listQuery = Model.find(filter).sort(sortOptions[sortKey]).skip(skip).limit(limit);
      for (const options of populate) listQuery = listQuery.populate(options);
      const [total, items] = await Promise.all([Model.countDocuments(filter), listQuery.lean()]);
      const mapped = Model.modelName === 'StudyMaterial' ? items.map(serializeProduct) : items;
      return response.status(200).json({ items: mapped, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) {
      if (error?.status === 400) return response.status(400).json({ message: error.message });
      return next(error);
    }
  };
}

function serializeOrder(order, refunds = [], entitlementStatus = 'not-granted') {
  const student = order.student && typeof order.student === 'object' && (order.student.name || order.student.email)
    ? { id: String(order.student._id ?? order.student.id), name: order.student.name ?? '', email: order.student.email ?? '' }
    : null;
  return {
    id: String(order._id ?? order.id),
    student,
    items: (order.items ?? []).map((item) => ({
      product: item.product && typeof item.product === 'object' && item.product.title ? { id: String(item.product._id ?? item.product.id), title: item.product.title, resourceType: item.product.resourceType ?? '' } : null,
      title: item.titleSnapshot,
      unitPricePaise: item.unitPricePaise,
      quantity: item.quantity,
    })),
    amountPaise: order.amountPaise,
    currency: order.currency,
    status: order.status,
    paymentProvider: order.paymentProvider,
    paymentVerifiedAt: order.paymentVerifiedAt,
    totalRefundedPaise: order.totalRefundedPaise ?? 0,
    remainingCapturedPaise: Math.max(0, (order.amountPaise ?? 0) - (order.totalRefundedPaise ?? 0)),
    refunds: refunds.map((refund) => ({
      refundId: refund.providerRefundId,
      paymentId: refund.providerPaymentId,
      amountPaise: refund.amountPaise,
      currency: refund.currency,
      status: refund.status,
      reconciliationStatus: refund.reconciliationStatus,
      processedAt: refund.processedAt ?? null,
    })),
    entitlementStatus,
    refundReviewStatus: order.refundReviewStatus ?? 'not-required',
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function createAdminController({ UserModel, OrderModel, RefundModel, ProductModel, ExamModel, SubjectModel, ChapterModel, TopicModel, CourseModel, QuestionBankModel, MockTestModel, PurchasedAccessModel, CourseProgressModel, TestAttemptModel }) {
  const queryHandlers = {
    products: buildEntityList(ProductModel, {
      searchFields: ['title', 'description', 'keywords'],
      populate: [
        { path: 'exam', select: 'name slug region' },
        { path: 'subject', select: 'name slug' },
        { path: 'chapter', select: 'name slug' },
        { path: 'topic', select: 'name slug' },
        { path: 'topics', select: 'name slug' },
        { path: 'course', select: 'courseType durationMinutes lessonCount publicationStatus' },
        { path: 'bundleItems', select: 'title slug resourceType publicationStatus' },
      ],
    }),
    exams: buildEntityList(ExamModel, { searchFields: ['name', 'description', 'region'] }),
    subjects: buildEntityList(SubjectModel, { searchFields: ['name', 'description'], populate: [{ path: 'exam', select: 'name slug' }] }),
    chapters: buildEntityList(ChapterModel, { searchFields: ['name', 'description'], populate: [{ path: 'exam', select: 'name slug' }, { path: 'subject', select: 'name slug' }] }),
    topics: buildEntityList(TopicModel, { searchFields: ['name', 'description'], populate: [{ path: 'exam', select: 'name slug' }, { path: 'subject', select: 'name slug' }, { path: 'chapter', select: 'name slug' }] }),
    courses: buildEntityList(CourseModel, { searchFields: ['courseType', 'outline'], populate: [{ path: 'product', select: 'title slug resourceType publicationStatus' }, { path: 'exam', select: 'name slug' }, { path: 'subjects', select: 'name slug' }] }),
    questionBanks: buildEntityList(QuestionBankModel, { searchFields: ['title'], populate: [{ path: 'exam', select: 'name slug' }, { path: 'subject', select: 'name slug' }, { path: 'product', select: 'title slug publicationStatus currentPricePaise' }] }),
    mockTests: buildEntityList(MockTestModel, { searchFields: ['title'], populate: [{ path: 'exam', select: 'name slug' }, { path: 'product', select: 'title slug resourceType publicationStatus' }, { path: 'questionBanks', select: 'title publicationStatus' }] }),
  };

  return {
    overview: async (_request, response, next) => {
      try {
        const [productCount, publishedProductCount, studyMaterialCount, courseCount, publishedCourseCount, draftCourseCount, questionBankCount, mockTestCount, studentCount, orderCount, verifiedRevenue] = await Promise.all([
          ProductModel.countDocuments({}),
          ProductModel.countDocuments({ publicationStatus: 'published' }),
          ProductModel.countDocuments({ resourceType: { $nin: ['video-course', 'crash-course', 'bundle'] } }),
          CourseModel.countDocuments({}),
          CourseModel.countDocuments({ publicationStatus: 'published' }),
          CourseModel.countDocuments({ publicationStatus: 'draft' }),
          QuestionBankModel.countDocuments({}),
          MockTestModel.countDocuments({}),
          UserModel.countDocuments({ role: 'student' }),
          OrderModel.countDocuments({}),
          OrderModel.aggregate([
            { $match: { status: { $in: ['paid', 'partially_refunded'] }, paymentVerifiedAt: { $type: 'date' } } },
            { $group: { _id: null, amountPaise: { $sum: { $subtract: ['$amountPaise', { $ifNull: ['$totalRefundedPaise', 0] }] } }, orderCount: { $sum: 1 } } },
          ]),
        ]);
        const revenue = verifiedRevenue[0] ?? { amountPaise: 0, orderCount: 0 };
        return response.status(200).json({
          metrics: {
            productCount,
            publishedProductCount,
            studyMaterialCount,
            courseCount,
            publishedCourseCount,
            draftCourseCount,
            questionBankCount,
            mockTestCount,
            studentCount,
            orderCount,
            verifiedRevenuePaise: revenue.amountPaise ?? 0,
            verifiedPaidOrderCount: revenue.orderCount ?? 0,
          },
        });
      } catch (error) { return next(error); }
    },
    ...queryHandlers,
    students: async (request, response, next) => {
      try {
        const page = parsePage(request.query.page, 1, 1000);
        const limit = parsePage(request.query.limit, 20, 50);
        const filter = { role: 'student' };
        const pattern = searchPattern(request.query.q);
        if (pattern) filter.$or = [{ name: pattern }, { email: pattern }];
        const skip = (page - 1) * limit;
        const [total, students] = await Promise.all([
          UserModel.countDocuments(filter),
          UserModel.find(filter).select('name adminUsername email createdAt').sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
        ]);
        const studentIds = students.map((student) => student._id);
        const [accessRows, progressRows, attemptRows] = await Promise.all([
          PurchasedAccessModel?.find ? PurchasedAccessModel.find({ student: { $in: studentIds }, status: 'active' }).select('student product').lean() : [],
          CourseProgressModel?.find ? CourseProgressModel.find({ student: { $in: studentIds } }).select('student updatedAt').lean() : [],
          TestAttemptModel?.find ? TestAttemptModel.find({ student: { $in: studentIds } }).select('student createdAt updatedAt').lean() : [],
        ]);
        const courseProducts = [...new Set(accessRows.map((access) => String(access.product)).filter(Boolean))];
        const paidCourses = CourseModel?.find && courseProducts.length
          ? await CourseModel.find({ product: { $in: courseProducts } }).select('_id product').lean()
          : [];
        const courseIdByProduct = new Map(paidCourses.map((course) => [String(course.product), String(course._id)]));
        const counts = new Map(studentIds.map((id) => [String(id), { activePurchases: 0, enrolledCourseIds: new Set(), courseProgressCount: 0, testAttemptCount: 0, lastActivityAt: null }]));
        for (const access of accessRows) {
          const row = counts.get(String(access.student));
          if (!row) continue;
          row.activePurchases += 1;
          const courseId = courseIdByProduct.get(String(access.product));
          if (courseId) row.enrolledCourseIds.add(courseId);
        }
        for (const progress of progressRows) {
          const row = counts.get(String(progress.student));
          if (!row) continue;
          row.courseProgressCount += 1;
          if (progress.course) row.enrolledCourseIds.add(String(progress.course));
          const activityAt = progress.updatedAt ? new Date(progress.updatedAt) : null;
          if (activityAt && (!row.lastActivityAt || activityAt > row.lastActivityAt)) row.lastActivityAt = activityAt;
        }
        for (const attempt of attemptRows) {
          const row = counts.get(String(attempt.student));
          if (!row) continue;
          row.testAttemptCount += 1;
          const activityAt = attempt.updatedAt ?? attempt.createdAt ? new Date(attempt.updatedAt ?? attempt.createdAt) : null;
          if (activityAt && (!row.lastActivityAt || activityAt > row.lastActivityAt)) row.lastActivityAt = activityAt;
        }
        const items = students.map((student) => ({
          id: String(student._id ?? student.id),
          name: student.name ?? '',
          email: student.email ?? '',
          registeredAt: student.createdAt ?? null,
          activePurchases: counts.get(String(student._id))?.activePurchases ?? 0,
          enrolledCourseCount: counts.get(String(student._id))?.enrolledCourseIds.size ?? 0,
          courseProgressCount: counts.get(String(student._id))?.courseProgressCount ?? 0,
          testAttemptCount: counts.get(String(student._id))?.testAttemptCount ?? 0,
          lastActivityAt: counts.get(String(student._id))?.lastActivityAt ?? null,
        }));
        return response.status(200).json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
      } catch (error) {
        if (error?.status === 400) return response.status(400).json({ message: error.message });
        return next(error);
      }
    },
    orders: async (request, response, next) => {
      try {
        const page = parsePage(request.query.page, 1, 1000);
        const limit = parsePage(request.query.limit, 20, 50);
        const filter = {};
        if (request.query.status) {
          if (!['pending', 'paid', 'partially_refunded', 'failed', 'cancelled', 'refunded'].includes(request.query.status)) return response.status(400).json({ message: 'Choose a supported payment status.' });
          filter.status = request.query.status;
        }
        const pattern = searchPattern(request.query.q);
        if (pattern) {
          const studentMatches = await UserModel.find({ role: 'student', $or: [{ name: pattern }, { email: pattern }] }).select('_id').lean();
          const clauses = [{ 'items.titleSnapshot': pattern }];
          if (studentMatches.length) clauses.push({ student: { $in: studentMatches.map((student) => student._id) } });
          if (mongoose.isValidObjectId(request.query.q)) clauses.push({ _id: request.query.q });
          filter.$or = clauses;
        }
        const skip = (page - 1) * limit;
        const [total, orders] = await Promise.all([
          OrderModel.countDocuments(filter),
          OrderModel.find(filter)
            .populate('student', 'name email')
            .populate('items.product', 'title resourceType')
            .sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
        ]);
        const orderIds = orders.map((order) => order._id);
        const [refunds, accesses] = await Promise.all([
          RefundModel?.find && orderIds.length ? RefundModel.find({ order: { $in: orderIds } }).sort({ createdAt: 1, _id: 1 }).lean() : [],
          PurchasedAccessModel?.find && orderIds.length ? PurchasedAccessModel.find({ order: { $in: orderIds }, source: 'purchase' }).select('order status').lean() : [],
        ]);
        const refundsByOrder = new Map();
        for (const refund of refunds) {
          const key = String(refund.order);
          const rows = refundsByOrder.get(key) ?? [];
          rows.push(refund);
          refundsByOrder.set(key, rows);
        }
        const accessByOrder = new Map();
        for (const access of accesses) {
          const key = String(access.order);
          const rows = accessByOrder.get(key) ?? [];
          rows.push(access.status);
          accessByOrder.set(key, rows);
        }
        const items = orders.map((order) => {
          const statuses = accessByOrder.get(String(order._id)) ?? [];
          const entitlementStatus = !statuses.length ? 'not-granted'
            : statuses.every((status) => status === 'active') ? 'active'
              : statuses.every((status) => status === 'revoked') ? 'revoked' : 'mixed';
          return serializeOrder(order, refundsByOrder.get(String(order._id)) ?? [], entitlementStatus);
        });
        return response.status(200).json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
      } catch (error) {
        if (error?.status === 400) return response.status(400).json({ message: error.message });
        return next(error);
      }
    },
    reviewPartialRefund: async (request, response, next) => {
      try {
        if (!mongoose.isValidObjectId(request.params.orderId)) return response.status(400).json({ message: 'Enter a valid order ID.' });
        const decision = request.body?.decision;
        if (!['keep-access', 'revoke-access'].includes(decision)) return response.status(400).json({ message: 'Choose whether to keep or revoke access for this partial refund.' });
        const order = await OrderModel.findById(request.params.orderId).lean();
        if (!order) return response.status(404).json({ message: 'The order could not be found.' });
        if (order.status !== 'partially_refunded') {
          return response.status(409).json({ message: 'This order has no pending partial-refund review.' });
        }
        if (order.refundReviewStatus === decision) {
          if (decision === 'revoke-access') await PurchasedAccessModel.updateMany(
            { order: order._id, source: 'purchase', status: 'active' },
            { $set: { status: 'revoked', revokedAt: new Date() } },
          );
          return response.status(200).json({ orderId: String(order._id), decision, status: order.status });
        }
        if (order.refundReviewStatus !== 'pending') return response.status(409).json({ message: 'This partial refund has already been reviewed.' });
        const updated = await OrderModel.findOneAndUpdate(
          { _id: order._id, status: 'partially_refunded', refundReviewStatus: 'pending' },
          { $set: { refundReviewStatus: decision } },
          { new: true, runValidators: true },
        );
        if (!updated) return response.status(409).json({ message: 'The refund review changed. Refresh the order and try again.' });
        if (decision === 'revoke-access') {
          await PurchasedAccessModel.updateMany(
            { order: order._id, source: 'purchase', status: 'active' },
            { $set: { status: 'revoked', revokedAt: new Date() } },
          );
        }
        return response.status(200).json({ orderId: String(updated._id), decision: updated.refundReviewStatus, status: updated.status });
      } catch (error) { return next(error); }
    },
  };
}

export default createAdminController;
