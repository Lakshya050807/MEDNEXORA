import { useEffect } from 'react';
import AuthPageShell from '../components/AuthPageShell.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import StudentDashboardPage from './StudentDashboardPage.jsx';

function replaceLocation(url) {
  window.location.replace(url);
}

export default function ProtectedStudentRoute({ children, navigate = replaceLocation }) {
  const { status, refreshSession } = useAuth();

  useEffect(() => {
    if (status === 'anonymous') {
      const next = `${window.location.pathname}${window.location.search}`;
      navigate(`/login?next=${encodeURIComponent(next || '/student/dashboard')}`);
    }
  }, [status, navigate]);

  if (status === 'authenticated') return children ?? <StudentDashboardPage />;
  if (status === 'unavailable') {
    return (
      <AuthPageShell title="We couldn’t verify your session." description="Your dashboard stays protected while the account service is unavailable.">
        <button className="auth-submit" type="button" onClick={() => void refreshSession()}>Try again</button>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell title={status === 'anonymous' ? 'Taking you to log in…' : 'Checking your student access.'} description="Please wait while we verify your account." />
  );
}
