import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import { formatPricePaise } from '../data/catalog.js';
import { courseApi } from '../services/courseApi.js';

function CourseCard({ course }) {
  const product = course.product ?? {};
  return (
    <article className="course-catalog-card">
      <a className="course-card-art" href={`/courses/${encodeURIComponent(course.id)}`}>
        {product.thumbnailUrl ? <img src={product.thumbnailUrl} alt="" loading="lazy" /> : <span className="course-card-placeholder"><Icon name="play" size={30} /></span>}
        <span className="course-type-chip">{course.courseType === 'crash-course' ? 'Crash course' : 'Recorded course'}</span>
      </a>
      <div className="course-card-copy">
        <p className="eyebrow">{course.category || course.exam?.name || 'Government Competitive Exam Preparation'}</p>
        <h2><a href={`/courses/${encodeURIComponent(course.id)}`}>{product.title || 'Entrance preparation course'}</a></h2>
        <p>{product.description || 'A structured course with lessons organized by module.'}</p>
        <div className="course-card-meta">{course.lessonCount > 0 ? <span><Icon name="play" size={15} /> {course.lessonCount} lessons</span> : <span>Course outline in progress</span>}{course.durationMinutes && <span>{course.durationMinutes} min</span>}</div>
        {course.subjects?.length > 0 && <div className="course-subject-tags">{course.subjects.slice(0, 3).map((subject) => <span key={subject.id}>{subject.name || 'Subject'}</span>)}</div>}
        <div className="course-card-footer"><strong>{product.isFree ? 'Free' : formatPricePaise(product.currentPricePaise)}</strong><a className="course-link-button" href={`/courses/${encodeURIComponent(course.id)}`}>View course <Icon name="arrow" size={15} /></a></div>
      </div>
    </article>
  );
}

const flagshipSubjects = ['Physics', 'Chemistry', 'Biology'];
const flagshipTitle = 'B.Sc. Nursing Entrance Preparation';
const flagshipSlug = 'bsc-nursing-entrance-preparation';
const flagshipDescription = 'A structured learning programme covering Physics, Chemistry and Biology to help students prepare for B.Sc. Nursing entrance examinations.';

function FlagshipCoursePreview() {
  return (
    <a className="course-preview-card-link" href="/courses/bsc-nursing-entrance-preparation/overview" aria-label={`Open course overview: ${flagshipTitle}`}>
      <article className="course-catalog-card course-coming-soon-card" aria-label={`${flagshipTitle}, coming soon`}>
        <div className="course-card-art course-coming-soon-art" aria-hidden="true">
          <span className="course-coming-soon-badge">Coming soon · Draft</span>
          <span className="course-coming-soon-icon"><Icon name="book" size={30} /></span>
          <span className="course-coming-soon-caption">ENTRANCE PREPARATION</span>
        </div>
        <div className="course-card-copy course-coming-soon-copy">
          <p className="eyebrow">Government Competitive Exam Preparation</p>
          <h2>{flagshipTitle}</h2>
          <p>{flagshipDescription}</p>
          <div className="course-subject-tags" aria-label="Course subjects">{flagshipSubjects.map((subject) => <span key={subject}>{subject}</span>)}</div>
          <div className="course-card-footer"><strong className="course-draft-status">Draft · not available for enrollment</strong></div>
        </div>
      </article>
    </a>
  );
}

export default function CourseCatalogPage() {
  const [courseType, setCourseType] = useState('all');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const teaserMatches = (courseType === 'all' || courseType === 'video-course')
    && `${flagshipTitle} ${flagshipDescription} ${flagshipSubjects.join(' ')} Government Competitive Exam Preparation`.toLowerCase().includes(search.trim().toLowerCase());
  const hasPublishedFlagship = items.some((course) => course.product?.slug === flagshipSlug);
  const showFlagshipTeaser = state === 'ready' && teaserMatches && !hasPublishedFlagship;

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    setError('');
    courseApi.list({ courseType: courseType === 'all' ? undefined : courseType, q: search.trim(), limit: 24 }, { signal: controller.signal })
      .then((result) => { setItems(result.items ?? []); setState('ready'); })
      .catch((requestError) => {
        if (requestError?.name === 'AbortError') return;
        setError(requestError.message || 'Courses could not be loaded.');
        setState('error');
      });
    return () => controller.abort();
  }, [courseType, search, retry]);

  return (
    <div className="site-shell">
      <SiteHeader activePage="courses" />
      <main className="course-catalog-page">
        <div className="page-width">
          <nav className="catalog-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><span aria-current="page">Courses</span></nav>
          <section className="course-catalog-hero">
            <div><p className="eyebrow"><span className="eyebrow-dot" /> GOVERNMENT COMPETITIVE EXAM PREPARATION</p><h1>Courses for <span>steady preparation.</span></h1><p>Explore courses organized around their configured subjects and lessons. Published details and previews are shown when available.</p></div>
            <a className="course-secondary-link" href="/my-courses"><Icon name="play" size={17} /> Continue learning</a>
          </section>
          <div className="course-catalog-toolbar">
            <label className="course-search-field"><Icon name="search" size={18} /><span className="sr-only">Search courses</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search courses or subjects" /></label>
            <label className="course-type-filter"><span className="sr-only">Course type</span><select value={courseType} onChange={(event) => setCourseType(event.target.value)}><option value="all">All course types</option><option value="video-course">Recorded courses</option><option value="crash-course">Crash courses</option></select></label>
          </div>
          {showFlagshipTeaser && <div className="course-catalog-grid course-coming-soon-grid"><FlagshipCoursePreview /></div>}
          {state === 'loading' && <div className="catalog-state-panel" role="status"><span className="loading-mark" /><h2>Loading published courses</h2><p>Checking course details and exam configuration.</p></div>}
          {state === 'error' && <div className="catalog-state-panel" role="alert"><h2>Courses are unavailable</h2><p>{error}</p><button className="secondary-button" type="button" onClick={() => setRetry((value) => value + 1)}>Try again <Icon name="arrow" size={15} /></button></div>}
          {state === 'ready' && items.length > 0 && <div className="course-catalog-grid">{items.map((course) => <CourseCard key={course.id} course={course} />)}</div>}
          {state === 'ready' && items.length === 0 && !showFlagshipTeaser && <div className="empty-results"><span className="empty-icon"><Icon name="play" size={25} /></span><h2>No published courses found</h2><p>Try another search or check back after course content has been published.</p><button className="secondary-button" type="button" onClick={() => { setSearch(''); setCourseType('all'); }}>Clear filters</button></div>}
          <p className="course-access-note"><Icon name="shield" size={16} /> Paid lessons require an active course entitlement. A secure signed video provider must be configured before paid playback is enabled.</p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
