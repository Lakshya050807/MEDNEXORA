import mongoose from 'mongoose';
import { materialCategories, resourceTypes } from '../models/StudyMaterial.js';
import { publishedExamFilter } from '../services/examPublication.js';

const resourceLabels = Object.freeze({
  notes: 'Notes',
  'practice-paper': 'Practice paper',
  'previous-year-paper': 'Previous-year paper',
  'mock-test': 'Mock test',
  'video-course': 'Video course',
  'crash-course': 'Crash course',
  bundle: 'Preparation bundle',
});

function validObjectId(value) {
  return mongoose.isValidObjectId(value);
}

function parseInteger(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    const error = new Error(`${name} must be an integer between ${min} and ${max}.`);
    error.status = 400;
    throw error;
  }
  return number;
}

function normalizedReference(value) {
  if (!value) return null;
  const reference = typeof value.toObject === 'function' ? value.toObject() : value;
  if (typeof reference !== 'object') return String(reference);
  if (typeof reference.toHexString === 'function') return reference.toHexString();
  if (!reference._id && !reference.id) return String(reference);
  return {
    id: String(reference._id ?? reference.id),
    name: reference.name ?? reference.title ?? '',
    slug: reference.slug ?? '',
    ...(reference.isPrimary !== undefined ? { isPrimary: reference.isPrimary } : {}),
    ...(reference.courseType ? { courseType: reference.courseType } : {}),
    ...(reference.category ? { category: reference.category } : {}),
    ...(reference.targetAudience ? { targetAudience: reference.targetAudience } : {}),
    ...(reference.resourceType ? { resourceType: reference.resourceType } : {}),
    ...(reference.durationMinutes ? { durationMinutes: reference.durationMinutes } : {}),
    ...(reference.lessonCount !== undefined ? { lessonCount: reference.lessonCount } : {}),
    ...(Array.isArray(reference.outline) ? { outline: reference.outline } : {}),
    ...(reference.course && !['draft', 'archived'].includes(reference.course.publicationStatus)
      ? { courseId: String(reference.course._id ?? reference.course.id) }
      : {}),
  };
}

export function serializeProduct(document) {
  const product = typeof document?.toObject === 'function' ? document.toObject() : { ...document };
  if (!product) return null;
  delete product.__v;
  delete product.contentUrl;
  const topics = (product.topics ?? []).map(normalizedReference).filter(Boolean);
  const bundleItems = (product.bundleItems ?? []).map(normalizedReference).filter(Boolean);
  const resourceType = product.resourceType;
  const paperLabel = resourceType === 'previous-year-paper'
    ? (product.paperClassification === 'verified-previous-year' ? 'Verified previous-year paper' : 'Unverified previous-year paper')
    : resourceType === 'practice-paper'
      ? 'Original practice paper'
      : resourceType === 'mock-test'
        ? 'Original mock test'
        : null;
  const pricePaise = Number.isSafeInteger(product.pricePaise) ? product.pricePaise : null;
  const discountPaise = Number.isSafeInteger(product.discountPaise) ? product.discountPaise : 0;
  const currentPricePaise = Number.isSafeInteger(product.currentPricePaise)
    ? product.currentPricePaise
    : pricePaise === null ? null : pricePaise - discountPaise;
  const course = ['draft', 'archived'].includes(product.course?.publicationStatus) ? null : normalizedReference(product.course);
  return {
    ...product,
    id: String(product._id ?? product.id),
    exam: normalizedReference(product.exam),
    subject: normalizedReference(product.subject),
    chapter: normalizedReference(product.chapter),
    topic: normalizedReference(product.topic),
    topics,
    bundleItems,
    course,
    resourceTypeLabel: resourceLabels[resourceType] ?? 'Study resource',
    paperLabel,
    pricePaise,
    discountPaise,
    currentPricePaise,
    isFree: currentPricePaise === 0,
  };
}

function populateProduct(query) {
  return query
    .populate({ path: 'exam', select: 'name slug region publicationStatus', match: publishedExamFilter() })
    .populate({ path: 'subject', select: 'name slug publicationStatus', match: { publicationStatus: 'published' } })
    .populate({ path: 'chapter', select: 'name slug publicationStatus', match: { publicationStatus: 'published' } })
    .populate({ path: 'topic', select: 'name slug', match: { publicationStatus: 'published' } })
    .populate({ path: 'topics', select: 'name slug', match: { publicationStatus: 'published' } })
    .populate('course', 'courseType category targetAudience durationMinutes lessonCount outline publicationStatus')
    .populate({ path: 'bundleItems', select: 'title slug resourceType publicationStatus course', match: { publicationStatus: 'published' } })
    .populate({ path: 'bundleItems.course', select: 'publicationStatus' });
}

function serializePublicExam(exam) {
  const {
    officialSources: _legacyOfficialSources,
    publishedWithoutVerifiedSource: _legacyPublicationMarker,
    ...publicExam
  } = exam;
  return publicExam;
}

