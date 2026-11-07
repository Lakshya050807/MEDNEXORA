import mongoose from 'mongoose';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { localPrivatePdfPath, maxPrivatePdfBytes } from '../services/privatePdfStorage.js';
import { publishedExamFilter } from '../services/examPublication.js';

const courseTypes = new Set(['video-course', 'crash-course']);
const freeMaterialTypes = new Set(['notes', 'practice-paper', 'previous-year-paper']);
function idOf(value) {
  if (value && typeof value.toHexString === 'function') return value.toHexString();
  const id = value?._id ?? value?.id ?? value;
  if (id && typeof id.toHexString === 'function') return id.toHexString();
  return id == null ? '' : String(id);
}

async function queryRows(query, { select, sort, limit, populate } = {}) {
  if (select && typeof query?.select === 'function') query = query.select(select);
  for (const item of populate ?? []) {
    if (typeof query?.populate === 'function') query = query.populate(item);
  }
  if (sort && typeof query?.sort === 'function') query = query.sort(sort);
  if (limit && typeof query?.limit === 'function') query = query.limit(limit);
  if (typeof query?.lean === 'function') query = query.lean();
  return await query;
}

function productSummary(product, { downloadAvailable = false, accessSource = 'purchase', acquiredAt = null } = {}) {
  const id = idOf(product);
  return {
    id,
    title: product.title,
    description: product.description ?? '',
    detailedDescription: product.detailedDescription ?? '',
    category: product.category ?? null,
    language: product.language ?? '',
    thumbnailUrl: product.thumbnailUrl ?? '',
    resourceType: product.resourceType,
    pricePaise: Number.isSafeInteger(product.pricePaise) ? product.pricePaise : null,
    discountPaise: Number(product.discountPaise ?? 0),
    currentPricePaise: Number.isSafeInteger(product.currentPricePaise) ? product.currentPricePaise : null,
    subject: product.subject && typeof product.subject === 'object' ? product.subject.name ?? '' : '',
    exam: product.exam && typeof product.exam === 'object' ? product.exam.name ?? '' : '',
    updatedAt: product.updatedAt ?? null,
    accessSource,
    acquiredAt,
    detailUrl: product.publicationStatus === 'published' ? `/products/${encodeURIComponent(id)}` : null,
    downloadAvailable,
    downloadUrl: downloadAvailable ? `/api/student/resources/${encodeURIComponent(id)}/download` : null,
  };
}

function isPublishedCatalogueProduct(product) {
  const exam = product?.exam;
  const subject = product?.subject;
  const chapter = product?.chapter;
  const topic = product?.topic;
  const topics = product?.topics ?? [];
  const isPublishedTopic = (item) => item && typeof item === 'object'
    && item.publicationStatus === 'published'
    && (!item.chapter || (typeof item.chapter === 'object' && item.chapter.publicationStatus === 'published'));
  return product?.publicationStatus === 'published'
    && exam && typeof exam === 'object' && exam.publicationStatus === 'published'
    && subject && typeof subject === 'object' && subject.publicationStatus === 'published'
    && (!chapter || (typeof chapter === 'object' && chapter.publicationStatus === 'published'))
    && (!topic || isPublishedTopic(topic))
    && topics.every(isPublishedTopic);
}

const topicPopulate = {
  path: 'topic',
  select: 'name publicationStatus chapter',
  populate: { path: 'chapter', select: 'publicationStatus' },
};
const examPopulate = {
  path: 'exam',
  select: 'name slug region publicationStatus',
  match: publishedExamFilter(),
};
const topicsPopulate = {
  path: 'topics',
  select: 'name publicationStatus chapter',
  populate: { path: 'chapter', select: 'publicationStatus' },
};

function privateAssetUrl(reference, storageOrigin) {
  if (!reference || !storageOrigin) return null;
  let base;
  let target;
  try {
    base = new URL(storageOrigin);
    target = new URL(String(reference), `${base.origin}/`);
  } catch {
    return null;
  }
  if (target.origin !== base.origin || target.username || target.password || !['https:', 'http:'].includes(target.protocol)) return null;
  let decodedPath;
  try { decodedPath = decodeURIComponent(target.pathname); } catch { return null; }
  const segments = decodedPath.split('/');
  if (!decodedPath.startsWith('/private/') || segments.some((segment) => segment === '.' || segment === '..') || decodedPath.includes('\\')) return null;
  return target;
}

