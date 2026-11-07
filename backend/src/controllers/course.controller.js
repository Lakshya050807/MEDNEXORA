import mongoose from 'mongoose';
import { publishedExamFilter } from '../services/examPublication.js';

const supportedCourseTypes = ['video-course', 'crash-course'];
const publicProviderNames = new Set(['youtube', 'vimeo']);
const flagshipPreviewSlug = 'bsc-nursing-entrance-preparation';
const flagshipPreviewCategory = 'Government Competitive Exam Preparation';
const flagshipPreviewSubjects = [
  { slug: 'physics', name: 'Physics' },
  { slug: 'chemistry', name: 'Chemistry' },
  { slug: 'biology', name: 'Biology' },
];

function idOf(value) {
  if (value && typeof value.toHexString === 'function') return value.toHexString();
  const id = value?._id ?? value?.id ?? value;
  if (id && typeof id.toHexString === 'function') return id.toHexString();
  return id == null ? '' : String(id);
}

function validId(value) {
  return mongoose.isValidObjectId(value);
}

function error(status, message) {
  const result = new Error(message);
  result.status = status;
  return result;
}

function ordered(items = []) {
  return items.map((item, index) => ({ item, index }))
    .sort((left, right) => Number(left.item.sortOrder ?? 0) - Number(right.item.sortOrder ?? 0) || left.index - right.index)
    .map(({ item }) => item);
}

function safeProviderEmbed(provider, assetId) {
  const value = String(assetId ?? '').trim();
  if (provider === 'youtube' && /^[A-Za-z0-9_-]{11}$/u.test(value)) {
    return `https://www.youtube-nocookie.com/embed/${value}`;
  }
  if (provider === 'vimeo' && /^\d{1,20}$/u.test(value)) {
    return `https://player.vimeo.com/video/${value}`;
  }
  return null;
}

function populatedDocument(value) {
  if (!value || typeof value !== 'object' || typeof value.toHexString === 'function') return null;
  return typeof value.toObject === 'function' ? value.toObject() : value;
}

function moduleIsVisible(module, course) {
  const rawSubject = module.subject;
  const rawChapter = module.chapter;
  const subject = populatedDocument(module.subject);
  const chapter = populatedDocument(module.chapter);
  const rawChapterSubject = chapter?.subject;
  const chapterSubject = populatedDocument(rawChapterSubject);
  const examId = idOf(course.exam);
  if (rawSubject && (!subject || subject.publicationStatus !== 'published')) return false;
  if (rawChapter && (!chapter || chapter.publicationStatus !== 'published')) return false;
  if (rawChapterSubject && (!chapterSubject || chapterSubject.publicationStatus !== 'published')) return false;
  const configuredSubject = subject ?? chapterSubject;
  if (configuredSubject) {
    const configuredSubjectIds = new Set((course.subjects ?? []).map(idOf));
    if (!configuredSubjectIds.has(idOf(configuredSubject)) || (configuredSubject.exam && idOf(configuredSubject.exam) !== examId)) return false;
  }
  if (chapter && ((chapter.exam && idOf(chapter.exam) !== examId)
    || (configuredSubject && chapter.subject && idOf(chapter.subject) !== idOf(configuredSubject)))) return false;
  return true;
}

function visibleModules(course) {
  return ordered(course.modules ?? []).filter((module) => moduleIsVisible(module, course));
}

function lessonIsVisible(lesson, module, course) {
  if (lesson.publicationStatus && lesson.publicationStatus !== 'published') return false;
  if (!lesson.topic) return true;
  const topic = populatedDocument(lesson.topic);
  if (!topic || topic.publicationStatus !== 'published') return false;
  const subject = populatedDocument(module.subject);
  const chapter = populatedDocument(module.chapter);
  return Boolean(subject && chapter
    && idOf(topic.exam) === idOf(course.exam)
    && idOf(topic.subject) === idOf(subject)
    && idOf(topic.chapter) === idOf(chapter));
}

function visibleLessons(module, course) {
  return ordered(module.lessons ?? []).filter((lesson) => lessonIsVisible(lesson, module, course));
}

