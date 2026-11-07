import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import { formatPricePaise } from '../data/catalog.js';
import { courseApi } from '../services/courseApi.js';

function orderedLessons(course) {
  return (course.modules ?? []).flatMap((module) => (module.lessons ?? []).map((lesson) => ({ ...lesson, moduleTitle: module.title })));
}

export default function CourseDetailPage({ courseId }) {
  const [course, setCourse] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [previewLessonId, setPreviewLessonId] = useState('');
  const [playback, setPlayback] = useState(null);
  const [previewState, setPreviewState] = useState('idle');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    setError('');
    courseApi.get(courseId, { signal: controller.signal }).then((result) => {
      setCourse(result.course);
      setState('ready');
    }).catch((requestError) => {
      if (requestError?.name === 'AbortError') return;
      setError(requestError.message || 'Course details could not be loaded.');
      setState(requestError.status === 404 ? 'missing' : 'error');
    });
    return () => controller.abort();
  }, [courseId, retry]);

  const startPreview = async (lesson) => {
    setPreviewLessonId(lesson.id);
    setPlayback(null);
    setPreviewState('loading');
    try {
      const result = await courseApi.getPreviewPlayback(courseId, lesson.id);
      setPlayback(result);
      setPreviewState(result.available ? 'ready' : 'unavailable');
    } catch (requestError) {
      setPlayback({ message: requestError.message || 'This preview could not be loaded.' });
      setPreviewState('error');
    }
  };

  if (state !== 'ready' || !course) {
    return <div className="site-shell"><SiteHeader activePage="courses" /><main className="missing-product-page"><div className="missing-product-card">{state === 'loading' ? <><span className="loading-mark" /><p className="eyebrow">COURSE CATALOGUE</p><h1>Loading course</h1><p>Checking published modules and lesson details.</p></> : <><span className="empty-icon"><Icon name="play" size={25} /></span><p className="eyebrow">GOVERNMENT COMPETITIVE EXAM PREPARATION</p><h1>{state === 'missing' ? 'Course not found.' : 'Course unavailable.'}</h1><p>{error}</p>{state === 'error' && <button className="secondary-button" type="button" onClick={() => setRetry((value) => value + 1)}>Try again <Icon name="arrow" size={15} /></button>}<a className="secondary-button" href="/courses">Browse courses <Icon name="arrow" size={15} /></a></>}</div></main></div>;
  }

  const product = course.product ?? {};
  const lessons = orderedLessons(course);
  const previews = lessons.filter((lesson) => lesson.isPreview);
  const continueUrl = `/courses/${encodeURIComponent(course.id)}/learn`;
  const loginNext = encodeURIComponent(continueUrl);

  return (
    <div className="site-shell">
      <SiteHeader activePage="courses" />
      <main className="course-detail-page">
        <div className="page-width">
          <nav className="catalog-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="/courses">Courses</a><span>/</span><span aria-current="page">{product.title}</span></nav>
          <section className="course-detail-hero">
            <div className="course-detail-art">{product.thumbnailUrl ? <img src={product.thumbnailUrl} alt="" /> : <span><Icon name="play" size={35} /></span>}</div>
            <div className="course-detail-copy">
              <p className="eyebrow"><span className="eyebrow-dot" /> {course.category || 'GOVERNMENT COMPETITIVE EXAM PREPARATION'} · {course.exam?.name || 'Government Competitive Examination'}</p>
              <h1>{product.title}</h1>
              <p>{product.description}</p>
              <div className="course-detail-meta">{course.lessonCount > 0 ? <span><Icon name="play" size={16} /> {course.lessonCount} lessons</span> : <span>Course outline in progress</span>}{course.durationMinutes && <span>{course.durationMinutes} minutes</span>}<span>{course.subjects?.length || 0} subjects</span></div>
              {course.subjects?.length > 0 && <div className="course-subject-tags">{course.subjects.map((subject) => <span key={subject.id}>{subject.name || 'Subject'}</span>)}</div>}
              <div className="course-detail-action-row"><strong>{product.isFree ? 'Free' : formatPricePaise(product.currentPricePaise)}</strong>{product.isFree ? <a className="course-primary-link" href={`/login?next=${loginNext}`}>Start this course <Icon name="arrow" size={16} /></a> : <div className="course-purchase-actions"><a className="course-primary-link" href={`/products/${encodeURIComponent(product.slug || product.id)}`}>Purchase course <Icon name="arrow" size={16} /></a><a className="course-secondary-link" href="/my-courses">Already enrolled?</a></div>}</div>
              {!product.isFree && <p className="course-access-note course-access-inline"><Icon name="shield" size={15} /> Paid access is granted only after purchase verification and server-side entitlement confirmation.</p>}
            </div>
          </section>

          <div className="course-detail-grid">
            <section className="course-outline-panel" aria-labelledby="course-outline-title">
              <div className="course-section-heading"><div><p className="eyebrow">COURSE CONTENTS</p><h2 id="course-outline-title">Modules and lessons</h2></div><span>{lessons.length} lessons</span></div>
              {course.modules?.length ? <div className="course-module-list">{course.modules.map((module) => (
                <article className="course-module-card" key={module.id}>
                  <header><div><span className="module-number">{String((course.modules.indexOf(module) + 1)).padStart(2, '0')}</span><div><h3>{module.title}</h3>{(module.subject?.name || module.chapter?.name) && <small>{[module.subject?.name, module.chapter?.name].filter(Boolean).join(' · ')}</small>}</div></div><span>{module.lessons.length} lessons</span></header>
                  {module.description && <p className="course-module-description">{module.description}</p>}
                  <ol>{module.lessons.map((lesson) => <li key={lesson.id} className={lesson.id === previewLessonId ? 'is-preview-selected' : ''}><span className="course-lesson-icon"><Icon name={lesson.isPreview ? 'play' : 'lock'} size={15} /></span><div><strong>{lesson.title}</strong>{lesson.description && <small>{lesson.description}</small>}</div><span className="course-lesson-duration">{lesson.durationMinutes ? `${lesson.durationMinutes} min` : ''}</span>{lesson.isPreview && <button type="button" className="preview-play-button" onClick={() => startPreview(lesson)}>{lesson.id === previewLessonId && previewState === 'loading' ? 'Loading…' : 'Preview'}</button>}</li>)}</ol>
                </article>
              ))}</div> : <div className="course-empty-content"><h3>Lessons are being prepared</h3><p>Published lesson content will appear here after it is configured.</p></div>}
            </section>
            <aside className="course-preview-column">
              <section className="course-preview-panel" aria-labelledby="preview-player-title">
                <p className="eyebrow">FREE PREVIEW</p><h2 id="preview-player-title">Try a sample lesson</h2>
                {playback?.available && previewState === 'ready' ? <div className="course-video-frame"><iframe src={playback.embedUrl} title={playback.lessonTitle || 'Free course preview'} sandbox="allow-scripts allow-same-origin allow-presentation" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></div> : <div className="course-player-placeholder"><Icon name={previewState === 'loading' ? 'spark' : 'play'} size={26} /><p>{previewState === 'loading' ? 'Loading the configured preview…' : previewState !== 'idle' ? playback?.message || 'The preview could not be loaded.' : previews.length ? 'Select a lesson marked Preview to check its configured player.' : 'No free preview lesson has been configured.'}</p></div>}
                {previews.length > 0 && <p className="course-preview-caption">{previews.length} free preview {previews.length === 1 ? 'lesson is' : 'lessons are'} configured for this course.</p>}
              </section>
              <section className="course-outline-panel course-highlights-panel"><p className="eyebrow">COURSE OVERVIEW</p><h2>Preparation highlights</h2>{course.targetAudience && <p>For: {course.targetAudience}</p>}{course.outline?.length ? <ul>{course.outline.map((item, index) => <li key={`${index}-${item}`}><Icon name="checklist" size={15} />{item}</li>)}</ul> : <p>Course highlights have not been added yet.</p>}<a className="course-secondary-link" href={`/login?next=${loginNext}`}>Sign in to continue learning <Icon name="arrow" size={15} /></a></section>
            </aside>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