function downloadFilename(title) {
  return String(title ?? 'study-resource')
    .normalize('NFKD')
    .replace(/[^\w -]/gu, '')
    .trim()
    .replace(/[\s-]+/gu, '-')
    .slice(0, 100) || 'study-resource';
}

function privateAssetAvailable(reference, storageOrigin, storageDirectory) {
  return Boolean(localPrivatePdfPath(reference, storageDirectory) || privateAssetUrl(reference, storageOrigin));
}

function ordered(items = []) {
  return (items ?? []).map((item, index) => ({ item, index }))
    .sort((left, right) => Number(left.item.sortOrder ?? 0) - Number(right.item.sortOrder ?? 0) || left.index - right.index)
    .map(({ item }) => item);
}

function serializeOrder(order) {
  return {
    id: idOf(order),
    status: order.status,
    currency: order.currency ?? 'INR',
    amountPaise: order.amountPaise,
    items: (order.items ?? []).map((item) => ({
      productId: idOf(item.product),
      title: item.titleSnapshot,
      quantity: item.quantity,
      unitPricePaise: item.unitPricePaise,
    })),
    paymentVerifiedAt: order.paymentVerifiedAt ?? null,
    accessGrantedAt: order.accessGrantedAt ?? null,
    createdAt: order.createdAt ?? null,
  };
}

function serializeAttempt(attempt) {
  return {
    id: idOf(attempt),
    mode: attempt.mode,
    title: attempt.titleSnapshot,
    status: attempt.status,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt ?? null,
    questionCount: attempt.questions?.length ?? 0,
    result: attempt.result ?? null,
    url: `/practice/attempts/${encodeURIComponent(idOf(attempt))}`,
  };
}

function idSet(values) {
  return new Set((values ?? []).map(idOf).filter(Boolean));
}

function courseCard(course, product, progress) {
  const lessons = ordered(course.modules ?? []).flatMap((module) => ordered(module.lessons ?? []));
  const validLessonIds = idSet(lessons);
  const completedIds = new Set([...idSet(progress?.completedLessonIds)].filter((id) => validLessonIds.has(id)));
  const completedCount = completedIds.size;
  const totalLessons = lessons.length;
  const nextLesson = lessons.find((lesson) => !completedIds.has(idOf(lesson))) ?? lessons.at(-1) ?? null;
  const courseId = idOf(course);
  const lessonId = nextLesson ? idOf(nextLesson) : '';
  return {
    id: courseId,
    productId: idOf(product),
    title: product.title,
    thumbnailUrl: product.thumbnailUrl ?? '',
    courseType: course.courseType,
    exam: course.exam && typeof course.exam === 'object' ? course.exam.name ?? '' : '',
    completedLessons: completedCount,
    totalLessons,
    progressPercent: totalLessons ? Math.round((completedCount / totalLessons) * 100) : 0,
    nextLesson: nextLesson ? { id: lessonId, title: nextLesson.title } : null,
    continueUrl: lessonId ? `/courses/${encodeURIComponent(courseId)}/learn?lessonId=${encodeURIComponent(lessonId)}` : `/courses/${encodeURIComponent(courseId)}/learn`,
  };
}

function displayAccuracy(correct, answered) {
  return answered ? Math.round((correct / answered) * 100) : 0;
}

