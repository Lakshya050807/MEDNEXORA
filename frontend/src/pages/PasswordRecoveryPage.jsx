import { useEffect, useState } from 'react';
import AuthPageShell from '../components/AuthPageShell.jsx';
import { authApi } from '../services/authApi.js';

function tokenFromLocation() {
  const queryToken = new URLSearchParams(window.location.search).get('token');
  const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get('token');
  return fragmentToken || queryToken || '';
}

export default function PasswordRecoveryPage({ mode }) {
  const [token] = useState(tokenFromLocation);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState(mode === 'reset' && !token ? 'error' : 'idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(mode === 'reset' && !token ? 'This password reset link is invalid or expired. Request a new link.' : '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (mode !== 'reset' || (!window.location.search.includes('token=') && !window.location.hash.includes('token='))) return;
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('token');
    cleanUrl.hash = '';
    window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}`);
  }, [mode]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if (mode === 'reset' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (mode === 'reset' && [...password].length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    if (mode === 'reset' && new TextEncoder().encode(password).length > 72) {
      setError('Password must be no more than 72 UTF-8 bytes.');
      return;
    }

    setSubmitting(true);
    try {
      const result = mode === 'forgot'
        ? await authApi.requestPasswordReset(email.trim())
        : await authApi.resetPassword({ token, password, confirmPassword });
      setMessage(result.message || 'Request received.');
      setStatus('success');
    } catch (requestError) {
      setError(requestError.message || 'Something went wrong. Please try again later.');
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'success') {
    const reset = mode === 'reset';
    return (
      <AuthPageShell
        eyebrow="ACCOUNT SECURITY"
        title={reset ? 'Password updated.' : 'Request received.'}
        description={message}
        footer={<span><a href="/login">Return to login</a></span>}
      >
        <p className="launch-gate-message" role="status">{message}</p>
      </AuthPageShell>
    );
  }

  const resetMode = mode === 'reset';
  return (
    <AuthPageShell
      eyebrow="ACCOUNT SECURITY"
      title={resetMode ? 'Choose a new password.' : 'Reset your password.'}
      description={resetMode
        ? 'Use at least 12 characters. Your other sessions will be signed out after the change.'
        : 'Enter the email address on your account. If it matches, we will send password reset instructions.'}
      footer={<span>Remember your password? <a href="/login">Log in</a></span>}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {resetMode ? <>
          <label className="auth-field" htmlFor="reset-password">
            <span>New password</span>
            <input id="reset-password" name="password" type="password" autoComplete="new-password" maxLength={72} required value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label className="auth-field" htmlFor="reset-confirm-password">
            <span>Confirm new password</span>
            <input id="reset-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" maxLength={72} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </label>
        </> : <label className="auth-field" htmlFor="recovery-email">
          <span>Email address</span>
          <input id="recovery-email" name="email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>}
        <button className="auth-submit" type="submit" disabled={submitting || (resetMode && !token)}>
          {submitting ? 'Please wait…' : resetMode ? 'Update password' : 'Send reset instructions'}
        </button>
      </form>
    </AuthPageShell>
  );
}
