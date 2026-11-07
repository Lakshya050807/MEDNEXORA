import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminOrderPanel from '../components/admin/AdminOrderPanel.jsx';
import AdminResourcePanel from '../components/admin/AdminResourcePanel.jsx';
import AdminStudentPanel from '../components/admin/AdminStudentPanel.jsx';
import AdminSettingsPanel from '../components/admin/AdminSettingsPanel.jsx';
import AdminCurriculumPanel from '../components/admin/AdminCurriculumPanel.jsx';
import Icon from '../components/Icon.jsx';
import BrandLink from '../components/BrandLink.jsx';
import { adminApi, formatRupees } from '../services/adminApi.js';

const adminListPageSize = 50;

async function listAllAdminRecords(resource, signal) {
  const firstPage = await adminApi.list(resource, { page: 1, limit: adminListPageSize }, { signal });
  const pageCount = Number.isSafeInteger(firstPage.pagination?.pages) ? Math.max(1, firstPage.pagination.pages) : 1;
  if (pageCount <= 1) return firstPage;
  const remainingPages = await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => adminApi.list(resource, {
    page: index + 2,
    limit: adminListPageSize,
  }, { signal })));
  return { ...firstPage, items: [...(firstPage.items ?? []), ...remainingPages.flatMap((page) => page.items ?? [])] };
}

const publicationStatus = {
  name: 'publicationStatus', label: 'Publication status', type: 'select', required: true, defaultValue: 'draft', options: [
    { value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'archived', label: 'Archived' },
  ],
};
const resourceTypeOptions = [
  ['notes', 'Notes'], ['practice-paper', 'Original practice paper'], ['previous-year-paper', 'Previous-year paper'],
  ['mock-test', 'Mock test'], ['video-course', 'Video course'], ['crash-course', 'Crash course'], ['bundle', 'Preparation bundle'],
].map(([value, label]) => ({ value, label }));
const materialCategoryOptions = [
  ['chapter-notes', 'Chapter notes'], ['revision-notes', 'Revision notes'], ['important-questions', 'Important questions'],
  ['previous-year-papers', 'Previous-year papers'], ['formula-sheets', 'Formula sheets'],
  ['practice-worksheets', 'Practice worksheets'], ['reference-materials', 'Reference materials'],
].map(([value, label]) => ({ value, label }));
const paperClassificationOptions = (_data, values = {}) => {
  if (values.resourceType === 'previous-year-paper') return [{ value: 'verified-previous-year', label: 'Verified previous-year paper' }];
  if (values.resourceType === 'practice-paper') return [{ value: 'original-practice', label: 'Original practice paper' }];
  return [];
};
const recentlyUpdatedSorts = [
  { value: 'updated-newest', label: 'Recently updated' },
  { value: 'updated-oldest', label: 'Least recently updated' },
];
const namedSorts = [
  ...recentlyUpdatedSorts,
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
];
const orderedSorts = [...namedSorts, { value: 'display-order', label: 'Configured display order' }];
const examOptions = (data) => data.exams.map((item) => ({ value: String(item._id ?? item.id), label: item.name }));
const subjectOptions = (data) => data.subjects.map((item) => ({ value: String(item._id ?? item.id), label: `${item.name}${item.exam?.name ? ` · ${item.exam.name}` : ''}` }));
const productSubjectOptions = (data, values = {}) => data.subjects
  .filter((item) => !values.exam || String(item.exam?._id ?? item.exam?.id ?? item.exam) === String(values.exam))
  .map((item) => ({ value: String(item._id ?? item.id), label: item.name }));
const chapterOptions = (data) => data.chapters.map((item) => ({ value: String(item._id ?? item.id), label: `${item.name}${item.subject?.name ? ` · ${item.subject.name}` : ''}` }));
const topicOptions = (data) => data.topics.map((item) => ({ value: String(item._id ?? item.id), label: item.name }));
const productOptions = (data) => data.products.map((item) => ({ value: String(item._id ?? item.id), label: `${item.title} · ${item.publicationStatus}` }));
const questionBankOptions = (data) => data.questionBanks.map((item) => ({ value: String(item._id ?? item.id), label: `${item.title} · ${item.publicationStatus}` }));
const courseOptions = (data) => data.courses.map((item) => ({ value: String(item._id ?? item.id), label: `${item.product?.title || item.courseType} · ${item.publicationStatus}` }));
function rupeesToPaise(value, label) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) throw new Error(`${label} must be between ₹0 and ₹10,00,000.`);
  return Math.round(amount * 100);
}

