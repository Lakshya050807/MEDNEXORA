import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import AuthPageShell from '../components/AuthPageShell.jsx';
import { adminApi } from '../services/adminApi.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,31}$/iu;

export default function AdminLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    const normalizedUsername = username.trim();
    if (!(usernamePattern.test(normalizedUsername) || emailPattern.test(normalizedUsername)) || normalizedUsername.length > 254 || !password || new TextEncoder().encode(password).length > 72) {
      setError('Enter a valid administrator username and password.');
      return;
    }
    setSubmitting(true);
    try {
      await adminApi.login({ username: normalizedUsername, password });
      window.location.assign('/admin');
    } catch (requestError) {
      setError(requestError.message || 'We couldn’t verify administrator access.');
      if (requestError.status === 401) setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageShell eyebrow="RESTRICTED ADMIN ACCESS" title="Sign in to the admin workspace." description="Administrator access is granted separately and is never available through student registration." footer={<span>Student account? <a href="/login">Use student login</a></span>} footerNote="Restricted administrator access for MEDNEXORA Government Competitive Exam Preparation.">
      <form className="auth-form" onSubmit={submit} noValidate>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <label className="auth-field" htmlFor="admin-login-username"><span>Admin username</span><input id="admin-login-username" type="text" autoComplete="username" maxLength={254} value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
        <label className="auth-field" htmlFor="admin-login-password"><span>Password</span><input id="admin-login-password" type="password" autoComplete="current-password" maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'Verifying…' : 'Admin sign in'} <Icon name="arrow" size={17} /></button>
      </form>
    </AuthPageShell>
  );
}
