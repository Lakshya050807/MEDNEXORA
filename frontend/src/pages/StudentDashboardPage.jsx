import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import { formatPricePaise } from '../data/catalog.js';
import { useAuth } from '../context/AuthContext.jsx';
import { AuthApiError, authApi } from '../services/authApi.js';

const resourceLabels = {
  notes: 'Study notes',
  'practice-paper': 'Practice paper',
  'previous-year-paper': 'Verified previous-year paper',
  'mock-test': 'Mock test',
  'video-course': 'Recorded course',
  'crash-course': 'Crash course',
  bundle: 'Preparation bundle',
};

const orderStatus = {
  paid: 'Paid and verified',
  partially_refunded: 'Partially refunded',
  pending: 'Payment pending',
  failed: 'Payment failed',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};

function dateLabel(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Section({ eyebrow, title, action, children, className = '' }) {
  return (
    <section className={`student-dash-section ${className}`}>
      <div className="student-dash-section-head">
        <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
        {action && <a className="student-dash-section-action" href={action.href}>{action.label}<Icon name="arrow" size={15} /></a>}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ title, children, href, linkLabel }) {
  return (
    <div className="student-dash-empty">
      <span className="student-dash-empty-icon"><Icon name="book" size={20} /></span>
      <div><strong>{title}</strong><p>{children}</p></div>
      {href && <a href={href}>{linkLabel}<Icon name="arrow" size={14} /></a>}
    </div>
  );
}

function Metric({ label, value, note, icon }) {
  return (
    <article className="student-dash-metric">
      <span className="student-dash-metric-icon"><Icon name={icon} size={18} /></span>
      <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
    </article>
  );
}

function ResourceRow({ resource }) {
  return (
    <article className="student-dash-resource">
      <div className="student-dash-resource-art">
        {resource.thumbnailUrl ? <img src={resource.thumbnailUrl} alt="" loading="lazy" /> : <Icon name="file" size={22} />}
      </div>
      <div className="student-dash-resource-copy">
        <span className="student-dash-tag">{resource.accessSource === 'free' ? 'Free access' : 'Purchased'} · {resourceLabels[resource.resourceType] ?? 'Study resource'}</span>
        <h3>{resource.detailUrl ? <a href={resource.detailUrl}>{resource.title}</a> : resource.title}</h3>
        <p>{[resource.subject, resource.exam, resource.acquiredAt ? `Added ${dateLabel(resource.acquiredAt)}` : ''].filter(Boolean).join(' · ') || 'Government Competitive Exam Preparation'}</p>
      </div>
      <div className="student-dash-resource-action">
        {resource.downloadAvailable && resource.downloadUrl
          ? <a className="student-dash-download" href={resource.downloadUrl}><Icon name="file" size={15} />Download PDF</a>
          : <span className="student-dash-unavailable" title="A private PDF is not configured for this resource."><Icon name="lock" size={14} />PDF unavailable</span>}
      </div>
    </article>
  );
}

export default function StudentDashboardPage() {
  const { user, refreshSession } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [status, setStatus] = useState('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [librarySearch, setLibrarySearch] = useState('');

  useEffect(() => {
    let active = true;
    setStatus('loading');
    authApi.studentDashboard()
      .then((result) => {
        if (!active) return;
        setDashboard(result);
        setStatus('ready');
        setErrorMessage('');
      })
      .catch(async (error) => {
        if (!active) return;
        if (error instanceof AuthApiError && error.status === 401) {
          await refreshSession();
          return;
        }
        setErrorMessage(error.message || 'The dashboard could not be loaded.');
        setStatus('error');
      });
    return () => { active = false; };
  }, [refreshSession, retryCount]);

  const data = dashboard?.dashboard;
  const profile = dashboard?.user ?? user;
  const courses = data?.purchased?.courses ?? [];
  const materials = data?.purchased?.materials ?? [];
  const filteredMaterials = materials.filter((resource) => `${resource.title} ${resource.description} ${resource.subject} ${resource.exam}`.toLocaleLowerCase().includes(librarySearch.trim().toLocaleLowerCase()));
  const analytics = data?.analytics ?? {};
  const recentAttempts = data?.recentAttempts ?? [];
  const orders = data?.orders ?? [];
  const freePractice = data?.freePractice ?? { questionBanks: [], mockTests: [] };
  const metrics = data?.summary ?? {};

  return (
    <div className="site-shell">
      <SiteHeader activePage="student" />
      <main className="student-dashboard-page">
        <div className="page-width">
          <div className="student-dash-welcome">
            <div className="student-dash-welcome-copy">
              <p className="eyebrow"><span className="eyebrow-dot" /> YOUR EXAM PREPARATION</p>
              <h1>Welcome back, <span>{profile?.name || 'student'}.</span></h1>
              <p>Your study space brings together purchased resources, course progress and results you have recorded.</p>
              <div className="student-dash-quick-links">
                <a className="student-dash-primary" href="/practice">Start practice <Icon name="arrow" size={15} /></a>
                <a href="/study-material">Explore study materials</a>
              </div>
            </div>
            <aside className="student-dash-profile" aria-label="Student profile">
              <span className="student-dash-avatar"><Icon name="user" size={22} /></span>
              <div><strong>{profile?.name || 'Student'}</strong><span>{profile?.email || 'Student account'}</span><small>Government exam candidate</small></div>
            </aside>
          </div>

          {status === 'loading' && <div className="dashboard-state" role="status"><span className="loading-mark" /><p>Loading your saved preparation data…</p></div>}
          {status === 'error' && <div className="dashboard-state dashboard-error" role="alert"><h2>Dashboard unavailable</h2><p>{errorMessage}</p><button className="secondary-button" type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again <Icon name="arrow" size={15} /></button></div>}

          {status === 'ready' && (
            <div className="student-dash-content">
              <div className="student-dash-metrics">
                <Metric label="Purchased resources" value={metrics.purchasedResources ?? 0} note="Verified access" icon="file" />
                <Metric label="Courses" value={metrics.purchasedCourses ?? 0} note="Available to continue" icon="play" />
                <Metric label="Completed attempts" value={metrics.completedAttempts ?? 0} note="Saved test results" icon="checklist" />
                <Metric label="Overall accuracy" value={metrics.overallAccuracyPercent == null ? '—' : `${metrics.overallAccuracyPercent}%`} note="Answered questions · latest 100 results" icon="spark" />
              </div>

              <Section eyebrow="YOUR LEARNING" title="Continue learning" action={{ href: '/my-courses', label: 'All courses' }}>
                {courses.length ? <div className="student-dash-course-grid">{courses.map((course) => (
                  <article className="student-dash-course" key={course.id}>
                    <div className="student-dash-course-art">{course.thumbnailUrl ? <img src={course.thumbnailUrl} alt="" loading="lazy" /> : <Icon name="play" size={23} />}</div>
                    <div className="student-dash-course-body">
                      <span className="student-dash-tag">{course.courseType === 'crash-course' ? 'Crash course' : 'Recorded course'}</span>
                      <h3>{course.title}</h3>
                      <p>{course.exam || 'Government Competitive Exam Preparation'}</p>
                      <div className="student-dash-progress-label"><span>{course.completedLessons} of {course.totalLessons} lessons</span><strong>{course.progressPercent}%</strong></div>
                      <div className="student-dash-progress" role="progressbar" aria-label={`${course.title} course progress`} aria-valuenow={course.progressPercent} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${course.progressPercent}%` }} /></div>
                      <a className="student-dash-inline-link" href={course.continueUrl}>{course.completedLessons ? 'Continue course' : 'Start course'}<Icon name="arrow" size={14} /></a>
                    </div>
                  </article>
                ))}</div> : <EmptyState title="No courses to continue yet">Purchased courses will appear here with lesson completion saved to your account.</EmptyState>}
              </Section>

              <Section eyebrow="MY LIBRARY" title="Your study materials" action={{ href: '/study-material', label: 'Browse materials' }}>
                {materials.length > 0 && <label className="student-library-search"><Icon name="search" size={16} /><span className="sr-only">Search your library</span><input type="search" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="Search your library…" /></label>}
                {filteredMaterials.length ? <div className="student-dash-resource-list">{filteredMaterials.map((resource) => <ResourceRow key={resource.id} resource={resource} />)}</div> : materials.length ? <EmptyState title="No library items match">Try another title, subject or exam search.</EmptyState> : <EmptyState title="Your library is ready for resources">Add free materials or purchase a resource to see it here.<a href="/study-material">Browse study materials<Icon name="arrow" size={14} /></a></EmptyState>}
              </Section>

              <div className="student-dash-two-column">
                <Section eyebrow="RECENT RESULTS" title="Mock-test attempts" action={{ href: '/practice/attempts', label: 'Attempt history' }}>
                  {recentAttempts.length ? <div className="student-dash-attempt-list">{recentAttempts.map((attempt) => (
                    <a className="student-dash-attempt" href={attempt.url} key={attempt.id}>
                      <span className="student-dash-attempt-icon"><Icon name="checklist" size={17} /></span>
                      <span className="student-dash-attempt-main"><strong>{attempt.title}</strong><small>{attempt.status === 'in-progress' ? 'In progress' : `${attempt.mode === 'mock' ? 'Mock test' : 'Practice'} · ${dateLabel(attempt.submittedAt || attempt.startedAt)}`}</small></span>
                      <strong className="student-dash-attempt-score">{attempt.result ? `${attempt.result.score}/${attempt.result.maximumMarks}` : 'Continue'}</strong>
                    </a>
                  ))}</div> : <EmptyState title="No mock-test attempts yet">When you submit a mock test, its saved score and date will appear here.<a href="/practice">Find a mock test<Icon name="arrow" size={14} /></a></EmptyState>}
                </Section>

                <Section eyebrow="RECORDED PERFORMANCE" title="Subject accuracy">
                  {analytics.subjectPerformance?.length ? <div className="student-dash-subject-list">{analytics.subjectPerformance.map((subject) => (
                    <div className="student-dash-subject" key={subject.id}>
                      <div><strong>{subject.name}</strong><span>{subject.correct} correct of {subject.answered} answered</span></div>
                      <div className="student-dash-progress" role="progressbar" aria-label={`${subject.name} accuracy`} aria-valuenow={subject.accuracyPercent} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${subject.accuracyPercent}%` }} /></div>
                      <b>{subject.accuracyPercent}%</b>
                    </div>
                  ))}</div> : <EmptyState title="Subject performance will build as you practise">It is calculated from submitted attempts with saved answers.</EmptyState>}
                </Section>
              </div>

              <div className="student-dash-two-column">
                <Section eyebrow="ACCURACY TREND" title="Recent progress">
                  {analytics.trend?.length ? <div className="student-dash-trend" role="list" aria-label="Accuracy across recent completed attempts">{analytics.trend.map((item) => {
                    const ratio = Math.max(4, Math.min(100, Number(item.accuracyPercent) || 0));
                    return <div className="student-dash-trend-item" role="listitem" key={item.id} title={`${item.title}: ${item.score}/${item.maximumMarks}, ${item.accuracyPercent}% accuracy`}>
                      <strong>{item.accuracyPercent}%</strong><div className="student-dash-trend-bar"><span style={{ height: `${ratio}%` }} /></div><small>{dateLabel(item.date)}</small>
                    </div>;
                  })}</div> : <EmptyState title="Your progress trend will appear here">Submit a practice set or mock test to start a recorded trend.</EmptyState>}
                </Section>

                <Section eyebrow="SUGGESTED PRACTICE" title="Topics to revisit">
                  {analytics.weakTopics?.length ? <><p className="student-dash-rule-note">{analytics.recommendationRule}</p><div className="student-dash-recommendations">{analytics.weakTopics.map((topic) => (
                    <div className="student-dash-recommendation" key={topic.id}><span><strong>{topic.name}</strong><small>{topic.subject} · {topic.correct}/{topic.answered} correct</small></span><b>{topic.accuracyPercent}%</b><a href="/practice" aria-label={`Practise ${topic.name}`}>Practise<Icon name="arrow" size={13} /></a></div>
                  ))}</div></> : <EmptyState title="No topic recommendation yet">A topic is suggested only after at least 3 answered questions and accuracy below 70%.<a href="/practice">Practise questions<Icon name="arrow" size={14} /></a></EmptyState>}
                </Section>
              </div>

              <div className="student-dash-two-column">
                <Section eyebrow="PURCHASE RECORDS" title="Order history" action={{ href: '/orders', label: 'All orders' }}>
                  {orders.length ? <div className="student-dash-order-list">{orders.map((order) => <a className="student-dash-order" href={`/orders/${encodeURIComponent(order.id)}`} key={order.id}>
                    <span><strong>Order #{order.id.slice(-8).toUpperCase()}</strong><small>{dateLabel(order.createdAt)} · {order.items?.length ?? 0} item{order.items?.length === 1 ? '' : 's'}</small></span>
                    <span className={`student-dash-order-status order-status-badge status-${order.status}`}>{orderStatus[order.status] ?? 'Status unavailable'}</span>
                    <b>{formatPricePaise(order.amountPaise) ?? '—'}</b>
                  </a>)}</div> : <EmptyState title="No orders yet">Order and verified payment status will appear here after checkout.<a href="/study-material">Browse materials<Icon name="arrow" size={14} /></a></EmptyState>}
                </Section>

                <Section eyebrow="OPEN PRACTICE" title="Free resources & mock tests">
                  <div className="student-dash-practice-links">
                    <a href="/practice"><span className="student-dash-practice-icon"><Icon name="checklist" size={18} /></span><span><strong>Free MCQ practice</strong><small>{freePractice.questionBanks?.length ? `${freePractice.questionBanks.length} published question bank${freePractice.questionBanks.length === 1 ? '' : 's'} available` : 'Browse available practice sets'}</small></span><Icon name="arrow" size={15} /></a>
                    {freePractice.questionBanks?.slice(0, 3).map((bank) => <a href="/practice" className="student-dash-practice-subitem" key={bank.id}><span>{bank.title}</span><small>{bank.subject || 'Question bank'}</small></a>)}
                    <a href="/practice"><span className="student-dash-practice-icon"><Icon name="clipboard" size={18} /></span><span><strong>Available mock tests</strong><small>{freePractice.mockTests?.length ? `${freePractice.mockTests.length} free or purchased test${freePractice.mockTests.length === 1 ? '' : 's'} ready` : 'See tests available to your account'}</small></span><Icon name="arrow" size={15} /></a>
                    {freePractice.mockTests?.slice(0, 3).map((mockTest) => <a href="/practice" className="student-dash-practice-subitem" key={mockTest.id}><span>{mockTest.title}</span><small>{[mockTest.questionCount && `${mockTest.questionCount} questions`, mockTest.durationMinutes && `${mockTest.durationMinutes} min`].filter(Boolean).join(' · ')}</small></a>)}
                  </div>
                </Section>
              </div>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
