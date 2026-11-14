import { useMemo, useState } from 'react';
import { adminApi } from '../../services/adminApi.js';
import Icon from '../Icon.jsx';

function idOf(value) {
  const id = value?._id ?? value?.id ?? value;
  return id == null ? '' : String(id);
}

function ordered(items = []) {
  return [...items].sort((left, right) => Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0) || String(left.title ?? '').localeCompare(String(right.title ?? '')));
}

function ErrorMessage({ children }) {
  return children ? <p className="admin-message is-error" role="alert">{children}</p> : null;
}

const blankLesson = (moduleId, sortOrder) => ({
  moduleId, title: '', description: '', contentText: '', topic: '', durationMinutes: '',
  videoProvider: 'none', videoAssetId: '', isPreview: false, publicationStatus: 'draft', sortOrder,
});

export default function AdminCourseLessonsPanel({ course, subjects = [], chapters = [], topics = [], products = [], onSaved, onNavigate, onDirtyChange }) {
  const [moduleDraft, setModuleDraft] = useState(null);
  const [lessonDraft, setLessonDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const courseId = idOf(course);
  const modules = useMemo(() => ordered(course?.modules ?? []), [course?.modules]);
  const unsaved = Boolean(moduleDraft || lessonDraft);
  const draftCourse = course?.publicationStatus !== 'published';
  const notifyDirty = (value) => onDirtyChange?.(value);

  const beginModule = (module = null) => {
    if (unsaved && !window.confirm('Discard the current unsaved lesson or module edits?')) return;
    setError(''); setNotice(''); setLessonDraft(null);
    setModuleDraft(module ? {
      id: idOf(module), title: module.title ?? '', description: module.description ?? '',
      subject: idOf(module.subject), chapter: idOf(module.chapter), sortOrder: String(module.sortOrder ?? 0),
    } : { id: '', title: '', description: '', subject: '', chapter: '', sortOrder: String(modules.length) });
    notifyDirty(true);
  };

  const beginLesson = (module, lesson = null) => {
    if (unsaved && !window.confirm('Discard the current unsaved lesson or module edits?')) return;
    setError(''); setNotice(''); setModuleDraft(null);
    setLessonDraft(lesson ? {
      moduleId: idOf(module), id: idOf(lesson), title: lesson.title ?? '', description: lesson.description ?? '',
      contentText: lesson.contentText ?? '', topic: idOf(lesson.topic), durationMinutes: lesson.durationMinutes ?? '',
      videoProvider: lesson.videoProvider ?? 'none', videoAssetId: lesson.videoAssetId ?? '',
      isPreview: Boolean(lesson.isPreview), publicationStatus: lesson.publicationStatus ?? 'published',
      sortOrder: String(lesson.sortOrder ?? 0),
    } : blankLesson(idOf(module), (module.lessons ?? []).reduce((max, item) => Math.max(max, Number(item.sortOrder ?? 0)), -1) + 1));
    notifyDirty(true);
  };

  const finishEdit = () => {
    if (unsaved && !window.confirm('Discard these unsaved curriculum edits?')) return;
    setModuleDraft(null); setLessonDraft(null); setError('');
    notifyDirty(false);
  };

  const saveModules = async (nextModules, successMessage) => {
    setSaving(true); setError(''); setNotice('');
    try {
      await adminApi.update('courses', courseId, { modules: nextModules });
      setModuleDraft(null); setLessonDraft(null); notifyDirty(false);
      setNotice(successMessage);
      onSaved?.('courses');
    } catch (requestError) {
      setError(requestError.message || 'The curriculum changes could not be saved.');
    } finally { setSaving(false); }
  };

  const saveModule = async (event) => {
    event.preventDefault();
    const draft = moduleDraft;
    const order = Number(draft.sortOrder);
    if (draft.title.trim().length < 2) return setError('Enter a module title with at least 2 characters.');
    if (!draft.subject || !draft.chapter) return setError('Choose the module subject and its chapter.');
    if (!Number.isSafeInteger(order) || order < 0 || order > 10000) return setError('Module order must be a whole number from 0 to 10,000.');
    const existing = course.modules ?? [];
    const next = draft.id
      ? existing.map((module) => idOf(module) === draft.id ? { ...module, title: draft.title.trim(), description: draft.description.trim(), subject: draft.subject, chapter: draft.chapter, sortOrder: order } : module)
      : [...existing, { title: draft.title.trim(), description: draft.description.trim(), subject: draft.subject, chapter: draft.chapter, sortOrder: order, lessons: [] }];
    await saveModules(next, draft.id ? 'Module changes saved.' : 'Module added as a draft.');
  };

  const saveLesson = async (event) => {
    event.preventDefault();
    const draft = lessonDraft;
    const module = (course.modules ?? []).find((item) => idOf(item) === draft.moduleId);
    if (!module) return setError('The selected course module no longer exists. Refresh the page and try again.');
    const order = Number(draft.sortOrder);
    const duration = draft.durationMinutes === '' ? null : Number(draft.durationMinutes);
    if (draft.title.trim().length < 2) return setError('Enter a lesson title with at least 2 characters.');
    if (draft.contentText.length > 30000) return setError('Lesson text must be 30,000 characters or fewer.');
    if (!Number.isSafeInteger(order) || order < 0 || order > 10000) return setError('Lesson order must be a whole number from 0 to 10,000.');
    if (duration !== null && (!Number.isSafeInteger(duration) || duration < 0 || duration > 10000)) return setError('Duration must be a whole number from 0 to 10,000 minutes.');
    const allowedTopics = topics.filter((topic) => idOf(topic.subject) === idOf(module.subject) && idOf(topic.chapter) === idOf(module.chapter));
    if (draft.topic && !allowedTopics.some((topic) => idOf(topic) === draft.topic)) return setError('Choose a topic from this module’s subject and chapter.');
    if (draft.videoProvider !== 'none' && !draft.videoAssetId.trim()) return setError('Enter the provider ID or private asset reference for this video lesson.');
    const lesson = {
      ...(draft.id ? { _id: draft.id } : {}), title: draft.title.trim(), description: draft.description.trim(),
      contentText: draft.contentText.trim(), topic: draft.topic || null, durationMinutes: duration,
      videoProvider: draft.videoProvider, videoAssetId: draft.videoAssetId.trim(), isPreview: Boolean(draft.isPreview),
      publicationStatus: draft.publicationStatus, sortOrder: order,
    };
    const next = (course.modules ?? []).map((item) => idOf(item) === draft.moduleId
      ? { ...item, subject: idOf(item.subject), chapter: idOf(item.chapter), lessons: draft.id
        ? (item.lessons ?? []).map((oldLesson) => idOf(oldLesson) === draft.id ? { ...oldLesson, ...lesson } : oldLesson)
        : [...(item.lessons ?? []), lesson] }
      : { ...item, subject: idOf(item.subject), chapter: idOf(item.chapter), lessons: item.lessons ?? [] });
    await saveModules(next, draft.id ? 'Lesson changes saved.' : 'Lesson saved as a draft.');
  };

  const deleteLesson = async (module, lesson) => {
    if (!draftCourse) return setError('Unpublish the course before deleting a lesson; use Archived to retain student history.');
    const hasUnsaved = unsaved;
    const prompt = hasUnsaved
      ? 'Delete this saved lesson and discard your unsaved editor changes? Deletion is blocked if student progress refers to it.'
      : `Permanently delete “${lesson.title}”? Deletion is blocked if student progress refers to it.`;
    if (!window.confirm(prompt)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await adminApi.removeCourseLesson(courseId, idOf(lesson));
      setModuleDraft(null); setLessonDraft(null); notifyDirty(false);
      setNotice(result.message || 'Lesson deleted.');
      onSaved?.('courses');
    } catch (requestError) { setError(requestError.message || 'This lesson could not be deleted.'); }
    finally { setSaving(false); }
  };

  const moveLesson = async (module, lesson, direction) => {
    const sorted = ordered(module.lessons ?? []);
    const from = sorted.findIndex((item) => idOf(item) === idOf(lesson));
    const to = from + direction;
    if (to < 0 || to >= sorted.length) return;
    [sorted[from], sorted[to]] = [sorted[to], sorted[from]];
    const orderById = new Map(sorted.map((item, index) => [idOf(item), index]));
    const next = (course.modules ?? []).map((item) => ({ ...item, subject: idOf(item.subject), chapter: idOf(item.chapter), lessons: idOf(item) === idOf(module) ? (item.lessons ?? []).map((itemLesson) => ({ ...itemLesson, sortOrder: orderById.get(idOf(itemLesson)) })) : item.lessons ?? [] }));
    await saveModules(next, 'Lesson order saved.');
  };

  const selectedModule = lessonDraft ? (course.modules ?? []).find((item) => idOf(item) === lessonDraft.moduleId) : null;
  const availableChapters = moduleDraft ? chapters.filter((chapter) => idOf(chapter.subject) === moduleDraft.subject && idOf(chapter.exam) === idOf(course.exam)) : [];
  const availableTopics = selectedModule ? topics.filter((topic) => idOf(topic.subject) === idOf(selectedModule.subject) && idOf(topic.chapter) === idOf(selectedModule.chapter)) : [];
  const linkedMaterials = lessonDraft?.topic ? products.filter((product) => idOf(product.topic) === lessonDraft.topic || (product.topics ?? []).some((topic) => idOf(topic) === lessonDraft.topic)) : [];

  return (
    <section className="admin-course-lessons" aria-labelledby="admin-course-lessons-title">
      <div className="admin-panel-heading"><div><p className="eyebrow">COURSE LESSONS</p><h3 id="admin-course-lessons-title">Modules and lesson content</h3><p>Modules are mapped to an existing course subject and chapter. Lesson text is plain text; video credentials and public file URLs are not accepted here.</p></div><button type="button" className="admin-primary-button" onClick={() => beginModule()}>Add module</button></div>
      {error && <ErrorMessage>{error}</ErrorMessage>}{notice && <p className="admin-message" role="status">{notice}</p>}
      {moduleDraft && <form className="admin-editor-card admin-course-inline-editor" onSubmit={saveModule}><div className="admin-editor-heading"><div><p className="eyebrow">MODULE EDITOR</p><h4>{moduleDraft.id ? 'Edit module' : 'Add module'}</h4></div><button type="button" className="admin-quiet-button" onClick={finishEdit}>Cancel</button></div><div className="admin-form-grid"><label className="admin-field"><span>Module title</span><input required minLength={2} maxLength={200} value={moduleDraft.title} onChange={(event) => setModuleDraft((current) => ({ ...current, title: event.target.value }))} /></label><label className="admin-field"><span>Display order</span><input type="number" min="0" max="10000" step="1" required value={moduleDraft.sortOrder} onChange={(event) => setModuleDraft((current) => ({ ...current, sortOrder: event.target.value }))} /></label><label className="admin-field"><span>Subject</span><select required value={moduleDraft.subject} onChange={(event) => setModuleDraft((current) => ({ ...current, subject: event.target.value, chapter: '' }))}><option value="">Choose a course subject</option>{subjects.filter((subject) => (course.subjects ?? []).some((value) => idOf(value) === idOf(subject)) && idOf(subject.exam) === idOf(course.exam)).map((subject) => <option key={idOf(subject)} value={idOf(subject)}>{subject.name} · {subject.publicationStatus}</option>)}</select></label><label className="admin-field"><span>Chapter</span><select required value={moduleDraft.chapter} onChange={(event) => setModuleDraft((current) => ({ ...current, chapter: event.target.value }))}><option value="">Choose a chapter</option>{availableChapters.map((chapter) => <option key={idOf(chapter)} value={idOf(chapter)}>{chapter.name} · {chapter.publicationStatus}</option>)}</select></label><label className="admin-field admin-field-wide"><span>Description</span><textarea rows="2" maxLength="2000" value={moduleDraft.description} onChange={(event) => setModuleDraft((current) => ({ ...current, description: event.target.value }))} /></label></div><div className="admin-form-actions"><button className="admin-primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save module'}</button></div></form>}
      {lessonDraft && selectedModule && <form className="admin-editor-card admin-course-inline-editor" onSubmit={saveLesson}><div className="admin-editor-heading"><div><p className="eyebrow">LESSON EDITOR</p><h4>{lessonDraft.id ? 'Edit lesson' : 'Add lesson'} · {selectedModule.title}</h4></div><button type="button" className="admin-quiet-button" onClick={finishEdit}>Cancel</button></div><div className="admin-form-grid"><label className="admin-field"><span>Lesson title</span><input required minLength={2} maxLength={200} value={lessonDraft.title} onChange={(event) => setLessonDraft((current) => ({ ...current, title: event.target.value }))} /></label><label className="admin-field"><span>Display order</span><input type="number" min="0" max="10000" step="1" required value={lessonDraft.sortOrder} onChange={(event) => setLessonDraft((current) => ({ ...current, sortOrder: event.target.value }))} /></label><label className="admin-field"><span>Topic (optional)</span><select aria-label="Topic (optional)" value={lessonDraft.topic} onChange={(event) => setLessonDraft((current) => ({ ...current, topic: event.target.value }))}><option value="">No topic mapping</option>{availableTopics.map((topic) => <option key={idOf(topic)} value={idOf(topic)}>{topic.name} · {topic.publicationStatus}</option>)}</select><small>Only topics in this module’s subject and chapter are listed.</small></label><label className="admin-field"><span>Duration (minutes)</span><input type="number" min="0" max="10000" step="1" value={lessonDraft.durationMinutes} onChange={(event) => setLessonDraft((current) => ({ ...current, durationMinutes: event.target.value }))} /></label><label className="admin-field admin-field-wide"><span>Short description</span><textarea rows="2" maxLength="2000" value={lessonDraft.description} onChange={(event) => setLessonDraft((current) => ({ ...current, description: event.target.value }))} /></label><label className="admin-field admin-field-wide"><span>Lesson text</span><textarea aria-label="Lesson text" className="admin-lesson-content-input" rows="9" maxLength="30000" value={lessonDraft.contentText} onChange={(event) => setLessonDraft((current) => ({ ...current, contentText: event.target.value }))} /><small>{lessonDraft.contentText.length}/30,000 characters. Text is escaped and returned only after student course access is verified.</small></label><label className="admin-field"><span>Video provider</span><select value={lessonDraft.videoProvider} onChange={(event) => setLessonDraft((current) => ({ ...current, videoProvider: event.target.value, videoAssetId: event.target.value === 'none' ? '' : current.videoAssetId }))}><option value="none">No video</option><option value="youtube">YouTube provider ID</option><option value="vimeo">Vimeo provider ID</option><option value="private-hosted">Private hosted asset reference</option><option value="other">Other configured provider ID</option></select></label><label className="admin-field"><span>Provider ID / private asset reference</span><input maxLength="300" value={lessonDraft.videoAssetId} disabled={lessonDraft.videoProvider === 'none'} onChange={(event) => setLessonDraft((current) => ({ ...current, videoAssetId: event.target.value }))} /><small>Do not enter a video URL, private file URL, or secret credential.</small></label><label className="admin-field"><span>Publication status</span><select value={lessonDraft.publicationStatus} onChange={(event) => setLessonDraft((current) => ({ ...current, publicationStatus: event.target.value }))}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label><label className="admin-checkbox-field"><input type="checkbox" checked={lessonDraft.isPreview} onChange={(event) => setLessonDraft((current) => ({ ...current, isPreview: event.target.checked }))} /><span>Free preview lesson</span><small>Only provider playback configured as a preview may be opened publicly.</small></label></div>{linkedMaterials.length > 0 && <div className="admin-lesson-linked-materials"><strong>Published materials mapped to this topic</strong><ul>{linkedMaterials.filter((product) => product.publicationStatus === 'published').map((product) => <li key={idOf(product)}>{product.title} · {product.currentPricePaise === 0 ? 'Free' : 'Paid'}</li>)}</ul></div>}<div className="admin-lesson-preview"><p className="eyebrow">LESSON PREVIEW</p><h5>{lessonDraft.title || 'Lesson title'}</h5><p>{lessonDraft.description || 'Lesson description will appear here.'}</p>{lessonDraft.contentText ? <pre>{lessonDraft.contentText}</pre> : <p>Text content has not been entered.</p>}</div><div className="admin-form-actions"><button className="admin-primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : lessonDraft.id ? 'Save lesson' : 'Add lesson as draft'}</button></div></form>}
      {!modules.length && !moduleDraft && <div className="admin-state"><Icon name="play" size={22} /><p>No modules are configured. Add a module after the course subject and chapter exist.</p></div>}
      <div className="admin-course-module-cards">{modules.map((module, moduleIndex) => {
        const chapter = chapters.find((item) => idOf(item) === idOf(module.chapter));
        const subject = subjects.find((item) => idOf(item) === idOf(module.subject));
        const lessons = ordered(module.lessons ?? []);
        return <section className="admin-course-module-card" key={idOf(module) || `${module.title}-${moduleIndex}`}><header><div><p className="eyebrow">MODULE {Number(module.sortOrder ?? moduleIndex) + 1}</p><h4>{module.title}</h4><p>{subject?.name || 'Subject missing'}{chapter ? ` · ${chapter.name}` : ''}{module.description ? ` · ${module.description}` : ''}</p></div><div className="admin-row-actions"><button className="admin-quiet-button" type="button" onClick={() => beginModule(module)}>Edit module</button><button className="admin-primary-button" type="button" onClick={() => beginLesson(module)}>Add lesson</button></div></header><div className="admin-course-lesson-list">{lessons.length ? lessons.map((lesson, index) => <article className="admin-course-lesson-row" key={idOf(lesson) || `${lesson.title}-${index}`}><div><span className={`admin-status-pill status-${lesson.publicationStatus || 'published'}`}>{lesson.publicationStatus || 'legacy published'}</span><h5>{lesson.title}</h5><p>{lesson.description || (lesson.contentText ? 'Text lesson configured' : 'No text content')} · order {lesson.sortOrder ?? index}</p></div><div className="admin-row-actions"><button className="admin-quiet-button" type="button" disabled={index === 0 || saving} onClick={() => void moveLesson(module, lesson, -1)}>Move up</button><button className="admin-quiet-button" type="button" disabled={index === lessons.length - 1 || saving} onClick={() => void moveLesson(module, lesson, 1)}>Move down</button><button className="admin-quiet-button" type="button" onClick={() => beginLesson(module, lesson)}>Edit lesson</button><button className="admin-quiet-button" type="button" disabled={!draftCourse || saving} title={!draftCourse ? 'Unpublish the course before permanent deletion; archive to preserve student history.' : 'Delete only when student progress does not reference this lesson.'} onClick={() => void deleteLesson(module, lesson)}>Delete</button></div></article>) : <p className="admin-inline-empty">No lessons in this module yet.</p>}</div></section>;
      })}</div>
      {!draftCourse && <p className="admin-data-note"><Icon name="shield" size={15} /> This course is published. New lessons should remain Draft until reviewed. To permanently delete a saved lesson, unpublish the course first; the server also blocks deletion when saved progress references that lesson.</p>}
    </section>
  );
}
