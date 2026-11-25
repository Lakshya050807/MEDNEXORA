import { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import { catalogApi } from '../services/catalogApi.js';
import { courseApi } from '../services/courseApi.js';

function flattenLessons(course) {
  return (course.modules ?? []).flatMap((module) => (module.lessons ?? []).map((lesson) => ({
    ...lesson,
    moduleId: module.id,
    moduleTitle: module.title,
    subjectId: module.subject?.id ?? '',
    subjectName: module.subject?.name ?? '',
    chapterName: module.chapter?.name ?? '',
  })));
}

export default function CourseLearningPage({ courseId }) {
  const initialLessonId = new URLSearchParams(window.location.search).get('lessonId') ?? '';
  const [course, setCourse] = useState(null);
  const [progress, setProgress] = useState(null);
  const [selectedId, setSelectedId] = useState(initialLessonId);
  const [playback, setPlayback] = useState(null);
  const [lessonContent, setLessonContent] = useState(null);
  const [contentState, setContentState] = useState('idle');
  const [relatedMaterials, setRelatedMaterials] = useState([]);
  const [materialsState, setMaterialsState] = useState('idle');
  const [state, setState] = useState('loading');
  const [actionState, setActionState] = useState('idle');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const lessons = useMemo(() => course ? flattenLessons(course) : [], [course]);
  const selectedLesson = lessons.find((lesson) => lesson.id === selectedId) ?? null;

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    setError('');
    Promise.all([courseApi.get(courseId, { signal: controller.signal }), courseApi.progress(courseId, { signal: controller.signal })])
      .then(([courseResult, progressResult]) => {
        setCourse(courseResult.course);
        setProgress(progressResult.progress);
        const allLessons = flattenLessons(courseResult.course);
        const chosen = allLessons.find((lesson) => lesson.id === initialLessonId)
          ?? allLessons.find((lesson) => !progressResult.progress.completedLessonIds.includes(lesson.id))
          ?? allLessons[0];
        setSelectedId(chosen?.id ?? '');
        setState('ready');
      })
      .catch((requestError) => {
        if (requestError?.name === 'AbortError') return;
        setError(requestError.message || 'Course access could not be checked.');
        setState(requestError.status === 403 ? 'locked' : requestError.status === 404 ? 'missing' : 'error');
      });
    return () => controller.abort();
  }, [courseId, retry, initialLessonId]);

  useEffect(() => {
    if (state !== 'ready' || !selectedLesson) return undefined;
    const controller = new AbortController();
    setPlayback(null);
    setLessonContent(null);
    setContentState('loading');
    setRelatedMaterials([]);
    setMaterialsState(selectedLesson.topic?.id ? 'loading' : 'idle');
    courseApi.playback(courseId, selectedLesson.id, { signal: controller.signal }).then(setPlayback).catch((requestError) => {
      if (requestError?.name !== 'AbortError') setPlayback({ available: false, message: requestError.message || 'Playback could not be checked.' });
    });
    courseApi.lessonContent(courseId, selectedLesson.id, { signal: controller.signal }).then((result) => {
      setLessonContent(result.lesson ?? null);
      setContentState('ready');
    }).catch((requestError) => {
      if (requestError?.name !== 'AbortError') {
        setLessonContent(null);
        setContentState('error');
      }
    });
    if (selectedLesson.topic?.id && selectedLesson.subjectId && course?.exam?.id) {
      catalogApi.listProducts({ examId: course.exam.id, subjectId: selectedLesson.subjectId, topicId: selectedLesson.topic.id, limit: 10 }, { signal: controller.signal }).then((result) => {
        setRelatedMaterials(result.items ?? []);
        setMaterialsState('ready');
      }).catch((requestError) => {
        if (requestError?.name !== 'AbortError') setMaterialsState('error');
      });
    }
    return () => controller.abort();
  }, [courseId, selectedLesson?.id, selectedLesson?.topic?.id, selectedLesson?.subjectId, course?.exam?.id, state]);

  const markComplete = async () => {
    if (!selectedLesson) return;
    setActionState('saving');
    setError('');
    try {
      const result = await courseApi.completeLesson(courseId, selectedLesson.id);
      setProgress(result.progress);
      setActionState('saved');
    } catch (requestError) {
      setError(requestError.message || 'Lesson progress could not be saved.');
      setActionState('error');
    }
  };

  if (state !== 'ready' || !course) {
    const locked = state === 'locked';
    return <div className="site-shell"><SiteHeader activePage="student" /><main className="missing-product-page"><div className="missing-product-card">{state === 'loading' ? <><span className="loading-mark" /><h1>Checking course access</h1><p>Verifying your course entitlement.</p></> : <><span className="empty-icon"><Icon name={locked ? 'lock' : 'play'} size={25} /></span><h1>{locked ? 'Course access required.' : state === 'missing' ? 'Course unavailable.' : 'Learning space unavailable.'}</h1><p>{error}</p>{state === 'error' && <button className="secondary-button" type="button" onClick={() => setRetry((value) => value + 1)}>Try again <Icon name="arrow" size={15} /></button>}<a className="secondary-button" href={locked ? `/courses/${encodeURIComponent(courseId)}` : '/my-courses'}>{locked ? 'View course details' : 'My courses'} <Icon name="arrow" size={15} /></a></>}</div></main></div>;
  }

  const completedIds = new Set(progress?.completedLessonIds ?? []);
  const product = course.product ?? {};
  const selectedIndex = lessons.findIndex((lesson) => lesson.id === selectedId);
  const canComplete = Boolean(playback?.available || lessonContent?.contentText?.trim());
  const practiceUrl = selectedLesson?.topic?.id && selectedLesson.subjectId && course.exam?.id
    ? `/practice?${new URLSearchParams({ examId: course.exam.id, subjectId: selectedLesson.subjectId, topicId: selectedLesson.topic.id }).toString()}`
    : '';
  return (
    <div className="site-shell">
      <SiteHeader activePage="student" />
      <main className="course-learning-page"><div className="page-width">
        <nav className="catalog-breadcrumb" aria-label="Breadcrumb"><a href="/my-courses">My courses</a><span>/</span><a href={`/courses/${encodeURIComponent(course.id)}`}>{product.title}</a><span>/</span><span aria-current="page">Learning</span></nav>
        <header className="learning-page-heading"><div><p className="eyebrow"><span className="eyebrow-dot" /> CONTINUE LEARNING</p><h1>{product.title}</h1><p>{course.exam?.name || 'Government Competitive Exam Preparation'}</p></div><div className="learning-progress-summary"><strong>{progress?.percent ?? 0}%</strong><span>{progress?.completedCount ?? 0} / {progress?.totalLessons ?? lessons.length} complete</span><div className="course-progress-track" role="progressbar" aria-valuenow={progress?.percent ?? 0} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${progress?.percent ?? 0}%` }} /></div></div></header>
        <div className="course-learning-layout">
          <section className="learning-player-column">
            <div className="learning-player-shell">
              {playback?.available
                ? <div className="course-video-frame learning-video-frame"><iframe src={playback.embedUrl} title={playback.lessonTitle || selectedLesson?.title || 'Course lesson'} sandbox="allow-scripts allow-same-origin allow-presentation" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></div>
                : lessonContent?.contentText?.trim()
                  ? <article className="learning-text-content"><p className="eyebrow">TEXT LESSON</p><h2>{lessonContent.title}</h2><div>{lessonContent.contentText}</div></article>
                  : <div className="course-player-placeholder learning-player-placeholder"><Icon name={contentState === 'loading' ? 'spark' : 'play'} size={30} /><h2>{contentState === 'loading' ? 'Loading lesson…' : 'Lesson content unavailable'}</h2><p>{playback?.message || (contentState === 'error' ? 'The lesson content could not be loaded. Try again.' : 'This lesson does not have text content or an available video configured yet.')}</p></div>}
            </div>
            {selectedLesson && <div className="learning-lesson-details"><p className="eyebrow">{[selectedLesson.subjectName, selectedLesson.chapterName, selectedLesson.moduleTitle].filter(Boolean).join(' · ')}</p><h2>{selectedLesson.title}</h2>{selectedLesson.description && <p>{selectedLesson.description}</p>}<div className="learning-actions">{completedIds.has(selectedLesson.id) ? <span className="lesson-complete-label"><Icon name="checklist" size={16} /> Completed</span> : <button className="course-primary-link" type="button" disabled={!canComplete || actionState === 'saving'} onClick={markComplete}>{actionState === 'saving' ? 'Saving progress…' : 'Mark lesson complete'} <Icon name="checklist" size={16} /></button>}{actionState === 'saved' && <span className="progress-save-message" role="status">Progress saved.</span>}{error && <span className="progress-save-error" role="alert">{error}</span>}</div>
              {(practiceUrl || selectedLesson.topic?.id) && <section className="learning-related-content" aria-label="Topic learning resources"><h3>Continue with this topic</h3>{practiceUrl && <a className="course-secondary-link" href={practiceUrl}>Practice topic MCQs <Icon name="arrow" size={14} /></a>}{materialsState === 'loading' && <p role="status">Finding published study materials…</p>}{materialsState === 'error' && <p role="alert">Related materials could not be loaded. You can still browse the catalogue.</p>}{materialsState === 'ready' && relatedMaterials.length > 0 && <ul>{relatedMaterials.map((resource) => <li key={resource.id}><a href={`/products/${encodeURIComponent(resource.slug || resource.id)}`}>{resource.title}</a><span>{resource.isFree ? 'Free resource' : 'Paid resource'}</span></li>)}</ul>}{materialsState === 'ready' && relatedMaterials.length === 0 && <p>No published study materials are mapped to this topic yet.</p>}</section>}
            </div>}
            <nav className="learning-lesson-navigation" aria-label="Lesson navigation"><button type="button" className="course-secondary-link" disabled={selectedIndex <= 0} onClick={() => { setSelectedId(lessons[selectedIndex - 1]?.id ?? ''); setActionState('idle'); setError(''); }}>Previous lesson</button><span>Lesson {Math.max(0, selectedIndex + 1)} of {lessons.length}</span><button type="button" className="course-secondary-link" disabled={selectedIndex < 0 || selectedIndex >= lessons.length - 1} onClick={() => { setSelectedId(lessons[selectedIndex + 1]?.id ?? ''); setActionState('idle'); setError(''); }}>Next lesson</button></nav>
          </section>
          <aside className="learning-outline-panel"><div className="course-section-heading"><div><p className="eyebrow">COURSE OUTLINE</p><h2>Lessons</h2></div><span>{lessons.length}</span></div>{course.modules.map((module) => <section className="learning-module" key={module.id}><h3>{module.title}</h3>{module.lessons.map((lesson) => <button className={`learning-lesson-row${selectedId === lesson.id ? ' is-selected' : ''}`} key={lesson.id} type="button" onClick={() => { setSelectedId(lesson.id); setActionState('idle'); setError(''); }}><span className={`learning-check${completedIds.has(lesson.id) ? ' is-done' : ''}`}>{completedIds.has(lesson.id) ? '✓' : <Icon name="play" size={12} />}</span><span><strong>{lesson.title}</strong><small>{lesson.durationMinutes ? `${lesson.durationMinutes} min` : 'Lesson'}</small></span></button>)}</section>)}{!lessons.length && <p className="course-module-description">No lessons have been configured yet.</p>}</aside>
        </div>
      </div></main>
    </div>
  );
}
