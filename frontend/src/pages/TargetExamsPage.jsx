import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import { catalogApi } from '../services/catalogApi.js';

const detailRows = [
  ['eligibility', 'Eligibility'],
  ['syllabus', 'Syllabus'],
  ['pattern', 'Exam pattern'],
];

function SubjectOutline({ examId, subject }) {
  return (
    <article className="target-outline-subject">
      <div className="target-outline-heading">
        <div><h4>{subject.name}</h4>{subject.description && <p>{subject.description}</p>}</div>
        <a href={`/study-material?examId=${encodeURIComponent(examId)}&subjectId=${encodeURIComponent(subject._id)}`}>Resources <Icon name="arrowUpRight" size={14} /></a>
      </div>
      {subject.chapters?.length ? <div className="target-outline-chapters">{subject.chapters.map((chapter) => (
        <section className="target-outline-chapter" key={chapter._id}>
          <h5><a href={`/study-material?examId=${encodeURIComponent(examId)}&subjectId=${encodeURIComponent(subject._id)}&chapterId=${encodeURIComponent(chapter._id)}`}>{chapter.name}</a></h5>
          {chapter.description && <p>{chapter.description}</p>}
          {chapter.topics?.length ? <ul>{chapter.topics.map((topic) => <li key={topic._id}>{topic.name}</li>)}</ul> : <span className="target-outline-empty">No published topics in this chapter yet.</span>}
        </section>
      ))}</div> : <span className="target-outline-empty">No published chapters configured for this subject yet.</span>}
      {subject.topics?.length > 0 && <div className="target-outline-topics"><strong>Other published topics</strong><ul>{subject.topics.map((topic) => <li key={topic._id}>{topic.name}</li>)}</ul></div>}
    </article>
  );
}

function ExamCard({ exam }) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState('idle');
  const [details, setDetails] = useState(null);
  const [error, setError] = useState('');
  const examId = String(exam._id ?? exam.id);

  const loadOutline = async () => {
    setState('loading');
    setError('');
    try {
      setDetails(await catalogApi.getExam(examId));
      setState('ready');
    } catch (requestError) {
      setError(requestError.message || 'The exam outline could not be loaded.');
      setState('error');
    }
  };
  const toggleOutline = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!details && state !== 'loading') void loadOutline();
  };

  return (
    <article className="target-directory-card">
      <div className="target-directory-card-heading">
        <div><p className="eyebrow">{exam.region ? `${exam.region} · Government examination` : 'Government Competitive Examination'}</p><h2>{exam.name}</h2></div>
        {exam.isPrimary && <span className="target-exam-primary-label">Primary target</span>}
      </div>
      {exam.description && <p className="target-directory-description">{exam.description}</p>}
      <dl className="target-directory-facts">{detailRows.filter(([key]) => exam[key]).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{exam[key]}</dd></div>)}</dl>
      <div className="target-directory-actions"><a className="primary-button" href={`/study-material?examId=${encodeURIComponent(examId)}`}>Browse this exam’s resources <Icon name="arrow" size={16} /></a><button className="secondary-button" type="button" aria-expanded={expanded} onClick={() => void toggleOutline()}>{expanded ? 'Hide subject outline' : 'View subjects, chapters & topics'}</button></div>
      {expanded && <div className="target-directory-outline">{state === 'loading' && <div className="catalog-state-panel" role="status"><span className="loading-mark" /><p>Loading published subjects and chapters…</p></div>}{state === 'error' && <div className="catalog-state-panel" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={() => void loadOutline()}>Try again</button></div>}{state === 'ready' && (details.subjects?.length ? <div className="target-outline-list">{details.subjects.map((subject) => <SubjectOutline key={subject._id} examId={examId} subject={subject} />)}</div> : <p className="target-outline-empty">No published subjects have been configured for this examination yet.</p>)}</div>}
    </article>
  );
}

export default function TargetExamsPage() {
  const [exams, setExams] = useState([]);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    catalogApi.listExams({ signal: controller.signal }).then((items) => {
      setExams(items);
      setState('ready');
    }).catch((requestError) => {
      if (requestError.name === 'AbortError') return;
      setError(requestError.message || 'Published exam configurations could not be loaded.');
      setState('error');
    });
    return () => controller.abort();
  }, [retry]);

  return (
    <div className="site-shell">
      <SiteHeader activePage="target-exams" />
      <main className="target-directory-page">
        <section className="target-directory-hero"><div className="page-width"><nav className="catalog-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><span aria-current="page">Target exams</span></nav><p className="eyebrow">GOVERNMENT COMPETITIVE EXAM PREPARATION</p><h1>Choose your <span>target examination.</span></h1><p>Published examination details and subject outlines are configured by the MEDNEXORA team.</p></div></section>
        <section className="section target-directory-results" aria-label="Published target exams"><div className="page-width">
          {state === 'loading' && <div className="catalog-state-panel" role="status"><span className="loading-mark" /><h2>Loading target examinations</h2><p>Checking published Government Competitive Examinations.</p></div>}
          {state === 'error' && <div className="catalog-state-panel" role="alert"><h2>Exam configurations are unavailable</h2><p>{error}</p><button className="secondary-button" type="button" onClick={() => setRetry((count) => count + 1)}>Try again</button></div>}
          {state === 'ready' && exams.length > 0 && <div className="target-directory-grid">{exams.map((exam) => <ExamCard key={exam._id ?? exam.id} exam={exam} />)}</div>}
          {state === 'ready' && exams.length === 0 && <div className="catalog-state-panel"><h2>No published target exams yet</h2><p>Exam information appears here after an administrator publishes an examination configuration.</p></div>}
        </div></section>
      </main>
      <SiteFooter />
    </div>
  );
}
