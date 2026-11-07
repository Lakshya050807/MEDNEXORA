import { useEffect, useMemo, useState } from 'react';
import Icon from '../Icon.jsx';
import { adminApi } from '../../services/adminApi.js';

const subjectSlots = [
  { slug: 'physics', label: 'Physics' },
  { slug: 'chemistry', label: 'Chemistry' },
  { slug: 'biology', label: 'Biology' },
];
const statuses = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];
const resourceByKind = { subject: 'subjects', chapter: 'chapters', topic: 'topics' };

function idOf(value) {
  const id = value?._id ?? value?.id ?? value;
  return id == null ? '' : String(id);
}

function compareOrder(left, right) {
  return Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0) || String(left.name ?? '').localeCompare(String(right.name ?? ''));
}

function slugify(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
}

function ErrorText({ children }) {
  return children ? <p className="admin-message is-error curriculum-feedback" role="alert">{children}</p> : null;
}

function RecordEditor({ editor, exams, chapters, topicReferenced = false, onCancel, onSubmit, saving }) {
  const { kind, record, subjectId, chapterId, examId } = editor;
  const [name, setName] = useState(record?.name ?? '');
  const [slug, setSlug] = useState(record?.slug ?? '');
  const [slugEdited, setSlugEdited] = useState(Boolean(record?.slug));
  const [description, setDescription] = useState(record?.description ?? '');
  const [sortOrder, setSortOrder] = useState(String(record?.sortOrder ?? 0));
  const [publicationStatus, setPublicationStatus] = useState(record?.publicationStatus ?? 'draft');
  const [selectedChapter, setSelectedChapter] = useState(idOf(record?.chapter) || chapterId || '');
  const [localError, setLocalError] = useState('');
  const isSubject = kind === 'subject';
  const title = record ? `Edit ${kind}` : `Add ${kind}`;
  const selectedExam = exams.find((exam) => idOf(exam) === (examId || idOf(record?.exam)));
  const availableChapters = chapters.filter((chapter) => idOf(chapter.subject) === (subjectId || idOf(record?.subject)));
  const topicParentFixed = kind === 'topic' && record && (idOf(record.chapter) || topicReferenced);

  const submit = (event) => {
    event.preventDefault();
    setLocalError('');
    const order = Number(sortOrder);
    if (!name.trim() || name.trim().length < 2) return setLocalError('Enter a name with at least 2 characters.');
    if (!Number.isSafeInteger(order) || order < 0 || order > 10000) return setLocalError('Display order must be a whole number from 0 to 10,000.');
    if (!isSubject && !slugify(slug)) return setLocalError('Enter a URL slug using letters and numbers.');
    if (kind === 'topic' && !topicParentFixed && !selectedChapter) return setLocalError('Choose a chapter for this topic.');

    const payload = {
      name: name.trim(),
      description: description.trim(),
      sortOrder: order,
      publicationStatus,
      exam: examId || idOf(record?.exam) || idOf(selectedExam),
    };
    if (kind === 'chapter' || kind === 'topic') payload.subject = subjectId || idOf(record?.subject);
    if (kind === 'chapter') payload.slug = slugify(slug);
    if (kind === 'topic') {
      payload.slug = slugify(slug);
      if (selectedChapter || idOf(record?.chapter)) payload.chapter = selectedChapter || idOf(record?.chapter);
    }
    // A flagship subject's slug is its stable Physics/Chemistry/Biology identity.
    // The admin can edit the display name and description without breaking course mappings.
    if (isSubject && record?.slug) payload.slug = record.slug;
    void onSubmit(payload);
  };

  return (
    <section className="curriculum-editor" aria-labelledby="curriculum-editor-title">
      <div className="curriculum-editor-head"><div><p className="eyebrow">CURRICULUM EDITOR</p><h3 id="curriculum-editor-title">{title}</h3><p>{selectedExam?.name ? `Examination: ${selectedExam.name}` : 'The course examination and parent records are fixed for this edit.'}</p></div><button className="admin-quiet-button" type="button" onClick={onCancel}>Cancel</button></div>
      <form className="curriculum-form" onSubmit={submit}>
        <label className="admin-field"><span>{isSubject ? 'Subject name' : `${kind[0].toUpperCase()}${kind.slice(1)} title`}</span><input value={name} onChange={(event) => { const next = event.target.value; setName(next); if (!slugEdited && !isSubject) setSlug(slugify(next)); }} maxLength={isSubject ? 120 : 160} required /></label>
        {!isSubject && <label className="admin-field"><span>URL slug</span><input value={slug} onChange={(event) => { setSlug(event.target.value); setSlugEdited(true); }} maxLength={160} pattern="[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*" required /><small>Created from the title by default; you can adjust it before saving.</small></label>}
        {kind === 'topic' && (topicParentFixed ? <label className="admin-field"><span>Chapter</span><input value={availableChapters.find((chapter) => idOf(chapter) === idOf(record?.chapter))?.name ?? (record?.chapter ? 'Configured chapter' : 'Unassigned')} readOnly /><small>Parent mappings are locked here to protect existing dependent content.</small></label> : <label className="admin-field"><span>Chapter</span><select value={selectedChapter} onChange={(event) => setSelectedChapter(event.target.value)} required><option value="">Choose a chapter</option>{availableChapters.map((chapter) => <option key={idOf(chapter)} value={idOf(chapter)}>{chapter.name} · {chapter.publicationStatus}</option>)}</select></label>)}
        <label className="admin-field curriculum-field-description"><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={kind === 'subject' ? 2000 : 3000} rows={3} /></label>
        <label className="admin-field"><span>Display order</span><input type="number" min="0" max="10000" step="1" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} required /></label>
        <label className="admin-field"><span>Publication state</span><select value={publicationStatus} onChange={(event) => setPublicationStatus(event.target.value)}>{statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select><small>Publishing is checked against the configured exam and parent hierarchy.</small></label>
        {localError && <ErrorText>{localError}</ErrorText>}
        <div className="curriculum-editor-actions"><button className="admin-quiet-button" type="button" onClick={onCancel}>Cancel</button><button className="admin-primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : record ? 'Save changes' : publicationStatus === 'published' ? 'Create & publish' : 'Create draft'}</button></div>
      </form>
    </section>
  );
}