async function publishedHierarchyClauses({ ExamModel, SubjectModel, ChapterModel, TopicModel, CourseModel }) {
  const exams = await ExamModel.find(publishedExamFilter()).select('_id').lean();
  const examIds = exams.map((exam) => exam._id);
  const subjects = examIds.length
    ? await SubjectModel.find({ exam: { $in: examIds }, publicationStatus: 'published' }).select('_id').lean()
    : [];
  const subjectIds = subjects.map((subject) => subject._id);
  const publishedSubjectIds = new Set(subjectIds.map(String));
  const configuredCourses = CourseModel?.find && examIds.length
    ? await CourseModel.find({ exam: { $in: examIds }, publicationStatus: 'published' }).select('product subjects').lean()
    : [];
  const multiSubjectCourseProductIds = configuredCourses
    .filter((course) => Array.isArray(course.subjects) && course.subjects.length > 0
      && course.subjects.every((subject) => publishedSubjectIds.has(String(subject?._id ?? subject))))
    .map((course) => course.product?._id ?? course.product)
    .filter(Boolean);
  const chapters = examIds.length && subjectIds.length
    ? await ChapterModel.find({ exam: { $in: examIds }, subject: { $in: subjectIds }, publicationStatus: 'published' }).select('_id').lean()
    : [];
  const configuredTopics = examIds.length && subjectIds.length
    ? await TopicModel.find({ exam: { $in: examIds }, subject: { $in: subjectIds } }).select('_id publicationStatus chapter').lean()
    : [];
  const publishedChapterIds = new Set(chapters.map((chapter) => String(chapter._id)));
  const unpublishedTopicIds = configuredTopics
    .filter((topic) => topic.publicationStatus !== 'published' || (topic.chapter && !publishedChapterIds.has(String(topic.chapter))))
    .map((topic) => topic._id);
  return [
    { exam: { $in: examIds } },
    { $or: [
      { subject: { $in: subjectIds } },
      { resourceType: { $in: ['video-course', 'crash-course'] }, _id: { $in: multiSubjectCourseProductIds } },
    ] },
    { $or: [{ chapter: null }, { chapter: { $in: chapters.map((chapter) => chapter._id) } }] },
    { $or: [{ topic: null }, { topic: { $nin: unpublishedTopicIds } }] },
    { topics: { $nin: unpublishedTopicIds } },
  ];
}

function badRequest(response, message) {
  return response.status(400).json({ message });
}

function safeValidationMessage(error) {
  if (error?.name === 'ValidationError') {
    return Object.values(error.errors ?? {}).map((item) => item.message).filter(Boolean).join(' ') || 'The submitted catalogue data is invalid.';
  }
  if (error?.name === 'CastError') return 'One or more catalogue references are invalid.';
  return null;
}

function duplicateMessage(kind, error) {
  if (kind === 'exam' && error?.keyPattern?.isPrimary) {
    return 'Only one examination can be primary. Clear the current primary selection first.';
  }
  return 'A catalogue item with those identifiers already exists.';
}

function logStudyMaterialMongoError(error, operation, Model) {
  if (error?.name !== 'MongoServerError') return;
  const diagnostics = {
    name: error.name,
    model: 'StudyMaterial',
    collection: error.collectionName ?? error.ns ?? Model.collection?.collectionName ?? 'studymaterials',
    operation,
    code: error.code ?? null,
    codeName: error.codeName ?? null,
    message: error.message ?? 'MongoDB operation failed.',
    keyPattern: error.keyPattern ?? null,
    keyValue: error.keyValue ?? null,
    stack: error.stack ?? null,
  };
  // These diagnostics stay in backend logs. The API response continues to use
  // the generic safe error message from the app error handler.
  console.error('MongoDB StudyMaterial operation failed:', JSON.stringify(diagnostics));
}

function toAdminBody(body, fields) {
  const result = {};
  const optionalReferences = new Set(['exam', 'subject', 'chapter', 'topic', 'product', 'course']);
  for (const field of fields) {
    if (Object.hasOwn(body ?? {}, field)) result[field] = (optionalReferences.has(field) || ['category', 'difficultyLevel'].includes(field)) && body[field] === '' ? null : body[field];
  }
  return result;
}

function relationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

const referenceId = (value) => value?._id ?? value;

function plainSubdocument(value) {
  return value && typeof value.toObject === 'function' ? value.toObject() : { ...(value ?? {}) };
}

function idString(value) {
  const id = value?._id ?? value?.id ?? value;
  return id == null ? '' : String(id);
}

function preserveCourseModules(existingModules = [], incomingModules = [], { allowNewIds = false } = {}) {
  const existing = existingModules.map(plainSubdocument);
  const existingById = new Map(existing.filter((module) => module._id).map((module) => [idString(module._id), module]));
  const seenModuleIds = new Set();
  const merged = incomingModules.map((value) => {
    const module = plainSubdocument(value);
    const moduleId = idString(module._id);
    const oldModule = moduleId ? existingById.get(moduleId) : null;
    if (moduleId && !oldModule && !allowNewIds) throw relationError('A course module ID must belong to this course.');
    if (oldModule) seenModuleIds.add(moduleId);

    const result = oldModule ? { ...oldModule, ...module, _id: oldModule._id } : module;
    if (Array.isArray(module.lessons)) {
      const oldLessons = oldModule?.lessons ?? [];
      const oldLessonsById = new Map(oldLessons.filter((lesson) => lesson._id).map((lesson) => [idString(lesson._id), lesson]));
      const seenLessonIds = new Set();
      const lessons = module.lessons.map((lessonValue) => {
        const lesson = plainSubdocument(lessonValue);
        const lessonId = idString(lesson._id);
        const oldLesson = lessonId ? oldLessonsById.get(lessonId) : null;
        if (lessonId && !oldLesson && !allowNewIds) throw relationError('A lesson ID must belong to its existing course module.');
        if (oldLesson) seenLessonIds.add(lessonId);
        const normalized = oldLesson ? { ...oldLesson, ...lesson, _id: oldLesson._id } : { ...lesson };
        // New lessons start in draft. Existing legacy lessons with no status keep
        // that state when edited, preserving their existing student visibility.
        if (!oldLesson && !normalized.publicationStatus) normalized.publicationStatus = 'draft';
        return normalized;
      });
      result.lessons = [...lessons, ...oldLessons.filter((lesson) => !seenLessonIds.has(idString(lesson._id)))];
    } else if (oldModule) {
      result.lessons = oldModule.lessons ?? [];
    } else {
      result.lessons = [];
    }
    return result;
  });

  return [...merged, ...existing.filter((module) => !seenModuleIds.has(idString(module._id)))];
}

