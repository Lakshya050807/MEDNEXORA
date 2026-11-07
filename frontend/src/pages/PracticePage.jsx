import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import { catalogApi } from '../services/catalogApi.js';
import { practiceApi } from '../services/practiceApi.js';

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function PageFrame({ children }) {
  return <div className="site-shell"><SiteHeader activePage="student" /><main className="practice-page"><div className="page-width">{children}</div></main><SiteFooter /></div>;
}

function StateCard({ title, message, error, onRetry }) {
  return <section className={`practice-state ${error ? 'practice-state-error' : ''}`} role={error ? 'alert' : 'status'}><span className="practice-state-mark">{error ? '!' : <span className="loading-mark" />}</span><h2>{title}</h2><p>{message}</p>{onRetry && <button className="secondary-button" type="button" onClick={onRetry}>Try again <Icon name="arrow" size={15} /></button>}</section>;
}

function PracticeHub() {
  const [banks, setBanks] = useState([]);
  const [tests, setTests] = useState([]);
  const [exams, setExams] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [topics, setTopics] = useState([]);
  const [examId, setExamId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [starting, setStarting] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    Promise.all([
      practiceApi.listQuestionBanks({ examId, subjectId, topicId, limit: 50 }, { signal: controller.signal }),
      practiceApi.listMockTests({ signal: controller.signal }),
      catalogApi.listExams({ signal: controller.signal }),
      examId ? catalogApi.listSubjects(examId, { signal: controller.signal }) : Promise.resolve([]),
      subjectId ? catalogApi.listTopics(subjectId, { signal: controller.signal }) : Promise.resolve([]),
    ]).then(([bankResult, testResult, examItems, subjectItems, topicItems]) => {
      setBanks(bankResult.items ?? []);
      setTests(testResult.items ?? []);
      setExams(examItems ?? []);
      setSubjects(subjectItems ?? []);
      setTopics(topicItems ?? []);
      setError('');
      setStatus('ready');
    }).catch((caught) => {
      if (caught?.name === 'AbortError') return;
      setError(caught.message || 'The practice catalogue could not be loaded.');
      setStatus('error');
    });
    return () => controller.abort();
  }, [examId, subjectId, topicId, retry]);

  async function start(kind, id) {
    setStarting(id);
    setError('');
    try {
      const result = kind === 'practice' ? await practiceApi.startPractice(id, topicId) : await practiceApi.startMockTest(id);
      window.location.assign(`/practice/attempts/${encodeURIComponent(result.attempt.id)}`);
    } catch (caught) {
      setError(caught.message || 'The attempt could not be started.');
      setStarting('');
    }
  }

  return <>
    <div className="practice-heading"><p className="eyebrow"><span className="eyebrow-dot" /> PRACTICE & MOCK TESTS</p><h1>Make every question <span>count.</span></h1><p>Choose a published question bank for focused practice or start a timed mock test. Settings come from the configured resource; they do not claim to represent an official exam pattern.</p></div>
    <section className="practice-filter-panel" aria-label="Filter practice questions">
      <label>Target examination<select value={examId} onChange={(event) => { setExamId(event.target.value); setSubjectId(''); setTopicId(''); }}><option value="">All configured exams</option>{exams.map((exam) => <option key={exam._id ?? exam.id} value={exam._id ?? exam.id}>{exam.name}</option>)}</select></label>
      <label>Subject<select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setTopicId(''); }} disabled={!examId}><option value="">All subjects</option>{subjects.map((subject) => <option key={subject._id ?? subject.id} value={subject._id ?? subject.id}>{subject.name}</option>)}</select></label>
      <label>Topic<select value={topicId} onChange={(event) => setTopicId(event.target.value)} disabled={!subjectId}><option value="">All topics</option>{topics.map((topic) => <option key={topic._id ?? topic.id} value={topic._id ?? topic.id}>{topic.name}</option>)}</select></label>
    </section>
    <div className="practice-shortcuts"><a className="secondary-button" href="/practice/attempts">View attempt history <Icon name="arrow" size={15} /></a><a className="practice-text-link" href="/student/dashboard">Student dashboard</a></div>
    {status === 'loading' && <StateCard title="Loading practice resources" message="Finding published question banks and mock tests…" />}
    {status === 'error' && <StateCard error title="Practice resources unavailable" message={error} onRetry={() => setRetry((value) => value + 1)} />}
    {status === 'ready' && <>
      {error && <p className="practice-inline-error" role="alert">{error}</p>}
      <section className="practice-resource-section"><div className="practice-section-title"><div><p className="eyebrow">FOCUSED LEARNING</p><h2>Practice MCQs</h2></div><span>{banks.length} available</span></div>
        {banks.length ? <div className="practice-card-grid">{banks.map((bank) => <article className="practice-resource-card" key={bank.id}><span className="practice-card-icon"><Icon name="checklist" size={19} /></span><p className="practice-card-kicker">{bank.subject?.name || 'Subject practice'}</p><h3>{bank.title}</h3><p className="practice-card-detail">{bank.exam?.name || 'Configured examination'} · {bank.questionCount} questions</p>{bank.locked ? <span className="practice-locked-label">Access required</span> : <button className="primary-button" type="button" disabled={starting === bank.id} onClick={() => start('practice', bank.id)}>{starting === bank.id ? 'Starting…' : 'Start practice'} <Icon name="arrow" size={15} /></button>}</article>)}</div> : <div className="practice-empty"><h3>No question banks match these filters</h3><p>Try another subject or topic, or check back after more practice content is published.</p></div>}
      </section>
      <section className="practice-resource-section"><div className="practice-section-title"><div><p className="eyebrow">TIMED PREPARATION</p><h2>Mock tests</h2></div><span>{tests.length} available</span></div>
        {tests.length ? <div className="practice-card-grid">{tests.map((test) => <article className="practice-resource-card" key={test.id}><span className="practice-card-icon practice-card-icon-blue"><Icon name="file" size={19} /></span><p className="practice-card-kicker">{test.exam?.name || 'Configured examination'}</p><h3>{test.title}</h3><p className="practice-card-detail">{test.questionCount ?? 'Configured'} questions · {test.durationMinutes ?? 'Untimed'} min · {test.totalMarks ?? 'Scoring'} marks</p><p className="practice-card-detail">{test.negativeMarkingEnabled ? `${test.negativeMarksPerQuestion} marks deducted per incorrect answer` : 'No negative marking configured'} · {test.pricePaise === 0 ? 'Free' : `₹${(test.pricePaise / 100).toFixed(2)}`}</p>{test.locked ? <span className="practice-locked-label">Purchase access required</span> : <button className="primary-button" type="button" disabled={starting === test.id} onClick={() => start('mock', test.id)}>{starting === test.id ? 'Starting…' : 'Start timed test'} <Icon name="arrow" size={15} /></button>}</article>)}</div> : <div className="practice-empty"><h3>No published mock tests yet</h3><p>Mock tests will appear here when an administrator publishes them.</p></div>}
      </section>
      <p className="practice-content-note">Question banks are supplied by the site administrators. Demonstration questions should be original examples; no question here is represented as an official previous-year paper.</p>
    </>}
  </>;
}