function StatusBadge({ status }) {
  return <span className={`admin-status-pill status-${status || 'draft'}`}>{status || 'draft'}</span>;
}

function SummaryCard({ label, value, detail, icon }) {
  return <article className="admin-metric-card curriculum-summary-card"><span className="metric-icon"><Icon name={icon} size={18} /></span><small>{label}</small><strong>{value}</strong><span>{detail}</span></article>;
}

export default function AdminCurriculumPanel({ exams = [], subjects = [], chapters = [], topics = [], courses = [], products = [], questionBanks = [], onSaved, onNavigate }) {
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savingLessonId, setSavingLessonId] = useState('');
  const [publishingKey, setPublishingKey] = useState('');
  const [mappingSelections, setMappingSelections] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [courseOverride, setCourseOverride] = useState(null);
  const [publicationOverrides, setPublicationOverrides] = useState({});

  const configuredCourse = useMemo(() => courses.find((item) => item.product?.slug === 'bsc-nursing-entrance-preparation') ?? null, [courses]);
  useEffect(() => setCourseOverride(null), [configuredCourse]);
  const adminSubjects = useMemo(() => subjects.map((record) => ({ ...record, publicationStatus: publicationOverrides[`subject:${idOf(record)}`] ?? record.publicationStatus })), [subjects, publicationOverrides]);
  const adminChapters = useMemo(() => chapters.map((record) => ({ ...record, publicationStatus: publicationOverrides[`chapter:${idOf(record)}`] ?? record.publicationStatus })), [chapters, publicationOverrides]);
  const adminTopics = useMemo(() => topics.map((record) => ({ ...record, publicationStatus: publicationOverrides[`topic:${idOf(record)}`] ?? record.publicationStatus })), [topics, publicationOverrides]);
  useEffect(() => {
    const persistedStatuses = new Map([
      ...subjects.map((record) => [`subject:${idOf(record)}`, record.publicationStatus]),
      ...chapters.map((record) => [`chapter:${idOf(record)}`, record.publicationStatus]),
      ...topics.map((record) => [`topic:${idOf(record)}`, record.publicationStatus]),
    ]);
    setPublicationOverrides((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([key, status]) => persistedStatuses.get(key) !== status));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [subjects, chapters, topics]);
  const course = courseOverride ?? configuredCourse;
  const courseId = idOf(course);
  const examId = idOf(course?.exam);
  const courseExam = exams.find((exam) => idOf(exam) === examId);
  const courseSubjectIds = useMemo(() => new Set((course?.subjects ?? []).map(idOf)), [course]);
  const courseSubjects = useMemo(() => adminSubjects.filter((subject) => courseSubjectIds.has(idOf(subject)) && idOf(subject.exam) === examId), [adminSubjects, courseSubjectIds, examId]);
  const subjectSlotsInCourse = useMemo(() => subjectSlots.map((slot) => ({ ...slot, record: courseSubjects.find((subject) => subject.slug === slot.slug) ?? null })), [courseSubjects]);
  const activeSubjectIds = useMemo(() => new Set(courseSubjects.map(idOf)), [courseSubjects]);
  const courseChapters = useMemo(() => adminChapters.filter((chapter) => activeSubjectIds.has(idOf(chapter.subject)) && idOf(chapter.exam) === examId).sort(compareOrder), [adminChapters, activeSubjectIds, examId]);
  const courseTopics = useMemo(() => adminTopics.filter((topic) => activeSubjectIds.has(idOf(topic.subject)) && idOf(topic.exam) === examId).sort(compareOrder), [adminTopics, activeSubjectIds, examId]);
  const curriculumRecords = [...courseSubjects, ...courseChapters, ...courseTopics];
  const publishedCount = curriculumRecords.filter((item) => item.publicationStatus === 'published').length;
  const draftCount = curriculumRecords.filter((item) => item.publicationStatus === 'draft').length;

  const refresh = () => { setEditor(null); setNotice('Saved successfully.'); setError(''); onSaved?.(); };

  const saveRecord = async (payload) => {
    if (!editor) return;
    setSaving(true);
    setError('');
    setNotice('');
    const resource = resourceByKind[editor.kind];
    try {
      if (editor.record) await adminApi.update(resource, idOf(editor.record), payload);
      else await adminApi.create(resource, payload);
      refresh();
    } catch (requestError) {
      setError(requestError.message || `Could not save this ${editor.kind}.`);
    } finally {
      setSaving(false);
    }
  };

  const changePublication = async (kind, record, nextStatus) => {
    const recordId = idOf(record);
    const key = `${kind}:${recordId}`;
    setPublishingKey(key);
    setError(''); setNotice('');
    try {
      const response = await adminApi.update(resourceByKind[kind], recordId, { publicationStatus: nextStatus });
      const savedStatus = response?.[kind]?.publicationStatus ?? nextStatus;
      setPublicationOverrides((current) => ({ ...current, [key]: savedStatus }));
      setNotice(`${record.name} is now ${savedStatus}.`);
      onSaved?.();
    } catch (requestError) {
      setError(requestError.message || `Could not ${nextStatus === 'published' ? 'publish' : 'unpublish'} this ${kind}.`);
    } finally { setPublishingKey(''); }
  };

  const removeRecord = async (kind, record) => {
    if (!window.confirm(`Delete “${record.name}”? This action cannot be undone.`)) return;
    setError(''); setNotice('');
    try {
      await adminApi.remove(resourceByKind[kind], idOf(record));
      setNotice(`${record.name} was deleted.`);
      onSaved?.();
    } catch (requestError) { setError(requestError.message || 'This record could not be deleted.'); }
  };

  const saveLessonTopic = async (targetModule, moduleIndex, lesson, selectedTopicId) => {
    if (!course || !courseId) return;
    const lessonId = idOf(lesson);
    setSavingLessonId(lessonId);
    setError(''); setNotice('');
    const targetModuleId = idOf(targetModule);
    const modules = (course.modules ?? []).map((module, currentModuleIndex) => ({
      ...module,
      subject: idOf(module.subject) || null,
      chapter: idOf(module.chapter) || null,
      lessons: (module.lessons ?? []).map((currentLesson) => ({
        ...currentLesson,
        topic: (targetModuleId ? idOf(module) === targetModuleId : currentModuleIndex === moduleIndex) && idOf(currentLesson) === lessonId ? (selectedTopicId || null) : (idOf(currentLesson.topic) || null),
      })),
    }));
    try {
      const response = await adminApi.update('courses', courseId, { modules });
      if (response.course) setCourseOverride(response.course);
      setMappingSelections((current) => ({ ...current, [lessonId]: selectedTopicId }));
      setNotice('Lesson topic mapping saved. This does not create a lesson or grant course access.');
      onSaved?.();
    } catch (requestError) { setError(requestError.message || 'The lesson topic mapping could not be saved.'); }
    finally { setSavingLessonId(''); }
  };

  const getLessonSelection = (lesson) => Object.hasOwn(mappingSelections, idOf(lesson)) ? mappingSelections[idOf(lesson)] : idOf(lesson.topic);
  const hasProductRef = (field, recordId) => products.some((product) => idOf(product[field]) === recordId || (field === 'topic' && (product.topics ?? []).some((topic) => idOf(topic) === recordId)));
  const hasQuestionRef = (recordId) => questionBanks.some((bank) => (bank.questions ?? []).some((question) => idOf(question.topic) === recordId));
  const hasCourseRef = (field, recordId) => courses.some((item) => (item.modules ?? []).some((module) => idOf(module[field]) === recordId || (field === 'topic' && (module.lessons ?? []).some((lesson) => idOf(lesson.topic) === recordId))));

  if (!course) return (
    <section className="admin-resource-panel curriculum-panel">
      <div className="admin-panel-heading"><div><p className="eyebrow">FLAGSHIP COURSE</p><h2>Curriculum management</h2><p>Manage the existing B.Sc. Nursing Entrance Preparation hierarchy.</p></div></div>
      <div className="admin-state is-error"><p>The flagship course record was not found in the current admin catalogue. This editor will not create course or syllabus records automatically.</p></div>
    </section>
  );

  return (
    <section className="admin-resource-panel curriculum-panel" aria-labelledby="curriculum-title">
      <div className="admin-panel-heading curriculum-panel-heading"><div><p className="eyebrow">COURSE CURRICULUM</p><h2 id="curriculum-title">B.Sc. Nursing Entrance Preparation</h2><p>Manage existing subjects, chapters, topics and lesson mappings. Curriculum edits never enroll students or change progress.</p></div><span className={`curriculum-course-status status-${course.publicationStatus || 'draft'}`}>{course.publicationStatus || 'draft'} course</span></div>
      {error && <ErrorText>{error}</ErrorText>}{notice && <p className="admin-message curriculum-feedback" role="status">{notice}</p>}
      {courseExam && <div className="curriculum-publication-prerequisite" role="note"><div><strong>Publication order</strong><p>The examination and subject must be published manually before a chapter; the chapter must be published manually before its topics. This panel never publishes parent records or the course for you.</p><div className="curriculum-parent-statuses"><span>Examination: <StatusBadge status={courseExam.publicationStatus} /></span><span>Course: <StatusBadge status={course.publicationStatus} /></span><span>Subjects: {courseSubjects.map((subject) => <span className="curriculum-subject-status" key={idOf(subject)}>{subject.name} <StatusBadge status={subject.publicationStatus} /></span>)}</span></div></div>{courseExam.publicationStatus !== 'published' && <button type="button" className="admin-quiet-button" onClick={() => onNavigate?.('exams')}>Manage examination</button>}</div>}

      <div className="curriculum-summary-grid">
        <SummaryCard label="Total subjects" value={courseSubjects.length} detail="Configured for this course" icon="book" />
        <SummaryCard label="Total chapters" value={courseChapters.length} detail="Across configured subjects" icon="clipboard" />
        <SummaryCard label="Total topics" value={courseTopics.length} detail="Including unassigned topics" icon="checklist" />
        <SummaryCard label="Published" value={publishedCount} detail="Subjects, chapters and topics" icon="shield" />
        <SummaryCard label="Draft" value={draftCount} detail="Subjects, chapters and topics" icon="file" />
      </div>

      {editor && <RecordEditor key={`${editor.kind}-${idOf(editor.record) || 'new'}-${editor.chapterId || editor.subjectId || ''}`} editor={editor} exams={exams} chapters={courseChapters} topicReferenced={editor.kind === 'topic' && editor.record ? hasProductRef('topic', idOf(editor.record)) || hasQuestionRef(idOf(editor.record)) || hasCourseRef('topic', idOf(editor.record)) : false} onCancel={() => setEditor(null)} onSubmit={saveRecord} saving={saving} />}

      <div className="curriculum-subject-grid">
        {subjectSlotsInCourse.map(({ slug, label, record }) => {
          const subjectId = idOf(record);
          const subjectChapters = courseChapters.filter((chapter) => idOf(chapter.subject) === subjectId);
          const subjectTopics = courseTopics.filter((topic) => idOf(topic.subject) === subjectId);
          const unassignedTopics = subjectTopics.filter((topic) => !idOf(topic.chapter));
          return (
            <article className="curriculum-subject-card" key={slug} aria-label={`${label} curriculum`}>
              <header className="curriculum-subject-head"><div><span className="curriculum-subject-mark">{label.slice(0, 1)}</span><div><p className="eyebrow">PRIMARY SUBJECT</p><h3>{record?.name || label}</h3>{record && record.name !== label && <small className="curriculum-canonical-note">Subject identity: {label}</small>}</div></div>{record ? <StatusBadge status={record.publicationStatus} /> : <span className="admin-status-pill status-draft">Not configured</span>}</header>
              {!record ? <div className="curriculum-empty-subject"><p>This subject is not linked to the course’s configured subject list. No subject record was created.</p></div> : <>
                <p className="curriculum-subject-description">{record.description || 'No subject description has been added.'}</p>
                <div className="curriculum-subject-counts"><span><strong>{subjectChapters.length}</strong> chapters</span><span><strong>{subjectTopics.length}</strong> topics</span></div>
                <div className="curriculum-subject-actions">
                  <button className="admin-quiet-button" type="button" onClick={() => setEditor({ kind: 'subject', record, subjectId, examId })}>Edit subject</button>
                  <button className="admin-quiet-button" type="button" aria-label={`${record.publicationStatus === 'published' ? 'Unpublish' : 'Publish'} subject ${record.name}`} disabled={publishingKey === `subject:${subjectId}`} onClick={() => void changePublication('subject', record, record.publicationStatus === 'published' ? 'draft' : 'published')}>{publishingKey === `subject:${subjectId}` ? 'Saving…' : record.publicationStatus === 'published' ? 'Unpublish subject' : 'Publish subject'}</button>
                  <button className="admin-primary-button" type="button" onClick={() => setEditor({ kind: 'chapter', subjectId, examId })}>Add chapter</button>
                </div>
                <small className="curriculum-protected-note"><Icon name="shield" size={12} /> Protected while linked to this course and dependent content.</small>
                <div className="curriculum-chapter-list">
                  {!subjectChapters.length ? <div className="curriculum-inline-empty"><p>No chapters have been configured for {label}.</p><button type="button" className="curriculum-text-button" onClick={() => setEditor({ kind: 'chapter', subjectId, examId })}>Add the first chapter <Icon name="arrow" size={14} /></button></div> : subjectChapters.map((chapter) => {
                    const chapterId = idOf(chapter);
                    const chapterTopics = subjectTopics.filter((topic) => idOf(topic.chapter) === chapterId);
                    const chapterUsedByCourse = hasCourseRef('chapter', chapterId);
                    const chapterUsedByProduct = hasProductRef('chapter', chapterId);
                    const chapterProtected = chapterTopics.length > 0 || chapterUsedByCourse || chapterUsedByProduct;
                    return (
                      <section className="curriculum-chapter" key={chapterId} aria-label={`Chapter ${chapter.name}`}>
                        <div className="curriculum-record-heading"><div><span className="curriculum-order">{Number(chapter.sortOrder ?? 0)}</span><div><h4>{chapter.name}</h4><small>{chapterTopics.length} topics{chapter.description ? ` · ${chapter.description}` : ''}</small></div></div><StatusBadge status={chapter.publicationStatus} /></div>
                        <div className="curriculum-record-actions"><button type="button" className="admin-quiet-button" aria-label={`Edit chapter ${chapter.name}`} onClick={() => setEditor({ kind: 'chapter', record: chapter, subjectId, examId })}>Edit</button><button type="button" className="admin-quiet-button" aria-label={`Publish chapter ${chapter.name}`} disabled={chapter.publicationStatus === 'published' || publishingKey === `chapter:${chapterId}`} onClick={() => void changePublication('chapter', chapter, 'published')}>{publishingKey === `chapter:${chapterId}` ? 'Publishing…' : 'Publish'}</button><button type="button" className="admin-quiet-button" aria-label={`Unpublish chapter ${chapter.name}`} disabled={chapter.publicationStatus !== 'published' || publishingKey === `chapter:${chapterId}`} onClick={() => void changePublication('chapter', chapter, 'draft')}>{publishingKey === `chapter:${chapterId}` ? 'Saving…' : 'Unpublish'}</button><button type="button" className="admin-quiet-button" aria-label={`Delete chapter ${chapter.name}`} disabled={chapterProtected} title={chapterProtected ? 'This chapter has dependent topics, course modules or study materials.' : 'Delete chapter'} onClick={() => void removeRecord('chapter', chapter)}>Delete</button><button type="button" className="curriculum-text-button" onClick={() => setEditor({ kind: 'topic', subjectId, chapterId, examId })}>Add topic <Icon name="plus" size={13} /></button></div>
                        <div className="curriculum-topic-list">{chapterTopics.length ? chapterTopics.map((topic) => {
                          const topicId = idOf(topic);
                          const topicUsed = hasProductRef('topic', topicId) || hasQuestionRef(topicId) || hasCourseRef('topic', topicId);
                          return <div className="curriculum-topic-row" key={topicId}><div><span className="curriculum-topic-dot" /><span><strong>{topic.name}</strong><small>Order {topic.sortOrder ?? 0}{topic.description ? ` · ${topic.description}` : ''}</small></span></div><StatusBadge status={topic.publicationStatus} /><div className="curriculum-record-actions"><button type="button" className="admin-quiet-button" aria-label={`Edit topic ${topic.name}`} onClick={() => setEditor({ kind: 'topic', record: topic, subjectId, chapterId, examId })}>Edit</button><button type="button" className="admin-quiet-button" aria-label={`Publish topic ${topic.name}`} disabled={topic.publicationStatus === 'published' || publishingKey === `topic:${topicId}`} onClick={() => void changePublication('topic', topic, 'published')}>{publishingKey === `topic:${topicId}` ? 'Publishing…' : 'Publish'}</button><button type="button" className="admin-quiet-button" aria-label={`Unpublish topic ${topic.name}`} disabled={topic.publicationStatus !== 'published' || publishingKey === `topic:${topicId}`} onClick={() => void changePublication('topic', topic, 'draft')}>{publishingKey === `topic:${topicId}` ? 'Saving…' : 'Unpublish'}</button><button type="button" className="admin-quiet-button" aria-label={`Delete topic ${topic.name}`} disabled={topicUsed} title={topicUsed ? 'This topic is referenced by study material, questions or a course lesson.' : 'Delete topic'} onClick={() => void removeRecord('topic', topic)}>Delete</button></div></div>;
                        }) : <p className="curriculum-no-topics">No topics in this chapter yet.</p>}</div>
                      </section>
                    );
                  })}
                </div>
                {unassignedTopics.length > 0 && <div className="curriculum-unassigned"><h4>Topics needing a chapter</h4><p>Assign each existing topic to a chapter before mapping it to a course lesson.</p>{unassignedTopics.map((topic) => <div className="curriculum-unassigned-row" key={idOf(topic)}><span>{topic.name} <StatusBadge status={topic.publicationStatus} /></span><button className="admin-quiet-button" type="button" onClick={() => setEditor({ kind: 'topic', record: topic, subjectId, examId })}>Assign chapter</button></div>)}</div>}
              </>}
            </article>
          );
        })}
      </div>

      <section className="curriculum-mapping-card" aria-labelledby="curriculum-mapping-title">
        <div className="curriculum-mapping-heading"><div><p className="eyebrow">EXISTING COURSE LESSONS</p><h3 id="curriculum-mapping-title">Map lessons to topics</h3><p>Select a topic that belongs to the lesson module’s existing subject and chapter. This only changes the lesson mapping.</p></div><span className="curriculum-mapping-note"><Icon name="shield" size={15} /> No enrollment or progress changes</span></div>
        {(course.modules ?? []).length ? <div className="curriculum-module-list">{[...course.modules].sort(compareOrder).map((module, moduleIndex) => {
          const moduleSubjectId = idOf(module.subject);
          const moduleChapterId = idOf(module.chapter);
          const moduleSubject = subjects.find((subject) => idOf(subject) === moduleSubjectId);
          const moduleChapter = courseChapters.find((chapter) => idOf(chapter) === moduleChapterId);
          const eligibleTopics = courseTopics.filter((topic) => idOf(topic.subject) === moduleSubjectId && idOf(topic.chapter) === moduleChapterId);
          return <section className="curriculum-module" key={idOf(module) || `${module.title}-${moduleIndex}`}><header><div><h4>{module.title}</h4><p>{moduleSubject?.name || 'Subject not mapped'}{moduleChapter ? ` · ${moduleChapter.name}` : ' · Chapter not mapped'}</p></div><span>{(module.lessons ?? []).length} lessons</span></header>
            {(module.lessons ?? []).length ? <div className="curriculum-lesson-list">{module.lessons.map((lesson) => {
              const lessonId = idOf(lesson);
              const selectedTopicId = getLessonSelection(lesson);
              const currentTopic = courseTopics.find((topic) => idOf(topic) === selectedTopicId);
              const options = course.publicationStatus === 'published' && (!lesson.publicationStatus || lesson.publicationStatus === 'published')
                ? eligibleTopics.filter((topic) => topic.publicationStatus === 'published')
                : eligibleTopics;
              const mappingOptions = currentTopic && !options.some((topic) => idOf(topic) === selectedTopicId) ? [...options, currentTopic] : options;
              const canMap = Boolean(moduleSubjectId && moduleChapterId && activeSubjectIds.has(moduleSubjectId));
              return <div className="curriculum-lesson-row" key={lessonId || lesson.title}><div className="curriculum-lesson-info"><strong>{lesson.title}</strong><small>{lesson.publicationStatus || 'legacy published'}{currentTopic ? ` · ${currentTopic.name}` : ' · No topic mapping'}</small></div><label className="admin-field curriculum-lesson-select"><span className="sr-only">Topic for {lesson.title}</span><select aria-label={`Topic for ${lesson.title}`} value={selectedTopicId} disabled={!canMap || Boolean(savingLessonId)} onChange={(event) => setMappingSelections((current) => ({ ...current, [lessonId]: event.target.value }))}><option value="">No topic mapping</option>{mappingOptions.map((topic) => <option key={idOf(topic)} value={idOf(topic)}>{topic.name} · {topic.publicationStatus}</option>)}</select></label><button type="button" className="admin-primary-button" disabled={!canMap || Boolean(savingLessonId) || selectedTopicId === idOf(lesson.topic)} onClick={() => void saveLessonTopic(module, moduleIndex, lesson, selectedTopicId)}>{savingLessonId === lessonId ? 'Saving…' : 'Save mapping'}</button>{!canMap && <small className="curriculum-mapping-warning">Choose a configured course subject and chapter in Courses before mapping a lesson.</small>}</div>;
            })}</div> : <p className="curriculum-no-topics">No lessons exist in this module. Add lessons from the existing Courses section.</p>}
          </section>;
        })}</div> : <div className="admin-state"><Icon name="play" size={22} /><p>No lessons are configured yet. This editor will not create lessons automatically.</p></div>}
      </section>
    </section>
  );
}