function totalLessonIds(course) {
  return visibleModules(course).flatMap((module) => visibleLessons(module, course).map((lesson) => idOf(lesson)));
}

function progressSummary(course, progress) {
  const lessonIds = totalLessonIds(course);
  const currentIds = new Set(lessonIds);
  const completedLessonIds = [...new Set((progress?.completedLessonIds ?? []).map(idOf).filter((id) => currentIds.has(id)))];
  const percent = lessonIds.length ? Math.round((completedLessonIds.length / lessonIds.length) * 100) : 0;
  return { completedLessonIds, completedCount: completedLessonIds.length, totalLessons: lessonIds.length, percent };
}

function visibleLastLessonId(course, progress) {
  const lastLessonId = progress?.lastLessonId ? idOf(progress.lastLessonId) : null;
  return lastLessonId && totalLessonIds(course).includes(lastLessonId) ? lastLessonId : null;
}

export function serializeCourse(value) {
  const course = typeof value?.toObject === 'function' ? value.toObject() : { ...(value ?? {}) };
  const productValue = course.product && typeof course.product === 'object'
    ? (typeof course.product.toObject === 'function' ? course.product.toObject() : course.product)
    : null;
  const listedPrice = Number.isSafeInteger(productValue?.pricePaise) ? productValue.pricePaise : null;
  const productPrice = Number.isSafeInteger(productValue?.currentPricePaise)
    ? productValue.currentPricePaise
    : listedPrice === null ? null : listedPrice - Number(productValue?.discountPaise ?? 0);
  const modules = visibleModules(course).map((module) => {
    const subjectValue = populatedDocument(module.subject);
    const chapterValue = populatedDocument(module.chapter);
    return {
      id: idOf(module),
      title: module.title,
      description: module.description ?? '',
      subject: subjectValue ? { id: idOf(subjectValue), name: subjectValue.name ?? '' } : null,
      chapter: chapterValue ? { id: idOf(chapterValue), name: chapterValue.name ?? '', slug: chapterValue.slug ?? '' } : null,
      sortOrder: Number(module.sortOrder ?? 0),
      lessons: visibleLessons(module, course).map((lesson) => ({
        id: idOf(lesson),
        title: lesson.title,
        description: lesson.description ?? '',
        durationMinutes: lesson.durationMinutes ?? null,
        isPreview: Boolean(lesson.isPreview),
        sortOrder: Number(lesson.sortOrder ?? 0),
        ...(lesson.topic ? { topic: {
          id: idOf(lesson.topic),
          name: populatedDocument(lesson.topic)?.name ?? '',
          slug: populatedDocument(lesson.topic)?.slug ?? '',
        } } : {}),
      })),
    };
  });
  const examValue = course.exam && typeof course.exam === 'object'
    ? (typeof course.exam.toObject === 'function' ? course.exam.toObject() : course.exam)
    : null;
  const subjectValues = (course.subjects ?? []).filter((subject) => populatedDocument(subject)?.publicationStatus === 'published'
    && (!populatedDocument(subject)?.exam || idOf(populatedDocument(subject).exam) === idOf(course.exam))).map((subject) => typeof subject === 'object'
    ? { id: idOf(subject), name: subject.name ?? '' }
    : { id: idOf(subject), name: '' });
  return {
    id: idOf(course),
    product: productValue ? {
      id: idOf(productValue),
      title: productValue.title ?? '',
      slug: productValue.slug ?? '',
      description: productValue.description ?? '',
      thumbnailUrl: productValue.thumbnailUrl ?? '',
      resourceType: productValue.resourceType ?? course.courseType,
      pricePaise: listedPrice,
      discountPaise: Number(productValue.discountPaise ?? 0),
      currentPricePaise: productPrice,
      isFree: productPrice === 0,
    } : null,
    exam: examValue ? { id: idOf(examValue), name: examValue.name ?? '' } : null,
    category: course.category ?? '',
    targetAudience: course.targetAudience ?? '',
    subjects: subjectValues,
    courseType: course.courseType,
    durationMinutes: course.durationMinutes ?? null,
    lessonCount: modules.reduce((sum, item) => sum + item.lessons.length, 0),
    outline: course.outline ?? [],
    modules,
    publicationStatus: course.publicationStatus,
    createdAt: course.createdAt ?? null,
    updatedAt: course.updatedAt ?? null,
  };
}

