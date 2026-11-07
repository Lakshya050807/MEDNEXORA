import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import AuthPageShell from '../components/AuthPageShell.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;

function postLoginPath() {
  const next = new URLSearchParams(window.location.search).get('next');
  if (next === '/student/dashboard' || next === '/practice' || next === '/mock-tests' || next === '/practice/attempts' || next === '/my-courses' || next === '/cart' || next === '/orders') return next;
  const orderPath = next?.match(/^\/orders\/([a-f\d]{24})$/iu);
  if (orderPath) return `/orders/${orderPath[1]}`;
  const coursePath = next?.match(/^\/courses\/([a-f\d]{24})\/learn$/iu);
  if (coursePath) return `/courses/${coursePath[1]}/learn`;
  if (next?.startsWith('/practice/attempts/')) {
    const attemptId = next.slice('/practice/attempts/'.length);
    if (/^[a-f\d]{24}$/iu.test(attemptId)) return `/practice/attempts/${attemptId}`;
  }
  return '/student/dashboard';
}

export default function LoginPage({ required = false }) {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return (
      <AuthPageShell title="You’re signed in." description="Continue to your student dashboard or checkout." footer={<a href="/register">Create another student account</a>}>
        <a className="auth-submit" href={postLoginPath()}>Continue <Icon name="arrow" size={17} /></a>
      </AuthPageShell>
    );
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    const nextErrors = {};
    const normalizedEmail = email.trim();
    if (!emailPattern.test(normalizedEmail) || normalizedEmail.length > 254) nextErrors.email = 'Enter a valid email address.';
    if (!password) nextErrors.password = 'Enter your password.';
    if (new TextEncoder().encode(password).length > 72) nextErrors.password = 'Password must be no more than 72 UTF-8 bytes.';
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      await login({ email: normalizedEmail, password });
      window.location.assign(postLoginPath());
    } catch (requestError) {
      setError(requestError.message || 'We couldn’t sign you in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageShell
      eyebrow={required ? 'STUDENT ACCESS REQUIRED' : 'WELCOME BACK'}
      title="Log in to your account."
      description={required ? 'Sign in to continue to your protected Government Competitive Exam Preparation dashboard.' : 'Access your student dashboard, courses and exam preparation resources.'}
      footer={<span>New to MEDNEXORA? <a href="/register">Create a student account</a></span>}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <label className="auth-field" htmlFor="login-email">
          <span>Email address</span>
          <input id="login-email" name="email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'login-email-error' : undefined} />
          {fieldErrors.email && <small id="login-email-error" className="field-error">{fieldErrors.email}</small>}
        </label>
        <label className="auth-field" htmlFor="login-password">
          <span>Password</span>
          <input id="login-password" name="password" type="password" autoComplete="current-password" maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'login-password-error' : undefined} />
          {fieldErrors.password && <small id="login-password-error" className="field-error">{fieldErrors.password}</small>}
        </label>
        <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Log in'} <Icon name="arrow" size={17} /></button>
      </form>
    </AuthPageShell>
  );
}
