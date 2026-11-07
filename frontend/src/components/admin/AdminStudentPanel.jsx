import { useEffect, useState } from 'react';
import Icon from '../Icon.jsx';
import { adminApi } from '../../services/adminApi.js';

function formatDate(value) {
  if (!value) return 'No activity recorded';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AdminStudentPanel() {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    adminApi.list('students', { page, limit: 20, q: appliedSearch }, { signal: controller.signal })
      .then((result) => {
        setItems(result.items ?? []);
        setPagination(result.pagination ?? { page, pages: 0, total: (result.items ?? []).length });
      })
      .catch((requestError) => {
        if (requestError?.name !== 'AbortError') setError(requestError.message || 'Student accounts could not be loaded.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, appliedSearch, refresh]);

  return (
    <section className="admin-resource-panel" aria-labelledby="admin-students-title">
      <div className="admin-panel-heading"><div><h2 id="admin-students-title">Students</h2><p>Read-only account, purchase access, course progress, and test activity from current records.</p></div><button className="admin-quiet-button" type="button" onClick={() => setRefresh((value) => value + 1)}><Icon name="refresh" size={15} /> Refresh</button></div>
      <div className="admin-list-card">
        <div className="admin-list-toolbar">
          <form className="admin-search-form" onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedSearch(search.trim()); }}>
            <label className="sr-only" htmlFor="admin-student-search">Search students</label>
            <input id="admin-student-search" type="search" placeholder="Search by name or email…" value={search} onChange={(event) => setSearch(event.target.value)} />
            <button className="admin-quiet-button" type="submit"><Icon name="search" size={15} /> Search</button>
          </form>
          <span className="admin-student-total">{pagination.total} registered students</span>
        </div>
        {loading ? <div className="admin-state" role="status"><span className="loading-mark" /> Loading student accounts…</div>
          : error ? <div className="admin-state is-error" role="alert"><p>{error}</p><button className="admin-quiet-button" type="button" onClick={() => setRefresh((value) => value + 1)}>Try again</button></div>
            : !items.length ? <div className="admin-state"><Icon name="user" size={21} /><p>{appliedSearch ? 'No student accounts match this search.' : 'No student accounts have been registered yet.'}</p></div>
              : <div className="admin-table-scroll"><table className="admin-table admin-students-table"><thead><tr><th>Student</th><th>Registered</th><th>Enrolled courses</th><th>Active purchases</th><th>Course progress records</th><th>Test attempts</th><th>Last activity</th></tr></thead><tbody>{items.map((student) => <tr key={student.id}><td><strong>{student.name}</strong><small>{student.email}</small></td><td>{formatDate(student.registeredAt)}</td><td>{student.enrolledCourseCount}</td><td>{student.activePurchases}</td><td>{student.courseProgressCount}</td><td>{student.testAttemptCount}</td><td>{formatDate(student.lastActivityAt)}</td></tr>)}</tbody></table></div>}
        {!loading && !error && pagination.pages > 1 && <div className="admin-pagination"><span>Page {pagination.page} of {pagination.pages}</span><div><button className="admin-quiet-button" type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="admin-quiet-button" type="button" disabled={page >= pagination.pages} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>}
      </div>
    </section>
  );
}
