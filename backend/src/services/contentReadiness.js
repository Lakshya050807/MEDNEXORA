const statusKeys = ['published', 'draft', 'archived'];
const excludedStudyMaterialTypes = new Set(['video-course', 'crash-course', 'mock-test', 'bundle']);
const visibleLessonStatuses = new Set(['published', undefined, null]);

function idOf(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') return value.toHexString();
    if (value._id !== undefined && value._id !== null) return idOf(value._id);
    if (value.id !== undefined && value.id !== null && typeof value.id !== 'object') return idOf(value.id);
  }
  return String(value);
}

function statusOf(record, { legacyLesson = false } = {}) {
  if (legacyLesson && (record.publicationStatus === undefined || record.publicationStatus === null)) return 'published';
  return statusKeys.includes(record.publicationStatus) ? record.publicationStatus : 'draft';
}

function newCounts() {
  return { total: 0, published: 0, draft: 0, archived: 0 };
}

function addCount(counts, status, amount = 1) {
  counts.total += amount;
  counts[status] += amount;
}

function makeIssue(key, label, section, records) {
  return {
    key,
    label,
    section,
    count: records.length,
    examples: records.slice(0, 6).map(({ id, name }) => ({ id, name })),
  };
}

function hasLessonContent(lesson) {
  const hasText = typeof lesson.contentText === 'string' && lesson.contentText.trim().length > 0;
  const hasVideo = lesson.videoProvider && lesson.videoProvider !== 'none'
    && typeof lesson.videoAssetId === 'string' && lesson.videoAssetId.trim().length > 0;
  return hasText || hasVideo;
}

function validQuestion(question) {
  return Array.isArray(question.options)
    && question.options.length >= 2
    && question.options.length <= 8
    && question.options.every((option) => typeof option === 'string' && option.trim().length > 0)
    && Number.isSafeInteger(question.correctAnswerIndex)
    && question.correctAnswerIndex >= 0
    && question.correctAnswerIndex < question.options.length;
}

function checklistItem(label, section, ready, detail) {
  return { label, section, status: ready ? 'complete' : 'warning', detail };
}

/**
 * Derive a safe, read-only readiness summary from already-loaded catalogue
 * records. This function intentionally returns metadata and counts only; it
 * never returns lesson text, question prompts/keys, or private file paths.
 */