export function createStudentController({
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
  privateStorageOrigin = '',
  privateStorageDir = '',
  assetFetch = globalThis.fetch,
}) {
  async function loadDashboard(request) {
    const studentId = idOf(request.user);
    const completedAttemptFilter = { student: studentId, status: { $in: ['submitted', 'timed-out'] }, result: { $ne: null } };
    const [accessRows, recentOrders, attempts, mockAttemptRows, completedAttemptCount, progressRows, freeProducts] = await Promise.all([
      queryRows(PurchasedAccessModel.find({ student: studentId, status: 'active' }), { select: 'product order source grantedAt' }),
      queryRows(OrderModel.find({ student: studentId }), { sort: { createdAt: -1, _id: -1 }, limit: 5 }),
      queryRows(TestAttemptModel.find(completedAttemptFilter), { select: '+answerKey', sort: { createdAt: -1, _id: -1 }, limit: 100 }),
      queryRows(TestAttemptModel.find({ student: studentId, mode: 'mock' }), { sort: { createdAt: -1, _id: -1 }, limit: 5 }),
      TestAttemptModel.countDocuments(completedAttemptFilter),
      queryRows(CourseProgressModel.find({ student: studentId }), { select: 'course completedLessonIds lastLessonId updatedAt' }),
      queryRows(ProductModel.find({ publicationStatus: 'published', currentPricePaise: 0 }), {
        select: 'title description thumbnailUrl resourceType pricePaise discountPaise currentPricePaise subject chapter topic topics exam publicationStatus updatedAt',
        populate: ['subject', 'chapter', topicPopulate, topicsPopulate, examPopulate],
      }),
    ]);

    const referencedOrderIds = [...idSet(accessRows.map((access) => access.order))];
    const verifiedOrders = referencedOrderIds.length
      ? await queryRows(OrderModel.find({
        _id: { $in: referencedOrderIds },
        student: studentId,
        status: { $in: ['paid', 'partially_refunded'] },
        paymentVerifiedAt: { $ne: null },
      }), { select: '_id paymentVerifiedAt' })
      : [];
    const verifiedOrderIds = idSet(verifiedOrders.map((order) => order._id));
    const paidAccessRows = accessRows.filter((access) => access.source !== 'free' && verifiedOrderIds.has(idOf(access.order)));
    const freeAccessRows = accessRows.filter((access) => access.source === 'free');
    const purchasedProductIds = idSet(paidAccessRows
      .map((access) => access.product));
    const freeAccessProductIds = idSet(freeAccessRows.map((access) => access.product));
    const libraryProductIds = new Set([...purchasedProductIds, ...freeAccessProductIds]);

    const purchasedProducts = libraryProductIds.size
      ? (await queryRows(ProductModel.find({ _id: { $in: [...libraryProductIds] }, publicationStatus: 'published' }), {
        select: '+contentUrl title description detailedDescription category language fileSizeBytes format thumbnailUrl resourceType pricePaise discountPaise currentPricePaise subject chapter topic topics exam updatedAt publicationStatus',
        populate: ['subject', 'chapter', topicPopulate, topicsPopulate, examPopulate],
      })).filter(isPublishedCatalogueProduct)
      : [];
    const productById = new Map(purchasedProducts.map((product) => [idOf(product), product]));
    const accessByProduct = new Map([...paidAccessRows, ...freeAccessRows].map((access) => [idOf(access.product), access]));
    const visibleFreeProducts = freeProducts.filter(isPublishedCatalogueProduct);
    const freeProductIds = idSet(visibleFreeProducts);
    const availableProductIds = new Set([
      ...freeProductIds,
      ...purchasedProducts.filter((product) => product.publicationStatus === 'published').map(idOf),
    ]);
    const [publishedBanks, publishedTests] = await Promise.all([
      queryRows(QuestionBankModel.find({
        publicationStatus: 'published',
        $or: [{ product: null }, { product: { $in: [...freeProductIds] } }],
      }), { select: '_id title subject product', populate: ['subject'], limit: 5 }),
      availableProductIds.size
        ? queryRows(MockTestModel.find({ publicationStatus: 'published', product: { $in: [...availableProductIds] } }), {
          select: '_id product title durationMinutes questionCount createdAt', sort: { createdAt: -1, _id: -1 }, limit: 4,
        })
        : [],
    ]);

    const boughtCourseProducts = purchasedProducts.filter((product) => courseTypes.has(product.resourceType));
    const boughtCourseProductIds = idSet(boughtCourseProducts);
    const courses = boughtCourseProductIds.size
      ? await queryRows(CourseModel.find({ product: { $in: [...boughtCourseProductIds] }, publicationStatus: 'published' }), { populate: ['exam'] })
      : [];
    const progressByCourse = new Map(progressRows.map((progress) => [idOf(progress.course), progress]));
    const courseProductIds = idSet(courses.map((course) => course.product));
    const purchasedCourses = courses
      .map((course) => ({ course, product: productById.get(idOf(course.product)) ?? course.product }))
      .filter(({ product }) => product && typeof product === 'object' && product.title)
      .map(({ course, product }) => courseCard(course, product, progressByCourse.get(idOf(course))));
    const purchasedMaterials = purchasedProducts
      .filter((product) => !courseProductIds.has(idOf(product)))
      .map((product) => {
        const access = accessByProduct.get(idOf(product));
        return productSummary(product, {
          downloadAvailable: privateAssetAvailable(product.contentUrl, privateStorageOrigin, privateStorageDir),
          accessSource: access?.source === 'free' ? 'free' : 'purchase',
          acquiredAt: access?.grantedAt ?? access?.createdAt ?? null,
        });
      });

    const completedAttempts = attempts ?? [];
    const allBankIds = idSet(attempts.flatMap((attempt) => [attempt.questionBank, ...(attempt.questions ?? []).map((question) => question.bankId)]));
    const allTopicIds = idSet(attempts.flatMap((attempt) => (attempt.questions ?? []).map((question) => question.topic)));
    const [attemptBanks, topics] = await Promise.all([
      allBankIds.size ? queryRows(QuestionBankModel.find({ _id: { $in: [...allBankIds] } }), { select: '_id subject' }) : [],
      allTopicIds.size ? queryRows(TopicModel.find({ _id: { $in: [...allTopicIds] } }), { select: '_id name subject' }) : [],
    ]);
    const bankSubjectById = new Map(attemptBanks.map((bank) => [idOf(bank), idOf(bank.subject)]));
    const topicById = new Map(topics.map((topic) => [idOf(topic), topic]));
    const subjectIds = idSet([
      ...attemptBanks.map((bank) => bank.subject),
      ...topics.map((topic) => topic.subject),
    ]);
    const subjects = subjectIds.size
      ? await queryRows(SubjectModel.find({ _id: { $in: [...subjectIds] } }), { select: '_id name' })
      : [];
    const subjectById = new Map(subjects.map((subject) => [idOf(subject), subject.name]));

    const subjectStats = new Map();
    const topicStats = new Map();
    let correctTotal = 0;
    let answeredTotal = 0;
    for (const attempt of completedAttempts) {
      const answersByQuestion = new Map((attempt.answers ?? []).map((answer) => [idOf(answer.questionId), answer]));
      const keysByQuestion = new Map((attempt.answerKey ?? []).map((key) => [idOf(key.questionId), key]));
      for (const question of attempt.questions ?? []) {
        const answer = answersByQuestion.get(idOf(question.questionId));
        const key = keysByQuestion.get(idOf(question.questionId));
        if (!answer || answer.selectedOptionIndex === null || answer.selectedOptionIndex === undefined || !key) continue;
        const correct = answer.selectedOptionIndex === key.correctAnswerIndex;
        const topicId = idOf(question.topic);
        const topic = topicById.get(topicId);
        const subjectId = topic ? idOf(topic.subject) : bankSubjectById.get(idOf(question.bankId ?? attempt.questionBank)) ?? '';
        if (subjectId) {
          const stats = subjectStats.get(subjectId) ?? { correct: 0, answered: 0 };
          stats.answered += 1;
          if (correct) stats.correct += 1;
          subjectStats.set(subjectId, stats);
        }
        if (topicId && topic) {
          const stats = topicStats.get(topicId) ?? { correct: 0, answered: 0 };
          stats.answered += 1;
          if (correct) stats.correct += 1;
          topicStats.set(topicId, stats);
        }
        answeredTotal += 1;
        if (correct) correctTotal += 1;
      }
    }
    const subjectPerformance = [...subjectStats.entries()]
      .map(([subjectId, stats]) => ({
        id: subjectId,
        name: subjectById.get(subjectId) ?? 'Subject',
        answered: stats.answered,
        correct: stats.correct,
        incorrect: stats.answered - stats.correct,
        accuracyPercent: displayAccuracy(stats.correct, stats.answered),
      }))
      .sort((left, right) => left.accuracyPercent - right.accuracyPercent || left.name.localeCompare(right.name));
    const weakTopics = [...topicStats.entries()]
      .filter(([, stats]) => stats.answered >= 3 && displayAccuracy(stats.correct, stats.answered) < 70)
      .map(([topicId, stats]) => {
        const topic = topicById.get(topicId);
        const subjectId = idOf(topic?.subject);
        return {
          id: topicId,
          name: topic?.name ?? 'Topic',
          subject: subjectById.get(subjectId) ?? 'Subject',
          answered: stats.answered,
          correct: stats.correct,
          accuracyPercent: displayAccuracy(stats.correct, stats.answered),
        };
      })
      .sort((left, right) => left.accuracyPercent - right.accuracyPercent || right.answered - left.answered)
      .slice(0, 3);

    const trends = completedAttempts.slice(0, 7).reverse().map((attempt) => ({
      id: idOf(attempt),
      title: attempt.titleSnapshot,
      mode: attempt.mode,
      date: attempt.submittedAt ?? attempt.createdAt ?? null,
      score: attempt.result.score,
      maximumMarks: attempt.result.maximumMarks,
      accuracyPercent: attempt.result.accuracyPercent,
    }));
    const recentMockAttempts = (mockAttemptRows ?? []).map(serializeAttempt);

    const freeQuestionBanks = publishedBanks
      .map((bank) => ({ id: idOf(bank), title: bank.title, subject: bank.subject && typeof bank.subject === 'object' ? bank.subject.name ?? '' : subjectById.get(idOf(bank.subject)) ?? '' }));

    const availableProductsById = new Map([...purchasedProducts, ...visibleFreeProducts].map((product) => [idOf(product), product]));
    const availableMockTests = publishedTests
      .filter((mockTest) => {
        const product = availableProductsById.get(idOf(mockTest.product));
        return product && (product.currentPricePaise === 0 || purchasedProductIds.has(idOf(product)));
      })
      .map((mockTest) => ({
        id: idOf(mockTest),
        title: mockTest.title,
        durationMinutes: mockTest.durationMinutes ?? null,
        questionCount: mockTest.questionCount ?? null,
      }));

    const recentOrderList = (recentOrders ?? []).map(serializeOrder);
    return {
      user: request.student,
      dashboard: {
        summary: {
          purchasedResources: purchasedProductIds.size,
          libraryResources: purchasedMaterials.length,
          purchasedCourses: purchasedCourses.length,
          completedAttempts: completedAttemptCount,
          overallAccuracyPercent: answeredTotal ? displayAccuracy(correctTotal, answeredTotal) : null,
        },
        purchased: { materials: purchasedMaterials, courses: purchasedCourses },
        recentAttempts: recentMockAttempts,
        analytics: {
          completedAttemptCount,
          overallAccuracyPercent: answeredTotal ? displayAccuracy(correctTotal, answeredTotal) : null,
          analysisWindow: 'Performance trends and topic recommendations use up to the latest 100 completed attempts.',
          subjectPerformance,
          trend: trends,
          weakTopics,
          recommendationRule: 'Recommendations appear when a topic has at least 3 answered questions and accuracy below 70%; topics are ranked by lowest accuracy.',
        },
        orders: recentOrderList,
        freePractice: { questionBanks: freeQuestionBanks, mockTests: availableMockTests },
      },
    };
  }

  return {
    getStudentDashboard: async (request, response, next) => {
      try {
        return response.status(200).json(await loadDashboard(request));
      } catch (error) {
        return next(error);
      }
    },

    claimFreeMaterial: async (request, response, next) => {
      try {
        response.set('Cache-Control', 'private, no-store');
        const studentId = idOf(request.user);
        const productId = request.params.productId;
        if (!mongoose.isValidObjectId(productId)) return response.status(400).json({ message: 'Enter a valid resource ID.' });
        const product = await queryRows(ProductModel.findOne({ _id: productId, publicationStatus: 'published' }), {
          select: '+contentUrl _id title resourceType currentPricePaise publicationStatus exam subject chapter topic topics',
          populate: [examPopulate, 'subject', 'chapter', topicPopulate, topicsPopulate],
        });
        if (!isPublishedCatalogueProduct(product)) return response.status(404).json({ message: 'The resource could not be found.' });
        if (!freeMaterialTypes.has(product.resourceType)) return response.status(409).json({ message: 'Free library access is available for study PDFs and practice papers only.' });
        if (!privateAssetAvailable(product.contentUrl, privateStorageOrigin, privateStorageDir)) return response.status(409).json({ message: 'The private PDF has not been configured for this resource yet.' });

        const existing = await queryRows(PurchasedAccessModel.findOne({ student: studentId, product: productId }), { select: 'source status grantedAt createdAt' });
        if (existing?.status === 'active') {
          if (existing.source !== 'free') {
            const verifiedOrder = await queryRows(OrderModel.findOne({ _id: existing.order, student: studentId, status: { $in: ['paid', 'partially_refunded'] }, paymentVerifiedAt: { $ne: null } }), { select: '_id' });
            if (!verifiedOrder) return response.status(403).json({ message: 'This resource access could not be verified.' });
          }
          return response.status(200).json({ access: { productId, source: existing.source ?? 'purchase', grantedAt: existing.grantedAt ?? existing.createdAt ?? null } });
        }
        if (existing) return response.status(409).json({ message: 'This resource has a revoked access record. Contact support if you think this is an error.' });
        if (product.currentPricePaise !== 0) return response.status(409).json({ message: 'This resource is not currently free. Use the secure checkout to purchase it.' });

        const grantedAt = new Date();
        try {
          await PurchasedAccessModel.create({ student: studentId, product: productId, order: null, source: 'free', status: 'active', grantedAt });
        } catch (error) {
          if (error?.code !== 11000) throw error;
          const latest = await queryRows(PurchasedAccessModel.findOne({ student: studentId, product: productId }), { select: 'source status grantedAt createdAt order' });
          if (latest?.status !== 'active') throw error;
          if (latest.source !== 'free') {
            const verifiedOrder = await queryRows(OrderModel.findOne({ _id: latest.order, student: studentId, status: { $in: ['paid', 'partially_refunded'] }, paymentVerifiedAt: { $ne: null } }), { select: '_id' });
            if (!verifiedOrder) return response.status(403).json({ message: 'This resource access could not be verified.' });
          }
          return response.status(200).json({ access: { productId, source: latest.source ?? 'purchase', grantedAt: latest.grantedAt ?? latest.createdAt ?? null } });
        }
        return response.status(201).json({ access: { productId, source: 'free', grantedAt } });
      } catch (error) {
        if (error?.name === 'ValidationError') return response.status(400).json({ message: 'Free resource access could not be recorded.' });
        return next(error);
      }
    },

    downloadPurchasedResource: async (request, response, next) => {
      try {
        response.set('Cache-Control', 'private, no-store');
        const studentId = idOf(request.user);
        const productId = request.params.productId;
        if (!mongoose.isValidObjectId(productId)) return response.status(400).json({ message: 'Enter a valid resource ID.' });
        const product = await queryRows(ProductModel.findOne({ _id: productId, publicationStatus: 'published' }), {
          select: '+contentUrl title publicationStatus exam subject chapter topic topics',
          populate: [examPopulate, 'subject', 'chapter', topicPopulate, topicsPopulate],
        });
        if (!isPublishedCatalogueProduct(product)) return response.status(404).json({ message: 'The resource could not be found.' });

        const access = await queryRows(PurchasedAccessModel.findOne({ student: studentId, product: productId, status: 'active' }), { select: 'order source' });
        if (!access) return response.status(403).json({ message: 'A verified purchase is required to download this resource.' });
        if (access.source !== 'free') {
          const verifiedOrder = await queryRows(OrderModel.findOne({
            _id: access.order,
            student: studentId,
            status: { $in: ['paid', 'partially_refunded'] },
            paymentVerifiedAt: { $ne: null },
          }), { select: '_id' });
          if (!verifiedOrder) return response.status(403).json({ message: 'A verified purchase is required to download this resource.' });
        }

        const localPath = localPrivatePdfPath(product.contentUrl, privateStorageDir);
        if (localPath) {
          let fileInfo;
          try {
            fileInfo = await stat(localPath);
          } catch (error) {
            if (error?.code === 'ENOENT') return response.status(404).json({ message: 'The private PDF could not be found.' });
            return next(error);
          }
          if (!fileInfo.isFile()) return response.status(404).json({ message: 'The private PDF could not be found.' });
          if (fileInfo.size > maxPrivatePdfBytes) return response.status(413).json({ message: 'This PDF exceeds the 50 MB download limit.' });
          response.status(200);
          response.set('Content-Type', 'application/pdf');
          response.set('Content-Disposition', `attachment; filename="${downloadFilename(product.title)}.pdf"`);
          response.set('Cache-Control', 'private, no-store');
          response.set('X-Content-Type-Options', 'nosniff');
          response.set('Content-Length', String(fileInfo.size));
          const sizeGuard = new Transform({
            transform(chunk, _encoding, callback) {
              this.bytes = (this.bytes ?? 0) + chunk.length;
              callback(this.bytes > maxPrivatePdfBytes ? new Error('Private PDF exceeds the configured download limit.') : null, chunk);
            },
          });
          try {
            await pipeline(createReadStream(localPath), sizeGuard, response);
          } catch (streamError) {
            if (response.headersSent) response.destroy();
            else return response.status(502).json({ message: 'The private PDF could not be streamed safely.' });
          }
          return undefined;
        }

        const assetUrl = privateAssetUrl(product.contentUrl, privateStorageOrigin);
        if (!assetUrl) return response.status(503).json({ message: 'Private PDF storage is not configured for this resource.' });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        let asset;
        try {
          asset = await assetFetch(assetUrl, { redirect: 'manual', signal: controller.signal });
          if (!asset || asset.status !== 200 || !asset.body) {
            await asset?.body?.cancel?.().catch(() => {});
            return response.status(asset?.status === 404 ? 404 : 502).json({ message: 'The private file could not be retrieved.' });
          }
          const contentType = asset.headers?.get?.('content-type')?.split(';')[0]?.trim().toLowerCase();
          if (contentType !== 'application/pdf') {
            await asset.body.cancel?.().catch(() => {});
            return response.status(502).json({ message: 'The configured resource is not available as a PDF.' });
          }
          const lengthHeader = asset.headers?.get?.('content-length');
          const contentLength = lengthHeader === null || lengthHeader === undefined ? null : Number(lengthHeader);
          if (lengthHeader !== null && lengthHeader !== undefined
            && (!/^\d+$/u.test(lengthHeader) || !Number.isSafeInteger(contentLength))) {
            await asset.body.cancel?.().catch(() => {});
            return response.status(502).json({ message: 'The private file service returned invalid file metadata.' });
          }
          if (contentLength !== null && contentLength > maxPrivatePdfBytes) {
            await asset.body.cancel?.().catch(() => {});
            return response.status(413).json({ message: 'This PDF exceeds the 50 MB download limit.' });
          }

          response.status(200);
          response.set('Content-Type', 'application/pdf');
          response.set('Content-Disposition', `attachment; filename="${downloadFilename(product.title)}.pdf"`);
          response.set('Cache-Control', 'private, no-store');
          response.set('X-Content-Type-Options', 'nosniff');
          if (contentLength !== null) response.set('Content-Length', String(contentLength));

          const disconnectAbort = () => {
            if (!response.writableEnded) controller.abort();
          };
          response.once('close', disconnectAbort);
          try {
            let streamedBytes = 0;
            const sizeGuard = new Transform({
              transform(chunk, _encoding, callback) {
                streamedBytes += chunk.length;
                if (streamedBytes > maxPrivatePdfBytes) {
                  controller.abort();
                  callback(new Error('Private PDF exceeds the configured download limit.'));
                  return;
                }
                callback(null, chunk);
              },
            });
            await pipeline(Readable.fromWeb(asset.body), sizeGuard, response, { signal: controller.signal });
          } catch (streamError) {
            if (response.headersSent) response.destroy();
            else {
              response.removeHeader('Content-Disposition');
              response.removeHeader('Content-Length');
              return response.status(streamError?.name === 'AbortError' ? 504 : 502).json({
                message: streamError?.name === 'AbortError' ? 'The private file service took too long to respond.' : 'The private file could not be streamed safely.',
              });
            }
          } finally {
            response.off('close', disconnectAbort);
          }
          return undefined;
        } catch (error) {
          return response.status(error?.name === 'AbortError' ? 504 : 502).json({
            message: error?.name === 'AbortError' ? 'The private file service took too long to respond.' : 'The private file service could not be reached.',
          });
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        return next(error);
      }
    },
  };
}
