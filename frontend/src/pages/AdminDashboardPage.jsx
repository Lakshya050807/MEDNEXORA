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
const referenceResources = {
  exams: 'exams',
  subjects: 'subjects',
  chapters: 'chapters',
  topics: 'topics',
  products: 'products',
  'question-banks': 'questionBanks',
  courses: 'courses',
};
const allReferenceResources = Object.keys(referenceResources);
const readinessSectionLabels = {
  courses: 'Courses', curriculum: 'Curriculum', exams: 'Examinations', products: 'Study Materials',
  'question-banks': 'Question banks', 'mock-tests': 'Mock tests',
};
const readinessCountRows = [
  ['courses', 'Courses'], ['subjects', 'Subjects'], ['chapters', 'Chapters'], ['topics', 'Topics'],
  ['lessons', 'Lessons'], ['mcqs', 'MCQs'], ['mockTests', 'Mock tests'], ['studyMaterials', 'Study materials'],
];

function ContentReadinessDashboard({ data, onNavigate }) {
  const issues = (data?.issues ?? []).filter((issue) => issue.count > 0);
  return <section className="admin-readiness-section" aria-labelledby="content-readiness-title">
    <header className="admin-readiness-heading">
      <div><p className="eyebrow">PUBLICATION PREPARATION</p><h2 id="content-readiness-title">Educational content readiness</h2><p>Counts reflect current database records; MCQ states follow their question bank. Study material totals exclude course, mock-test and bundle listings. This report is advisory and never changes publication status.</p></div>
    </header>
    <div className="admin-readiness-count-grid">
      {readinessCountRows.map(([key, label]) => {
        const count = data?.counts?.[key] ?? { total: 0, published: 0, draft: 0, archived: 0 };
        return <article className="admin-readiness-count-card" key={key}>
          <span>{label}</span><strong>{count.total}</strong>
          <small><b>{count.published}</b> published <i aria-hidden="true">·</i> <b>{count.draft}</b> draft <i aria-hidden="true">·</i> <b>{count.archived}</b> archived</small>
        </article>;
      })}
    </div>
    <div className="admin-readiness-grid">
      <article className="admin-readiness-card">
        <div className="admin-readiness-card-heading"><div><h3>Items to review</h3><p>Warnings identify content that may be incomplete or not visible to students.</p></div><span className={issues.length ? 'readiness-pill is-warning' : 'readiness-pill is-complete'}>{issues.length ? `${issues.length} warning types` : 'No gaps detected'}</span></div>
        {issues.length === 0 ? <p className="admin-readiness-empty">No content gaps are currently detected in the loaded catalogue.</p> : <div className="admin-readiness-issues">
          {issues.map((issue) => <section className="admin-readiness-issue" key={issue.key}>
            <div className="admin-readiness-issue-summary"><span className="readiness-issue-count">{issue.count}</span><strong>{issue.label}</strong><button type="button" className="admin-readiness-link" onClick={() => onNavigate(issue.section)}>Open {readinessSectionLabels[issue.section] ?? 'content'} <span aria-hidden="true">→</span></button></div>
            {issue.examples?.length > 0 && <ul>{issue.examples.map((example) => <li key={`${issue.key}-${example.id}`}>{example.name}</li>)}</ul>}
          </section>)}
        </div>}
      </article>
      <article className="admin-readiness-card admin-course-readiness-card">
        <div className="admin-readiness-card-heading"><div><h3>Per-course checklist</h3><p>Open each admin section to review or complete a course item.</p></div></div>
        {!data?.courses?.length ? <p className="admin-readiness-empty">No courses are configured yet.</p> : <div className="admin-course-readiness-list">
          {data.courses.map((course) => <section className="admin-course-readiness-item" key={course.id}>
            <header><div><strong>{course.title}</strong><small>{course.publicationStatus} · {course.issueCount} checklist {course.issueCount === 1 ? 'item' : 'items'} to review</small></div><span className={`curriculum-course-status status-${course.publicationStatus}`}>{course.publicationStatus}</span></header>
            <ul>{course.checks.map((check) => <li key={`${course.id}-${check.label}`}>
              <span className={`readiness-check-mark is-${check.status}`} aria-label={check.status === 'complete' ? 'Complete' : 'Needs review'}>{check.status === 'complete' ? '✓' : '!'}</span>
              <div><strong>{check.label}</strong><small>{check.detail}</small></div>
              <button type="button" className="admin-readiness-link" onClick={() => onNavigate(check.section)}>Open {readinessSectionLabels[check.section] ?? 'content'}</button>
            </li>)}</ul>
          </section>)}
        </div>}
      </article>
    </div>
  </section>;
}

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
  { name: 'questions', label: 'MCQ questions', type: 'question-builder', defaultValue: [], wide: true },
  publicationStatus,
];
const mockTestFields = [
  { name: 'product', label: 'Mock-test catalogue product', type: 'select', options: productOptions, required: true },
  { name: 'exam', label: 'Target examination', type: 'select', options: examOptions, required: true },
  { name: 'title', label: 'Mock test title', type: 'text', required: true },
  { name: 'description', label: 'Student-facing description', type: 'textarea', wide: true, rows: 3 },
  { name: 'instructions', label: 'Student instructions', type: 'textarea', wide: true, rows: 5 },
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
  { name: 'outline', label: 'Course outline (one item per line)', type: 'lines', wide: true },
  publicationStatus,
];