const examFields = [
  { name: 'name', label: 'Examination Name', type: 'text', required: true },
  { name: 'slug', label: 'URL slug', type: 'text', required: true },
  { name: 'region', label: 'Region (optional)', type: 'text' },
  { name: 'description', label: 'Description', type: 'textarea', wide: true },
  { name: 'eligibility', label: 'Eligibility Notes', type: 'textarea', wide: true },
  { name: 'syllabus', label: 'Syllabus Notes', type: 'textarea', wide: true },
  { name: 'pattern', label: 'Exam Pattern Notes', type: 'textarea', wide: true },
  { name: 'isPrimary', label: 'Primary Target Examination', type: 'checkbox', defaultValue: false, help: 'Only one examination can be marked as the primary target.' },
  publicationStatus,
];
const subjectFields = [
  { name: 'exam', label: 'Target examination', type: 'select', options: examOptions, required: true },
  { name: 'name', label: 'Subject name', type: 'text', required: true },
  { name: 'slug', label: 'URL slug', type: 'text', required: true },
  { name: 'sortOrder', label: 'Display order', type: 'number', defaultValue: 0, min: 0, step: 1 },
  { name: 'description', label: 'Description', type: 'textarea', wide: true },
  publicationStatus,
];
const chapterFields = [
  { name: 'exam', label: 'Target examination', type: 'select', options: examOptions, required: true },
  { name: 'subject', label: 'Subject', type: 'select', options: subjectOptions, required: true },
  { name: 'name', label: 'Chapter name', type: 'text', required: true },
  { name: 'slug', label: 'URL slug', type: 'text', required: true },
  { name: 'sortOrder', label: 'Display order', type: 'number', defaultValue: 0, min: 0, step: 1 },
  { name: 'description', label: 'Description', type: 'textarea', wide: true },
  publicationStatus,
];
const topicFields = [
  { name: 'exam', label: 'Target examination', type: 'select', options: examOptions, required: true },
  { name: 'subject', label: 'Subject', type: 'select', options: subjectOptions, required: true },
  { name: 'chapter', label: 'Chapter (optional)', type: 'select', options: chapterOptions },
  { name: 'name', label: 'Topic name', type: 'text', required: true },
  { name: 'slug', label: 'URL slug', type: 'text', required: true },
  { name: 'sortOrder', label: 'Display order', type: 'number', defaultValue: 0, min: 0, step: 1 },
  { name: 'description', label: 'Description', type: 'textarea', wide: true },
  publicationStatus,
];
export const productFields = [
  { name: 'exam', label: 'Target examination', type: 'select', options: examOptions, required: true },
  { name: 'subject', label: 'Subject (not required for multi-subject courses)', type: 'select', options: productSubjectOptions, help: 'Choose a subject configured under the selected examination. Draft subjects are valid for draft resources. A multi-subject course can use its configured subject list instead.' },
  { name: 'chapter', label: 'Chapter (optional)', type: 'select', options: chapterOptions },
  { name: 'topic', label: 'Primary topic', type: 'select', options: topicOptions },
  { name: 'topics', label: 'Additional topics', type: 'multi-select', options: topicOptions, help: 'Hold Ctrl or Command to select multiple topics.' },
  { name: 'title', label: 'Resource title', type: 'text', required: true },
  { name: 'slug', label: 'URL slug', type: 'text', required: true },
  { name: 'resourceType', label: 'Resource type', type: 'select', required: true, defaultValue: 'notes', options: resourceTypeOptions },
  { name: 'description', label: 'Description', type: 'textarea', required: true, wide: true },
  { name: 'detailedDescription', label: 'Detailed description', type: 'textarea', wide: true, rows: 5 },
  { name: 'category', label: 'Material category', type: 'select', options: materialCategoryOptions },
  { name: 'difficultyLevel', label: 'Difficulty level (optional)', type: 'select', options: [{ value: 'beginner', label: 'Beginner' }, { value: 'intermediate', label: 'Intermediate' }, { value: 'advanced', label: 'Advanced' }] },
  { name: 'language', label: 'Language', type: 'text', placeholder: 'Enter the material language' },
  { name: 'pricingMode', label: 'Access type', type: 'select', defaultValue: 'paid', options: [{ value: 'free', label: 'Free' }, { value: 'paid', label: 'Paid' }], toForm: (_value, record) => record?.pricePaise === 0 ? 'free' : 'paid', toApi: () => ({}) },
  { name: 'pricePaise', label: 'Listed price (₹)', type: 'number', min: 0, max: 1000000, step: 0.01, placeholder: 'Enter a price', help: 'Published paid resources require a listed price. Choose Free above to set the listed price to ₹0.', toForm: (value) => Number.isSafeInteger(value) ? (value / 100).toFixed(2) : '', toApi: (value, values) => ({ pricePaise: values.pricingMode === 'free' ? 0 : String(value ?? '').trim() ? rupeesToPaise(value, 'Listed price') : null }) },
  { name: 'discountPaise', label: 'Discount (₹)', type: 'number', min: 0, max: 1000000, step: 0.01, defaultValue: '0.00', toForm: (value) => ((Number(value) || 0) / 100).toFixed(2), toApi: (value, values) => ({ discountPaise: values.pricingMode === 'free' ? 0 : rupeesToPaise(value, 'Discount') }) },
  { name: 'thumbnailUrl', label: 'Thumbnail URL', type: 'url', placeholder: 'https://…' },
  { name: 'format', label: 'Format', type: 'text', placeholder: 'PDF, recorded video…' },
  { name: 'durationMinutes', label: 'Duration (minutes)', type: 'number', min: 1, step: 1 },
  { name: 'learningOutcomes', label: 'Learning outcomes (one per line)', type: 'lines', wide: true },
  { name: 'keywords', label: 'Search keywords (comma-separated)', type: 'csv', wide: true },
  { name: 'previewTitle', label: 'Preview title', type: 'text', toForm: (_value, record) => record?.preview?.title ?? '', toApi: (_value, values) => ({ preview: values.previewTitle.trim() || values.previewExcerpt.trim() ? { title: values.previewTitle.trim(), excerpt: values.previewExcerpt.trim() } : null }) },
  { name: 'previewExcerpt', label: 'Public preview excerpt', type: 'textarea', wide: true, rows: 4, toForm: (_value, record) => record?.preview?.excerpt ?? '', toApi: (_value, values) => ({ preview: values.previewTitle.trim() || values.previewExcerpt.trim() ? { title: values.previewTitle.trim(), excerpt: values.previewExcerpt.trim() } : null }), help: 'This excerpt is public. Do not paste paid content. The original PDF remains private.' },
  { name: 'paperClassification', label: 'Paper label', type: 'select', options: paperClassificationOptions, visibleWhen: (values) => ['practice-paper', 'previous-year-paper'].includes(values.resourceType), requiredWhen: (values) => values.publicationStatus === 'published' && ['practice-paper', 'previous-year-paper'].includes(values.resourceType), omitWhenEmpty: true },
  { name: 'previousYearSource', label: 'Previous-year verification (JSON)', type: 'json', defaultValue: {}, wide: true, rows: 4, visibleWhen: (values) => values.resourceType === 'previous-year-paper', help: 'Required before publishing a previous-year paper: title, URL, legalAvailabilityConfirmed and verifiedAt.' },
  { name: 'course', label: 'Linked course (optional)', type: 'select', options: courseOptions, help: 'Course metadata is separate from the target examination. Leave blank unless this material should be linked to a course.' },
  { name: 'bundleItems', label: 'Included resources for a bundle', type: 'multi-select', options: productOptions, help: 'For a published bundle, choose at least one other published resource.' },
  { name: 'contentUrl', label: 'Private PDF path or storage URL (optional)', type: 'password', writeOnly: true, wide: true, placeholder: 'Enter to set or replace; leave blank to keep the saved reference', help: 'Write-only. For externally hosted PDFs, use only a URL on the configured private storage origin. Never use a public paid-file URL.' },
  { name: 'pdfUpload', label: 'Upload or replace private PDF', type: 'pdf-upload', wide: true, toApi: (asset) => asset?.reference ? { contentUrl: asset.reference, fileSizeBytes: asset.sizeBytes } : {}, help: 'PDF files up to 50 MB are checked by file signature and stored outside public static folders. After upload, save this product to attach it.' },
  publicationStatus,
];
const questionBankFields = [
  { name: 'exam', label: 'Target examination', type: 'select', options: examOptions, required: true },
  { name: 'subject', label: 'Subject', type: 'select', options: subjectOptions, required: true },
  { name: 'product', label: 'Access product (optional)', type: 'select', options: productOptions },
  { name: 'title', label: 'Question bank title', type: 'text', required: true },
  { name: 'questions', label: 'MCQ questions (JSON array)', type: 'json', defaultValue: [], wide: true, rows: 13, help: 'Use original or properly licensed content. Label any demonstration item as an original example. Each question: {"prompt":"…","options":["A","B","C","D"],"correctAnswerIndex":0,"explanation":"…","topic":"optional topic ID"}. Answer index is zero-based.' },
  publicationStatus,
];
const mockTestFields = [
  { name: 'product', label: 'Mock-test catalogue product', type: 'select', options: productOptions, required: true },
  { name: 'exam', label: 'Target examination', type: 'select', options: examOptions, required: true },
  { name: 'title', label: 'Mock test title', type: 'text', required: true },
  { name: 'questionBanks', label: 'Question banks', type: 'multi-select', options: questionBankOptions },
  { name: 'durationMinutes', label: 'Duration (minutes)', type: 'number', min: 1, step: 1 },
  { name: 'questionCount', label: 'Question count', type: 'number', min: 1, step: 1 },
  { name: 'marksPerQuestion', label: 'Marks per question', type: 'number', min: 0, step: 0.25, defaultValue: 1 },
  { name: 'totalMarks', label: 'Total marks', type: 'number', min: 0, step: 0.25 },
  { name: 'negativeMarkingEnabled', label: 'Enable negative marking', type: 'checkbox', defaultValue: false },
  { name: 'negativeMarksPerQuestion', label: 'Negative marks per incorrect answer', type: 'number', min: 0, step: 0.25, defaultValue: 0 },
  { name: 'allowAnswerReview', label: 'Allow answer review after submission', type: 'checkbox', defaultValue: true },
  { name: 'revealExplanations', label: 'Show explanations after submission', type: 'checkbox', defaultValue: true },
  { name: 'patternVerified', label: 'Exam pattern independently verified', type: 'checkbox', defaultValue: false, help: 'Mark only when this mock-test pattern has been checked against its configured examination details.' },
  publicationStatus,
];
const courseFields = [
  { name: 'product', label: 'Catalogue product', type: 'select', options: productOptions, required: true },
  { name: 'exam', label: 'Target examination', type: 'select', options: examOptions, required: true },
  { name: 'category', label: 'Category', type: 'text', placeholder: 'Government Competitive Exam Preparation' },
  { name: 'targetAudience', label: 'Target audience', type: 'textarea', wide: true },
  { name: 'subjects', label: 'Subjects', type: 'multi-select', options: subjectOptions },
  { name: 'courseType', label: 'Course type', type: 'select', required: true, options: [{ value: 'video-course', label: 'Video course' }, { value: 'crash-course', label: 'Crash course' }] },
  { name: 'durationMinutes', label: 'Total duration (minutes)', type: 'number', min: 1, step: 1 },
  { name: 'lessonCount', label: 'Lesson count', type: 'number', min: 0, step: 1 },
  { name: 'outline', label: 'Course outline (one item per line)', type: 'lines', wide: true },
  { name: 'modules', label: 'Modules and lessons (JSON)', type: 'json', defaultValue: [], wide: true, rows: 13, help: 'Example: [{"title":"Physics chapter module","subject":"subject-id","chapter":"chapter-id","sortOrder":0,"lessons":[{"title":"Lesson 1","topic":"optional-topic-id","publicationStatus":"draft","durationMinutes":20,"videoProvider":"youtube","videoAssetId":"11-character-id","isPreview":false,"sortOrder":0}]}]. Map each topic to its module subject, chapter, and course examination. New lessons default to Draft; publish only when reviewed. Reorder with sortOrder; keep existing module and lesson _id values when editing so saved progress remains linked. Use provider IDs or private asset references only, never private URLs or credentials. Paid lessons remain unavailable until secure signed playback is configured.' },
  publicationStatus,
];

