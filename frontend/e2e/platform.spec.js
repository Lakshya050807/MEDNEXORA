import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5174';
const adminUsername = process.env.E2E_ADMIN_USERNAME;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const studentPassword = process.env.E2E_STUDENT_PASSWORD;
const onlyTestSlug = `e2e-${randomUUID().slice(0, 8)}`;
const state = {};
const diagnostics = new WeakMap();
const apiResponseCounts = new Map();

test.describe.serial('MEDNEXORA browser E2E workflows on disposable MongoDB', () => {
  test.beforeEach(async ({ page }) => {
    const entries = { consoleErrors: [], pageErrors: [], failedRequests: [], serverErrors: [], apiClientErrors: [], rateLimits: [] };
    diagnostics.set(page, entries);
    page.on('console', (message) => { if (message.type() === 'error') entries.consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => entries.pageErrors.push(error.message));
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText;
      if (failure && failure !== 'net::ERR_ABORTED') entries.failedRequests.push(`${request.method()} ${request.url()} — ${failure}`);
    });
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/api/')) {
        const route = new URL(url).pathname;
        apiResponseCounts.set(route, (apiResponseCounts.get(route) ?? 0) + 1);
        if (response.status() === 429) entries.rateLimits.push({ route, headers: response.headers() });
      }
      if (response.status() >= 500) entries.serverErrors.push(`${response.status()} ${url}`);
      else if (url.includes('/api/') && response.status() >= 400) entries.apiClientErrors.push(`${response.status()} ${url}`);
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    const entries = diagnostics.get(page) ?? {};
    await testInfo.attach('browser-diagnostics.json', {
      body: Buffer.from(JSON.stringify({ ...entries, cumulativeApiResponses: Object.fromEntries(apiResponseCounts) }, null, 2)),
      contentType: 'application/json',
    });
    const summary = Object.fromEntries(Object.entries(entries).map(([key, values]) => [key, values.length]));
    console.log(`[browser diagnostics] ${testInfo.title}: ${JSON.stringify({ counts: summary, consoleErrors: entries.consoleErrors, apiClientErrors: entries.apiClientErrors, rateLimits: entries.rateLimits, cumulativeApiResponses: Object.fromEntries(apiResponseCounts) })}`);
  });

  async function adminLogin(page) {
    await page.goto('/admin/login');
    await page.getByLabel('Admin username').fill(adminUsername);
    await page.getByLabel('Password').fill(adminPassword);
    await page.getByRole('button', { name: /admin sign in/i }).click();
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  }

  async function adminRequest(context, method, path, body) {
    const response = await context.request[method](`${baseURL}/api/admin${path}`, {
      headers: { Origin: baseURL },
      ...(body === undefined ? {} : { data: body }),
    });
    const payload = await response.json().catch(() => ({}));
    expect(response.ok(), `${method.toUpperCase()} ${path}: ${payload.message ?? response.status()}`).toBeTruthy();
    return payload;
  }

  async function studentApi(context, method, path, body) {
    return context.request[method](`${baseURL}${path}`, {
      headers: { Origin: baseURL },
      ...(body === undefined ? {} : { data: body }),
    });
  }

async function runUiMutation(page, path, method, action) {
  const responsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return new URL(response.url()).pathname === `/api/admin${path}` && request.method() === method;
  });
  await action();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  expect(response.ok(), `${method} ${path}: ${payload.message ?? response.status()}`).toBeTruthy();
  return payload;
}