function populateCourse(query) {
  return query
    .populate({ path: 'product', select: 'title slug description thumbnailUrl resourceType pricePaise discountPaise currentPricePaise publicationStatus', match: { publicationStatus: 'published' } })
    .populate({ path: 'exam', select: 'name slug region publicationStatus', match: publishedExamFilter() })
    .populate({ path: 'subjects', select: 'name slug publicationStatus exam' })
    .populate({ path: 'modules.subject', select: 'name slug publicationStatus exam', populate: { path: 'exam', select: 'publicationStatus' } })
    .populate({ path: 'modules.chapter', select: 'name slug publicationStatus subject exam', populate: [
      { path: 'subject', select: 'publicationStatus' },
      { path: 'exam', select: 'publicationStatus' },
    ] })
    .populate({ path: 'modules.lessons.topic', select: 'name slug publicationStatus exam subject chapter', populate: [
      { path: 'exam', select: 'publicationStatus' },
      { path: 'subject', select: 'publicationStatus' },
      { path: 'chapter', select: 'publicationStatus subject exam' },
    ] });
}

async function getPublishedCourse(CourseModel, courseId) {
  if (!validId(courseId)) throw error(400, 'Enter a valid course ID.');
  const course = await populateCourse(CourseModel.findOne({ _id: courseId, publicationStatus: 'published' })).lean();
  if (!course || !course.product || !course.exam) throw error(404, 'The published course was not found.');
  return course;
}

async function hasCourseAccess({ course, studentId, PurchasedAccessModel }) {
  if (course.product?.currentPricePaise === 0) return true;
  return Boolean(await PurchasedAccessModel.exists({ student: studentId, product: idOf(course.product), status: 'active' }));
}

function getLesson(course, lessonId) {
  for (const module of visibleModules(course)) {
    const lesson = visibleLessons(module, course).find((entry) => idOf(entry) === String(lessonId));
    if (lesson) return lesson;
  }
  return null;
}

function playbackResult(course, lesson, { isPreview = false } = {}) {
  const freeAccess = course.product?.currentPricePaise === 0;
  const allowPublicProvider = freeAccess || (isPreview && lesson.isPreview);
  if (allowPublicProvider && publicProviderNames.has(lesson.videoProvider)) {
    const embedUrl = safeProviderEmbed(lesson.videoProvider, lesson.videoAssetId);
    if (embedUrl) return { available: true, provider: lesson.videoProvider, embedUrl, lessonTitle: lesson.title };
  }
  return {
    available: false,
    message: freeAccess || lesson.isPreview
      ? 'A playable preview is not configured for this lesson.'
      : 'Secure playback is unavailable until a private or signed video provider is configured.',
  };
}

function serializeWithProgress(course, progress) {
  return { ...serializeCourse(course), progress: progressSummary(course, progress) };
}

function queryLean(query) {
  return typeof query?.lean === 'function' ? query.lean() : query;
}

