import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import { formatPricePaise } from '../data/catalog.js';
import { courseApi } from '../services/courseApi.js';

function nextLesson(course) {
  const completed = new Set(course.progress?.completedLessonIds ?? []);
  const lessons = (course.modules ?? []).flatMap((module) => module.lessons ?? []);
  return lessons.find((lesson) => !completed.has(lesson.id))?.id ?? course.continueLessonId ?? lessons[0]?.id ?? '';
}

export default function MyCoursesPage() {
  const [courses, setCourses] = useState([]);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    courseApi.myCourses({ signal: controller.signal }).then((result) => {
      setCourses(result.items ?? []);
      setState('ready');
    }).catch((requestError) => {
      if (requestError?.name === 'AbortError') return;
      setError(requestError.message || 'Your courses could not be loaded.');
      setState('error');
    });
    return () => controller.abort();
  }, [retry]);

  return (
    <div className="site-shell">
      <SiteHeader activePage="student" />
      <main className="my-courses-page"><div className="page-width">
        <div className="dashboard-greeting"><p className="eyebrow"><span className="eyebrow-dot" /> YOUR LEARNING</p><h1>My <span>courses.</span></h1><p>Continue a course with an active purchase entitlement or a published free course.</p></div>
        {state === 'loading' && <div className="dashboard-state" role="status"><span className="loading-mark" /><p>Loading your course access…</p></div>}
        {state === 'error' && <div className="dashboard-state dashboard-error" role="alert"><h2>Courses unavailable</h2><p>{error}</p><button className="secondary-button" type="button" onClick={() => setRetry((value) => value + 1)}>Try again <Icon name="arrow" size={15} /></button></div>}
        {state === 'ready' && courses.length > 0 && <div className="my-courses-grid">{courses.map((course) => {
          const product = course.product ?? {};
          const lessonId = nextLesson(course);
          const learnUrl = `/courses/${encodeURIComponent(course.id)}/learn${lessonId ? `?lessonId=${encodeURIComponent(lessonId)}` : ''}`;
          return <article className="my-course-card" key={course.id}>
            <a className="my-course-art" href={`/courses/${encodeURIComponent(course.id)}`}>{product.thumbnailUrl ? <img src={product.thumbnailUrl} alt="" loading="lazy" /> : <span><Icon name="play" size={25} /></span>}</a>
            <div className="my-course-body"><div className="my-course-labels"><span>{course.accessType === 'purchased' ? 'Purchased' : 'Free course'}</span><span>{course.courseType === 'crash-course' ? 'Crash course' : 'Recorded course'}</span></div><h2><a href={`/courses/${encodeURIComponent(course.id)}`}>{product.title}</a></h2><p>{course.exam?.name || 'Government Competitive Exam Preparation'}</p>
              <div className="course-progress-caption"><span>Course progress</span><strong>{course.progress?.percent ?? 0}%</strong></div><div className="course-progress-track" role="progressbar" aria-valuenow={course.progress?.percent ?? 0} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${course.progress?.percent ?? 0}%` }} /></div>
              <p className="course-progress-count">{course.progress?.completedCount ?? 0} of {course.progress?.totalLessons ?? course.lessonCount} lessons complete · {product.isFree ? 'Free' : formatPricePaise(product.currentPricePaise)}</p>
              <a className="course-primary-link" href={learnUrl}>{course.progress?.completedCount ? 'Continue learning' : 'Start course'} <Icon name="arrow" size={15} /></a>
            </div>
          </article>;
        })}</div>}
        {state === 'ready' && courses.length === 0 && <div className="empty-results"><span className="empty-icon"><Icon name="play" size={25} /></span><h2>No courses in your learning space yet</h2><p>Published free courses and courses with an active purchase entitlement appear here.</p><a className="secondary-button" href="/courses">Explore courses <Icon name="arrow" size={15} /></a></div>}
      </div></main>
      <SiteFooter />
    </div>
  );
}