const adminFields = {
  exam: ['name', 'slug', 'region', 'description', 'eligibility', 'syllabus', 'pattern', 'isPrimary', 'publicationStatus'],
  subject: ['exam', 'name', 'slug', 'description', 'sortOrder', 'publicationStatus'],
  chapter: ['exam', 'subject', 'name', 'slug', 'description', 'sortOrder', 'publicationStatus'],
  topic: ['exam', 'subject', 'chapter', 'name', 'slug', 'description', 'sortOrder', 'publicationStatus'],
  product: ['exam', 'title', 'slug', 'description', 'detailedDescription', 'category', 'difficultyLevel', 'language', 'pricePaise', 'discountPaise', 'thumbnailUrl', 'subject', 'chapter', 'topic', 'topics', 'bundleItems', 'resourceType', 'publicationStatus', 'paperClassification', 'previousYearSource', 'format', 'fileSizeBytes', 'durationMinutes', 'course', 'keywords', 'learningOutcomes', 'preview', 'contentUrl'],
  course: ['product', 'exam', 'category', 'targetAudience', 'subjects', 'courseType', 'durationMinutes', 'lessonCount', 'outline', 'modules', 'publicationStatus'],
  questionBank: ['exam', 'subject', 'product', 'title', 'questions', 'publicationStatus'],
  mockTest: ['product', 'exam', 'title', 'description', 'instructions', 'questionBanks', 'durationMinutes', 'questionCount', 'marksPerQuestion', 'totalMarks', 'negativeMarkingEnabled', 'negativeMarksPerQuestion', 'patternVerified', 'allowAnswerReview', 'revealExplanations', 'publicationStatus'],
};

function adminHandlers(Model, kind, validate = async () => {}) {
  const fields = adminFields[kind];
  return {
    create: async (request, response, next) => {
      let operation = `${Model.modelName ?? kind}.validate`;
      try {
        const data = toAdminBody(request.body, fields);
        if (kind === 'course' && Array.isArray(data.modules)) {
          data.modules = preserveCourseModules([], data.modules, { allowNewIds: true });
          data.lessonCount = data.modules.reduce((count, module) => count + (module.lessons?.length ?? 0), 0);
        }
        await validate(data);
        operation = `${Model.modelName ?? kind}.create`;
        const document = await Model.create(data);
        return response.status(201).json({ [kind]: kind === 'product' ? serializeProduct(document) : document.toJSON() });
      } catch (error) {
        if (kind === 'product') logStudyMaterialMongoError(error, operation, Model);
        const validationMessage = safeValidationMessage(error);
        if (validationMessage) return badRequest(response, validationMessage);
        if (error?.code === 11000) return response.status(409).json({ message: duplicateMessage(kind, error) });
        return next(error);
      }
    },
    update: async (request, response, next) => {
      if (!validObjectId(request.params.id)) return badRequest(response, 'Enter a valid catalogue item ID.');
      let operation = `${Model.modelName ?? kind}.findById`;
      try {
        const document = await Model.findById(request.params.id);
        if (!document) return response.status(404).json({ message: 'The catalogue item was not found.' });
        const data = toAdminBody(request.body, fields);
        if (kind === 'course' && Array.isArray(data.modules)) {
          data.modules = preserveCourseModules(document.modules ?? [], data.modules);
          data.lessonCount = data.modules.reduce((count, module) => count + (module.lessons?.length ?? 0), 0);
        }
        document.set(data);
        operation = `${Model.modelName ?? kind}.validate`;
        await validate(document);
        operation = `${Model.modelName ?? kind}.save`;
        await document.save();
        return response.status(200).json({ [kind]: kind === 'product' ? serializeProduct(document) : document.toJSON() });
      } catch (error) {
        if (kind === 'product') logStudyMaterialMongoError(error, operation, Model);
        const validationMessage = safeValidationMessage(error);
        if (validationMessage) return badRequest(response, validationMessage);
        if (error?.code === 11000) return response.status(409).json({ message: duplicateMessage(kind, error) });
        return next(error);
      }
    },
  };
}