export function calculateContentReadiness({
  exams = [], subjects = [], chapters = [], topics = [], courses = [], studyMaterials = [], questionBanks = [], mockTests = [],
} = {}) {
  const examsById = new Map(exams.map((record) => [idOf(record), record]));
  const subjectsById = new Map(subjects.map((record) => [idOf(record), record]));
  const chaptersById = new Map(chapters.map((record) => [idOf(record), record]));
  const topicsById = new Map(topics.map((record) => [idOf(record), record]));
  const productsById = new Map(studyMaterials.map((record) => [idOf(record), record]));
  const banksById = new Map(questionBanks.map((record) => [idOf(record), record]));
  const totals = Object.fromEntries(['courses', 'subjects', 'chapters', 'topics', 'lessons', 'mcqs', 'mockTests', 'studyMaterials'].map((key) => [key, newCounts()]));

  for (const record of courses) addCount(totals.courses, statusOf(record));
  for (const record of subjects) addCount(totals.subjects, statusOf(record));
  for (const record of chapters) addCount(totals.chapters, statusOf(record));
  for (const record of topics) addCount(totals.topics, statusOf(record));
  for (const record of mockTests) addCount(totals.mockTests, statusOf(record));
  for (const record of studyMaterials.filter((item) => !excludedStudyMaterialTypes.has(item.resourceType))) {
    addCount(totals.studyMaterials, statusOf(record));
  }

  const lessons = [];
  const courseTitle = (course) => productsById.get(idOf(course.product))?.title || course.title || 'Untitled course';
  for (const course of courses) {
    for (const module of course.modules ?? []) {
      for (const lesson of module.lessons ?? []) {
        lessons.push({
          ...lesson,
          id: idOf(lesson),
          name: `${courseTitle(course)} — ${lesson.title || 'Untitled lesson'}`,
          courseId: idOf(course),
          courseExam: idOf(course.exam),
          configuredSubjects: new Set((course.subjects ?? []).map(idOf)),
          moduleSubject: idOf(module.subject),
          moduleChapter: idOf(module.chapter),
        });
      }
    }
  }
  for (const lesson of lessons) addCount(totals.lessons, statusOf(lesson, { legacyLesson: true }));

  const questionRows = [];
  for (const bank of questionBanks) {
    for (let index = 0; index < (bank.questions ?? []).length; index += 1) {
      const question = bank.questions[index];
      questionRows.push({
        question,
        index,
        bank,
        id: idOf(question),
        name: `${bank.title || 'Untitled question bank'} — question ${index + 1}`,
      });
      addCount(totals.mcqs, statusOf(bank));
    }
  }

  const questionHasPublishedParents = (bank, question) => {
    const exam = examsById.get(idOf(bank.exam));
    const subject = subjectsById.get(idOf(bank.subject));
    if (bank.publicationStatus !== 'published' || exam?.publicationStatus !== 'published'
      || subject?.publicationStatus !== 'published' || idOf(subject.exam) !== idOf(bank.exam)) return false;
    if (!question.topic) return true;
    const topic = topicsById.get(idOf(question.topic));
    const chapter = topic && chaptersById.get(idOf(topic.chapter));
    return topic?.publicationStatus === 'published' && chapter?.publicationStatus === 'published'
      && idOf(topic.exam) === idOf(bank.exam) && idOf(topic.subject) === idOf(bank.subject)
      && idOf(chapter.subject) === idOf(bank.subject) && idOf(chapter.exam) === idOf(bank.exam);
  };
  const countAvailableQuestions = (test) => (test.questionBanks ?? []).reduce((count, bankRef) => {
    const bank = banksById.get(idOf(bankRef));
    if (!bank || idOf(bank.exam) !== idOf(test.exam)) return count;
    return count + (bank.questions ?? []).filter((question) => validQuestion(question) && questionHasPublishedParents(bank, question)).length;
  }, 0);

  const publishedLessonsByTopic = new Map();
  for (const lesson of lessons) {
    if (!visibleLessonStatuses.has(lesson.publicationStatus)) continue;
    const topicId = idOf(lesson.topic);
    if (!topicId) continue;
    const topic = topicsById.get(topicId);
    const subject = topic && subjectsById.get(idOf(topic.subject));
    const chapter = topic && chaptersById.get(idOf(topic.chapter));
    const hierarchyReady = topic
      && topic.publicationStatus === 'published'
      && subject?.publicationStatus === 'published'
      && chapter?.publicationStatus === 'published'
      && idOf(topic.exam) === lesson.courseExam
      && idOf(topic.subject) === lesson.moduleSubject
      && idOf(topic.chapter) === lesson.moduleChapter
      && lesson.configuredSubjects.has(idOf(topic.subject));
    if (hierarchyReady) publishedLessonsByTopic.set(topicId, (publishedLessonsByTopic.get(topicId) ?? 0) + 1);
  }

  const validPublishedQuestionsByTopic = new Map();
  for (const row of questionRows) {
    const bank = row.bank;
    if (!validQuestion(row.question) || !questionHasPublishedParents(bank, row.question)) continue;
    const topicId = idOf(row.question.topic);
    const topic = topicsById.get(topicId);
    if (!topic) continue;
    validPublishedQuestionsByTopic.set(topicId, (validPublishedQuestionsByTopic.get(topicId) ?? 0) + 1);
  }

  const coursesWithoutPublishedSubjects = [];
  const subjectsWithoutChapters = [];
  const chaptersWithoutTopics = [];
  const topicsWithoutLearningContent = [];
  const lessonsWithoutContent = [];
  const mcqsWithoutExplanation = [];
  const mcqsWithInvalidAnswer = [];
  const mockTestsWithoutSufficientQuestions = [];
  const publishedContentWithUnpublishedParents = [];
  const courseReadiness = new Map();
  const coursesById = new Map(courses.map((course) => [idOf(course), course]));

  for (const subject of subjects) {
    if (!(chapters.some((chapter) => idOf(chapter.subject) === idOf(subject) && idOf(chapter.exam) === idOf(subject.exam)))) {
      subjectsWithoutChapters.push({ id: idOf(subject), name: subject.name || 'Untitled subject' });
    }
    const exam = examsById.get(idOf(subject.exam));
    if (subject.publicationStatus === 'published' && exam?.publicationStatus !== 'published') {
      publishedContentWithUnpublishedParents.push({ id: idOf(subject), name: subject.name || 'Published subject' });
    }
  }
  for (const lesson of lessons) {
    if (!visibleLessonStatuses.has(lesson.publicationStatus)) continue;
    const course = coursesById.get(lesson.courseId);
    const product = course && productsById.get(idOf(course.product));
    const subject = subjectsById.get(lesson.moduleSubject);
    const chapter = lesson.moduleChapter ? chaptersById.get(lesson.moduleChapter) : null;
    const topic = lesson.topic ? topicsById.get(idOf(lesson.topic)) : null;
    const exam = examsById.get(lesson.courseExam);
    const invalidParent = course?.publicationStatus !== 'published'
      || product?.publicationStatus !== 'published'
      || exam?.publicationStatus !== 'published'
      || !subject || subject.publicationStatus !== 'published' || idOf(subject.exam) !== lesson.courseExam
      || !lesson.configuredSubjects.has(lesson.moduleSubject)
      || (chapter && (chapter.publicationStatus !== 'published' || idOf(chapter.subject) !== lesson.moduleSubject || idOf(chapter.exam) !== lesson.courseExam))
      || (topic && (topic.publicationStatus !== 'published' || idOf(topic.subject) !== lesson.moduleSubject
        || idOf(topic.exam) !== lesson.courseExam || idOf(topic.chapter) !== lesson.moduleChapter));
    if (invalidParent) publishedContentWithUnpublishedParents.push({ id: lesson.id, name: lesson.name });
  }
  for (const chapter of chapters) {
    const subject = subjectsById.get(idOf(chapter.subject));
    if (!topics.some((topic) => idOf(topic.chapter) === idOf(chapter) && idOf(topic.subject) === idOf(chapter.subject))) {
      chaptersWithoutTopics.push({ id: idOf(chapter), name: chapter.name || 'Untitled chapter' });
    }
    const exam = examsById.get(idOf(chapter.exam));
    if (chapter.publicationStatus === 'published'
      && (exam?.publicationStatus !== 'published' || subject?.publicationStatus !== 'published'
        || idOf(subject?.exam) !== idOf(chapter.exam))) {
      publishedContentWithUnpublishedParents.push({ id: idOf(chapter), name: chapter.name || 'Published chapter' });
    }
  }
  for (const topic of topics) {
    const subject = subjectsById.get(idOf(topic.subject));
    const chapter = chaptersById.get(idOf(topic.chapter));
    const hasLearningContent = (publishedLessonsByTopic.get(idOf(topic)) ?? 0) > 0
      || (validPublishedQuestionsByTopic.get(idOf(topic)) ?? 0) > 0;
    if (!hasLearningContent) topicsWithoutLearningContent.push({ id: idOf(topic), name: topic.name || 'Untitled topic' });
    const exam = examsById.get(idOf(topic.exam));
    if (topic.publicationStatus === 'published'
      && (exam?.publicationStatus !== 'published' || subject?.publicationStatus !== 'published'
        || chapter?.publicationStatus !== 'published' || idOf(subject?.exam) !== idOf(topic.exam)
        || idOf(chapter?.subject) !== idOf(topic.subject) || idOf(chapter?.exam) !== idOf(topic.exam))) {
      publishedContentWithUnpublishedParents.push({ id: idOf(topic), name: topic.name || 'Published topic' });
    }
  }
  for (const lesson of lessons) {
    if (!hasLessonContent(lesson)) lessonsWithoutContent.push({ id: lesson.id, name: lesson.name });
  }
  for (const row of questionRows) {
    if (!String(row.question.explanation ?? '').trim()) mcqsWithoutExplanation.push({ id: row.id, name: row.name });
    if (!validQuestion(row.question)) mcqsWithInvalidAnswer.push({ id: row.id, name: row.name });
  }

  for (const course of courses) {
    const examId = idOf(course.exam);
    const configuredSubjectIds = [...new Set((course.subjects ?? []).map(idOf).filter(Boolean))];
    const validConfiguredSubjects = configuredSubjectIds
      .map((id) => subjectsById.get(id))
      .filter((subject) => subject && idOf(subject.exam) === examId);
    const publishedSubjects = validConfiguredSubjects.filter((subject) => subject.publicationStatus === 'published');
    if (!publishedSubjects.length) coursesWithoutPublishedSubjects.push({ id: idOf(course), name: courseTitle(course) });

    const courseLessons = lessons.filter((lesson) => lesson.courseId === idOf(course));
    const relatedTests = mockTests.filter((test) => idOf(test.exam) === examId
      || idOf(productsById.get(idOf(test.product))?.course) === idOf(course));
    const checks = [];
    const exam = examsById.get(examId);
    const product = productsById.get(idOf(course.product));
    checks.push(checklistItem('Examination published', 'exams', exam?.publicationStatus === 'published', exam?.publicationStatus === 'published' ? 'The configured examination is published.' : 'The course examination is missing or not published.'));
    checks.push(checklistItem('Linked course product published', 'products', product?.publicationStatus === 'published', product?.publicationStatus === 'published' ? 'The student-facing course product is published.' : 'The linked product is missing or not published.'));
    checks.push(checklistItem('Configured subjects published', 'curriculum', publishedSubjects.length > 0 && publishedSubjects.length === configuredSubjectIds.length, `${publishedSubjects.length} of ${configuredSubjectIds.length} configured subjects are published and match this examination.`));

    const subjectChapters = chapters.filter((chapter) => publishedSubjects.some((subject) => idOf(subject) === idOf(chapter.subject))
      && idOf(chapter.exam) === examId && chapter.publicationStatus === 'published');
    const allSubjectsHaveChapters = publishedSubjects.length > 0 && publishedSubjects.every((subject) => subjectChapters.some((chapter) => idOf(chapter.subject) === idOf(subject)));
    checks.push(checklistItem('Published subjects have chapters', 'curriculum', allSubjectsHaveChapters, allSubjectsHaveChapters ? `${subjectChapters.length} published chapters are linked to course subjects.` : 'One or more published course subjects have no published chapter.'));

    const subjectTopics = topics.filter((topic) => publishedSubjects.some((subject) => idOf(subject) === idOf(topic.subject))
      && idOf(topic.exam) === examId && topic.publicationStatus === 'published');
    const topicsCovered = subjectTopics.length > 0 && subjectTopics.every((topic) => (publishedLessonsByTopic.get(idOf(topic)) ?? 0) > 0 || (validPublishedQuestionsByTopic.get(idOf(topic)) ?? 0) > 0);
    checks.push(checklistItem('Published topics have lessons or valid MCQs', 'curriculum', topicsCovered, subjectTopics.length ? `${subjectTopics.filter((topic) => (publishedLessonsByTopic.get(idOf(topic)) ?? 0) > 0 || (validPublishedQuestionsByTopic.get(idOf(topic)) ?? 0) > 0).length} of ${subjectTopics.length} published topics have mapped learning content.` : 'No published topics are configured yet.'));

    const visibleLessons = courseLessons.filter((lesson) => visibleLessonStatuses.has(lesson.publicationStatus));
    const lessonsWithContent = visibleLessons.filter(hasLessonContent).length;
    checks.push(checklistItem('Lessons include learning content', 'curriculum', visibleLessons.length > 0 && lessonsWithContent === visibleLessons.length, visibleLessons.length ? `${lessonsWithContent} of ${visibleLessons.length} student-visible lessons contain text or configured video metadata.` : 'No student-visible lessons are configured yet.'));

    const testsWithSufficientQuestions = relatedTests.filter((test) => Number.isSafeInteger(test.questionCount)
      && test.questionCount > 0 && countAvailableQuestions(test) >= test.questionCount);
    const testsReady = relatedTests.length > 0 && testsWithSufficientQuestions.length === relatedTests.length;
    checks.push(checklistItem('Mock tests have enough published questions', 'mock-tests', testsReady, relatedTests.length ? `${testsWithSufficientQuestions.length} of ${relatedTests.length} related mock tests have enough valid questions in published banks.` : 'No related mock tests are configured.'));

    const issueCount = checks.filter((check) => check.status !== 'complete').length;
    const title = courseTitle(course);
    if (course.publicationStatus === 'published'
      && (exam?.publicationStatus !== 'published' || product?.publicationStatus !== 'published' || !publishedSubjects.length)) {
      publishedContentWithUnpublishedParents.push({ id: idOf(course), name: title });
    }
    courseReadiness.set(idOf(course), { id: idOf(course), title, publicationStatus: statusOf(course), issueCount, checks });
  }

  for (const bank of questionBanks) {
    if (bank.publicationStatus !== 'published') continue;
    const subject = subjectsById.get(idOf(bank.subject));
    const exam = examsById.get(idOf(bank.exam));
    if (exam?.publicationStatus !== 'published' || subject?.publicationStatus !== 'published' || idOf(subject.exam) !== idOf(bank.exam)) {
      publishedContentWithUnpublishedParents.push({ id: idOf(bank), name: bank.title || 'Published question bank' });
    }
  }

  for (const material of studyMaterials) {
    if (material.publicationStatus !== 'published' || excludedStudyMaterialTypes.has(material.resourceType)) continue;
    const subject = subjectsById.get(idOf(material.subject));
    const chapter = material.chapter ? chaptersById.get(idOf(material.chapter)) : null;
    const topic = material.topic ? topicsById.get(idOf(material.topic)) : null;
    const materialExam = examsById.get(idOf(material.exam));
    const mappedTopics = [material.topic, ...(material.topics ?? [])].filter(Boolean);
    const hierarchyUnpublished = materialExam?.publicationStatus !== 'published'
      || !subject || subject.publicationStatus !== 'published' || idOf(subject.exam) !== idOf(material.exam)
      || (chapter && (chapter.publicationStatus !== 'published' || idOf(chapter.subject) !== idOf(subject) || idOf(chapter.exam) !== idOf(material.exam)))
      || (topic && (topic.publicationStatus !== 'published' || idOf(topic.subject) !== idOf(subject)
        || idOf(topic.exam) !== idOf(material.exam) || idOf(topic.chapter) !== idOf(material.chapter)))
      || mappedTopics.some((topicRef) => {
        const mapped = topicsById.get(idOf(topicRef));
        return !mapped || mapped.publicationStatus !== 'published' || idOf(mapped.subject) !== idOf(subject)
          || idOf(mapped.exam) !== idOf(material.exam) || (chapter && idOf(mapped.chapter) !== idOf(chapter));
      });
    if (hierarchyUnpublished) publishedContentWithUnpublishedParents.push({ id: idOf(material), name: material.title || 'Published study material' });
  }

  for (const test of mockTests) {
    const available = countAvailableQuestions(test);
    if (!Number.isSafeInteger(test.questionCount) || test.questionCount < 1 || available < test.questionCount) {
      mockTestsWithoutSufficientQuestions.push({ id: idOf(test), name: test.title || 'Untitled mock test' });
    }
    if (test.publicationStatus === 'published') {
      const exam = examsById.get(idOf(test.exam));
      const product = productsById.get(idOf(test.product));
      if (exam?.publicationStatus !== 'published' || product?.publicationStatus !== 'published'
        || !Number.isSafeInteger(test.questionCount) || available < test.questionCount) {
        publishedContentWithUnpublishedParents.push({ id: idOf(test), name: test.title || 'Published mock test' });
      }
    }
  }

  const issues = [
    makeIssue('courses-without-published-subjects', 'Courses without published subjects', 'courses', coursesWithoutPublishedSubjects),
    makeIssue('subjects-without-chapters', 'Subjects without chapters', 'curriculum', subjectsWithoutChapters),
    makeIssue('chapters-without-topics', 'Chapters without topics', 'curriculum', chaptersWithoutTopics),
    makeIssue('topics-without-learning-content', 'Topics without mapped lessons or valid questions', 'curriculum', topicsWithoutLearningContent),
    makeIssue('lessons-without-content', 'Lessons without text or configured video', 'curriculum', lessonsWithoutContent),
    makeIssue('mcqs-without-explanations', 'MCQs without explanations', 'question-banks', mcqsWithoutExplanation),
    makeIssue('mcqs-with-invalid-answers', 'MCQs without a valid answer', 'question-banks', mcqsWithInvalidAnswer),
    makeIssue('mock-tests-with-insufficient-questions', 'Mock tests without enough published questions', 'mock-tests', mockTestsWithoutSufficientQuestions),
    makeIssue('published-content-with-unpublished-parents', 'Published content with missing, draft, or inconsistent parents', 'curriculum', publishedContentWithUnpublishedParents),
  ];

  return {
    counts: totals,
    issues,
    courses: [...courseReadiness.values()].sort((left, right) => left.title.localeCompare(right.title)),
  };
}

export default calculateContentReadiness;