const panels = [
  { id: 'products', title: 'Study materials & bundles', hint: 'Manage material descriptions, curriculum mappings, categories, free or paid pricing, previews and private PDFs.', fields: productFields, sortOptions: [...recentlyUpdatedSorts, { value: 'name-asc', label: 'Title A–Z' }, { value: 'name-desc', label: 'Title Z–A' }, { value: 'price-asc', label: 'Price low to high' }, { value: 'price-desc', label: 'Price high to low' }], filters: [{ queryParam: 'examId', label: 'Exam', options: examOptions }, { queryParam: 'subjectId', label: 'Subject', options: subjectOptions }, { queryParam: 'chapterId', label: 'Chapter', options: chapterOptions }, { queryParam: 'category', label: 'Category', options: materialCategoryOptions }, { queryParam: 'resourceType', label: 'Type', options: resourceTypeOptions }], columns: [{ name: 'title', label: 'Resource' }, { name: 'category', label: 'Category' }, { name: 'resourceType', label: 'Type' }, { name: 'exam', label: 'Exam', type: 'reference' }, { name: 'subject', label: 'Subject', type: 'reference' }, { name: 'publicationStatus', label: 'Status' }, { name: 'price', label: 'Price', value: (item) => formatRupees(item.currentPricePaise) }] },
  { id: 'exams', title: 'Examinations', hint: 'Configure examination details and publication status.', fields: examFields, sortOptions: namedSorts, columns: [{ name: 'name', label: 'Examination' }, { name: 'region', label: 'Region' }, { name: 'priority', label: 'Target priority', value: (item) => item.isPrimary ? 'Primary target' : 'Additional' }, { name: 'publicationStatus', label: 'Status' }] },
  { id: 'subjects', title: 'Subjects', hint: 'Manage subject lists separately for each configured examination.', fields: subjectFields, sortOptions: orderedSorts, filters: [{ queryParam: 'examId', label: 'Exam', options: examOptions }], columns: [{ name: 'name', label: 'Subject' }, { name: 'exam', label: 'Exam', type: 'reference' }, { name: 'publicationStatus', label: 'Status' }] },
  { id: 'chapters', title: 'Chapters', hint: 'Organize each subject into exam-specific chapters before adding topics and resources.', fields: chapterFields, sortOptions: orderedSorts, filters: [{ queryParam: 'examId', label: 'Exam', options: examOptions }, { queryParam: 'subjectId', label: 'Subject', options: subjectOptions }], columns: [{ name: 'name', label: 'Chapter' }, { name: 'subject', label: 'Subject', type: 'reference' }, { name: 'exam', label: 'Exam', type: 'reference' }, { name: 'publicationStatus', label: 'Status' }] },
  { id: 'topics', title: 'Topics', hint: 'Manage topic records under configured subjects and optional chapters.', fields: topicFields, sortOptions: orderedSorts, filters: [{ queryParam: 'examId', label: 'Exam', options: examOptions }, { queryParam: 'subjectId', label: 'Subject', options: subjectOptions }, { queryParam: 'chapterId', label: 'Chapter', options: chapterOptions }], columns: [{ name: 'name', label: 'Topic' }, { name: 'chapter', label: 'Chapter', type: 'reference' }, { name: 'subject', label: 'Subject', type: 'reference' }, { name: 'exam', label: 'Exam', type: 'reference' }, { name: 'publicationStatus', label: 'Status' }] },
  { id: 'question-banks', title: 'Question banks', hint: 'Edit MCQs, answer keys and explanations. Answer indexes are zero-based.', fields: questionBankFields, sortOptions: namedSorts, filters: [{ queryParam: 'examId', label: 'Exam', options: examOptions }, { queryParam: 'subjectId', label: 'Subject', options: subjectOptions }], columns: [{ name: 'title', label: 'Question bank' }, { name: 'exam', label: 'Exam', type: 'reference' }, { name: 'subject', label: 'Subject', type: 'reference' }, { name: 'questionCount', label: 'Questions', value: (item) => item.questions?.length ?? 0 }, { name: 'publicationStatus', label: 'Status' }] },
  { id: 'mock-tests', title: 'Mock tests', hint: 'Configure duration, marks and negative marking against question banks.', fields: mockTestFields, sortOptions: namedSorts, filters: [{ queryParam: 'examId', label: 'Exam', options: examOptions }], columns: [{ name: 'title', label: 'Mock test' }, { name: 'questionCount', label: 'Questions' }, { name: 'totalMarks', label: 'Total marks' }, { name: 'negativeMarkingEnabled', label: 'Negative marking', value: (item) => item.negativeMarkingEnabled ? `${item.negativeMarksPerQuestion} per wrong answer` : 'Off' }, { name: 'publicationStatus', label: 'Status' }] },
  { id: 'courses', title: 'Courses', hint: 'Manage course metadata, categories, target audiences, subjects, ordered modules, lesson previews and provider references. Configure price and thumbnail on the linked catalogue product.', fields: courseFields, sortOptions: recentlyUpdatedSorts, filters: [{ queryParam: 'examId', label: 'Exam', options: examOptions }, { queryParam: 'courseType', label: 'Type', options: [{ value: 'video-course', label: 'Video course' }, { value: 'crash-course', label: 'Crash course' }] }], columns: [{ name: 'product', label: 'Catalogue product', type: 'reference' }, { name: 'courseType', label: 'Type' }, { name: 'lessonCount', label: 'Lessons' }, { name: 'publicationStatus', label: 'Status' }] },
];

