import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import { courseApi } from '../services/courseApi.js';

export default function FlagshipCourseOverviewPage() {
  const [preview, setPreview] = useState(null);
  const [state, setState] = useState('loading');

  useEffect(() => {
    const controller = new AbortController();
    courseApi.flagshipPreview({ signal: controller.signal })
      .then((result) => {
        setPreview(result.preview ?? null);
        setState(result.preview ? 'ready' : 'missing');
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        setState(error?.status === 404 ? 'missing' : 'error');
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="site-shell">
      <SiteHeader activePage="courses" />
      <main className="flagship-overview-page">
        <div className="page-width">
          <nav className="catalog-breadcrumb" aria-label="Breadcrumb">
            <a href="/">Home</a><span>/</span><a href="/courses">Courses</a><span>/</span><span aria-current="page">Course Overview</span>
          </nav>

          {state === 'loading' && <section className="flagship-overview-state" role="status"><span className="loading-mark" /><p className="eyebrow">MEDNEXORA COURSE OVERVIEW</p><h1>Loading course overview</h1></section>}
          {state !== 'loading' && state !== 'ready' && <section className="flagship-overview-state" role="alert"><p className="eyebrow">MEDNEXORA COURSE OVERVIEW</p><h1>Course overview unavailable</h1><p>{state === 'missing' ? 'This course overview is not available right now.' : 'We could not load this course overview. Please try again later.'}</p><a className="course-secondary-link" href="/courses"><Icon name="arrow" size={16} /> Back to Courses</a></section>}

          {state === 'ready' && preview && <>
            <a className="flagship-back-link" href="/courses"><Icon name="arrow" size={16} /> Back to Courses</a>
            <article className="flagship-overview-card">
              <div className="flagship-overview-art" aria-hidden="true">
                <span className="flagship-overview-status">Coming soon · Draft</span>
                <span className="flagship-overview-icon"><Icon name="book" size={40} /></span>
                <span className="flagship-overview-caption">MEDNEXORA · COURSE OVERVIEW</span>
              </div>
              <div className="flagship-overview-copy">
                <p className="eyebrow"><span className="eyebrow-dot" /> {preview.category}</p>
                <h1>{preview.title}</h1>
                <p className="flagship-overview-description">{preview.description}</p>
                <section className="flagship-overview-subjects" aria-labelledby="flagship-subjects-title">
                  <p className="eyebrow" id="flagship-subjects-title">COURSE SUBJECTS</p>
                  <ul>{preview.subjects.map((subject) => <li key={subject}><Icon name="checklist" size={16} />{subject}</li>)}</ul>
                </section>
                <p className="flagship-overview-message">This course is currently being prepared. Enrollment will open soon.</p>
              </div>
            </article>
          </>}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