function AttemptHistory() {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    practiceApi.listAttempts({ page, limit: 20 }, { signal: controller.signal }).then((result) => { setItems(result.items ?? []); setPagination(result.pagination ?? { page, pages: 0 }); setStatus('ready'); }).catch((caught) => { if (caught?.name === 'AbortError') return; setError(caught.message); setStatus('error'); });
    return () => controller.abort();
  }, [retry, page]);
  return <><div className="practice-heading"><p className="eyebrow"><span className="eyebrow-dot" /> YOUR PREPARATION</p><h1>Attempt <span>history.</span></h1><p>Review saved practice sessions and mock-test results.</p></div><div className="practice-shortcuts"><a className="secondary-button" href="/practice">Browse practice <Icon name="arrow" size={15} /></a></div>{status === 'loading' && <StateCard title="Loading your attempts" message="Your saved practice history is being retrieved…" />}{status === 'error' && <StateCard error title="History unavailable" message={error} onRetry={() => setRetry((value) => value + 1)} />}{status === 'ready' && (items.length ? <><div className="practice-history-list">{items.map((item) => <a className="practice-history-card" href={`/practice/attempts/${encodeURIComponent(item.id)}`} key={item.id}><div><span className="practice-card-kicker">{item.mode === 'mock' ? 'MOCK TEST' : 'MCQ PRACTICE'} · {item.status.replace('-', ' ')}</span><h2>{item.title}</h2><p>{item.questionCount} questions · {item.submittedAt ? new Date(item.submittedAt).toLocaleString() : `Started ${new Date(item.startedAt).toLocaleString()}`}</p></div><strong>{item.result ? `${item.result.score} / ${item.result.maximumMarks}` : 'In progress'}</strong></a>)}</div>{pagination.pages > 1 && <div className="catalog-pagination"><button className="secondary-button" type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {pagination.page} of {pagination.pages}</span><button className="secondary-button" type="button" disabled={page >= pagination.pages} onClick={() => setPage((value) => value + 1)}>Next</button></div>}</> : <div className="practice-empty"><h3>No attempts saved yet</h3><p>Start a question bank or mock test to build your preparation history.</p><a className="secondary-button" href="/practice">Find practice resources <Icon name="arrow" size={15} /></a></div>)}</>;
}

function monotonicNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function hasSelectedAnswer(question) {
  return question.selectedOptionIndex !== null && question.selectedOptionIndex !== undefined;
}

function attemptIndexKey(id) {
  return `practice-attempt-current-index:${id}`;
}

function savedQuestionIndex(id, questionCount) {
  try {
    const saved = Number(window.sessionStorage.getItem(attemptIndexKey(id)));
    return Number.isInteger(saved) && saved >= 0 && saved < questionCount ? saved : 0;
  } catch {
    return 0;
  }
}

function QuestionImage({ image, questionNumber }) {
  const [failed, setFailed] = useState(false);
  if (!image?.url) return null;
  let safeUrl;
  try {
    const parsed = new URL(image.url);
    if (parsed.protocol !== 'https:') throw new Error('Unsupported image protocol');
    safeUrl = parsed.href;
  } catch {
    return <p className="practice-image-unavailable" role="status">Question image is unavailable.</p>;
  }
  if (failed) return <p className="practice-image-unavailable" role="status">Question image could not be loaded.</p>;
  return <img className="practice-question-image" src={safeUrl} alt={image.altText || `Illustration for question ${questionNumber}`} loading="lazy" onError={() => setFailed(true)} />;
}

export function AttemptRunner({ attemptId }) {
  const [attempt, setAttempt] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [clock, setClock] = useState(() => ({ serverNow: Date.now(), monotonicNow: monotonicNow() }));
  const [tick, setTick] = useState(() => monotonicNow());
  const submitStarted = useRef(false);
  const saveInFlight = useRef(false);
  const deadlineProbeInFlight = useRef(false);
  const lastDeadlineProbeAt = useRef(Number.NEGATIVE_INFINITY);
  const dialogWasOpen = useRef(false);
  const submitButtonRef = useRef(null);
  const returnButtonRef = useRef(null);
  const resultPanelRef = useRef(null);
  const [retry, setRetry] = useState(0);

  const syncClock = useCallback((serverNow) => {
    const parsed = Number(serverNow);
    const observedServerTime = Number.isFinite(parsed) ? parsed : Date.now();
    const observedMonotonicTime = monotonicNow();
    setClock({ serverNow: observedServerTime, monotonicNow: observedMonotonicTime });
    setTick(observedMonotonicTime);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    setError('');
    practiceApi.getAttempt(attemptId, { signal: controller.signal }).then((result) => {
      syncClock(result.serverNow);
      setAttempt(result.attempt);
      setCurrentIndex(result.attempt.status === 'in-progress' ? savedQuestionIndex(attemptId, result.attempt.questions.length) : 0);
      if (result.attempt.status !== 'in-progress') {
        try { window.sessionStorage.removeItem(attemptIndexKey(attemptId)); } catch { /* Session storage is optional. */ }
      }
      submitStarted.current = result.attempt.status !== 'in-progress';
      setStatus('ready');
      setError('');
    }).catch((caught) => {
      if (caught?.name === 'AbortError') return;
      setError(caught.message || 'This attempt could not be loaded.');
      setStatus('error');
    });
    return () => controller.abort();
  }, [attemptId, retry, syncClock]);

  useEffect(() => {
    if (!attempt) return;
    if (attempt.status !== 'in-progress') {
      try { window.sessionStorage.removeItem(attemptIndexKey(attemptId)); } catch { /* Session storage is optional. */ }
      return;
    }
    const boundedIndex = Math.max(0, Math.min(currentIndex, Math.max(0, attempt.questions.length - 1)));
    try { window.sessionStorage.setItem(attemptIndexKey(attemptId), String(boundedIndex)); } catch { /* Resume position is best-effort only. */ }
  }, [attempt, attemptId, currentIndex]);

  useEffect(() => {
    if (!attempt || attempt.status !== 'in-progress') return undefined;
    const unloadWarning = (event) => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', unloadWarning);
    return () => window.removeEventListener('beforeunload', unloadWarning);
  }, [attempt?.status]);

  useEffect(() => {
    if (submitDialogOpen) {
      dialogWasOpen.current = true;
      returnButtonRef.current?.focus();
      return undefined;
    }
    if (dialogWasOpen.current) {
      dialogWasOpen.current = false;
      if (attempt?.status === 'in-progress') submitButtonRef.current?.focus();
    }
    return undefined;
  }, [attempt?.status, submitDialogOpen]);

  useEffect(() => {
    if (attempt && attempt.status !== 'in-progress' && status === 'ready') resultPanelRef.current?.focus();
  }, [attempt?.status, status]);

  useEffect(() => {
    if (!attempt?.expiresAt || attempt.status !== 'in-progress') return undefined;
    const timer = window.setInterval(() => setTick(monotonicNow()), 250);
    return () => window.clearInterval(timer);
  }, [attempt?.expiresAt, attempt?.status]);

  const estimatedServerNow = clock.serverNow + Math.max(0, tick - clock.monotonicNow);
  const remaining = attempt?.expiresAt ? Math.max(0, new Date(attempt.expiresAt).getTime() - estimatedServerNow) : null;

  useEffect(() => {
    if (attempt?.status !== 'in-progress' || remaining === null || remaining > 0 || saveInFlight.current || deadlineProbeInFlight.current) return;
    const currentMonotonicTime = monotonicNow();
    if (currentMonotonicTime - lastDeadlineProbeAt.current < 1200) return;
    lastDeadlineProbeAt.current = currentMonotonicTime;
    deadlineProbeInFlight.current = true;
    practiceApi.getAttempt(attempt.id).then((result) => {
      syncClock(result.serverNow);
      setAttempt(result.attempt);
      if (result.attempt.status !== 'in-progress') setError('');
    }).catch((caught) => {
      setError(caught.message || 'The test timer could not be checked. Your saved attempt is still available.');
    }).finally(() => {
      deadlineProbeInFlight.current = false;
    });
  }, [attempt?.id, attempt?.status, remaining, syncClock, tick]);

  async function submit() {
    if (!attempt || attempt.status !== 'in-progress' || saveInFlight.current || submitStarted.current) return;
    submitStarted.current = true;
    setSubmitting(true);
    setError('');
    try {
      const result = await practiceApi.submitAttempt(attempt.id);
      syncClock(result.serverNow);
      setAttempt(result.attempt);
      setSubmitDialogOpen(false);
      if (result.attempt.status !== 'in-progress') {
        window.history.replaceState(window.history.state, '', `/practice/attempts/${encodeURIComponent(result.attempt.id)}/results`);
      }
      setError('');
    } catch (caught) {
      setError(caught.message || 'Your answers could not be submitted. Please try again.');
      submitStarted.current = false;
    } finally {
      setSubmitting(false);
    }
  }

  async function updateQuestion(question, updates) {
    if (!attempt || attempt.status !== 'in-progress' || saveInFlight.current || submitting) return;
    saveInFlight.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await practiceApi.saveAnswer(attempt.id, question.id, updates);
      syncClock(result.serverNow);
      setAttempt(result.attempt);
    } catch (caught) {
      setError(caught.message || 'Your response could not be saved. Please try again.');
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  if (status === 'loading') return <StateCard title="Opening your attempt" message="Loading saved questions and the server deadline…" />;
  if (status === 'error') return <StateCard error title="Attempt unavailable" message={error} onRetry={() => setRetry((value) => value + 1)} />;
  if (!attempt) return null;
  const questions = Array.isArray(attempt.questions) ? attempt.questions : [];
  const answered = questions.filter(hasSelectedAnswer).length;
  const unanswered = questions.length - answered;
  const reviewCount = questions.filter((item) => item.markedForReview).length;
  const question = questions[currentIndex];

  return <>
    <div className="practice-heading practice-attempt-heading"><p className="eyebrow"><span className="eyebrow-dot" /> {attempt.mode === 'mock' ? 'TIMED MOCK TEST' : 'MCQ PRACTICE'}</p><h1>{attempt.title}</h1><p>{questions.length} questions · {attempt.maximumMarks} maximum marks{attempt.negativeMarkingEnabled ? ` · ${attempt.negativeMarksPerQuestion} marks off per incorrect answer` : ''}</p></div>
    {error && <p className="practice-inline-error" role="alert">{error}</p>}
    {attempt.status === 'in-progress' ? !question ? <div className="practice-empty" role="status"><h2>No questions are assigned to this attempt</h2><p>Contact support before leaving this page.</p></div> : <div className="practice-attempt-layout">
      <section className="practice-question-panel" aria-label="Active examination question">
        <div className="practice-question-topline"><span aria-live="polite">QUESTION {currentIndex + 1} OF {questions.length}</span>{remaining !== null && <strong className={`practice-timer ${remaining < 60_000 ? 'practice-timer-low' : ''}`} role="timer" aria-label={`Time left ${formatTime(remaining)}`}>Time left {formatTime(remaining)}</strong>}</div>
        <h2>{question.prompt}</h2>
        <QuestionImage key={question.id} image={question.image} questionNumber={currentIndex + 1} />
        <div className="practice-options">{question.options.map((option, index) => <button key={`${question.id}-${index}`} className={`practice-option ${question.selectedOptionIndex === index ? 'is-selected' : ''}`} type="button" aria-pressed={question.selectedOptionIndex === index} disabled={saving || submitting} onClick={() => void updateQuestion(question, { selectedOptionIndex: index })}><span>{String.fromCharCode(65 + index)}</span>{option}</button>)}</div>
        <div className="practice-question-actions">
          <div className="practice-question-control-group">
            <button className="secondary-button" type="button" disabled={saving || submitting} onClick={() => void updateQuestion(question, { selectedOptionIndex: null })}>Clear response</button>
            <button className="secondary-button" type="button" disabled={saving || submitting} aria-pressed={Boolean(question.markedForReview)} onClick={() => void updateQuestion(question, { markedForReview: !question.markedForReview })}>{question.markedForReview ? 'Remove review mark' : 'Mark for review'}</button>
          </div>
          <span role="status">{saving ? 'Saving response…' : hasSelectedAnswer(question) ? 'Response saved' : 'Not answered'}</span>
        </div>
        <div className="practice-step-actions"><button className="secondary-button" type="button" disabled={currentIndex === 0} onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}>Previous</button><button className="primary-button" type="button" disabled={currentIndex >= questions.length - 1} onClick={() => setCurrentIndex((index) => Math.min(questions.length - 1, index + 1))}>Next question <Icon name="arrow" size={15} /></button></div>
        <button ref={submitButtonRef} className="practice-submit-button" type="button" disabled={saving || submitting} onClick={() => setSubmitDialogOpen(true)}>Submit test</button>
        <p className="practice-content-note">Responses save as you go. Browser leave warnings may not prevent every interruption.</p>
      </section>
      <aside className="practice-navigator" aria-label="Question navigation">
        <p className="eyebrow">QUESTION NAVIGATOR</p><h2>Your progress</h2><p>{answered} answered · {unanswered} unanswered · {reviewCount} marked for review</p>
        <div className="practice-question-grid">{questions.map((item, index) => {
          const selected = hasSelectedAnswer(item);
          const current = index === currentIndex;
          const label = `Go to question ${index + 1}${current ? ', current question' : ''}, ${selected ? 'answered' : 'unanswered'}${item.markedForReview ? ', marked for review' : ''}`;
          return <button key={item.id} type="button" aria-label={label} aria-current={current ? 'step' : undefined} className={`${current ? 'is-current' : ''} ${selected ? 'is-answered' : 'is-unanswered'} ${item.markedForReview ? 'is-review' : ''}`} onClick={() => setCurrentIndex(index)}>{index + 1}</button>;
        })}</div>
        <div className="practice-legend" aria-label="Question status legend"><span><i className="current-dot" /> Current</span><span><i className="answered-dot" /> Answered</span><span><i className="unanswered-dot" /> Unanswered</span><span><i className="review-dot" /> Marked for review</span></div>
        <a className="practice-history-link" href="/practice/attempts">Attempt history</a>
      </aside>
      {submitDialogOpen && <div className="practice-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setSubmitDialogOpen(false); }}>
        <section className="practice-submit-dialog" role="dialog" aria-modal="true" aria-labelledby="practice-submit-title" aria-describedby="practice-submit-description" onKeyDown={(event) => {
          if (event.key === 'Escape' && !submitting) setSubmitDialogOpen(false);
          if (event.key === 'Tab') {
            const focusableButtons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
            const firstButton = focusableButtons[0];
            const lastButton = focusableButtons.at(-1);
            if (event.shiftKey && document.activeElement === firstButton) {
              event.preventDefault();
              lastButton?.focus();
            } else if (!event.shiftKey && document.activeElement === lastButton) {
              event.preventDefault();
              firstButton?.focus();
            }
          }
        }}>
          <p className="eyebrow">FINAL CHECK</p><h2 id="practice-submit-title">Submit this test?</h2><p id="practice-submit-description">Your saved responses will be submitted for server-side evaluation. You can return to the test if you are not ready.</p>
          <div className="practice-submit-counts"><div><strong>{answered}</strong><span>Answered</span></div><div><strong>{unanswered}</strong><span>Unanswered</span></div><div><strong>{reviewCount}</strong><span>Marked for review</span></div></div>
          <div className="practice-submit-dialog-actions"><button ref={returnButtonRef} className="secondary-button" type="button" disabled={submitting} onClick={() => setSubmitDialogOpen(false)}>Return to test</button><button className="practice-submit-button" type="button" disabled={saving || submitting} onClick={() => void submit()}>{submitting ? 'Submitting…' : 'Confirm submission'}</button></div>
        </section>
      </div>}
    </div> : <section ref={resultPanelRef} className="practice-result-panel" tabIndex={-1} aria-labelledby="practice-result-title"><p className="eyebrow">{attempt.status === 'timed-out' ? 'TIME EXPIRED · SUBMITTED' : 'ATTEMPT SUBMITTED'}</p><h2 id="practice-result-title">Your result</h2><strong className="practice-result-score">{attempt.result?.score ?? 0}<span> / {attempt.result?.maximumMarks ?? attempt.maximumMarks}</span></strong><div className="practice-result-metrics"><div><strong>{attempt.result?.correctAnswers ?? 0}</strong><span>Correct</span></div><div><strong>{attempt.result?.incorrectAnswers ?? 0}</strong><span>Incorrect</span></div><div><strong>{attempt.result?.unansweredQuestions ?? 0}</strong><span>Unanswered</span></div><div><strong>{attempt.result?.accuracyPercent ?? 0}%</strong><span>Accuracy</span></div></div><div className="practice-result-actions"><a className="secondary-button" href="/practice">Back to practice <Icon name="arrow" size={15} /></a><a className="practice-text-link" href="/practice/attempts">View all attempts</a></div>
      {attempt.mode === 'mock' && !attempt.allowAnswerReview && <p className="practice-content-note">Answer review has been disabled for this mock test.</p>}
      <div className="practice-review-list"><h3>{attempt.mode === 'practice' ? 'Review your answers' : 'Answer review'}</h3>{questions.map((item, index) => <article className="practice-review-item" key={item.id}><p className="practice-card-kicker">QUESTION {index + 1}{item.markedForReview ? ' · MARKED FOR REVIEW' : ''}</p><h4>{item.prompt}</h4><QuestionImage image={item.image} questionNumber={index + 1} /><p>Your answer: {!hasSelectedAnswer(item) ? 'Unanswered' : `${String.fromCharCode(65 + item.selectedOptionIndex)}. ${item.options[item.selectedOptionIndex]}`}</p>{item.review && <><p className={item.review.isCorrect ? 'practice-correct-text' : 'practice-wrong-text'}>Correct answer: {String.fromCharCode(65 + item.review.correctAnswerIndex)}. {item.options[item.review.correctAnswerIndex]}</p>{item.review.explanation && <p className="practice-explanation">{item.review.explanation}</p>}</>}</article>)}</div>
    </section>}
  </>;
}

export default function PracticePage({ view = 'hub', attemptId = null }) {
  const content = useMemo(() => view === 'history' ? <AttemptHistory /> : attemptId ? <AttemptRunner attemptId={attemptId} /> : <PracticeHub />, [view, attemptId]);
  return <PageFrame>{content}</PageFrame>;
}