const navigation = [
  { id: 'overview', label: 'Dashboard', icon: 'spark' },
  { id: 'courses', label: 'Courses', icon: 'play' },
  { id: 'curriculum', label: 'Curriculum', icon: 'clipboard' },
  { id: 'exams', label: 'Examinations', icon: 'file' },
  { id: 'products', label: 'Study Materials', icon: 'book' },
  { id: 'question-banks', label: 'Question banks', icon: 'checklist' },
  { id: 'mock-tests', label: 'Mock tests', icon: 'file' },
  { id: 'students', label: 'Students', icon: 'user' },
  { id: 'orders', label: 'Orders & Payments', icon: 'bag' },
  { id: 'settings', label: 'Settings', icon: 'shield' },
];

export default function AdminDashboardPage() {
  const [access, setAccess] = useState('loading');
  const [admin, setAdmin] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [references, setReferences] = useState({ exams: [], subjects: [], chapters: [], topics: [], products: [], questionBanks: [], courses: [] });
  const [activeSection, setActiveSection] = useState('overview');
  const [loadError, setLoadError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [logoutError, setLogoutError] = useState('');
  const selectedPanel = panels.find((panel) => panel.id === activeSection);

  const refreshDashboard = useCallback(() => setRefreshVersion((version) => version + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setAccess((current) => current === 'allowed' ? 'allowed' : 'loading');
    setLoadError('');
    Promise.all([
      adminApi.profile({ signal: controller.signal }),
      adminApi.overview({ signal: controller.signal }),
      listAllAdminRecords('exams', controller.signal),
      listAllAdminRecords('subjects', controller.signal),
      listAllAdminRecords('chapters', controller.signal),
      listAllAdminRecords('topics', controller.signal),
      adminApi.list('products', { page: 1, limit: adminListPageSize }, { signal: controller.signal }),
      adminApi.list('question-banks', { page: 1, limit: adminListPageSize }, { signal: controller.signal }),
      listAllAdminRecords('courses', controller.signal),
    ]).then(([profile, summary, exams, subjects, chapters, topics, products, questionBanks, courses]) => {
      setAdmin(profile.user);
      setMetrics(summary.metrics);
      setReferences({ exams: exams.items ?? [], subjects: subjects.items ?? [], chapters: chapters.items ?? [], topics: topics.items ?? [], products: products.items ?? [], questionBanks: questionBanks.items ?? [], courses: courses.items ?? [] });
      setAccess('allowed');
    }).catch((error) => {
      if (error?.name === 'AbortError') return;
      setLoadError(error.message || 'The admin workspace could not be loaded.');
      setAccess(error.status === 401 ? 'unauthenticated' : error.status === 403 ? 'forbidden' : 'error');
    });
    return () => controller.abort();
  }, [refreshVersion]);

  useEffect(() => {
    const revalidateRestoredAdminPage = (event) => {
      if (!event.persisted) return;
      setAccess('loading');
      setRefreshVersion((version) => version + 1);
    };
    window.addEventListener('pageshow', revalidateRestoredAdminPage);
    return () => window.removeEventListener('pageshow', revalidateRestoredAdminPage);
  }, []);

  const logout = async () => {
    setLogoutError('');
    try {
      await adminApi.logout();
      window.location.assign('/admin/login');
    } catch (error) { setLogoutError(error.message || 'Could not end the admin session.'); }
  };

  const optionData = useMemo(() => ({
    ...references,
    exams: references.exams,
    subjects: references.subjects,
    chapters: references.chapters,
    topics: references.topics,
    products: references.products,
    questionBanks: references.questionBanks,
    courses: references.courses,
  }), [references]);

  if (access !== 'allowed') {
    const unauthenticated = access === 'unauthenticated';
    const forbidden = access === 'forbidden';
    const title = access === 'loading' ? 'Verifying administrator access…' : unauthenticated ? 'Admin sign in required.' : forbidden ? 'This account has no admin access.' : 'Admin workspace unavailable.';
    return <div className="admin-gate"><div className="admin-gate-card"><BrandLink />{access === 'loading' ? <span className="loading-mark" /> : <span className="admin-gate-icon"><Icon name={forbidden ? 'shield' : 'file'} size={24} /></span>}<h1>{title}</h1><p>{access === 'loading' ? 'The backend checks the current session and administrator role.' : loadError}</p>{unauthenticated && <a className="admin-primary-button" href="/admin/login">Continue to admin login</a>}{forbidden && <a className="admin-primary-button" href="/admin/login">Sign in with an administrator account</a>}{access === 'error' && <button className="admin-primary-button" type="button" onClick={refreshDashboard}>Try again</button>}<a className="admin-gate-home" href="/">Return to the website</a></div></div>;
  }

  const activePanel = selectedPanel;
  return (
    <div className="admin-app-shell">
      <aside className="admin-sidebar">
        <BrandLink ariaLabel="MEDNEXORA home" />
        <div className="admin-sidebar-label">ADMIN WORKSPACE</div>
        <nav className="admin-sidebar-nav" aria-label="Admin sections">{navigation.map((entry) => <button key={entry.id} type="button" className={activeSection === entry.id ? 'is-active' : ''} onClick={() => setActiveSection(entry.id)}><Icon name={entry.icon} size={18} /><span>{entry.label}</span></button>)}</nav>
        <div className="admin-sidebar-profile"><span className="admin-avatar">{admin?.name?.slice(0, 1)?.toUpperCase() || 'A'}</span><span><strong>{admin?.name || 'Administrator'}</strong><small>{admin?.username ? `@${admin.username}` : admin?.email}</small></span></div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar"><div><span className="admin-mobile-brand">MEDNEXORA ADMIN</span><nav className="admin-breadcrumbs" aria-label="Breadcrumb"><span>Admin workspace</span><span aria-hidden="true">/</span><strong>{navigation.find((entry) => entry.id === activeSection)?.label}</strong></nav><h1>{navigation.find((entry) => entry.id === activeSection)?.label}</h1></div><div className="admin-topbar-actions"><button className="admin-quiet-button admin-account-menu" type="button" onClick={() => setActiveSection('settings')}><Icon name="user" size={15} /><span>{admin?.username ? `@${admin.username}` : 'Admin account'}</span></button><a href="/" className="admin-quiet-button">View website <Icon name="arrowUpRight" size={15} /></a><button className="admin-quiet-button" type="button" onClick={logout}>Log out</button></div></header>
        {logoutError && <p className="admin-message is-error" role="alert">{logoutError}</p>}

        {activeSection === 'overview' && <>
          <div className="admin-welcome-card"><div><p className="eyebrow">ADMIN OVERVIEW</p><h2>Welcome back, {admin?.name?.split(' ')[0] || 'admin'}.</h2><p>These counts come from the current database records. Net verified revenue subtracts verified refund totals from captured payments.</p></div><span className="admin-welcome-icon"><Icon name="clipboard" size={25} /></span></div>
          <div className="admin-metric-grid">
            <article className="admin-metric-card"><span className="metric-icon"><Icon name="user" size={19} /></span><small>Registered students</small><strong>{metrics?.studentCount ?? '—'}</strong><span>Student role accounts</span></article>
            <article className="admin-metric-card"><span className="metric-icon"><Icon name="play" size={19} /></span><small>Courses</small><strong>{metrics?.courseCount ?? '—'}</strong><span>{metrics?.publishedCourseCount ?? 0} published · {metrics?.draftCourseCount ?? 0} draft</span></article>
            <article className="admin-metric-card"><span className="metric-icon"><Icon name="book" size={19} /></span><small>Study materials</small><strong>{metrics?.studyMaterialCount ?? '—'}</strong><span>Resources excluding courses and bundles</span></article>
            <article className="admin-metric-card"><span className="metric-icon"><Icon name="checklist" size={19} /></span><small>Question banks</small><strong>{metrics?.questionBankCount ?? '—'}</strong><span>All publication states</span></article>
            <article className="admin-metric-card"><span className="metric-icon"><Icon name="file" size={19} /></span><small>Mock tests</small><strong>{metrics?.mockTestCount ?? '—'}</strong><span>All publication states</span></article>
            <article className="admin-metric-card"><span className="metric-icon"><Icon name="bag" size={19} /></span><small>Orders</small><strong>{metrics?.orderCount ?? '—'}</strong><span>{metrics?.verifiedPaidOrderCount ?? 0} verified paid</span></article>
            <article className="admin-metric-card admin-revenue-card"><span className="metric-icon"><Icon name="shield" size={19} /></span><small>Net verified revenue</small><strong>{formatRupees(metrics?.verifiedRevenuePaise ?? 0)}</strong><span>Captured payments less processed refunds</span></article>
            <article className="admin-metric-card"><span className="metric-icon"><Icon name="spark" size={19} /></span><small>All catalogue products</small><strong>{metrics?.productCount ?? '—'}</strong><span>{metrics?.publishedProductCount ?? 0} published</span></article>
          </div>
          <div className="admin-overview-grid"><article className="admin-overview-card"><p className="eyebrow">CONTENT WORKFLOW</p><h2>Manage the catalogue</h2><p>Create resources, configure exam mappings, then publish when details are ready.</p><button className="admin-primary-button" type="button" onClick={() => setActiveSection('products')}>Manage products <Icon name="arrow" size={16} /></button></article><article className="admin-overview-card"><p className="eyebrow">QUESTION PRACTICE</p><h2>Build tests from question banks</h2><p>Add MCQs with answer explanations, then set mock test duration, marks and negative-marking rules.</p><button className="admin-secondary-button" type="button" onClick={() => setActiveSection('question-banks')}>Open question banks <Icon name="arrow" size={16} /></button></article><article className="admin-overview-card"><p className="eyebrow">ORDER RECORDS</p><h2>Review recorded purchases</h2><p>Orders show payment status and student purchase snapshots. This workspace does not collect or process payments.</p><button className="admin-secondary-button" type="button" onClick={() => setActiveSection('orders')}>View orders <Icon name="arrow" size={16} /></button></article></div>
          <p className="admin-data-note"><Icon name="shield" size={16} /> Student registration cannot create administrator accounts. Admin access is verified by the backend on every request.</p>
        </>}

        {activeSection === 'orders' && <AdminOrderPanel />}
        {activeSection === 'students' && <AdminStudentPanel />}
        {activeSection === 'settings' && <AdminSettingsPanel admin={admin} onLogout={logout} />}
        {activePanel && <AdminResourcePanel key={activePanel.id} resource={activePanel.id} title={activePanel.title} description={activePanel.hint} fields={activePanel.fields} columns={activePanel.columns} filters={activePanel.filters} sortOptions={activePanel.sortOptions} options={optionData} onSaved={refreshDashboard} />}
        {activeSection === 'curriculum' && <AdminCurriculumPanel exams={references.exams} subjects={references.subjects} chapters={references.chapters} topics={references.topics} courses={references.courses} products={references.products} questionBanks={references.questionBanks} onSaved={refreshDashboard} onNavigate={setActiveSection} />}
      </main>
    </div>
  );
}