function recordId(record) {
  return record?._id ?? record?.id;
}

  async function createAdminContent(context) {
    const examPayload = await adminRequest(context, 'post', '/exams', {
      name: `E2E configured examination ${onlyTestSlug}`,
      slug: `${onlyTestSlug}-exam`,
      region: '',
      description: 'Disposable E2E exam fixture; not official examination information.',
      isPrimary: true,
      publicationStatus: 'published',
    });
    const exam = examPayload.exam;
    state.examId = exam._id ?? exam.id;
    state.examName = exam.name;
    expect(state.examId).toBeTruthy();

    const subjects = [];
    for (const [name, sortOrder] of [['Physics', 0], ['Chemistry', 1], ['Biology', 2]]) {
      const result = await adminRequest(context, 'post', '/subjects', {
        exam: state.examId,
        name,
        slug: name.toLowerCase(),
        description: `Disposable E2E ${name} subject fixture.`,
        sortOrder,
        publicationStatus: 'published',
      });
      subjects.push(result.subject);
    }
    state.subjectIds = subjects.map((subject) => subject._id ?? subject.id);
    state.physicsId = state.subjectIds[0];
    state.chemistryId = state.subjectIds[1];
    state.biologyId = state.subjectIds[2];
    expect(subjects.map((subject) => subject.name)).toEqual(['Physics', 'Chemistry', 'Biology']);

    const chapterPayload = await adminRequest(context, 'post', '/chapters', {
      exam: state.examId,
      subject: state.physicsId,
      name: `E2E chapter ${onlyTestSlug}`,
      slug: `${onlyTestSlug}-chapter`,
      description: 'Temporary chapter fixture for browser testing.',
      sortOrder: 0,
      publicationStatus: 'published',
    });
    const chapter = chapterPayload.chapter;
    state.chapterId = chapter._id ?? chapter.id;
    state.chapterTitle = chapter.name;

    const topicPayload = await adminRequest(context, 'post', '/topics', {
      exam: state.examId,
      subject: state.physicsId,
      chapter: state.chapterId,
      name: `E2E topic ${onlyTestSlug}`,
      slug: `${onlyTestSlug}-topic`,
      description: 'Temporary topic fixture for browser testing.',
      sortOrder: 0,
      publicationStatus: 'published',
    });
    state.topicId = topicPayload.topic._id ?? topicPayload.topic.id;
    state.topicTitle = topicPayload.topic.name;

    const courseProductResult = await adminRequest(context, 'post', '/products', {
      exam: state.examId,
      title: 'B.Sc. Nursing Entrance Preparation',
      slug: 'bsc-nursing-entrance-preparation',
      resourceType: 'video-course',
      description: 'A disposable course fixture for MEDNEXORA browser testing.',
      detailedDescription: 'Generated only in the isolated in-memory test database.',
      pricePaise: 0,
      discountPaise: 0,
      publicationStatus: 'draft',
      language: '',
    });
    state.courseProductId = courseProductResult.product.id ?? courseProductResult.product._id;

    const coursePayload = await adminRequest(context, 'post', '/courses', {
      product: state.courseProductId,
      exam: state.examId,
      category: 'Government Competitive Exam Preparation',
      targetAudience: 'Disposable E2E test account only.',
      subjects: state.subjectIds,
      courseType: 'video-course',
      publicationStatus: 'draft',
    });
    state.courseId = coursePayload.course._id ?? coursePayload.course.id;

    const courseUpdate = await adminRequest(context, 'patch', `/courses/${state.courseId}`, {
      modules: [{
        title: `E2E module ${onlyTestSlug}`,
        description: 'Disposable module for browser E2E.',
        subject: state.physicsId,
        chapter: state.chapterId,
        sortOrder: 0,
        lessons: [{
          title: `E2E lesson ${onlyTestSlug}`,
          description: 'Temporary lesson content for browser testing.',
          contentText: 'This text exists only in a disposable in-memory test database.',
          topic: state.topicId,
          durationMinutes: null,
          videoProvider: 'none',
          videoAssetId: '',
          isPreview: false,
          publicationStatus: 'published',
          sortOrder: 0,
        }],
      }],
    });
    state.lessonId = courseUpdate.course.modules[0].lessons[0]._id;
    expect(state.lessonId).toBeTruthy();

    await adminRequest(context, 'patch', `/courses/${state.courseId}`, { publicationStatus: 'published' });
    await adminRequest(context, 'patch', `/products/${state.courseProductId}`, { publicationStatus: 'published' });

    const bankPayload = await adminRequest(context, 'post', '/question-banks', {
      exam: state.examId,
      subject: state.physicsId,
      title: `E2E question bank ${onlyTestSlug}`,
      questions: [
        { prompt: `E2E question 1 ${onlyTestSlug}: choose the expected option.`, options: ['E2E option A1', 'E2E option B1', 'E2E option C1', 'E2E option D1'], correctAnswerIndex: 0, explanation: 'E2E-only explanation for answer A.', topic: state.topicId },
        { prompt: `E2E question 2 ${onlyTestSlug}: choose the expected option.`, options: ['E2E option A2', 'E2E option B2', 'E2E option C2', 'E2E option D2'], correctAnswerIndex: 0, explanation: 'E2E-only explanation for answer A.', topic: state.topicId },
      ],
      publicationStatus: 'published',
    });
    state.questionBankId = bankPayload.questionBank._id ?? bankPayload.questionBank.id;

    const mockProductPayload = await adminRequest(context, 'post', '/products', {
      exam: state.examId,
      subject: state.physicsId,
      title: `E2E mock test product ${onlyTestSlug}`,
      slug: `${onlyTestSlug}-mock-test`,
      resourceType: 'mock-test',
      description: 'Disposable timed test fixture; not an official examination pattern.',
      pricePaise: 0,
      discountPaise: 0,
      publicationStatus: 'published',
    });
    state.mockProductId = mockProductPayload.product.id ?? mockProductPayload.product._id;
    const mockPayload = await adminRequest(context, 'post', '/mock-tests', {
      product: state.mockProductId,
      exam: state.examId,
      title: `E2E mock test ${onlyTestSlug}`,
      description: 'Disposable browser test only.',
      instructions: 'Choose answers and submit this temporary test.',
      questionBanks: [state.questionBankId],
      durationMinutes: 10,
      questionCount: 2,
      marksPerQuestion: 2,
      totalMarks: 4,
      negativeMarkingEnabled: true,
      negativeMarksPerQuestion: 0.5,
      allowAnswerReview: true,
      revealExplanations: true,
      patternVerified: false,
      publicationStatus: 'published',
    });
    state.mockTestId = mockPayload.mockTest._id ?? mockPayload.mockTest.id;

    const paidPdfPayload = await adminRequest(context, 'post', '/products', {
      exam: state.examId,
      subject: state.physicsId,
      title: `E2E private PDF authorization ${onlyTestSlug}`,
      slug: `${onlyTestSlug}-private-pdf`,
      resourceType: 'notes',
      description: 'Disposable paid PDF authorization fixture for browser tests.',
      pricePaise: 12500,
      discountPaise: 0,
      contentUrl: `local-private:${onlyTestSlug}.pdf`,
      publicationStatus: 'published',
    });
    state.paidPdfId = paidPdfPayload.product.id ?? paidPdfPayload.product._id;

    const draftProductPayload = await adminRequest(context, 'post', '/products', {
      exam: state.examId,
      title: `E2E unpublished course product ${onlyTestSlug}`,
      slug: `${onlyTestSlug}-draft-course`,
      resourceType: 'video-course',
      description: 'Unpublished course visibility fixture only.',
      pricePaise: 0,
      discountPaise: 0,
      publicationStatus: 'draft',
    });
    state.draftCourseProductId = draftProductPayload.product.id ?? draftProductPayload.product._id;
    const draftCoursePayload = await adminRequest(context, 'post', '/courses', {
      product: state.draftCourseProductId,
      exam: state.examId,
      category: 'Government Competitive Exam Preparation',
      targetAudience: 'Disposable unpublished course fixture.',
      subjects: state.subjectIds,
      courseType: 'video-course',
      publicationStatus: 'draft',
    });
    state.draftCourseId = draftCoursePayload.course._id ?? draftCoursePayload.course.id;
    state.courseTitle = 'B.Sc. Nursing Entrance Preparation';
    state.lessonTitle = `E2E lesson ${onlyTestSlug}`;
    state.bankTitle = `E2E question bank ${onlyTestSlug}`;
    state.mockTestTitle = `E2E mock test ${onlyTestSlug}`;
  }

  test('admin logs in, creates exam curriculum, course, lessons, MCQs and mock test, then previews course', async ({ page, context }) => {
    await adminLogin(page);
    await createAdminContent(context);
    await page.reload();
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();

    await page.getByRole('button', { name: 'Curriculum', exact: true }).click();
    await expect(page.getByRole('heading', { name: state.courseTitle })).toBeVisible();
    await expect(page.getByText('Physics', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Chemistry', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Biology', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: state.lessonTitle })).toBeVisible();
    await page.getByRole('button', { name: `Unpublish topic ${state.topicTitle}`, exact: true }).click();
    const publishTopic = page.getByRole('button', { name: `Publish topic ${state.topicTitle}`, exact: true });
    await expect(publishTopic).toBeEnabled();
    await publishTopic.click();
    await expect(page.getByRole('button', { name: `Unpublish topic ${state.topicTitle}`, exact: true })).toBeEnabled();

    await page.getByRole('button', { name: 'Courses', exact: true }).click();
    const courseRow = page.getByRole('row').filter({ hasText: state.courseTitle });
    await expect(courseRow).toBeVisible();
    await courseRow.getByRole('button', { name: 'Preview' }).click();
    const coursePreview = page.getByRole('dialog', { name: 'Course preview' });
    await expect(coursePreview).toBeVisible();
    await expect(coursePreview.getByRole('heading', { name: state.courseTitle })).toBeVisible();
    await expect(page.getByRole('link', { name: /open student course page/i })).toBeVisible();
    await coursePreview.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Question banks', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: state.bankTitle })).toBeVisible();
    await page.getByRole('button', { name: 'Mock tests', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: state.mockTestTitle })).toBeVisible();

    const launchStatus = await context.request.get(`${baseURL}/api/launch/status`).then((response) => response.json());
    expect(launchStatus).toEqual({ registrationEnabled: true, paidPurchasesEnabled: false });
    const e2eDiagnostics = diagnostics.get(page);
    expect(e2eDiagnostics.pageErrors).toEqual([]);
    expect(e2eDiagnostics.serverErrors).toEqual([]);
  });

  test('admin edits exam details, configures multiple subjects on a course, and manages a private PDF through the UI', async ({ page }) => {
    test.setTimeout(120_000);
    await adminLogin(page);
    const uiExamName = state.examName;
    state.uiExamName = uiExamName;
    state.uiExamId = state.examId;
    state.uiSubjectNames = ['Physics', 'Chemistry', 'Biology'];
    state.uiSubjectIds = [...state.subjectIds];

    await page.getByRole('button', { name: 'Examinations', exact: true }).click();
    let examRow = page.getByRole('row').filter({ hasText: uiExamName });
    await expect(examRow).toBeVisible();
    await examRow.getByRole('button', { name: 'Edit' }).click();
    let examForm = page.getByRole('region', { name: 'Edit Examinations' });
    await examForm.getByLabel('Description').fill('Edited through the MEDNEXORA administrator interface in an isolated E2E database.');
    await runUiMutation(page, `/exams/${state.uiExamId}`, 'PATCH', () => examForm.getByRole('button', { name: 'Save changes' }).click());
    examRow = page.getByRole('row').filter({ hasText: uiExamName });
    await expect(examRow.getByText('published', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Examinations', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: uiExamName }).getByText('published', { exact: true })).toBeVisible();

    const uiCourseTitle = `E2E UI Course ${onlyTestSlug}`;
    const uiCourseDescription = 'A temporary course listing used only by the isolated browser test suite.';
    state.uiCourseTitle = uiCourseTitle;
    state.uiCourseDescription = uiCourseDescription;
    await page.getByRole('button', { name: 'Study Materials', exact: true }).click();
    let productForm = page.getByRole('region', { name: 'Create Study materials & bundles' });
    await productForm.locator('#admin-field-products-exam').selectOption(state.uiExamId);
    await productForm.getByLabel('Resource title').fill(uiCourseTitle);
    await productForm.getByLabel('URL slug').fill(`${onlyTestSlug}-ui-course`);
    await productForm.getByLabel('Resource type').selectOption('video-course');
    await productForm.locator('#admin-field-products-description').fill(uiCourseDescription);
    await productForm.getByLabel('Access type').selectOption('free');
    await productForm.getByLabel('Publication status').selectOption('draft');
    const initialValidity = await productForm.locator('form').evaluate((form) => Array.from(form.elements)
      .filter((element) => element.willValidate && !element.checkValidity())
      .map((element) => ({ id: element.id, value: element.value, message: element.validationMessage })));
    expect(initialValidity, JSON.stringify(initialValidity)).toEqual([]);

    // A dismissed navigation confirmation must retain the unsaved draft; accepting it cancels the form.
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Courses', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Study materials & bundles' })).toBeVisible();
    await expect(productForm.getByLabel('Resource title')).toHaveValue(uiCourseTitle);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Courses', exact: true }).click();
    await expect(page.locator('.admin-topbar').getByRole('heading', { name: 'Courses', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Study Materials', exact: true }).click();

    productForm = page.getByRole('region', { name: 'Create Study materials & bundles' });
    await productForm.locator('#admin-field-products-exam').selectOption(state.uiExamId);
    await productForm.getByLabel('Resource title').fill(uiCourseTitle);
    await productForm.getByLabel('URL slug').fill(`${onlyTestSlug}-ui-course`);
    await productForm.getByLabel('Resource type').selectOption('video-course');
    await productForm.locator('#admin-field-products-description').fill(uiCourseDescription);
    await productForm.getByLabel('Access type').selectOption('free');
    await productForm.getByLabel('Publication status').selectOption('draft');
    const retryValidity = await productForm.locator('form').evaluate((form) => Array.from(form.elements)
      .filter((element) => element.willValidate && !element.checkValidity())
      .map((element) => ({ id: element.id, value: element.value, message: element.validationMessage })));
    expect(retryValidity, JSON.stringify(retryValidity)).toEqual([]);

    let productCreateRequests = 0;
    await page.route('**/api/admin/products', async (route) => {
      if (route.request().method() === 'POST') {
        productCreateRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await route.continue();
    });
    const createdCourseProduct = await runUiMutation(page, '/products', 'POST', async () => {
      const submit = productForm.getByRole('button', { name: 'Create record' });
      await submit.dblclick();
    });
    await page.unroute('**/api/admin/products');
    expect(productCreateRequests).toBe(1);
    state.uiCourseProductId = recordId(createdCourseProduct.product);
    expect(state.uiCourseProductId).toBeTruthy();
    let productRow = page.getByRole('row').filter({ hasText: uiCourseTitle });
    await productRow.getByRole('button', { name: 'Edit' }).click();
    productForm = page.getByRole('region', { name: 'Edit Study materials & bundles' });
    await productForm.locator('#admin-field-products-description').fill(`${uiCourseDescription} Edited in the admin form.`);
    await runUiMutation(page, `/products/${state.uiCourseProductId}`, 'PATCH', () => productForm.getByRole('button', { name: 'Save changes' }).click());

    await page.getByRole('button', { name: 'Courses', exact: true }).click();
    let courseForm = page.getByRole('region', { name: 'Create Courses' });
    await courseForm.getByLabel('Catalogue product').selectOption(state.uiCourseProductId);
    await courseForm.locator('#admin-field-courses-exam').selectOption(state.uiExamId);
    await courseForm.getByLabel('Category').fill('Government Competitive Exam Preparation');
    await courseForm.getByLabel('Target audience').fill('Disposable browser test users only.');
    await courseForm.getByLabel('Subjects').selectOption(state.uiSubjectIds);
    await courseForm.getByLabel('Course type').selectOption('video-course');
    await courseForm.getByLabel('Publication status').selectOption('draft');
    const createdCourse = await runUiMutation(page, '/courses', 'POST', () => courseForm.getByRole('button', { name: 'Create record' }).click());
    state.uiCourseId = recordId(createdCourse.course);
    expect(state.uiCourseId).toBeTruthy();
    let courseRow = page.getByRole('row').filter({ hasText: uiCourseTitle });
    await courseRow.getByRole('button', { name: 'Edit' }).click();
    courseForm = page.getByRole('region', { name: 'Edit Courses' });
    await courseForm.getByLabel('Target audience').fill('Edited via the actual course-management form.');
    await runUiMutation(page, `/courses/${state.uiCourseId}`, 'PATCH', () => courseForm.getByRole('button', { name: 'Save changes' }).click());
    courseRow = page.getByRole('row').filter({ hasText: uiCourseTitle });
    await courseRow.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(courseRow.getByText('published', { exact: true })).toBeVisible();
    await courseRow.getByRole('button', { name: 'Preview' }).click();
    const coursePreview = page.getByRole('dialog', { name: 'Course preview' });
    await expect(coursePreview).toBeVisible();
    await expect(coursePreview.getByRole('heading', { name: uiCourseTitle })).toBeVisible();
    await expect(coursePreview.getByText(`Examination: ${uiExamName}`)).toBeVisible();
    const subjectPreview = coursePreview.locator('p').filter({ hasText: /^Subjects:/u });
    await expect(subjectPreview).toBeVisible();
    const shownSubjects = (await subjectPreview.innerText()).replace(/^Subjects:\s*/u, '').split(',').map((subject) => subject.trim());
    expect(shownSubjects).toHaveLength(3);
    expect(new Set(shownSubjects)).toEqual(new Set(state.uiSubjectNames));
    await coursePreview.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Study Materials', exact: true }).click();
    productRow = page.getByRole('row').filter({ hasText: uiCourseTitle });
    await productRow.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(productRow.getByText('published', { exact: true })).toBeVisible();

    const pdfTitle = `E2E UI private free PDF ${onlyTestSlug}`;
    state.uiPdfTitle = pdfTitle;
    productForm = page.getByRole('region', { name: 'Create Study materials & bundles' });
    await productForm.locator('#admin-field-products-exam').selectOption(state.uiExamId);
    await productForm.locator('#admin-field-products-subject').selectOption(state.uiSubjectIds[0]);
    await productForm.getByLabel('Resource title').fill(pdfTitle);
    await productForm.getByLabel('URL slug').fill(`${onlyTestSlug}-ui-private-pdf`);
    await productForm.getByLabel('Resource type').selectOption('notes');
    await productForm.locator('#admin-field-products-description').fill('Temporary PDF fixture uploaded through the admin interface.');
    await productForm.getByLabel('Material category').selectOption('chapter-notes');
    await productForm.getByLabel('Access type').selectOption('free');
    await productForm.getByLabel('Publication status').selectOption('draft');
    const pdfInput = productForm.getByLabel('Upload or replace private PDF');
    await pdfInput.setInputFiles({ name: 'invalid-e2e.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
    await expect(page.getByRole('alert')).toContainText('The uploaded file is not a valid PDF.');
    await pdfInput.setInputFiles({ name: 'valid-e2e.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% isolated browser test file\n%%EOF\n') });
    await expect(page.getByRole('status')).toContainText('PDF uploaded privately. Save this product to attach it.');
    const createdPdf = await runUiMutation(page, '/products', 'POST', () => productForm.getByRole('button', { name: 'Create record' }).click());
    state.uiPdfProductId = recordId(createdPdf.product);
    expect(state.uiPdfProductId).toBeTruthy();
    const pdfRow = page.getByRole('row').filter({ hasText: pdfTitle });
    await pdfRow.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(pdfRow.getByText('published', { exact: true })).toBeVisible();
  });

  test('admin builds curriculum chapters, topics, modules and lessons through the UI', async ({ page }) => {
    test.setTimeout(120_000);
    await adminLogin(page);
    await page.getByRole('button', { name: 'Curriculum', exact: true }).click();
    const physics = page.getByRole('article', { name: 'Physics curriculum' });
    await expect(page.locator('.curriculum-subject-card')).toHaveCount(3);
    await expect(page.getByRole('article', { name: 'Chemistry curriculum' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Biology curriculum' })).toBeVisible();
    await physics.getByRole('button', { name: 'Edit subject' }).click();
    let subjectEditor = page.locator('.curriculum-editor');
    await subjectEditor.getByLabel('Description').fill('Description edited through the flagship curriculum interface; no syllabus content was added.');
    await runUiMutation(page, `/subjects/${state.physicsId}`, 'PATCH', () => subjectEditor.getByRole('button', { name: 'Save changes' }).click());
    const chapterA = `E2E UI order A ${onlyTestSlug}`;
    const chapterB = `E2E UI order B ${onlyTestSlug}`;
    const topicA = `E2E UI topic A ${onlyTestSlug}`;
    const topicB = `E2E UI topic B ${onlyTestSlug}`;
    const moduleTitle = `E2E UI module ${onlyTestSlug}`;
    const lessonTitle = `E2E UI lesson ${onlyTestSlug}`;
    const secondLessonTitle = `E2E UI second lesson ${onlyTestSlug}`;
    const draftLessonTitle = `E2E UI draft lesson ${onlyTestSlug}`;
    state.uiLessonTitle = lessonTitle;
    state.uiArchivedLessonTitle = secondLessonTitle;
    state.uiDraftLessonTitle = draftLessonTitle;

    async function createChapter(name, order) {
      await physics.getByRole('button', { name: 'Add chapter' }).click();
      const editor = page.locator('.curriculum-editor');
      await editor.getByLabel('Chapter title').fill(name);
      await editor.getByLabel('Display order').fill(String(order));
      await editor.getByLabel('Description').fill(`Temporary chapter edited through the admin curriculum UI.`);
      await editor.getByLabel('Publication state').selectOption('draft');
      const created = await runUiMutation(page, '/chapters', 'POST', () => editor.getByRole('button', { name: 'Create draft' }).click());
      const id = recordId(created.chapter);
      expect(id).toBeTruthy();
      await expect(physics.getByRole('heading', { name })).toBeVisible();
      return id;
    }

    state.uiChapterAId = await createChapter(chapterA, 90);
    state.uiChapterBId = await createChapter(chapterB, 100);
    let chapter = physics.getByRole('region', { name: `Chapter ${chapterB}` });
    await chapter.getByRole('button', { name: `Edit chapter ${chapterB}` }).click();
    let curriculumEditor = page.locator('.curriculum-editor');
    await curriculumEditor.getByLabel('Description').fill('Edited in the browser-based curriculum editor.');
    await curriculumEditor.getByLabel('Display order').fill('80');
    await runUiMutation(page, `/chapters/${state.uiChapterBId}`, 'PATCH', () => curriculumEditor.getByRole('button', { name: 'Save changes' }).click());

    // Publishing a child while its chapter is still Draft must fail visibly and leave the parent unchanged.
    chapter = physics.getByRole('region', { name: `Chapter ${chapterB}` });
    await chapter.getByRole('button', { name: 'Add topic' }).click();
    curriculumEditor = page.locator('.curriculum-editor');
    await curriculumEditor.getByLabel('Topic title').fill(topicA);
    await curriculumEditor.getByLabel('Display order').fill('10');
    await curriculumEditor.getByLabel('Publication state').selectOption('draft');
    const createdTopicA = await runUiMutation(page, '/topics', 'POST', () => curriculumEditor.getByRole('button', { name: 'Create draft' }).click());
    state.uiTopicId = recordId(createdTopicA.topic);
    expect(state.uiTopicId).toBeTruthy();
    chapter = physics.getByRole('region', { name: `Chapter ${chapterB}` });
    const topicARow = chapter.locator('.curriculum-topic-row').filter({ hasText: topicA });
    await topicARow.getByRole('button', { name: `Publish topic ${topicA}`, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Publish the chapter before publishing its topics.');
    await expect(chapter.getByRole('button', { name: `Publish chapter ${chapterB}`, exact: true })).toBeEnabled();

    await chapter.getByRole('button', { name: `Publish chapter ${chapterB}`, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: `${chapterB} is now published.` })).toBeVisible();
    chapter = physics.getByRole('region', { name: `Chapter ${chapterB}` });
    await chapter.getByRole('button', { name: `Unpublish chapter ${chapterB}`, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: `${chapterB} is now draft.` })).toBeVisible();
    await chapter.getByRole('button', { name: `Publish chapter ${chapterB}`, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: `${chapterB} is now published.` })).toBeVisible();
    await chapter.getByRole('button', { name: `Publish topic ${topicA}`, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: `${topicA} is now published.` })).toBeVisible();

    await chapter.getByRole('button', { name: 'Add topic' }).click();
    curriculumEditor = page.locator('.curriculum-editor');
    await curriculumEditor.getByLabel('Topic title').fill(topicB);
    await curriculumEditor.getByLabel('Display order').fill('20');
    await curriculumEditor.getByLabel('Publication state').selectOption('draft');
    const createdTopicB = await runUiMutation(page, '/topics', 'POST', () => curriculumEditor.getByRole('button', { name: 'Create draft' }).click());
    state.uiTopicBId = recordId(createdTopicB.topic);
    chapter = physics.getByRole('region', { name: `Chapter ${chapterB}` });
    const topicBRow = chapter.locator('.curriculum-topic-row').filter({ hasText: topicB });
    await topicBRow.getByRole('button', { name: `Edit topic ${topicB}` }).click();
    curriculumEditor = page.locator('.curriculum-editor');
    await curriculumEditor.getByLabel('Description').fill('Topic description edited from the browser interface.');
    await curriculumEditor.getByLabel('Display order').fill('5');
    await runUiMutation(page, `/topics/${state.uiTopicBId}`, 'PATCH', () => curriculumEditor.getByRole('button', { name: 'Save changes' }).click());
    chapter = physics.getByRole('region', { name: `Chapter ${chapterB}` });
    await chapter.getByRole('button', { name: `Publish topic ${topicB}`, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: `${topicB} is now published.` })).toBeVisible();
    const chapterOrder = await physics.locator('.curriculum-chapter-list').locator('h4').allTextContents();
    expect(chapterOrder.indexOf(chapterB)).toBeLessThan(chapterOrder.indexOf(chapterA));
    const topicOrder = await chapter.locator('.curriculum-topic-row strong').allTextContents();
    expect(topicOrder.indexOf(topicB)).toBeLessThan(topicOrder.indexOf(topicA));

    const moduleEditor = page.locator('.admin-course-lessons');
    await moduleEditor.getByRole('button', { name: 'Add module' }).click();
    let moduleForm = page.locator('.admin-course-inline-editor');
    await moduleForm.getByLabel('Module title').fill(moduleTitle);
    await moduleForm.getByLabel('Display order').fill('1');
    await moduleForm.getByLabel('Subject').selectOption(state.physicsId);
    await expect(moduleForm.getByLabel('Chapter').getByRole('option', { name: `${chapterB} · published` })).toHaveCount(1);
    await moduleForm.getByLabel('Chapter').selectOption({ label: `${chapterB} · published` });
    await moduleForm.getByLabel('Description').fill('Temporary module with lesson mapping for UI E2E.');
    await runUiMutation(page, `/courses/${state.courseId}`, 'PATCH', () => moduleForm.getByRole('button', { name: 'Save module' }).click());
    let moduleCard = page.locator('.admin-course-module-card').filter({ hasText: moduleTitle });
    await expect(moduleCard).toBeVisible();
    await moduleCard.getByRole('button', { name: 'Edit module' }).click();
    moduleForm = page.locator('.admin-course-inline-editor');
    await moduleForm.getByLabel('Description').fill('Module description updated in the admin editor.');
    await runUiMutation(page, `/courses/${state.courseId}`, 'PATCH', () => moduleForm.getByRole('button', { name: 'Save module' }).click());

    await moduleCard.getByRole('button', { name: 'Add lesson' }).click();
    let lessonForm = page.locator('.admin-course-inline-editor');
    await lessonForm.getByLabel('Lesson title').fill(lessonTitle);
    await lessonForm.getByLabel('Display order').fill('1');
    await lessonForm.getByLabel('Topic (optional)').selectOption({ label: `${topicB} · published` });
    await lessonForm.getByLabel('Short description').fill('Temporary lesson summary created through the admin UI.');
    await lessonForm.getByLabel('Lesson text').fill('This non-instructional E2E fixture verifies lesson text editing and topic mapping.');
    await lessonForm.getByLabel('Publication status').selectOption('published');
    const createdLesson = await runUiMutation(page, `/courses/${state.courseId}`, 'PATCH', () => lessonForm.getByRole('button', { name: 'Add lesson as draft' }).click());
    state.uiLessonId = (createdLesson.course.modules ?? []).flatMap((item) => item.lessons ?? []).find((item) => item.title === lessonTitle)?._id;
    expect(state.uiLessonId).toBeTruthy();
    moduleCard = page.locator('.admin-course-module-card').filter({ hasText: moduleTitle });
    let lessonRow = moduleCard.locator('.admin-course-lesson-row').filter({ hasText: lessonTitle });
    await expect(lessonRow).toContainText('published');
    await lessonRow.getByRole('button', { name: 'Edit lesson' }).click();
    lessonForm = page.locator('.admin-course-inline-editor');
    await lessonForm.getByLabel('Lesson text').fill('Edited temporary lesson text, mapped to the published E2E topic.');
    await runUiMutation(page, `/courses/${state.courseId}`, 'PATCH', () => lessonForm.getByRole('button', { name: 'Save lesson' }).click());

    moduleCard = page.locator('.admin-course-module-card').filter({ hasText: moduleTitle });
    await moduleCard.getByRole('button', { name: 'Add lesson' }).click();
    lessonForm = page.locator('.admin-course-inline-editor');
    await lessonForm.getByLabel('Lesson title').fill(secondLessonTitle);
    await lessonForm.getByLabel('Display order').fill('2');
    await lessonForm.getByLabel('Topic (optional)').selectOption({ label: `${topicB} · published` });
    await lessonForm.getByLabel('Lesson text').fill('Second temporary lesson used to verify browser-based ordering.');
    await lessonForm.getByLabel('Publication status').selectOption('draft');
    const createdSecondLesson = await runUiMutation(page, `/courses/${state.courseId}`, 'PATCH', () => lessonForm.getByRole('button', { name: 'Add lesson as draft' }).click());
    state.uiDraftLessonId = (createdSecondLesson.course.modules ?? []).flatMap((item) => item.lessons ?? []).find((item) => item.title === secondLessonTitle)?._id;
    expect(state.uiDraftLessonId).toBeTruthy();

    moduleCard = page.locator('.admin-course-module-card').filter({ hasText: moduleTitle });
    lessonRow = moduleCard.locator('.admin-course-lesson-row').filter({ hasText: secondLessonTitle });
    await lessonRow.getByRole('button', { name: 'Move up' }).click();
    await expect(page.locator('.admin-course-lessons').getByRole('status').filter({ hasText: 'Lesson order saved.' })).toBeVisible();
    moduleCard = page.locator('.admin-course-module-card').filter({ hasText: moduleTitle });
    await expect.poll(() => moduleCard.locator('.admin-course-lesson-row h5').allTextContents()).toEqual([secondLessonTitle, lessonTitle]);

    await moduleCard.getByRole('button', { name: 'Add lesson' }).click();
    lessonForm = page.locator('.admin-course-inline-editor');
    await lessonForm.getByLabel('Lesson title').fill(draftLessonTitle);
    await lessonForm.getByLabel('Display order').fill('3');
    await lessonForm.getByLabel('Topic (optional)').selectOption({ label: `${topicB} · published` });
    await lessonForm.getByLabel('Lesson text').fill('Draft lesson fixture; students must not receive this content.');
    await lessonForm.getByLabel('Publication status').selectOption('draft');
    await runUiMutation(page, `/courses/${state.courseId}`, 'PATCH', () => lessonForm.getByRole('button', { name: 'Add lesson as draft' }).click());
    moduleCard = page.locator('.admin-course-module-card').filter({ hasText: moduleTitle });
    await expect(moduleCard.locator('.admin-course-lesson-row').filter({ hasText: draftLessonTitle })).toContainText('draft');

    // Canceling an editor dialog preserves unsaved input; accepting it discards only that unsaved draft.
    lessonRow = moduleCard.locator('.admin-course-lesson-row').filter({ hasText: lessonTitle });
    await lessonRow.getByRole('button', { name: 'Edit lesson' }).click();
    lessonForm = page.locator('.admin-course-inline-editor');
    await lessonForm.getByLabel('Lesson text').fill('Uncommitted text for cancellation verification.');
    page.once('dialog', (dialog) => dialog.dismiss());
    await lessonForm.getByRole('button', { name: 'Cancel' }).click();
    await expect(lessonForm.getByLabel('Lesson text')).toHaveValue('Uncommitted text for cancellation verification.');
    page.once('dialog', (dialog) => dialog.accept());
    await lessonForm.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.admin-course-inline-editor')).toHaveCount(0);

    chapter = physics.getByRole('region', { name: `Chapter ${chapterB}` });
    await expect(chapter.getByRole('button', { name: `Delete chapter ${chapterB}` })).toBeDisabled();
    await expect(chapter.locator('.curriculum-topic-row').filter({ hasText: topicB }).getByRole('button', { name: `Delete topic ${topicB}` })).toBeDisabled();
    moduleCard = page.locator('.admin-course-module-card').filter({ hasText: moduleTitle });
    await expect(moduleCard.locator('.admin-course-lesson-row').filter({ hasText: lessonTitle }).getByRole('button', { name: 'Delete' })).toBeDisabled();
    await moduleCard.locator('.admin-course-lesson-row').filter({ hasText: secondLessonTitle }).getByRole('button', { name: 'Edit lesson' }).click();
    lessonForm = page.locator('.admin-course-inline-editor');
    await lessonForm.getByLabel('Publication status').selectOption('archived');
    await runUiMutation(page, `/courses/${state.courseId}`, 'PATCH', () => lessonForm.getByRole('button', { name: 'Save lesson' }).click());
    moduleCard = page.locator('.admin-course-module-card').filter({ hasText: moduleTitle });
    await expect(moduleCard.locator('.admin-course-lesson-row').filter({ hasText: secondLessonTitle })).toContainText('archived');

    await page.reload();
    await page.getByRole('button', { name: 'Curriculum', exact: true }).click();
    chapter = page.getByRole('region', { name: `Chapter ${chapterB}` });
    await expect(chapter.getByRole('button', { name: `Unpublish chapter ${chapterB}`, exact: true })).toBeEnabled();
    await expect(chapter.locator('.curriculum-topic-row').filter({ hasText: topicB }).getByRole('button', { name: `Unpublish topic ${topicB}`, exact: true })).toBeEnabled();

    // A curriculum subject remains available after managing its dependent content.
    await expect(physics.getByRole('button', { name: 'Edit subject' })).toBeVisible();
  });

  test('admin creates, edits, validates, publishes and previews MCQs and a configured mock test through the UI', async ({ page }) => {
    test.setTimeout(120_000);
    await adminLogin(page);
    const bankTitle = `E2E UI MCQ bank ${onlyTestSlug}`;
    const editedBankTitle = `${bankTitle} edited`;
    const prompt = `E2E UI original demonstration question ${onlyTestSlug}: select the configured option.`;
    const explanation = `E2E-only answer explanation ${onlyTestSlug}.`;
    state.uiBankTitle = editedBankTitle;

    await page.getByRole('button', { name: 'Question banks', exact: true }).click();
    let bankForm = page.getByRole('region', { name: 'Create Question banks' });
    await bankForm.locator('#admin-field-question-banks-exam').selectOption(state.examId);
    await bankForm.getByLabel('Subject').selectOption(state.physicsId);
    await bankForm.getByLabel('Question bank title').fill(bankTitle);
    await bankForm.getByLabel('Publication status').selectOption('published');
    await bankForm.getByRole('button', { name: 'Create record' }).click();
    await expect(page.getByRole('alert')).toContainText('Add at least one complete question before publishing this question bank.');

    await bankForm.getByLabel('Publication status').selectOption('draft');
    await bankForm.getByRole('button', { name: 'Add question' }).click();
    await bankForm.getByLabel('Question prompt').fill(prompt);
    await bankForm.getByRole('textbox', { name: 'Option A' }).fill('Demonstration option A');
    await bankForm.getByRole('textbox', { name: 'Option B' }).fill('Demonstration option B');
    await bankForm.getByRole('textbox', { name: 'Option C' }).fill('Demonstration option C');
    await bankForm.getByRole('textbox', { name: 'Option D' }).fill('Demonstration option D');
    await bankForm.getByLabel('Correct answer').selectOption('2');
    await bankForm.getByLabel('Topic (optional)').selectOption({ label: `${state.topicTitle} · published` });
    await bankForm.getByLabel('Answer explanation').fill(explanation);
    const createdBank = await runUiMutation(page, '/question-banks', 'POST', () => bankForm.getByRole('button', { name: 'Create record' }).click());
    state.uiQuestionBankId = recordId(createdBank.questionBank);
    expect(state.uiQuestionBankId).toBeTruthy();
    let bankRow = page.getByRole('row').filter({ hasText: bankTitle });
    await bankRow.getByRole('button', { name: 'Edit' }).click();
    bankForm = page.getByRole('region', { name: 'Edit Question banks' });
    await bankForm.getByLabel('Question bank title').fill(editedBankTitle);
    await expect(bankForm.getByLabel('Correct answer')).toHaveValue('2');
    await expect(bankForm.getByLabel('Answer explanation')).toHaveValue(explanation);
    await bankForm.getByLabel('Answer explanation').fill(`${explanation} Revised.`);
    await runUiMutation(page, `/question-banks/${state.uiQuestionBankId}`, 'PATCH', () => bankForm.getByRole('button', { name: 'Save changes' }).click());
    bankRow = page.getByRole('row').filter({ hasText: editedBankTitle });
    await bankRow.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(bankRow.getByText('published', { exact: true })).toBeVisible();

    const testProductTitle = `E2E UI mock-test product ${onlyTestSlug}`;
    const testTitle = `E2E UI configured mock test ${onlyTestSlug}`;
    state.uiMockTestTitle = testTitle;
    await page.getByRole('button', { name: 'Study Materials', exact: true }).click();
    let productForm = page.getByRole('region', { name: 'Create Study materials & bundles' });
    await productForm.locator('#admin-field-products-exam').selectOption(state.examId);
    await productForm.locator('#admin-field-products-subject').selectOption(state.physicsId);
    await productForm.getByLabel('Resource title').fill(testProductTitle);
    await productForm.getByLabel('URL slug').fill(`${onlyTestSlug}-ui-mock-test`);
    await productForm.getByLabel('Resource type').selectOption('mock-test');
    await productForm.locator('#admin-field-products-description').fill('Temporary test catalogue fixture created by the browser workflow.');
    await productForm.getByLabel('Access type').selectOption('free');
    await productForm.getByLabel('Publication status').selectOption('draft');
    const testProduct = await runUiMutation(page, '/products', 'POST', () => productForm.getByRole('button', { name: 'Create record' }).click());
    state.uiMockProductId = recordId(testProduct.product);
    const testProductRow = page.getByRole('row').filter({ hasText: testProductTitle });
    await testProductRow.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(testProductRow.getByText('published', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Mock tests', exact: true }).click();
    let mockForm = page.getByRole('region', { name: 'Create Mock tests' });
    await mockForm.getByLabel('Mock-test catalogue product').selectOption(state.uiMockProductId);
    await mockForm.locator('#admin-field-mock-tests-exam').selectOption(state.examId);
    await mockForm.getByLabel('Mock test title').fill(testTitle);
    await mockForm.getByLabel('Student-facing description').fill('Temporary configurable test for validating the student preview.');
    await mockForm.getByLabel('Student instructions').fill('Choose one answer in this disposable demonstration test.');
    await mockForm.getByLabel('Question banks').selectOption([state.uiQuestionBankId]);
    await mockForm.getByLabel('Duration (minutes)').fill('12');
    await mockForm.getByLabel('Question count').fill('1');
    await mockForm.getByLabel('Marks per question').fill('4');
    await mockForm.getByLabel('Total marks').fill('4');
    await mockForm.getByLabel('Enable negative marking').check();
    await mockForm.getByLabel('Negative marks per incorrect answer').fill('0.25');
    await mockForm.getByLabel('Publication status').selectOption('draft');
    const createdMock = await runUiMutation(page, '/mock-tests', 'POST', () => mockForm.getByRole('button', { name: 'Create record' }).click());
    state.uiMockTestId = recordId(createdMock.mockTest);
    let mockRow = page.getByRole('row').filter({ hasText: testTitle });
    await mockRow.getByRole('button', { name: 'Edit' }).click();
    mockForm = page.getByRole('region', { name: 'Edit Mock tests' });
    await mockForm.getByLabel('Student instructions').fill('Instructions revised through the mock-test editor.');
    await mockForm.getByLabel('Duration (minutes)').fill('15');
    await runUiMutation(page, `/mock-tests/${state.uiMockTestId}`, 'PATCH', () => mockForm.getByRole('button', { name: 'Save changes' }).click());
    mockRow = page.getByRole('row').filter({ hasText: testTitle });
    await mockRow.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(mockRow.getByText('published', { exact: true })).toBeVisible();
    await mockRow.getByRole('button', { name: 'Preview' }).click();
    const testPreview = page.getByRole('dialog', { name: 'Mock test preview' });
    await expect(testPreview).toBeVisible();
    await expect(testPreview.getByRole('heading', { name: testTitle })).toBeVisible();
    await expect(testPreview).toContainText('15 minutes');
    await expect(testPreview).toContainText('4 per correct');
    await expect(testPreview).toContainText('4');
    await expect(testPreview.getByRole('heading', { name: prompt })).toBeVisible();
    await expect(testPreview).not.toContainText(`${explanation} Revised.`);
    await expect(testPreview).not.toContainText('Correct answer');
    await testPreview.getByRole('button', { name: 'Close' }).click();

    await mockRow.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(mockRow.getByText('archived', { exact: true })).toBeVisible();
    await page.goto('/practice');
    await expect(page.getByRole('heading', { name: testTitle })).toHaveCount(0);
  });

  test('student registers, enrolls, learns, practices MCQs, submits a mock test and sees dashboard results', async ({ page, context }) => {
    const studentEmail = `e2e-student-${randomUUID()}@example.test`;
    state.studentEmail = studentEmail;
    await page.goto('/register');
    await page.getByLabel('Full name').fill('MEDNEXORA E2E Student');
    await page.getByLabel('Email address').fill(studentEmail);
    await page.getByLabel(/^Password/).fill(studentPassword);
    await page.getByLabel('Confirm password').fill(studentPassword);
    await page.getByRole('button', { name: /create (my )?account|register/i }).click();
    await expect(page).toHaveURL(/student\/dashboard/);

    await page.goto('/courses');
    const courseLink = page.getByRole('link', { name: /B\.Sc\. Nursing Entrance Preparation/i });
    await expect(courseLink.first()).toBeVisible();
    await courseLink.first().click();
    await expect(page.getByRole('heading', { name: state.courseTitle })).toBeVisible();
    await page.getByRole('button', { name: /enroll for free/i }).click();
    await expect(page.getByRole('link', { name: /continue learning/i })).toBeVisible();

    await page.goto(`/courses/${state.courseId}/learn`);
    await expect(page.getByRole('heading', { name: state.lessonTitle }).first()).toBeVisible();
    await expect(page.getByText('This text exists only in a disposable in-memory test database.')).toBeVisible();
    await page.getByRole('button', { name: /mark lesson complete/i }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Progress saved.' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    await page.goto(`/courses/${state.courseId}/learn?lessonId=${state.uiLessonId}`);
    await expect(page.getByRole('heading', { name: state.uiLessonTitle }).first()).toBeVisible();
    await expect(page.getByText('Edited temporary lesson text, mapped to the published E2E topic.')).toBeVisible();
    await page.getByRole('button', { name: /mark lesson complete/i }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Progress saved.' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    await page.goto(`/courses/${state.courseId}`);
    await expect(page.getByText(state.uiDraftLessonTitle)).toHaveCount(0);
    await expect(page.getByText(state.uiArchivedLessonTitle)).toHaveCount(0);
    await page.goto('/my-courses');
    await expect(page.getByText(state.courseTitle, { exact: true })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');

    await page.goto(`/products/${state.uiPdfProductId}`);
    await expect(page.getByRole('heading', { name: state.uiPdfTitle })).toBeVisible();
    await page.getByRole('button', { name: 'Add to My Library' }).click();
    await expect(page.getByRole('link', { name: 'Open My Library' })).toBeVisible();
    await page.getByRole('link', { name: 'Open My Library' }).click();
    const libraryPdf = page.locator('.student-dash-resource').filter({ hasText: state.uiPdfTitle });
    await expect(libraryPdf).toBeVisible();
    const pdfDownloadPromise = page.waitForEvent('download');
    await libraryPdf.getByRole('link', { name: 'Download PDF' }).click();
    const pdfDownload = await pdfDownloadPromise;
    expect(await pdfDownload.failure()).toBeNull();

    await page.goto('/practice');
    await expect(page.getByRole('heading', { name: state.bankTitle })).toBeVisible();
    await page.getByRole('article').filter({ hasText: state.bankTitle }).getByRole('button', { name: /start practice/i }).click();
    await expect(page.getByRole('heading', { name: /E2E question 1/ })).toBeVisible();
    await page.getByRole('button', { name: /E2E option A1/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Correct answer.' })).toBeVisible();
    await expect(page.getByText('E2E-only explanation for answer A.')).toBeVisible();

    await page.goto('/practice');
    await expect(page.getByRole('heading', { name: state.mockTestTitle })).toBeVisible();
    await page.getByRole('button', { name: /start timed test/i }).click();
    await expect(page.getByRole('timer')).toContainText('Time left');
    const attemptId = new URL(page.url()).pathname.split('/').at(-1);
    state.attemptId = attemptId;
    const activeAttemptResponse = await context.request.get(`${baseURL}/api/student/practice/attempts/${attemptId}`);
    expect(activeAttemptResponse.status()).toBe(200);
    const activeAttempt = (await activeAttemptResponse.json()).attempt;
    expect(activeAttempt.questions).toHaveLength(2);
    expect(activeAttempt.questions[0]).not.toHaveProperty('correctAnswerIndex');
    expect(activeAttempt.questions[0]).not.toHaveProperty('review');
    expect(activeAttempt.questions[0]).not.toHaveProperty('explanation');
    const originalDeadline = activeAttempt.expiresAt;
    await page.reload();
    await expect(page.getByRole('timer')).toBeVisible();
    const resumedAttemptResponse = await context.request.get(`${baseURL}/api/student/practice/attempts/${attemptId}`);
    expect(resumedAttemptResponse.status()).toBe(200);
    const resumedAttempt = (await resumedAttemptResponse.json()).attempt;
    expect(resumedAttempt.id).toBe(attemptId);
    expect(resumedAttempt.expiresAt).toBe(originalDeadline);
    expect(resumedAttempt.questions[0]).not.toHaveProperty('correctAnswerIndex');

    for (const width of [375, 430, 768, 1366, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('timer')).toBeVisible();
      const testLayout = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      expect(testLayout.document, `Active mock test document overflow at ${width}px: ${JSON.stringify(testLayout)}`).toBeLessThanOrEqual(width + 1);
      expect(testLayout.body, `Active mock test body overflow at ${width}px: ${JSON.stringify(testLayout)}`).toBeLessThanOrEqual(width + 1);
    }
    await page.setViewportSize({ width: 1366, height: 900 });

    await page.getByRole('button', { name: /E2E option A[12]/ }).click();
    await page.getByRole('button', { name: /go to question 2/i }).click();
    await page.getByRole('button', { name: /E2E option B[12]/ }).click();
    await page.getByRole('button', { name: 'Submit test', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: /submit this test/i });
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByText('2', { exact: true }).first()).toBeVisible();
    await confirmation.getByRole('button', { name: /confirm submission/i }).click();
    await expect(page.getByRole('heading', { name: 'Your result' })).toBeVisible();
    await expect(page.getByText('E2E-only explanation for answer A.').first()).toBeVisible();
    await expect(page.locator('.practice-result-score')).toContainText('1.5');
    await expect(page.locator('.practice-result-metrics')).toContainText('50%');

    await page.goto('/practice/attempts');
    await expect(page.getByRole('heading', { name: state.mockTestTitle })).toBeVisible();
    await page.goto('/student/dashboard');
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: state.courseTitle })).toBeVisible();
    await expect(page.getByText(state.mockTestTitle).first()).toBeVisible();

    const launchBlocked = await studentApi(context, 'post', '/api/payments/orders', {
      idempotencyKey: `e2e-launch-gate-${randomUUID()}`,
      items: [{ productId: state.paidPdfId, quantity: 1 }],
    });
    expect(launchBlocked.status()).toBe(503);
    expect((await launchBlocked.json()).code).toBe('PUBLIC_LAUNCH_GATE_CLOSED');

    const userDiagnostics = diagnostics.get(page);
    expect(userDiagnostics.pageErrors).toEqual([]);
    expect(userDiagnostics.serverErrors).toEqual([]);
  });

  test('authorization blocks student admin access, draft enrollment, cross-student progress and paid PDF download', async ({ browser, page, context }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: /admin sign in required/i })).toBeVisible();

    const adminApiDenied = await context.request.get(`${baseURL}/api/admin/overview`);
    // The local E2E suite intentionally exercises many admin routes from one
    // client. If its per-IP request limit is exhausted, 429 is also a safe
    // denial; backend tests separately assert the unauthenticated 401 path.
    expect([401, 429]).toContain(adminApiDenied.status());
    expect(await adminApiDenied.json()).not.toHaveProperty('metrics');

    await page.goto('/login');
    await page.getByLabel('Email address').fill(state.studentEmail);
    await page.getByLabel('Password').fill(studentPassword);
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page).toHaveURL(/student\/dashboard/);

    const ownProgress = await context.request.get(`${baseURL}/api/student/courses/${state.courseId}/progress`);
    expect(ownProgress.status()).toBe(200);
    expect((await ownProgress.json()).progress.percent).toBe(100);

    const draftEnrollment = await studentApi(context, 'post', `/api/student/courses/${state.draftCourseId}/enroll`, {});
    expect([403, 404]).toContain(draftEnrollment.status());
    const privatePdfDenied = await context.request.get(`${baseURL}/api/student/resources/${state.paidPdfId}/download`);
    expect(privatePdfDenied.status()).toBe(403);

    const secondContext = await browser.newContext();
    try {
      const secondEmail = `e2e-other-${randomUUID()}@example.test`;
      const registration = await secondContext.request.post(`${baseURL}/api/auth/register`, {
        headers: { Origin: baseURL },
        data: { name: 'MEDNEXORA E2E Other Student', email: secondEmail, password: studentPassword },
      });
      expect(registration.status()).toBe(201);
      const otherProgress = await secondContext.request.get(`${baseURL}/api/student/courses/${state.courseId}/progress`);
      expect(otherProgress.status()).toBe(403);
      const otherLesson = await secondContext.request.get(`${baseURL}/api/student/courses/${state.courseId}/lessons/${state.lessonId}/content`);
      expect(otherLesson.status()).toBe(403);
      const otherPdf = await secondContext.request.get(`${baseURL}/api/student/resources/${state.paidPdfId}/download`);
      expect(otherPdf.status()).toBe(403);
      const otherFreePdf = await secondContext.request.get(`${baseURL}/api/student/resources/${state.uiPdfProductId}/download`);
      expect(otherFreePdf.status()).toBe(403);
    } finally {
      await secondContext.close();
    }

    const unauthorizedContext = await browser.newContext();
    try {
      const unauthenticatedLesson = await unauthorizedContext.request.get(`${baseURL}/api/student/courses/${state.courseId}/lessons/${state.lessonId}/content`);
      expect(unauthenticatedLesson.status()).toBe(401);
    } finally {
      await unauthorizedContext.close();
    }
  });

  test('public routes and key signed-in views fit all requested viewport widths', async ({ browser }) => {
    const widths = [375, 430, 768, 1366, 1920];
    const routes = [
      '/', '/login', '/register', '/admin/login', '/courses', `/courses/${state.courseId}`,
      `/courses/${state.courseId}/learn`, `/products/${state.paidPdfId}`, '/practice',
      `/practice/attempts/${state.attemptId}/results`, '/practice/attempts',
      '/student/dashboard', '/my-courses', '/orders', '/cart',
      '/target-exams', '/study-material', '/about', '/contact', '/faq',
      '/privacy-policy', '/terms-and-conditions', '/refund-cancellation-policy', '/not-a-real-route',
    ];
    const context = await browser.newContext({ viewport: { width: widths[0], height: 900 } });
    const page = await context.newPage();
    const entries = diagnostics.get(page) ?? { consoleErrors: [], pageErrors: [], failedRequests: [], serverErrors: [], apiClientErrors: [] };
    diagnostics.set(page, entries);
    page.on('console', (message) => { if (message.type() === 'error') entries.consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => entries.pageErrors.push(error.message));
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText;
      if (failure && failure !== 'net::ERR_ABORTED') entries.failedRequests.push(`${request.method()} ${request.url()} — ${failure}`);
    });
    page.on('response', (response) => {
      const url = response.url();
      if (response.status() >= 500) entries.serverErrors.push(`${response.status()} ${url}`);
      else if (url.includes('/api/') && response.status() >= 400) entries.apiClientErrors.push(`${response.status()} ${url}`);
    });
    await page.goto('/login');
    await page.getByLabel('Email address').fill(state.studentEmail);
    await page.getByLabel('Password').fill(studentPassword);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.goto(route);
        await page.locator('#root > *').first().waitFor({ state: 'attached' });
        await page.waitForTimeout(100);
        if (width === 375 && route === '/') {
          await page.locator('footer nav a[href^="/"]').first().waitFor({ state: 'visible' });
          const footerLinks = await page.locator('footer nav a[href^="/"]').evaluateAll((links) => links.map((link) => ({ href: link.getAttribute('href'), label: link.textContent.trim() })));
          expect(footerLinks.map((link) => link.href)).toEqual(expect.arrayContaining([
            '/target-exams', '/study-material', '/courses', '/practice', '/about', '/contact', '/faq',
            '/privacy-policy', '/terms-and-conditions', '/refund-cancellation-policy',
          ]));
          for (const { href } of footerLinks) expect(routes).toContain(href);
        }
        const size = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        expect(size.document, `${route} document overflow at ${width}px: ${JSON.stringify(size)}`).toBeLessThanOrEqual(width + 1);
        expect(size.body, `${route} body overflow at ${width}px: ${JSON.stringify(size)}`).toBeLessThanOrEqual(width + 1);
        const brokenImages = await page.locator('img').evaluateAll((images) => images.filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.currentSrc || image.src));
        expect(brokenImages, `${route} has broken images at ${width}px`).toEqual([]);
        if (route === '/not-a-real-route') await expect(page.getByRole('heading', { name: 'This page isn’t here.' })).toBeVisible();
      }
    }
    expect(entries.pageErrors).toEqual([]);
    expect(entries.serverErrors).toEqual([]);
    expect(entries.failedRequests).toEqual([]);
    expect(entries.apiClientErrors.filter((entry) => !/^401 .*\/api\/(?:admin|auth)\/me$/u.test(entry))).toEqual([]);
    expect(entries.consoleErrors.filter((entry) => !/status of 401 \(Unauthorized\)/u.test(entry))).toEqual([]);
    await context.close();
  });

  test('admin navigation and curriculum workspace remain usable across the five viewport widths', async ({ page }) => {
    await adminLogin(page);
    await expect(page.getByRole('heading', { name: 'Educational content readiness' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Per-course checklist' })).toBeVisible();
    await expect(page.getByText(state.courseTitle, { exact: true })).toBeVisible();
    await expect(page.locator('.admin-readiness-count-card').first().getByText('Courses', { exact: true })).toBeVisible();
    const curriculumReviewLink = page.getByRole('button', { name: 'Open Curriculum' }).first();
    await expect(curriculumReviewLink).toBeVisible();
    await curriculumReviewLink.click();
    await expect(page.getByRole('heading', { name: state.courseTitle })).toBeVisible();
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    for (const width of [375, 430, 768, 1366, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const dashboardLayout = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      expect(dashboardLayout.document, `Admin dashboard document overflow at ${width}px: ${JSON.stringify(dashboardLayout)}`).toBeLessThanOrEqual(width + 1);
      expect(dashboardLayout.body, `Admin dashboard body overflow at ${width}px: ${JSON.stringify(dashboardLayout)}`).toBeLessThanOrEqual(width + 1);
      await page.getByRole('button', { name: 'Curriculum', exact: true }).click();
      await expect(page.getByRole('heading', { name: state.courseTitle })).toBeVisible();
      const size = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      expect(size.document, `Admin document overflow at ${width}px: ${JSON.stringify(size)}`).toBeLessThanOrEqual(width + 1);
      expect(size.body, `Admin body overflow at ${width}px: ${JSON.stringify(size)}`).toBeLessThanOrEqual(width + 1);
      if (width !== 1920) await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    }
  });
});