export function createCatalogController({ ProductModel, ExamModel, SubjectModel, ChapterModel, TopicModel, CourseModel, QuestionBankModel, MockTestModel, TestAttemptModel, OrderModel, PurchasedAccessModel }) {
  const examAdmin = adminHandlers(ExamModel, 'exam');
  const validateSubject = async (data) => {
    if (!data.exam) return;
    const exam = await ExamModel.findById(referenceId(data.exam)).select('publicationStatus');
    if (!exam) throw relationError('Choose an existing examination for this subject.');
    if (data.publicationStatus === 'published' && exam.publicationStatus !== 'published') throw relationError('Publish the examination before publishing its subjects.');
  };
  const subjectAdmin = adminHandlers(SubjectModel, 'subject', validateSubject);
  const validateChapter = async (data) => {
    if (!data.exam || !data.subject) return;
    const [exam, subject] = await Promise.all([
      ExamModel.findById(referenceId(data.exam)).select('publicationStatus'),
      SubjectModel.findById(referenceId(data.subject)).select('exam publicationStatus'),
    ]);
    if (!exam || !subject || String(referenceId(subject.exam)) !== String(referenceId(data.exam))) throw relationError('Choose a subject that belongs to the selected examination.');
    if (data.publicationStatus === 'published' && (exam.publicationStatus !== 'published' || subject.publicationStatus !== 'published')) throw relationError('Publish the examination and subject before publishing this chapter.');
  };
  const chapterAdmin = adminHandlers(ChapterModel, 'chapter', validateChapter);
  const validateTopic = async (data) => {
    if (!data.exam || !data.subject) return;
    const [exam, subject] = await Promise.all([
      ExamModel.findById(referenceId(data.exam)).select('publicationStatus'),
      SubjectModel.findById(referenceId(data.subject)).select('exam publicationStatus'),
    ]);
    if (!exam || !subject || String(referenceId(subject.exam)) !== String(referenceId(data.exam))) throw relationError('Choose a subject that belongs to the selected examination.');
    if (data.publicationStatus === 'published' && (exam.publicationStatus !== 'published' || subject.publicationStatus !== 'published')) throw relationError('Publish the examination and subject before publishing its topics.');
    if (data.chapter) {
      const chapter = await ChapterModel.findById(referenceId(data.chapter)).select('exam subject publicationStatus');
      if (!chapter || String(referenceId(chapter.exam)) !== String(referenceId(data.exam)) || String(referenceId(chapter.subject)) !== String(referenceId(data.subject))) throw relationError('Choose a chapter that belongs to the selected examination and subject.');
      if (data.publicationStatus === 'published' && chapter.publicationStatus !== 'published') throw relationError('Publish the chapter before publishing its topics.');
    }
  };
  const topicAdmin = adminHandlers(TopicModel, 'topic', validateTopic);
  const validateProductPublication = async (data) => {
    const examId = data.exam?._id ?? data.exam;
    const subjectId = data.subject?._id ?? data.subject;
    const isCourseProduct = ['video-course', 'crash-course'].includes(data.resourceType);
    if (!mongoose.isValidObjectId(examId)) throw relationError('Select an existing target examination from the examination list.');
    if (subjectId && !mongoose.isValidObjectId(subjectId)) throw relationError('Select a subject record from the subject list; subject names and slugs are not valid references.');
    const examQuery = ExamModel.findById(examId);
    const subjectQuery = subjectId ? SubjectModel.findById(subjectId) : null;
    const [exam, subject] = await Promise.all([
      examQuery?.select ? examQuery.select('publicationStatus region') : examQuery,
      subjectQuery?.select ? subjectQuery.select('exam publicationStatus') : subjectQuery,
    ]);
    if (!exam) throw relationError('The selected target examination was not found. Refresh the examination list and select an existing record.');
    if (subjectId && !subject) throw relationError('The selected subject was not found. Refresh the subject list and select an existing record.');
    if (!subject && !isCourseProduct) throw relationError('Choose an existing subject for this resource. Multi-subject courses can use their configured course subjects.');
    if (subject) {
      const subjectExamId = String(subject.exam?._id ?? subject.exam);
      if (subjectExamId !== String(examId)) throw relationError('The selected subject does not belong to the selected examination.');
    }
    // Draft resources may be mapped to draft exams and subjects. Parent publication
    // is required only when the resource itself is being published.
    if (data.publicationStatus === 'published' && (exam.publicationStatus !== 'published' || (subject && subject.publicationStatus !== 'published'))) {
      throw relationError('Publish the target examination and matching subject before publishing this resource.');
    }
    if (data.publicationStatus === 'published' && isCourseProduct) {
      const productId = data._id ? referenceId(data._id) : null;
      const configuredCourse = productId && CourseModel?.findOne
        ? await CourseModel.findOne({ product: productId, exam: referenceId(examId), courseType: data.resourceType, publicationStatus: 'published' }).select('_id')
        : null;
      if (!configuredCourse) throw relationError('Publish the configured course details and subjects before publishing its catalogue resource.');
    }
    if (data.chapter) {
      const chapter = await ChapterModel.findById(data.chapter?._id ?? data.chapter).select('exam subject publicationStatus');
      if (!chapter || String(referenceId(chapter.exam)) !== String(examId) || String(referenceId(chapter.subject)) !== String(subjectId)) throw relationError('Choose a chapter that belongs to the selected examination and subject.');
      if (data.publicationStatus === 'published' && chapter.publicationStatus !== 'published') throw relationError('Publish the selected chapter before publishing this resource.');
    }
    const topicIds = [data.topic?._id ?? data.topic, ...(data.topics ?? []).map((topic) => topic?._id ?? topic)].filter(Boolean);
    if (topicIds.length) {
      const topicFilter = { _id: { $in: topicIds }, exam: examId, subject: subjectId };
      if (data.publicationStatus === 'published') topicFilter.publicationStatus = 'published';
      const mappedCount = await TopicModel.countDocuments(topicFilter);
      if (mappedCount !== new Set(topicIds.map(String)).size) {
        throw relationError(data.publicationStatus === 'published'
          ? 'Every selected topic must be published under the selected exam and subject.'
          : 'Every selected topic must belong to the selected exam and subject.');
      }
    }
    if (data.publicationStatus === 'published' && data.resourceType === 'bundle') {
      const bundleIds = (data.bundleItems ?? []).map((item) => String(item?._id ?? item)).filter(Boolean);
      if (!bundleIds.length || (data._id && bundleIds.includes(String(data._id)))) {
        const error = new Error('Choose at least one different resource for this preparation bundle.');
        error.status = 400;
        throw error;
      }
      const publishedBundleItems = await ProductModel.countDocuments({ _id: { $in: bundleIds }, publicationStatus: 'published' });
      if (publishedBundleItems !== new Set(bundleIds).size) {
        const error = new Error('Every bundle item must be a published resource.');
        error.status = 400;
        throw error;
      }
    }
  };
  const productAdmin = adminHandlers(ProductModel, 'product', validateProductPublication);
  const validateQuestionBank = async (data) => {
    if (data.product === '') data.product = null;
    if (!data.exam || !data.subject) return;
    const [exam, subject] = await Promise.all([
      ExamModel.findById(referenceId(data.exam)).select('publicationStatus'),
      SubjectModel.findById(referenceId(data.subject)).select('exam publicationStatus'),
    ]);
    if (!exam || !subject || String(referenceId(subject.exam)) !== String(referenceId(data.exam))) throw relationError('Choose a subject that belongs to the selected examination.');
    if (data.publicationStatus === 'published' && (exam.publicationStatus !== 'published' || subject.publicationStatus !== 'published')) throw relationError('Publish the examination and subject before publishing this question bank.');
    if (data.product) {
      const product = await ProductModel.findById(referenceId(data.product)).select('exam publicationStatus');
      if (!product || String(referenceId(product.exam)) !== String(referenceId(data.exam))) throw relationError('Choose an access product for this question bank from the same examination.');
      if (data.publicationStatus === 'published' && product.publicationStatus !== 'published') throw relationError('Publish the access product before publishing this question bank.');
    }
    const topicIds = [...new Set((data.questions ?? []).map((question) => question.topic?._id ?? question.topic).filter(Boolean).map(String))];
    if (topicIds.length && await TopicModel.countDocuments({ _id: { $in: topicIds }, exam: referenceId(data.exam), subject: referenceId(data.subject) }) !== topicIds.length) throw relationError('Every question topic must belong to the selected examination and subject.');
  };
  const questionBankAdmin = adminHandlers(QuestionBankModel, 'questionBank', validateQuestionBank);
  const validateCourse = async (data) => {
    if (!data.product || !data.exam) return;
    const [product, exam] = await Promise.all([
      ProductModel.findById(referenceId(data.product)).select('resourceType exam publicationStatus slug'),
      ExamModel.findById(referenceId(data.exam)).select('publicationStatus'),
    ]);
    if (!product || !exam) throw relationError('Choose an existing catalogue product and examination for this course.');
    if (product.resourceType !== data.courseType || String(referenceId(product.exam)) !== String(referenceId(data.exam))) throw relationError('The selected course product must match its course type and examination.');
    if (data.publicationStatus === 'published' && exam.publicationStatus !== 'published') throw relationError('Publish the examination before publishing course metadata.');
    const subjectIds = [...new Set((data.subjects ?? []).map(referenceId).filter(Boolean).map(String))];
    if (subjectIds.length !== (data.subjects ?? []).length) throw relationError('A course cannot include the same subject more than once.');
    if (subjectIds.length) {
      const mappedSubjects = await SubjectModel.countDocuments({ _id: { $in: subjectIds }, exam: referenceId(data.exam) });
      if (mappedSubjects !== subjectIds.length) throw relationError('Every course subject must belong to the selected examination.');
      if (data.publicationStatus === 'published') {
        const publishedSubjects = await SubjectModel.countDocuments({ _id: { $in: subjectIds }, exam: referenceId(data.exam), publicationStatus: 'published' });
        if (publishedSubjects !== subjectIds.length) throw relationError('Publish every course subject under the selected examination before publishing the course.');
      }
    }
    if (product.slug === 'bsc-nursing-entrance-preparation') {
      const flagshipSubjects = await SubjectModel.find({ exam: referenceId(data.exam), slug: { $in: ['physics', 'chemistry', 'biology'] } }).select('_id slug').lean();
      const expected = new Set(flagshipSubjects.map((subject) => String(subject._id)));
      const actual = new Set(subjectIds);
      if (flagshipSubjects.length !== 3 || actual.size !== 3 || [...expected].some((id) => !actual.has(id))) {
        throw relationError('The B.Sc. Nursing Entrance Preparation course must include exactly Physics, Chemistry, and Biology.');
      }
    }
    const moduleSubjectIds = [...new Set((data.modules ?? []).map((module) => module.subject?._id ?? module.subject).filter(Boolean).map(String))];
    if (moduleSubjectIds.some((subjectId) => !subjectIds.includes(subjectId))) throw relationError('Each module subject must also be selected in the course subjects.');
    const moduleChapters = (data.modules ?? []).filter((module) => module.chapter).map((module) => ({
      chapterId: referenceId(module.chapter),
      subjectId: referenceId(module.subject),
    }));
    if (moduleChapters.some(({ subjectId }) => !subjectId || !subjectIds.includes(String(subjectId)))) {
      throw relationError('A course module with a chapter must also map to one of the selected course subjects.');
    }
    if (moduleChapters.length) {
      const chapterIds = [...new Set(moduleChapters.map(({ chapterId }) => String(chapterId)))];
      const chapterFilter = { _id: { $in: chapterIds }, exam: referenceId(data.exam), subject: { $in: moduleSubjectIds } };
      if (data.publicationStatus === 'published') chapterFilter.publicationStatus = 'published';
      const matchedChapters = await ChapterModel.find(chapterFilter).select('_id exam subject publicationStatus').lean();
      const chaptersById = new Map(matchedChapters.map((chapter) => [String(chapter._id), chapter]));
      if (moduleChapters.some(({ chapterId, subjectId }) => String(chaptersById.get(String(chapterId))?.subject) !== String(subjectId))) {
        throw relationError(data.publicationStatus === 'published'
          ? 'Publish each course chapter and map it to the selected module subject before publishing the course.'
          : 'Each course chapter must belong to the selected examination and its module subject.');
      }
    }
    if (data.publicationStatus === 'published' && moduleSubjectIds.length) {
      const publishedSubjects = await SubjectModel.countDocuments({ _id: { $in: moduleSubjectIds }, exam: referenceId(data.exam), publicationStatus: 'published' });
      if (publishedSubjects !== moduleSubjectIds.length) throw relationError('Publish every module subject under the selected examination before publishing the course.');
    }
    const topicMappings = [];
    for (const module of data.modules ?? []) {
      const moduleSubjectId = referenceId(module.subject);
      const moduleChapterId = referenceId(module.chapter);
      for (const lesson of module.lessons ?? []) {
        if (!lesson.topic) continue;
        const topicId = referenceId(lesson.topic);
        if (!validObjectId(topicId)) throw relationError('Choose a valid topic for each mapped lesson.');
        if (!moduleSubjectId || !subjectIds.includes(String(moduleSubjectId))) {
          throw relationError('A lesson topic must be mapped through a subject configured for this course.');
        }
        if (!moduleChapterId) throw relationError('A lesson with a topic must belong to a course module with a chapter.');
        topicMappings.push({ topicId: String(topicId), subjectId: String(moduleSubjectId), chapterId: String(moduleChapterId), lessonStatus: lesson.publicationStatus });
      }
    }
    if (topicMappings.length) {
      const topicIds = [...new Set(topicMappings.map((mapping) => mapping.topicId))];
      const topics = await TopicModel.find({ _id: { $in: topicIds } }).select('_id exam subject chapter publicationStatus').lean();
      const topicsById = new Map(topics.map((topic) => [String(topic._id), topic]));
      if (topicsById.size !== topicIds.length) throw relationError('Every mapped lesson topic must reference an existing topic.');
      for (const mapping of topicMappings) {
        const topic = topicsById.get(mapping.topicId);
        if (String(referenceId(topic.exam)) !== String(referenceId(data.exam))) {
          throw relationError('A lesson topic must belong to the course examination.');
        }
        if (String(referenceId(topic.subject)) !== mapping.subjectId) {
          throw relationError('A lesson topic must belong to the module subject.');
        }
        if (!topic.chapter || String(referenceId(topic.chapter)) !== mapping.chapterId) {
          throw relationError('A lesson topic must belong to the module chapter.');
        }
        if (data.publicationStatus === 'published' && mapping.lessonStatus === 'published' && topic.publicationStatus !== 'published') {
          throw relationError('Publish a lesson topic before publishing its mapped lesson.');
        }
      }
    }
  };
  const courseAdmin = adminHandlers(CourseModel, 'course', validateCourse);
  const validateMockTest = async (data) => {
    if (!data.product || !data.exam) return;
    const [product, exam] = await Promise.all([
      ProductModel.findById(referenceId(data.product)).select('resourceType exam publicationStatus'),
      ExamModel.findById(referenceId(data.exam)).select('publicationStatus'),
    ]);
    if (!product || !exam) throw relationError('Choose an existing mock-test product and examination.');
    if (product.resourceType !== 'mock-test' || String(referenceId(product.exam)) !== String(referenceId(data.exam))) throw relationError('The selected catalogue product must be a mock test for the selected examination.');
    const bankIds = [...new Set((data.questionBanks ?? []).map(referenceId).filter(Boolean).map(String))];
    if (bankIds.length) {
      const filter = { _id: { $in: bankIds }, exam: referenceId(data.exam) };
      if (data.publicationStatus === 'published') filter.publicationStatus = 'published';
      if (await QuestionBankModel.countDocuments(filter) !== bankIds.length) throw relationError('Every mock-test question bank must be mapped to this examination and published before publishing the test.');
    }
    if (data.publicationStatus === 'published' && (product.publicationStatus !== 'published' || exam.publicationStatus !== 'published')) throw relationError('Publish the mock-test product and examination before publishing the test.');
  };
  const mockTestAdmin = adminHandlers(MockTestModel, 'mockTest', validateMockTest);

  const deleteConfiguredRecord = (Model, dependencies) => async (request, response, next) => {
    if (!validObjectId(request.params.id)) return badRequest(response, 'Enter a valid catalogue item ID.');
    try {
      const record = await Model.findById(request.params.id);
      if (!record) return response.status(404).json({ message: 'The catalogue item was not found.' });
      const references = await Promise.all(dependencies.map(async ({ Model: ReferenceModel, filter, label }) => {
        const count = await ReferenceModel.countDocuments(filter(request.params.id));
        return count ? `${count} ${label}${count === 1 ? '' : 's'}` : null;
      }));
      const inUse = references.filter(Boolean);
      if (inUse.length) {
        const recordLabel = ({ Subject: 'subject', Chapter: 'chapter', Topic: 'topic', StudyMaterial: 'study material' })[Model.modelName] ?? 'catalogue record';
        return response.status(409).json({
          message: `This ${recordLabel} is still used by ${inUse.join(', ')}. Remove or remap those records before deleting it.`,
        });
      }
      await Model.deleteOne({ _id: request.params.id });
      return response.status(200).json({ message: 'The catalogue item was deleted.' });
    } catch (error) {
      return next(error);
    }
  };

  const deleteSubject = deleteConfiguredRecord(SubjectModel, [
    { Model: ChapterModel, filter: (id) => ({ subject: id }), label: 'chapter' },
    { Model: TopicModel, filter: (id) => ({ subject: id }), label: 'topic' },
    { Model: ProductModel, filter: (id) => ({ subject: id }), label: 'study resource' },
    { Model: QuestionBankModel, filter: (id) => ({ subject: id }), label: 'question bank' },
    { Model: CourseModel, filter: (id) => ({ $or: [{ subjects: id }, { 'modules.subject': id }] }), label: 'course reference' },
  ]);
  const topicDependencies = [
    { Model: ProductModel, filter: (id) => ({ $or: [{ topic: id }, { topics: id }] }), label: 'study resource' },
    { Model: QuestionBankModel, filter: (id) => ({ 'questions.topic': id }), label: 'question bank' },
    { Model: CourseModel, filter: (id) => ({ 'modules.lessons.topic': id }), label: 'course lesson' },
  ];
  if (TestAttemptModel) topicDependencies.push({ Model: TestAttemptModel, filter: (id) => ({ 'questions.topic': id }), label: 'saved practice attempt' });
  const deleteTopic = deleteConfiguredRecord(TopicModel, topicDependencies);
  const deleteChapter = deleteConfiguredRecord(ChapterModel, [
    { Model: TopicModel, filter: (id) => ({ chapter: id }), label: 'topic' },
    { Model: ProductModel, filter: (id) => ({ chapter: id }), label: 'study resource' },
    { Model: CourseModel, filter: (id) => ({ 'modules.chapter': id }), label: 'course module' },
  ]);
  const deleteProduct = deleteConfiguredRecord(ProductModel, [
    ...(OrderModel ? [{ Model: OrderModel, filter: (id) => ({ 'items.product': id }), label: 'order history reference' }] : []),
    ...(PurchasedAccessModel ? [{ Model: PurchasedAccessModel, filter: (id) => ({ product: id }), label: 'student access record' }] : []),
    { Model: QuestionBankModel, filter: (id) => ({ product: id }), label: 'question bank' },
    { Model: MockTestModel, filter: (id) => ({ product: id }), label: 'mock test' },
    { Model: CourseModel, filter: (id) => ({ product: id }), label: 'course' },
    { Model: ProductModel, filter: (id) => ({ bundleItems: id }), label: 'bundle reference' },
  ]);

  return {
    listProducts: async (request, response, next) => {
      try {
        const page = parseInteger(request.query.page, 'page', { min: 1, max: 1000 }) ?? 1;
        const limit = parseInteger(request.query.limit, 'limit', { min: 1, max: 50 }) ?? 12;
        const minPrice = parseInteger(request.query.minPricePaise, 'minPricePaise') ?? null;
        const maxPrice = parseInteger(request.query.maxPricePaise, 'maxPricePaise') ?? null;
        if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) return badRequest(response, 'Minimum price cannot exceed maximum price.');
        const queryText = typeof request.query.q === 'string' ? request.query.q.trim() : '';
        if (queryText.length > 100) return badRequest(response, 'Search text must be 100 characters or fewer.');
        const filter = { publicationStatus: 'published' };
        for (const [parameter, field] of [['examId', 'exam'], ['subjectId', 'subject'], ['excludeId', '_id']]) {
          const value = request.query[parameter];
          if (value === undefined || value === '') continue;
          if (!validObjectId(value)) return badRequest(response, `${parameter} must be a valid ID.`);
          if (parameter === 'excludeId') filter[field] = { $ne: value };
          else filter[field] = value;
        }
        if (request.query.chapterId) {
          if (!validObjectId(request.query.chapterId)) return badRequest(response, 'chapterId must be a valid ID.');
          filter.chapter = request.query.chapterId;
        }
        if (request.query.topicId) {
          if (!validObjectId(request.query.topicId)) return badRequest(response, 'topicId must be a valid ID.');
          filter.$and = [{ $or: [{ topic: request.query.topicId }, { topics: request.query.topicId }] }];
        }
        if (request.query.resourceType) {
          if (!resourceTypes.includes(request.query.resourceType)) return badRequest(response, 'Choose a supported resource type.');
          filter.resourceType = request.query.resourceType;
        }
        if (request.query.category) {
          if (!materialCategories.includes(request.query.category)) return badRequest(response, 'Choose a supported study material category.');
          filter.category = request.query.category;
        }
        if (request.query.free !== undefined && !['true', 'false'].includes(request.query.free)) {
          return badRequest(response, 'free must be true or false when provided.');
        }
        if (queryText) {
          const escapedQuery = queryText.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
          const namePattern = new RegExp(escapedQuery, 'iu');
          const [matchingSubjects, matchingChapters, matchingTopics] = await Promise.all([
            SubjectModel.find({ name: namePattern, publicationStatus: 'published' }).select('_id').lean(),
            ChapterModel.find({ name: namePattern, publicationStatus: 'published' }).select('_id').lean(),
            TopicModel.find({ name: namePattern, publicationStatus: 'published' }).select('_id').lean(),
          ]);
          const matchingChapterIds = matchingChapters.map((chapter) => chapter._id);
          const matchingTopicIds = matchingTopics.map((topic) => topic._id);
          const searchClauses = [
            { $text: { $search: queryText } },
            { subject: { $in: matchingSubjects.map((subject) => subject._id) } },
            { chapter: { $in: matchingChapterIds } },
            { topic: { $in: matchingTopicIds } },
            { topics: { $in: matchingTopicIds } },
          ];
          if (filter.$and) filter.$and.push({ $or: searchClauses });
          else filter.$or = searchClauses;
        }
        if (request.query.free === 'true') filter.currentPricePaise = { $eq: 0 };
        else if (request.query.free === 'false') filter.currentPricePaise = { $gt: 0 };
        if (minPrice !== null || maxPrice !== null) {
          const priceFilter = typeof filter.currentPricePaise === 'object' ? filter.currentPricePaise : {};
          if (minPrice !== null) priceFilter.$gte = minPrice;
          if (maxPrice !== null) priceFilter.$lte = maxPrice;
          filter.currentPricePaise = priceFilter;
        }

        filter.$and = [...(filter.$and ?? []), ...await publishedHierarchyClauses({ ExamModel, SubjectModel, ChapterModel, TopicModel, CourseModel })];

        const sortOptions = {
          newest: { createdAt: -1, _id: -1 },
          'price-asc': { currentPricePaise: 1, createdAt: -1 },
          'price-desc': { currentPricePaise: -1, createdAt: -1 },
        };
        const sortKey = request.query.sort ?? 'newest';
        if (!Object.hasOwn(sortOptions, sortKey)) return badRequest(response, 'Choose a supported sort order.');
        const skip = (page - 1) * limit;
        const [total, results] = await Promise.all([
          ProductModel.countDocuments(filter),
          populateProduct(ProductModel.find(filter)).sort(sortOptions[sortKey]).skip(skip).limit(limit).lean(),
        ]);
        return response.status(200).json({
          items: results.map(serializeProduct),
          pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
      } catch (error) {
        const validationMessage = safeValidationMessage(error);
        if (validationMessage) return badRequest(response, validationMessage);
        return next(error);
      }
    },

    getProduct: async (request, response, next) => {
      try {
        const { id } = request.params;
        const filter = validObjectId(id)
          ? { _id: id, publicationStatus: 'published' }
          : { slug: id, publicationStatus: 'published' };
        filter.$and = await publishedHierarchyClauses({ ExamModel, SubjectModel, ChapterModel, TopicModel, CourseModel });
        const query = ProductModel.findOne(filter);
        const product = await populateProduct(query).lean();
        if (!product) return response.status(404).json({ message: 'The study resource was not found.' });
        return response.status(200).json({ product: serializeProduct(product) });
      } catch (error) {
        return next(error);
      }
    },

    listExams: async (_request, response, next) => {
      try {
        const exams = await ExamModel.find(publishedExamFilter()).sort({ isPrimary: -1, name: 1 }).lean();
        return response.status(200).json({ items: exams.map(serializePublicExam) });
      } catch (error) { return next(error); }
    },

    getExam: async (request, response, next) => {
      try {
        const examFilter = publishedExamFilter();
        if (validObjectId(request.params.id)) examFilter._id = request.params.id;
        else examFilter.slug = request.params.id;
        const exam = await ExamModel.findOne(examFilter).lean();
        if (!exam) return response.status(404).json({ message: 'The published examination was not found.' });
        const [subjects, chapters, topics] = await Promise.all([
          SubjectModel.find({ exam: exam._id, publicationStatus: 'published' }).sort({ sortOrder: 1, name: 1 }).lean(),
          ChapterModel.find({ exam: exam._id, publicationStatus: 'published' }).sort({ sortOrder: 1, name: 1 }).lean(),
          TopicModel.find({ exam: exam._id, publicationStatus: 'published' }).sort({ sortOrder: 1, name: 1 }).lean(),
        ]);
        const chapterMap = new Map(chapters.map((chapter) => [String(chapter._id), { ...chapter, topics: [] }]));
        const subjectMap = new Map(subjects.map((subject) => [String(subject._id), { ...subject, chapters: [], topics: [] }]));
        for (const chapter of chapterMap.values()) subjectMap.get(String(chapter.subject))?.chapters.push(chapter);
        for (const topic of topics) {
          const subject = subjectMap.get(String(topic.subject));
          if (!subject) continue;
          if (topic.chapter) chapterMap.get(String(topic.chapter))?.topics.push(topic);
          else subject.topics.push(topic);
        }
        return response.status(200).json({ exam: serializePublicExam(exam), subjects: [...subjectMap.values()] });
      } catch (error) { return next(error); }
    },

    listSubjects: async (request, response, next) => {
      try {
        const filter = { publicationStatus: 'published' };
        if (request.query.examId) {
          if (!validObjectId(request.query.examId)) return badRequest(response, 'examId must be a valid ID.');
          const exam = await ExamModel.findOne(publishedExamFilter({ _id: request.query.examId })).select('_id').lean();
          if (!exam) return response.status(200).json({ items: [] });
          filter.exam = exam._id;
        } else {
          const exams = await ExamModel.find(publishedExamFilter()).select('_id').lean();
          filter.exam = { $in: exams.map((exam) => exam._id) };
        }
        const subjects = await SubjectModel.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
        return response.status(200).json({ items: subjects });
      } catch (error) { return next(error); }
    },

    listTopics: async (request, response, next) => {
      try {
        if (!request.query.subjectId || !validObjectId(request.query.subjectId)) return badRequest(response, 'A valid subjectId is required.');
        const subject = await SubjectModel.findOne({ _id: request.query.subjectId, publicationStatus: 'published' }).select('exam').lean();
        if (!subject) return response.status(200).json({ items: [] });
        const exam = await ExamModel.findOne(publishedExamFilter({ _id: subject.exam })).select('_id').lean();
        if (!exam) return response.status(200).json({ items: [] });
        const visibleChapters = await ChapterModel.find({ subject: request.query.subjectId, exam: exam._id, publicationStatus: 'published' }).select('_id').lean();
        const visibleChapterIds = visibleChapters.map((chapter) => chapter._id);
        const filter = {
          subject: request.query.subjectId,
          exam: exam._id,
          publicationStatus: 'published',
          $or: [{ chapter: null }, { chapter: { $in: visibleChapterIds } }],
        };
        if (request.query.chapterId) {
          if (!validObjectId(request.query.chapterId)) return badRequest(response, 'chapterId must be a valid ID.');
          if (!visibleChapterIds.some((chapterId) => String(chapterId) === String(request.query.chapterId))) return response.status(200).json({ items: [] });
          filter.chapter = request.query.chapterId;
          delete filter.$or;
        }
        const topics = await TopicModel.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
        return response.status(200).json({ items: topics });
      } catch (error) { return next(error); }
    },

    listChapters: async (request, response, next) => {
      try {
        if (!request.query.subjectId || !validObjectId(request.query.subjectId)) return badRequest(response, 'A valid subjectId is required.');
        const subject = await SubjectModel.findOne({ _id: request.query.subjectId, publicationStatus: 'published' }).select('exam').lean();
        if (!subject) return response.status(200).json({ items: [] });
        const exam = await ExamModel.findOne(publishedExamFilter({ _id: subject.exam })).select('_id').lean();
        if (!exam) return response.status(200).json({ items: [] });
        const chapters = await ChapterModel.find({ subject: request.query.subjectId, exam: exam._id, publicationStatus: 'published' }).sort({ sortOrder: 1, name: 1 }).lean();
        return response.status(200).json({ items: chapters });
      } catch (error) { return next(error); }
    },

    admin: {
      createExam: examAdmin.create,
      updateExam: examAdmin.update,
      createSubject: subjectAdmin.create,
      updateSubject: subjectAdmin.update,
      deleteSubject,
      createChapter: chapterAdmin.create,
      updateChapter: chapterAdmin.update,
      deleteChapter,
      createTopic: topicAdmin.create,
      updateTopic: topicAdmin.update,
      deleteTopic,
      createProduct: productAdmin.create,
      updateProduct: productAdmin.update,
      deleteProduct,
      createCourse: courseAdmin.create,
      updateCourse: courseAdmin.update,
      createQuestionBank: questionBankAdmin.create,
      updateQuestionBank: questionBankAdmin.update,
      createMockTest: mockTestAdmin.create,
      updateMockTest: mockTestAdmin.update,
    },
  };
}