export function createCourseController({ CourseModel, ProductModel, ExamModel }) {
  return {
    getFlagshipDraftPreview: async (request, response, next) => {
      response.set('Cache-Control', 'no-store');
      try {
        const product = await queryLean(ProductModel.findOne({
          slug: flagshipPreviewSlug,
          resourceType: 'video-course',
          publicationStatus: 'draft',
        }).select('_id title description slug'));
        if (!product) return response.status(404).json({ message: 'The course preview is not available.' });

        const course = await queryLean(CourseModel.findOne({
          product: product._id,
          publicationStatus: 'draft',
          category: flagshipPreviewCategory,
        }).select('category subjects publicationStatus').populate({ path: 'subjects', select: 'slug' }));
        if (!course || course.publicationStatus !== 'draft') return response.status(404).json({ message: 'The course preview is not available.' });

        const subjectSlugs = (course.subjects ?? []).map((subject) => subject?.slug).sort();
        const expectedSlugs = flagshipPreviewSubjects.map((subject) => subject.slug).sort();
        if (subjectSlugs.length !== expectedSlugs.length || subjectSlugs.some((slug, index) => slug !== expectedSlugs[index])) {
          return response.status(404).json({ message: 'The course preview is not available.' });
        }

        return response.status(200).json({ preview: {
          title: product.title,
          description: product.description ?? '',
          category: course.category,
          subjects: flagshipPreviewSubjects.map((subject) => subject.name),
          status: 'draft',
        } });
      } catch (caught) { return next(caught); }
    },

    listCourses: async (request, response, next) => {
      try {
        const page = Number(request.query.page ?? 1);
        const limit = Number(request.query.limit ?? 12);
        if (!Number.isSafeInteger(page) || page < 1 || page > 1000) return response.status(400).json({ message: 'page must be an integer between 1 and 1000.' });
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) return response.status(400).json({ message: 'limit must be an integer between 1 and 50.' });
        const sort = request.query.sort ?? 'newest';
        if (!['newest', 'price-asc', 'price-desc'].includes(sort)) return response.status(400).json({ message: 'Choose a supported course sort order.' });
        const filter = { publicationStatus: 'published' };
        if (request.query.courseType) {
          if (!supportedCourseTypes.includes(request.query.courseType)) return response.status(400).json({ message: 'Choose a supported course type.' });
          filter.courseType = request.query.courseType;
        }
        if (request.query.examId) {
          if (!validId(request.query.examId)) return response.status(400).json({ message: 'examId must be a valid ID.' });
          filter.exam = request.query.examId;
        }
        const search = typeof request.query.q === 'string' ? request.query.q.trim() : '';
        if (search.length > 100) return response.status(400).json({ message: 'Search text must be 100 characters or fewer.' });
        const publicExams = await queryLean(ExamModel.find(publishedExamFilter()).select('_id'));
        if (filter.exam && !publicExams.some((exam) => idOf(exam) === String(filter.exam))) return response.status(200).json({ items: [], pagination: { page, limit, total: 0, pages: 0 } });
        if (!filter.exam) filter.exam = { $in: publicExams.map((exam) => exam._id) };
        const productFilter = { publicationStatus: 'published', resourceType: { $in: supportedCourseTypes } };
        if (search) {
          const escaped = search.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
          productFilter.$or = [{ $text: { $search: search } }, { title: new RegExp(escaped, 'iu') }, { description: new RegExp(escaped, 'iu') }];
        }
        const matchingProducts = await queryLean(ProductModel.find(productFilter).select('_id'));
        filter.product = { $in: matchingProducts.map((product) => product._id) };
        const offset = (page - 1) * limit;
        const total = await CourseModel.countDocuments(filter);
        let results;
        if (sort === 'newest') {
          results = await populateCourse(CourseModel.find(filter)).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit).lean();
        } else {
          const courseProductIds = await CourseModel.distinct('product', filter);
          const pageProducts = await ProductModel.find({ ...productFilter, _id: { $in: courseProductIds } })
            .sort({ currentPricePaise: sort === 'price-asc' ? 1 : -1, _id: 1 })
            .skip(offset).limit(limit).select('_id').lean();
          const productIds = pageProducts.map((product) => product._id);
          const productOrder = new Map(productIds.map((productId, index) => [idOf(productId), index]));
          results = await populateCourse(CourseModel.find({ ...filter, product: { $in: productIds } })).lean();
          results.sort((left, right) => productOrder.get(idOf(left.product)) - productOrder.get(idOf(right.product)));
        }
        const items = results.filter((course) => course.product && course.exam).map(serializeCourse);
        return response.status(200).json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
      } catch (caught) { return next(caught); }
    },

    getCourse: async (request, response, next) => {
      try {
        const course = await getPublishedCourse(CourseModel, request.params.id);
        return response.status(200).json({ course: serializeCourse(course) });
      } catch (caught) { return next(caught); }
    },

    getPreviewPlayback: async (request, response, next) => {
      try {
        const course = await getPublishedCourse(CourseModel, request.params.courseId);
        const lesson = getLesson(course, request.params.lessonId);
        if (!lesson) return response.status(404).json({ message: 'The lesson was not found in this course.' });
        if (!lesson.isPreview && course.product?.currentPricePaise !== 0) return response.status(403).json({ message: 'This lesson is not available as a free preview.' });
        return response.status(200).json(playbackResult(course, lesson, { isPreview: true }));
      } catch (caught) { return next(caught); }
    },
  };
}

