import mongoose from 'mongoose';

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function idString(value) {
  return value == null ? null : String(value._id ?? value.id ?? value);
}

function validId(value) {
  return typeof value === 'string' && mongoose.isValidObjectId(value);
}

function roundMarks(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function safeQuestion(question, answer, review, fallbackOrder) {
  const item = {
    id: idString(question.questionId),
    order: Number.isSafeInteger(question.order) ? question.order : fallbackOrder,
    prompt: question.prompt,
    options: question.options,
    topicId: idString(question.topic),
    topicName: question.topicName ?? '',
    subjectId: idString(question.subjectId),
    subjectName: question.subjectName ?? '',
    chapterId: idString(question.chapterId),
    chapterName: question.chapterName ?? '',
    image: question.image ?? null,
    selectedOptionIndex: answer?.selectedOptionIndex ?? null,
    markedForReview: answer?.markedForReview ?? false,
  };
  if (review) item.review = review;
  return item;
}

function serializeAttempt(attempt) {
  const answers = new Map((attempt.answers ?? []).map((answer) => [idString(answer.questionId), answer]));
  const keys = new Map((attempt.answerKey ?? []).map((answer) => [idString(answer.questionId), answer]));
  const questions = (attempt.questions ?? []).map((question, index) => {
    const answer = answers.get(idString(question.questionId));
    const key = keys.get(idString(question.questionId));
    const reveal = attempt.mode === 'practice'
      ? answer?.selectedOptionIndex !== null && answer?.selectedOptionIndex !== undefined
      : ['submitted', 'timed-out'].includes(attempt.status) && attempt.allowAnswerReview;
    const review = reveal && key ? {
      correctAnswerIndex: key.correctAnswerIndex,
      isCorrect: answer?.selectedOptionIndex === key.correctAnswerIndex,
      ...(attempt.mode === 'practice' || attempt.revealExplanations ? { explanation: key.explanation ?? '' } : {}),
    } : null;
    return safeQuestion(question, answer, review, index);
  });
  const spent = attempt.result?.timeSpentSeconds;
  return {
    id: idString(attempt._id ?? attempt.id),
    mode: attempt.mode,
    title: attempt.titleSnapshot,
    description: attempt.descriptionSnapshot ?? '',
    instructions: attempt.instructionsSnapshot ?? '',
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt,
    durationMinutes: attempt.durationMinutes,
    marksPerQuestion: attempt.marksPerQuestion,
    negativeMarkingEnabled: attempt.negativeMarkingEnabled,
    negativeMarksPerQuestion: attempt.negativeMarksPerQuestion,
    maximumMarks: attempt.maximumMarks,
    allowAnswerReview: attempt.allowAnswerReview,
    revealExplanations: attempt.revealExplanations,
    questions,
    result: attempt.result ?? null,
    timeSpentSeconds: Number.isSafeInteger(spent) ? spent : null,
    createdAt: attempt.createdAt,
  };
}

function serializeHistoryItem(attempt) {
  return {
    id: idString(attempt._id ?? attempt.id),
    mode: attempt.mode,
    title: attempt.titleSnapshot,
    status: attempt.status,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    result: attempt.result ?? null,
    timeSpentSeconds: Number.isSafeInteger(attempt.result?.timeSpentSeconds) ? attempt.result.timeSpentSeconds : null,
    questionCount: attempt.questions?.length ?? 0,
  };
}

export function createPracticeController({
  QuestionBankModel,
  MockTestModel,
  ProductModel,
  PurchasedAccessModel,
  TestAttemptModel,
  ExamModel,
  SubjectModel,
  TopicModel,
  ChapterModel,
}) {
  async function findAttempt(id, studentId) {
    const query = TestAttemptModel.findOne({ _id: id, student: studentId });
    if (typeof query?.select === 'function') query.select('+answerKey');
    return await query;
  }

  async function checkProductAccess(productId, studentId) {
    if (!productId) return { allowed: false, product: null };
    let query = ProductModel.findById(productId);
    if (typeof query?.select === 'function') query = query.select('_id title publicationStatus currentPricePaise resourceType');
    if (typeof query?.lean === 'function') query = query.lean();
    const product = await query;
    if (!product || product.publicationStatus !== 'published') return { allowed: false, product: null };
    if (!Number.isSafeInteger(product.currentPricePaise)) return { allowed: false, product };
    if (product.currentPricePaise === 0) return { allowed: true, product };
    const access = await PurchasedAccessModel.exists({ student: studentId, product: productId, status: 'active' });
    return { allowed: Boolean(access), product };
  }

  async function loadQuestionBank(id) {
    let query = QuestionBankModel.findOne({ _id: id, publicationStatus: 'published' });
    if (typeof query?.select === 'function') query = query.select('title exam subject product questions publicationStatus');
    if (typeof query?.lean === 'function') query = query.lean();
    return await query;
  }

  async function loadMockTest(id) {
    let query = MockTestModel.findOne({ _id: id, publicationStatus: 'published' });
    if (typeof query?.lean === 'function') query = query.lean();
    return await query;
  }

  async function loadQuestionMetadata(banks) {
    const subjectIds = [...new Set((banks ?? []).map((bank) => idString(bank.subject)).filter(Boolean))];
    const topicIds = [...new Set((banks ?? []).flatMap((bank) => (bank.questions ?? []).map((question) => idString(question.topic))).filter(Boolean))];
    const [subjects, topics] = await Promise.all([
      subjectIds.length
        ? SubjectModel.find({ _id: { $in: subjectIds } }).select('_id name').lean()
        : [],
      topicIds.length
        ? TopicModel.find({ _id: { $in: topicIds } }).select('_id name subject chapter').lean()
        : [],
    ]);
    const chapterIds = [...new Set((topics ?? []).map((topic) => idString(topic.chapter)).filter(Boolean))];
    const chapters = chapterIds.length
      ? await ChapterModel.find({ _id: { $in: chapterIds } }).select('_id name').lean()
      : [];
    return {
      subjects: new Map((subjects ?? []).map((subject) => [idString(subject._id), subject])),
      topics: new Map((topics ?? []).map((topic) => [idString(topic._id), topic])),
      chapters: new Map((chapters ?? []).map((chapter) => [idString(chapter._id), chapter])),
    };
  }

  function withQuestionMetadata(question, bank, metadata, order) {
    const topic = metadata.topics.get(idString(question.topic)) ?? null;
    const subject = metadata.subjects.get(idString(bank.subject)) ?? null;
    const chapterId = idString(topic?.chapter);
    const chapter = chapterId ? metadata.chapters.get(chapterId) : null;
    return {
      question,
      bankId: bank._id,
      order,
      subjectId: bank.subject ?? null,
      subjectName: subject?.name ?? '',
      topicId: question.topic ?? null,
      topicName: topic?.name ?? '',
      chapterId: topic?.chapter ?? null,
      chapterName: chapter?.name ?? '',
    };
  }

  function elapsedSeconds(attempt, submittedAt) {
    const started = new Date(attempt.startedAt).getTime();
    const ended = new Date(submittedAt).getTime();
    if (!Number.isFinite(started) || !Number.isFinite(ended)) return 0;
    const elapsed = Math.max(0, Math.floor((ended - started) / 1000));
    return Number.isSafeInteger(attempt.durationMinutes) && attempt.durationMinutes > 0
      ? Math.min(elapsed, attempt.durationMinutes * 60)
      : elapsed;
  }

  async function scoreAndSubmit(attempt, studentId, timedOut = false) {
    if (attempt.status !== 'in-progress') return attempt;
    const attemptId = idString(attempt._id ?? attempt.id);
    if (attempt.status === 'in-progress') {
      const now = new Date();
      const didExpire = timedOut || (attempt.expiresAt && new Date(attempt.expiresAt).getTime() <= now.getTime());
      const claimed = await TestAttemptModel.findOneAndUpdate(
        { _id: attemptId, student: studentId, status: 'in-progress', submissionLocked: { $ne: true } },
        { $set: { submissionLocked: true, submissionTimedOut: Boolean(didExpire) } },
        { new: true },
      );
      attempt = await findAttempt(attemptId, studentId);
      if (!attempt) throw httpError(404, 'This attempt could not be found.');
      if (['submitted', 'timed-out'].includes(attempt.status)) return attempt;
      if (!claimed && !attempt.submissionLocked) return attempt;
    }
    if (attempt.status !== 'in-progress' || !attempt.submissionLocked) return attempt;
    const now = new Date();
    const didExpire = Boolean(attempt.submissionTimedOut);
    const answers = new Map((attempt.answers ?? []).map((answer) => [idString(answer.questionId), answer]));
    const keys = new Map((attempt.answerKey ?? []).map((answer) => [idString(answer.questionId), answer]));
    let correctAnswers = 0;
    let incorrectAnswers = 0;
    let unansweredQuestions = 0;
    let score = 0;
    for (const question of attempt.questions ?? []) {
      const answer = answers.get(idString(question.questionId));
      const key = keys.get(idString(question.questionId));
      if (answer?.selectedOptionIndex === null || answer?.selectedOptionIndex === undefined) {
        unansweredQuestions += 1;
      } else if (answer.selectedOptionIndex === key?.correctAnswerIndex) {
        correctAnswers += 1;
        score += attempt.marksPerQuestion;
      } else {
        incorrectAnswers += 1;
        if (attempt.negativeMarkingEnabled) score -= attempt.negativeMarksPerQuestion;
      }
    }
    const answeredCount = correctAnswers + incorrectAnswers;
    const result = {
      score: roundMarks(score),
      maximumMarks: roundMarks(attempt.maximumMarks),
      correctAnswers,
      incorrectAnswers,
      unansweredQuestions,
      accuracyPercent: answeredCount ? roundMarks((correctAnswers / answeredCount) * 100) : 0,
      timeSpentSeconds: elapsedSeconds(attempt, now),
    };
    const updated = await TestAttemptModel.findOneAndUpdate(
      { _id: attemptId, student: studentId, status: 'in-progress', submissionLocked: true },
      { $set: { status: didExpire ? 'timed-out' : 'submitted', submissionLocked: false, submittedAt: now, result } },
      { new: true, runValidators: true },
    );
    if (updated) {
      const query = TestAttemptModel.findOne({ _id: attemptId, student: studentId });
      if (typeof query?.select === 'function') query.select('+answerKey');
      return await query;
    }
    const latest = await findAttempt(attemptId, studentId);
    if (latest) return latest;
    throw httpError(404, 'This attempt could not be found.');
  }

  async function autoSubmitIfExpired(attempt, studentId) {
    if (attempt.status === 'in-progress' && (attempt.submissionLocked || (attempt.expiresAt && new Date(attempt.expiresAt).getTime() <= Date.now()))) {
      return scoreAndSubmit(attempt, studentId, true);
    }
    return attempt;
  }

  async function saveAttempt({ studentId, mode, mockTest = null, questionBank = null, questions, title, description = '', instructions = '', startedAt, durationMinutes = null, marksPerQuestion = 1, negativeMarkingEnabled = false, negativeMarksPerQuestion = 0, maximumMarks, allowAnswerReview = true, revealExplanations = true }) {
    const expiresAt = durationMinutes ? new Date(startedAt.getTime() + durationMinutes * 60_000) : null;
    return TestAttemptModel.create({
      student: studentId,
      mode,
      mockTest,
      questionBank,
      titleSnapshot: title,
      descriptionSnapshot: description,
      instructionsSnapshot: instructions,
      questions: questions.map(({ question, bankId, order, subjectId, subjectName, topicName, chapterId, chapterName }, index) => ({
        questionId: question._id,
        bankId: bankId ?? null,
        order: Number.isSafeInteger(order) ? order : index,
        prompt: question.prompt,
        options: [...question.options],
        topic: question.topic ?? null,
        topicName: topicName ?? '',
        subjectId: subjectId ?? null,
        subjectName: subjectName ?? '',
        chapterId: chapterId ?? null,
        chapterName: chapterName ?? '',
        image: question.image ? { url: question.image.url, mimeType: question.image.mimeType, altText: question.image.altText ?? '' } : null,
      })),
      answers: questions.map(({ question }) => ({ questionId: question._id, selectedOptionIndex: null, markedForReview: false })),
      answerKey: questions.map(({ question }) => ({ questionId: question._id, correctAnswerIndex: question.correctAnswerIndex, explanation: question.explanation ?? '' })),
      status: 'in-progress',
      startedAt,
      expiresAt,
      durationMinutes,
      marksPerQuestion,
      negativeMarkingEnabled,
      negativeMarksPerQuestion,
      maximumMarks,
      allowAnswerReview,
      revealExplanations,
    });
  }

  async function startMockAttempt(request, response, next) {
    try {
      const mockTestId = request.body?.mockTestId;
      if (!validId(mockTestId)) return response.status(400).json({ message: 'Choose a valid mock test.' });
      const existingQuery = TestAttemptModel.findOne({ student: request.user._id, mockTest: mockTestId, mode: 'mock', status: 'in-progress' });
      if (typeof existingQuery?.select === 'function') existingQuery.select('+answerKey');
      const existing = await existingQuery;
      if (existing) {
        const current = await autoSubmitIfExpired(existing, request.user._id);
        return response.status(200).json({ attempt: serializeAttempt(current), resumed: current.status === 'in-progress' });
      }

      const test = await loadMockTest(mockTestId);
      if (!test) return response.status(404).json({ message: 'This mock test is unavailable.' });
      const access = await checkProductAccess(test.product, request.user._id);
      if (!access.allowed) return response.status(403).json({ message: 'You need active access to start this mock test.' });
      if (test.questionBanks?.length === 0) return response.status(409).json({ message: 'This mock test does not have published question banks yet.' });
      let bankQuery = QuestionBankModel.find({ _id: { $in: test.questionBanks }, exam: test.exam, publicationStatus: 'published' });
      if (typeof bankQuery?.select === 'function') bankQuery = bankQuery.select('title exam subject product questions');
      if (typeof bankQuery?.lean === 'function') bankQuery = bankQuery.lean();
      const banks = await bankQuery;
      const accessibleBanks = [];
      for (const bank of banks ?? []) {
        const bankAccess = bank.product ? await checkProductAccess(bank.product, request.user._id) : { allowed: true };
        if (bankAccess.allowed) accessibleBanks.push(bank);
      }
      const available = accessibleBanks.flatMap((bank) => (bank.questions ?? []).map((question) => ({ question, bank })));
      if (available.length === 0) return response.status(409).json({ message: 'This mock test does not have accessible published questions yet.' });
      const requestedCount = test.questionCount ?? available.length;
      if (!Number.isSafeInteger(requestedCount) || requestedCount < 1 || requestedCount > available.length) {
        return response.status(409).json({ message: 'The mock test question count does not match its published question banks.' });
      }
      const selected = [...available].sort(() => Math.random() - 0.5).slice(0, requestedCount);
      const metadata = await loadQuestionMetadata(accessibleBanks);
      const snapshotQuestions = selected.map(({ question, bank }, index) => withQuestionMetadata(question, bank, metadata, index));
      const marksPerQuestion = Number(test.marksPerQuestion ?? 1);
      const maximumMarks = Number(test.totalMarks ?? (requestedCount * marksPerQuestion));
      const penalty = Number(test.negativeMarksPerQuestion ?? 0);
      if (!Number.isFinite(marksPerQuestion) || marksPerQuestion < 0 || !Number.isFinite(maximumMarks) || maximumMarks < 0
        || maximumMarks < requestedCount * marksPerQuestion || !Number.isFinite(penalty) || penalty < 0 || penalty > marksPerQuestion) {
        return response.status(409).json({ message: 'The mock test has invalid scoring settings.' });
      }
      const startedAt = new Date();
      const attempt = await saveAttempt({
        studentId: request.user._id,
        mode: 'mock',
        mockTest: test._id,
        questions: snapshotQuestions,
        title: test.title,
        description: test.description ?? '',
        instructions: test.instructions ?? '',
        startedAt,
        durationMinutes: test.durationMinutes,
        marksPerQuestion,
        negativeMarkingEnabled: Boolean(test.negativeMarkingEnabled),
        negativeMarksPerQuestion: penalty,
        maximumMarks,
        allowAnswerReview: test.allowAnswerReview !== false,
        revealExplanations: test.revealExplanations !== false,
      });
      return response.status(201).json({ attempt: serializeAttempt(attempt), resumed: false });
    } catch (error) {
      if (error?.code === 11000) {
        try {
          const query = TestAttemptModel.findOne({ student: request.user._id, mockTest: request.body?.mockTestId, mode: 'mock', status: 'in-progress' });
          if (typeof query?.select === 'function') query.select('+answerKey');
          const active = await query;
          if (active) return response.status(200).json({ attempt: serializeAttempt(active), resumed: true });
        } catch { /* Return the original safe conflict below. */ }
        return response.status(409).json({ message: 'An attempt for this mock test is already being started.' });
      }
      if (error?.status) return response.status(error.status).json({ message: error.message });
      return next(error);
    }
  }

  async function startPracticeAttempt(request, response, next) {
    try {
      const bankId = request.body?.questionBankId;
      if (!validId(bankId)) return response.status(400).json({ message: 'Choose a valid question bank.' });
      const bank = await loadQuestionBank(bankId);
      if (!bank) return response.status(404).json({ message: 'This question bank is unavailable.' });
      if (bank.product && !(await checkProductAccess(bank.product, request.user._id)).allowed) {
        return response.status(403).json({ message: 'You need active access to practice from this question bank.' });
      }
      const topicId = request.body?.topicId;
      if (topicId && !validId(topicId)) return response.status(400).json({ message: 'Choose a valid topic.' });
      if (topicId) {
        const topic = await TopicModel.findOne({ _id: topicId, subject: bank.subject, exam: bank.exam, publicationStatus: 'published' });
        if (!topic) return response.status(404).json({ message: 'This topic is unavailable.' });
      }
      const questionIds = request.body?.questionIds;
      if (questionIds !== undefined && (!Array.isArray(questionIds) || questionIds.length < 1 || questionIds.length > 100 || questionIds.some((id) => !validId(id)))) {
        return response.status(400).json({ message: 'Choose between 1 and 100 valid questions.' });
      }
      if (questionIds && new Set(questionIds.map(String)).size !== questionIds.length) return response.status(400).json({ message: 'A question can only be selected once.' });
      const allowedIds = questionIds ? new Set(questionIds.map(String)) : null;
      const questions = (bank.questions ?? []).filter((question) => (!topicId || idString(question.topic) === String(topicId)) && (!allowedIds || allowedIds.has(idString(question._id))));
      if (allowedIds && questions.length !== allowedIds.size) return response.status(400).json({ message: 'Every selected question must belong to this bank and topic.' });
      if (!questions.length) return response.status(404).json({ message: 'No published questions are available for this selection.' });
      const metadata = await loadQuestionMetadata([bank]);
      const attempt = await saveAttempt({
        studentId: request.user._id,
        mode: 'practice',
        questionBank: bank._id,
        questions: questions.map((question, index) => withQuestionMetadata(question, bank, metadata, index)),
        title: bank.title,
        startedAt: new Date(),
        marksPerQuestion: 1,
        maximumMarks: questions.length,
      });
      return response.status(201).json({ attempt: serializeAttempt(attempt) });
    } catch (error) {
      if (error?.status) return response.status(error.status).json({ message: error.message });
      return next(error);
    }
  }

  return {
    listQuestionBanks: async (request, response, next) => {
      try {
        const filter = { publicationStatus: 'published' };
        for (const [key, field] of [['examId', 'exam'], ['subjectId', 'subject'], ['topicId', 'questions.topic']]) {
          if (!request.query[key]) continue;
          if (!validId(request.query[key])) return response.status(400).json({ message: `${key} must be a valid ID.` });
          filter[field] = request.query[key];
        }
        const page = Number(request.query.page ?? 1);
        const limit = Number(request.query.limit ?? 20);
        if (!Number.isSafeInteger(page) || page < 1 || page > 1000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) return response.status(400).json({ message: 'Page must be 1 to 1000 and limit must be 1 to 50.' });
        const search = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 100) : '';
        if (search) {
          const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu');
          filter.$and = [{ $or: [{ title: regex }, { 'questions.prompt': regex }] }];
        }
        const skip = (page - 1) * limit;
        let query = QuestionBankModel.find(filter).sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(limit);
        if (typeof query?.select === 'function') query = query.select('title exam subject product questions._id createdAt updatedAt');
        if (typeof query?.populate === 'function') query = query.populate({ path: 'exam', select: 'name slug' }).populate({ path: 'subject', select: 'name slug' });
        if (typeof query?.lean === 'function') query = query.lean();
        const [banks, total] = await Promise.all([query, QuestionBankModel.countDocuments(filter)]);
        const items = [];
        for (const bank of banks ?? []) {
          const access = bank.product ? await checkProductAccess(bank.product, request.user._id) : { allowed: true };
          items.push({
            id: idString(bank._id),
            title: bank.title,
            exam: bank.exam,
            subject: bank.subject,
            questionCount: bank.questions?.length ?? 0,
            locked: !access.allowed,
            createdAt: bank.createdAt,
            updatedAt: bank.updatedAt,
          });
        }
        return response.status(200).json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
      } catch (error) { return next(error); }
    },
    listMockTests: async (request, response, next) => {
      try {
        let query = MockTestModel.find({ publicationStatus: 'published' }).sort({ createdAt: -1, _id: -1 });
        if (typeof query?.populate === 'function') query = query.populate({ path: 'exam', select: 'name slug' });
        if (typeof query?.lean === 'function') query = query.lean();
        const tests = await query;
        const items = [];
        for (const test of tests ?? []) {
          const access = await checkProductAccess(test.product, request.user._id);
          if (!access.product) continue;
          items.push({
            id: idString(test._id),
            title: test.title,
            description: test.description ?? '',
            instructions: test.instructions ?? '',
            exam: test.exam,
            durationMinutes: test.durationMinutes,
            questionCount: test.questionCount,
            marksPerQuestion: test.marksPerQuestion,
            totalMarks: test.totalMarks,
            negativeMarkingEnabled: test.negativeMarkingEnabled,
            negativeMarksPerQuestion: test.negativeMarksPerQuestion,
            patternVerified: Boolean(test.patternVerified),
            pricePaise: access.product.currentPricePaise,
            locked: !access.allowed,
            allowAnswerReview: test.allowAnswerReview !== false,
          });
        }
        return response.status(200).json({ items });
      } catch (error) { return next(error); }
    },
    startAttempt: async (request, response, next) => {
      if (request.body?.mode === 'practice') return startPracticeAttempt(request, response, next);
      if (request.body?.mode === 'mock') return startMockAttempt(request, response, next);
      return response.status(400).json({ message: 'Choose practice or mock-test mode.' });
    },
    getAttempt: async (request, response, next) => {
      try {
        if (!validId(request.params.id)) return response.status(400).json({ message: 'Attempt ID must be valid.' });
        let attempt = await findAttempt(request.params.id, request.user._id);
        if (!attempt) return response.status(404).json({ message: 'This attempt could not be found.' });
        attempt = await autoSubmitIfExpired(attempt, request.user._id);
        return response.status(200).json({ attempt: serializeAttempt(attempt) });
      } catch (error) { return next(error); }
    },
    updateAnswer: async (request, response, next) => {
      try {
        const { id, questionId } = request.params;
        if (!validId(id) || !validId(questionId)) return response.status(400).json({ message: 'Attempt and question IDs must be valid.' });
        let attempt = await findAttempt(id, request.user._id);
        if (!attempt) return response.status(404).json({ message: 'This attempt could not be found.' });
        attempt = await autoSubmitIfExpired(attempt, request.user._id);
        if (attempt.status !== 'in-progress') return response.status(409).json({ message: 'This attempt has already been submitted.' });
        const questionIndex = attempt.questions.findIndex((question) => idString(question.questionId) === questionId);
        if (questionIndex < 0) return response.status(400).json({ message: 'This question is not part of the attempt.' });
        const body = request.body ?? {};
        const answerIndex = attempt.answers.findIndex((answer) => idString(answer.questionId) === questionId);
        if (answerIndex < 0) return response.status(409).json({ message: 'The answer record for this question is missing.' });
        const updates = {};
        if (Object.hasOwn(body, 'selectedOptionIndex')) {
          if (body.selectedOptionIndex !== null && (!Number.isSafeInteger(body.selectedOptionIndex) || body.selectedOptionIndex < 0 || body.selectedOptionIndex >= attempt.questions[questionIndex].options.length)) {
            return response.status(400).json({ message: 'Choose one of the available answer options.' });
          }
          updates[`answers.${answerIndex}.selectedOptionIndex`] = body.selectedOptionIndex;
        }
        if (Object.hasOwn(body, 'markedForReview')) {
          if (typeof body.markedForReview !== 'boolean') return response.status(400).json({ message: 'markedForReview must be true or false.' });
          updates[`answers.${answerIndex}.markedForReview`] = body.markedForReview;
        }
        if (!Object.keys(updates).length) return response.status(400).json({ message: 'Provide an answer or review-mark update.' });
        const answerFilter = { _id: id, student: request.user._id, status: 'in-progress', submissionLocked: { $ne: true } };
        if (attempt.expiresAt) answerFilter.expiresAt = { $gt: new Date() };
        const updated = await TestAttemptModel.findOneAndUpdate(
          answerFilter,
          { $set: updates },
          { new: true, runValidators: true },
        );
        if (!updated) {
          let latest = await findAttempt(id, request.user._id);
          if (latest) latest = await autoSubmitIfExpired(latest, request.user._id);
          if (latest && latest.status !== 'in-progress') return response.status(409).json({ message: 'The timer expired before this answer could be saved.', attempt: serializeAttempt(latest) });
          return response.status(409).json({ message: 'This attempt has already been submitted.' });
        }
        const fullQuery = TestAttemptModel.findOne({ _id: id, student: request.user._id });
        if (typeof fullQuery?.select === 'function') fullQuery.select('+answerKey');
        attempt = await fullQuery;
        return response.status(200).json({ attempt: serializeAttempt(attempt) });
      } catch (error) {
        if (error?.status) return response.status(error.status).json({ message: error.message });
        return next(error);
      }
    },
    submitAttempt: async (request, response, next) => {
      try {
        if (!validId(request.params.id)) return response.status(400).json({ message: 'Attempt ID must be valid.' });
        const attempt = await findAttempt(request.params.id, request.user._id);
        if (!attempt) return response.status(404).json({ message: 'This attempt could not be found.' });
        const submitted = attempt.status === 'in-progress' ? await scoreAndSubmit(attempt, request.user._id) : attempt;
        return response.status(200).json({ attempt: serializeAttempt(submitted), idempotent: attempt.status !== 'in-progress' });
      } catch (error) { return next(error); }
    },
    history: async (request, response, next) => {
      try {
        const page = Number(request.query.page ?? 1);
        const limit = Number(request.query.limit ?? 20);
        if (!Number.isSafeInteger(page) || page < 1 || page > 1000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) return response.status(400).json({ message: 'Page must be 1 to 1000 and limit must be 1 to 50.' });
        const filter = { student: request.user._id };
        let query = TestAttemptModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit);
        if (typeof query?.select === 'function') query = query.select('+answerKey');
        if (typeof query?.lean === 'function') query = query.lean();
        const [attempts, total] = await Promise.all([query, TestAttemptModel.countDocuments(filter)]);
        const items = [];
        for (let attempt of attempts ?? []) {
          attempt = await autoSubmitIfExpired(attempt, request.user._id);
          items.push(serializeHistoryItem(attempt));
        }
        return response.status(200).json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
      } catch (error) { return next(error); }
    },
  };
}

export default createPracticeController;