const panels = [
  { id: 'products', title: 'Study materials & bundles', hint: 'Manage material descriptions, curriculum mappings, categories, free or paid pricing, previews and private PDFs.', fields: productFields, sortOptions: [...recentlyUpdatedSorts, { value: 'name-asc', label: 'Title A–Z' }, { value: 'name-desc', label: 'Title Z–A' }, { value: 'price-asc', label: 'Price low to high' }, { value: 'price-desc', label: 'Price high to low' }], filters: [{ queryParam: 'examId', label: 'Exam', options: examOptions }, { queryParam: 'subjectId', label: 'Subject', options: subjectOptions }, { queryParam: 'chapterId', label: 'Chapter', options: chapterOptions }, { queryParam: 'category', label: 'Category', options: materialCategoryOptions }, { queryParam: 'resourceType', label: 'Type', options: resourceTypeOptions }], columns: [{ name: 'title', label: 'Resource' }, { name: 'category', label: 'Category' }, { name: 'resourceType', label: 'Type' }, { name: 'exam', label: 'Exam', type: 'reference' }, { name: 'subject', label: 'Subject', type: 'reference' }, { name: 'publicationStatus', label: 'Status' }, { name: 'price', label: 'Price', value: (item) => formatRupees(item.currentPricePaise) }] },
  { id: 'exams', title: 'Examinations', hint: 'Configure examination details and publication status.', fields: examFields, sortOptions: namedSorts, columns: [{ name: 'name', label: 'Examination' }, { name: 'region', label: 'Region' }, { name: 'priority', label: 'Target priority', value: (item) => item.isPrimary ? 'Primary target' : 'Additional' }, { name: 'publicationStatus', label: 'Status' }] },
  { id: 'subjects', title: 'Subjects', hint: 'Manage subject lists separately for each configured examination.', fields: subjectFields, sortOptions: orderedSorts, filters: [{ queryParam: 'examId', label: 'Exam', options: examOptions }], columns: [{ name: 'name', label: 'Subject' }, { name: 'exam', label: 'Exam', type: 'reference' }, { name: 'publicationStatus', label: 'Status' }] },
  { id: 'chapters', title: 'Chapters', hint: 'Organize each subject into exam-specific chapters before adding topics and resources.', fields: chapterFields, sortOptions: orderedSorts, filters: [{ queryParam: 'examId', label: 'Exam', options: examOptions }, { queryParam: 'subjectId', label: 'Subject', options: subjectOptions }], columns: [{ name: 'name', label: 'Chapter' }, { name: 'subject', label: 'Subject', type: 'reference' }, { name: 'exam', label: 'Exam', type: 'reference' }, { name: 'publicationStatus', label: 'Status' }] },
  { id: 'topics', title: 'Topics', hint: 'Manage topic records under configured subjects and optional chapters.', fields: topicFields, sortOptions: orderedSorts, filters: [{ queryParam: 'examId', label: 'Exam', options: examOptions }, { queryParam: 'subjectId', label: 'Subject', options: subjectOptions }, { queryParam: 'chapterId', label: 'Chapter', options: chapterOptions }], columns: [{ name: 'name', label: 'Topic' }, { name: 'chapter', label: 'Chapter', type: 'reference' }, { name: 'subject', label: 'Subject', type: 'reference' }, { name: 'exam', label: 'Exam', type: 'reference' }, { name: 'publicationStatus', label: 'Status' }] },
  { id: 'question-banks', title: 'Question banks', hint: 'Edit MCQs, answer keys and explanations. Answer indexes are zero-based.', fields: questionBankFields, sortOptions: namedSorts, filters: [{ queryParam: 'examId', label: 'Exam', options: examOptions }, { queryParam: 'subjectId', label: 'Subject', options: subjectOptions }], columns: [{ name: 'title', label: 'Question bank' }, { name: 'exam', label: 'Exam', type: 'reference' }, { name: 'subject', label: 'Subject', type: 'reference' }, { name: 'questionCount', label: 'Questions', value: (item) => item.questions?.length ?? 0 }, { name: 'publicationStatus', label: 'Status' }] },
  { id: 'mock-tests', title: 'Mock tests', hint: 'Configure student instructions, duration, question count, marks, and negative marking. Preview the student-facing test settings without starting an attempt or exposing answer keys.', fields: mockTestFields, previewType: 'mock-test', sortOptions: namedSorts, filters: [{ queryParam: 'examId', label: 'Exam', options: examOptions }], columns: [{ name: 'title', label: 'Mock test' }, { name: 'questionCount', label: 'Questions' }, { name: 'totalMarks', label: 'Total marks' }, { name: 'negativeMarkingEnabled', label: 'Negative marking', value: (item) => item.negativeMarkingEnabled ? `${item.negativeMarksPerQuestion} per wrong answer` : 'Off' }, { name: 'publicationStatus', label: 'Status' }] },
  { id: 'courses', title: 'Courses', hint: 'Manage course metadata, configured exam and subjects, status, and student preview. Lesson modules and lesson content are edited in Curriculum. Course title, description, thumbnail and pricing are stored on its linked video-course/crash-course product in Study Materials.', fields: courseFields, previewType: 'course', sortOptions: recentlyUpdatedSorts, filters: [{ queryParam: 'examId', label: 'Exam', options: examOptions }, { queryParam: 'courseType', label: 'Type', options: [{ value: 'video-course', label: 'Video course' }, { value: 'crash-course', label: 'Crash course' }] }], columns: [{ name: 'product', label: 'Catalogue product', type: 'reference' }, { name: 'courseType', label: 'Type' }, { name: 'lessonCount', label: 'Lessons' }, { name: 'publicationStatus', label: 'Status' }] },
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
  const [readiness, setReadiness] = useState(null);
  const [readinessStatus, setReadinessStatus] = useState('loading');
  const [readinessError, setReadinessError] = useState('');
  const [references, setReferences] = useState({ exams: [], subjects: [], chapters: [], topics: [], products: [], questionBanks: [], courses: [] });
  const [activeSection, setActiveSection] = useState('overview');
  const [loadError, setLoadError] = useState('');
  const [refreshRequest, setRefreshRequest] = useState({ version: 0, resource: null });
  const [logoutError, setLogoutError] = useState('');
  const [hasUnsavedWork, setHasUnsavedWork] = useState(false);
  const selectedPanel = panels.find((panel) => panel.id === activeSection);

  const refreshDashboard = useCallback((resource = null) => {
    setRefreshRequest((current) => ({ version: current.version + 1, resource }));
  }, []);
  const navigateSection = useCallback((nextSection) => {
    if (nextSection === activeSection) return;
    if (hasUnsavedWork && !window.confirm('Discard unsaved admin content changes and leave this section?')) return;
    setHasUnsavedWork(false);
    setActiveSection(nextSection);
  }, [activeSection, hasUnsavedWork]);

  useEffect(() => {
    if (!hasUnsavedWork) return undefined;
    const warnBeforeUnload = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedWork]);

  const updateReferences = (loadedReferences, replace = false) => {
    setReferences((current) => ({
      ...(replace ? {} : current),
      ...loadedReferences,
    }));
  };

  useEffect(() => {
    const controller = new AbortController();
    setAccess((current) => current === 'allowed' ? 'allowed' : 'loading');
    setLoadError('');
    Promise.all([
      adminApi.profile({ signal: controller.signal }),
      adminApi.overview({ signal: controller.signal, includeContentReadiness: true }),
      ...allReferenceResources.map((resource) => listAllAdminRecords(resource, controller.signal)),
    ]).then(([profile, summary, ...loaded]) => {
      setAdmin(profile.user);
      setMetrics(summary.metrics);
      if (summary.contentReadinessError || !summary.contentReadiness) {
        setReadinessError(summary.contentReadinessError || 'Content readiness could not be loaded.');
        setReadinessStatus('error');
      } else {
        setReadiness(summary.contentReadiness);
        setReadinessStatus('ready');
      }
      updateReferences(Object.fromEntries(allReferenceResources.map((resource, index) => [
        referenceResources[resource], loaded[index].items ?? [],
      ])), true);
      setAccess('allowed');
    }).catch((error) => {
      if (error?.name === 'AbortError') return;
      setLoadError(error.message || 'The admin workspace could not be loaded.');
      setAccess(error.status === 401 ? 'unauthenticated' : error.status === 403 ? 'forbidden' : 'error');
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!refreshRequest.version) return undefined;
    const controller = new AbortController();
    const collectionKey = referenceResources[refreshRequest.resource];
    const resources = collectionKey ? [refreshRequest.resource] : refreshRequest.resource ? [] : allReferenceResources;
    const includeProfile = !refreshRequest.resource;
    const includeReadiness = true;
    setReadinessStatus('loading');
    setLoadError('');
    Promise.all([
      ...(includeProfile ? [adminApi.profile({ signal: controller.signal })] : []),
      adminApi.overview({ signal: controller.signal, includeContentReadiness: includeReadiness }),
      ...resources.map((resource) => listAllAdminRecords(resource, controller.signal)),
    ]).then((results) => {
      let index = 0;
      if (includeProfile) setAdmin(results[index++].user);
      const summary = results[index++];
      setMetrics(summary.metrics);
      if (includeReadiness) {
        if (summary.contentReadinessError || !summary.contentReadiness) {
          setReadinessError(summary.contentReadinessError || 'Content readiness could not be refreshed.');
          setReadinessStatus('error');
        } else {
          setReadiness(summary.contentReadiness);
          setReadinessError('');
          setReadinessStatus('ready');
        }
      }
      const loaded = results.slice(index);
      if (resources.length) {
        updateReferences(Object.fromEntries(resources.map((resource, resourceIndex) => [
          referenceResources[resource], loaded[resourceIndex].items ?? [],
        ])), !refreshRequest.resource);
      } else if (!refreshRequest.resource) {
        updateReferences({}, true);
      }
      setAccess('allowed');
    }).catch((error) => {
      if (error?.name === 'AbortError') return;
      setLoadError(error.message || 'The admin workspace could not be refreshed.');
      setAccess(error.status === 401 ? 'unauthenticated' : error.status === 403 ? 'forbidden' : 'error');
    });
    return () => controller.abort();
  }, [refreshRequest]);

  useEffect(() => {
    const revalidateRestoredAdminPage = (event) => {
      if (!event.persisted) return;
      setAccess('loading');
      refreshDashboard();
    };
    window.addEventListener('pageshow', revalidateRestoredAdminPage);
    return () => window.removeEventListener('pageshow', revalidateRestoredAdminPage);
  }, [refreshDashboard]);

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
        <nav className="admin-sidebar-nav" aria-label="Admin sections">{navigation.map((entry) => <button key={entry.id} type="button" className={activeSection === entry.id ? 'is-active' : ''} onClick={() => navigateSection(entry.id)}><Icon name={entry.icon} size={18} /><span>{entry.label}</span></button>)}</nav>
        <div className="admin-sidebar-profile"><span className="admin-avatar">{admin?.name?.slice(0, 1)?.toUpperCase() || 'A'}</span><span><strong>{admin?.name || 'Administrator'}</strong><small>{admin?.username ? `@${admin.username}` : admin?.email}</small></span></div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar"><div><span className="admin-mobile-brand">MEDNEXORA ADMIN</span><nav className="admin-breadcrumbs" aria-label="Breadcrumb"><span>Admin workspace</span><span aria-hidden="true">/</span><strong>{navigation.find((entry) => entry.id === activeSection)?.label}</strong></nav><h1>{navigation.find((entry) => entry.id === activeSection)?.label}</h1></div><div className="admin-topbar-actions"><button className="admin-quiet-button admin-account-menu" type="button" onClick={() => navigateSection('settings')}><Icon name="user" size={15} /><span>{admin?.username ? `@${admin.username}` : 'Admin account'}</span></button><a href="/" className="admin-quiet-button">View website <Icon name="arrowUpRight" size={15} /></a><button className="admin-quiet-button" type="button" onClick={logout}>Log out</button></div></header>
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
          {readinessStatus === 'loading' && <section className="admin-readiness-section" aria-live="polite"><div className="admin-readiness-card admin-readiness-loading"><span className="loading-mark" /><p>Loading content readiness…</p></div></section>}
          {readinessStatus === 'error' && <section className="admin-readiness-section"><div className="admin-readiness-card admin-readiness-error" role="alert"><div><h2>Content readiness unavailable</h2><p>{readinessError}</p></div><button className="admin-secondary-button" type="button" onClick={() => refreshDashboard()}>Retry</button></div></section>}
          {readinessStatus === 'ready' && <ContentReadinessDashboard data={readiness} onNavigate={navigateSection} />}
          <div className="admin-overview-grid"><article className="admin-overview-card"><p className="eyebrow">CONTENT WORKFLOW</p><h2>Manage the catalogue</h2><p>Create resources, configure exam mappings, then publish when details are ready.</p><button className="admin-primary-button" type="button" onClick={() => navigateSection('products')}>Manage products <Icon name="arrow" size={16} /></button></article><article className="admin-overview-card"><p className="eyebrow">QUESTION PRACTICE</p><h2>Build tests from question banks</h2><p>Add MCQs with answer explanations, then set mock test duration, marks and negative-marking rules.</p><button className="admin-secondary-button" type="button" onClick={() => navigateSection('question-banks')}>Open question banks <Icon name="arrow" size={16} /></button></article><article className="admin-overview-card"><p className="eyebrow">ORDER RECORDS</p><h2>Review recorded purchases</h2><p>Orders show payment status and student purchase snapshots. This workspace does not collect or process payments.</p><button className="admin-secondary-button" type="button" onClick={() => navigateSection('orders')}>View orders <Icon name="arrow" size={16} /></button></article></div>
          <p className="admin-data-note"><Icon name="shield" size={16} /> Student registration cannot create administrator accounts. Admin access is verified by the backend on every request.</p>
        </>}

        {activeSection === 'orders' && <AdminOrderPanel />}
        {activeSection === 'students' && <AdminStudentPanel />}
        {activeSection === 'settings' && <AdminSettingsPanel admin={admin} onLogout={logout} />}
        {activeSection === 'courses' && <section className="admin-course-product-callout"><div><p className="eyebrow">LINKED COURSE LISTING</p><strong>Title, description, cover thumbnail, and free or paid pricing are stored on the course’s catalogue product.</strong><p>Create that product as a Draft under Study Materials, then select it here. Keep the course and product unpublished until their exam and curriculum are ready.</p></div><button className="admin-secondary-button" type="button" onClick={() => navigateSection('products')}>Open Study Materials <Icon name="arrow" size={15} /></button></section>}
        {activePanel && <AdminResourcePanel key={activePanel.id} resource={activePanel.id} title={activePanel.title} description={activePanel.hint} fields={activePanel.fields} columns={activePanel.columns} filters={activePanel.filters} sortOptions={activePanel.sortOptions} options={optionData} previewType={activePanel.previewType} onDirtyChange={setHasUnsavedWork} onSaved={refreshDashboard} />}
        {activeSection === 'curriculum' && <AdminCurriculumPanel exams={references.exams} subjects={references.subjects} chapters={references.chapters} topics={references.topics} courses={references.courses} products={references.products} questionBanks={references.questionBanks} onSaved={refreshDashboard} onNavigate={navigateSection} onDirtyChange={setHasUnsavedWork} />}
      </main>
    </div>
  );
}