export function createStudentCourseController({ CourseModel, ProductModel, CourseProgressModel, PurchasedAccessModel }) {
  return {
    listMyCourses: async (request, response, next) => {
      try {
        const studentId = idOf(request.user);
        const [accesses, savedProgress, freeProducts] = await Promise.all([
          queryLean(PurchasedAccessModel.find({ student: studentId, status: 'active' }).select('product')),
          queryLean(CourseProgressModel.find({ student: studentId }).select('course completedLessonIds lastLessonId')),
          queryLean(ProductModel.find({ publicationStatus: 'published', resourceType: { $in: supportedCourseTypes }, currentPricePaise: 0 }).select('_id')),
        ]);
        const purchasedProductIds = new Set((accesses ?? []).map((entry) => idOf(entry.product)));
        const progressByCourse = new Map((savedProgress ?? []).map((entry) => [idOf(entry.course), entry]));
        const productIds = new Set([...purchasedProductIds, ...(freeProducts ?? []).map(idOf)]);
        const courseFilter = { publicationStatus: 'published', product: { $in: [...productIds] } };
        const courses = await populateCourse(CourseModel.find(courseFilter)).sort({ updatedAt: -1 }).lean();
        const items = courses.filter((course) => course.product && course.exam).map((course) => ({
          ...serializeWithProgress(course, progressByCourse.get(idOf(course))),
          accessType: purchasedProductIds.has(idOf(course.product)) ? 'purchased' : 'free',
          continueLessonId: visibleLastLessonId(course, progressByCourse.get(idOf(course))),
        }));
        return response.status(200).json({ items });
      } catch (caught) { return next(caught); }
    },

    getProgress: async (request, response, next) => {
      try {
        const course = await getPublishedCourse(CourseModel, request.params.courseId);
        if (!await hasCourseAccess({ course, studentId: idOf(request.user), PurchasedAccessModel })) return response.status(403).json({ message: 'Purchase this course to view your learning progress.' });
        const progress = await queryLean(CourseProgressModel.findOne({ student: idOf(request.user), course: idOf(course) }));
        return response.status(200).json({ progress: { ...progressSummary(course, progress), lastLessonId: visibleLastLessonId(course, progress) } });
      } catch (caught) { return next(caught); }
    },

    completeLesson: async (request, response, next) => {
      try {
        const course = await getPublishedCourse(CourseModel, request.params.courseId);
        const lesson = getLesson(course, request.params.lessonId);
        if (!lesson) return response.status(404).json({ message: 'The lesson was not found in this course.' });
        if (!await hasCourseAccess({ course, studentId: idOf(request.user), PurchasedAccessModel })) return response.status(403).json({ message: 'Purchase this course before saving lesson progress.' });
        const progress = await CourseProgressModel.findOneAndUpdate(
          { student: idOf(request.user), course: idOf(course) },
          { $set: { lastLessonId: idOf(lesson) }, $addToSet: { completedLessonIds: idOf(lesson) } },
          { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
        );
        return response.status(200).json({ progress: { ...progressSummary(course, progress), lastLessonId: idOf(progress?.lastLessonId) || null } });
      } catch (caught) { return next(caught); }
    },

    getLessonPlayback: async (request, response, next) => {
      try {
        const course = await getPublishedCourse(CourseModel, request.params.courseId);
        const lesson = getLesson(course, request.params.lessonId);
        if (!lesson) return response.status(404).json({ message: 'The lesson was not found in this course.' });
        if (!await hasCourseAccess({ course, studentId: idOf(request.user), PurchasedAccessModel })) return response.status(403).json({ message: 'Purchase this course before opening this lesson.' });
        return response.status(200).json(playbackResult(course, lesson, { isPreview: lesson.isPreview }));
      } catch (caught) { return next(caught); }
    },
  };
}

