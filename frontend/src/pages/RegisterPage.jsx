import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import AuthPageShell from '../components/AuthPageShell.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { registrationErrorMessage, validateRegistration } from '../utils/registrationValidation.js';
import { postAuthenticationPath } from '../utils/authRedirect.js';
import { launchApi } from '../services/launchApi.js';

export default function RegisterPage() {
  const { user, register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [registrationAvailability, setRegistrationAvailability] = useState('checking');

  useEffect(() => {
    let active = true;
    launchApi.getStatus().then((status) => {
      if (active) setRegistrationAvailability(status.registrationEnabled ? 'open' : 'closed');
    }).catch(() => {
      if (active) setRegistrationAvailability('unavailable');
    });
    return () => { active = false; };
  }, []);

  if (user) {
    return (
      <AuthPageShell title="You’re signed in." description="Continue to your student dashboard.">
        <a className="auth-submit" href={postAuthenticationPath()}>Continue <Icon name="arrow" size={17} /></a>
      </AuthPageShell>
    );
  }

  if (registrationAvailability !== 'open') {
    const checking = registrationAvailability === 'checking';
    const title = checking ? 'Checking registration availability.' : 'Registration is not available.';
    const description = checking
      ? 'Please wait while we check whether new student accounts can be created.'
      : registrationAvailability === 'closed'
        ? 'New student registration is temporarily unavailable while launch information is being finalized. Existing students can still log in.'
        : 'We could not verify registration availability. Please try again later or use your existing account to log in.';
    return (
      <AuthPageShell title={title} description={description} footer={<span>Already have an account? <a href="/login">Log in</a></span>}>
        {!checking && <p className="launch-gate-message" role="status">New accounts can be created after the required public information and policies are completed and approved.</p>}
        {checking && <p className="launch-gate-message" role="status">Checking current availability…</p>}
      </AuthPageShell>
    );
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    const trimmedName = name.trim();
    const normalizedEmail = email.trim();
    const nextErrors = validateRegistration({ name, email, password, confirmPassword });

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      await register({ name: trimmedName, email: normalizedEmail, password });
      window.location.assign(postAuthenticationPath());
    } catch (requestError) {
      setError(registrationErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageShell
      eyebrow="GOVERNMENT COMPETITIVE EXAM PREPARATION"
      title="Create your candidate account."
      description="Register to access your exam preparation dashboard and study resources."
      footer={<span>Already have an account? <a href={`/login?next=${encodeURIComponent(postAuthenticationPath())}`}>Log in</a></span>}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <label className="auth-field" htmlFor="register-name">
          <span>Full name</span>
          <input id="register-name" name="name" type="text" autoComplete="name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'register-name-error' : undefined} />
          {fieldErrors.name && <small id="register-name-error" className="field-error">{fieldErrors.name}</small>}
        </label>
        <label className="auth-field" htmlFor="register-email">
          <span>Email address</span>
          <input id="register-email" name="email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'register-email-error' : undefined} />
          {fieldErrors.email && <small id="register-email-error" className="field-error">{fieldErrors.email}</small>}
        </label>
        <label className="auth-field" htmlFor="register-password">
          <span>Password <small>12+ characters</small></span>
          <input id="register-password" name="password" type="password" autoComplete="new-password" maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'register-password-error' : 'password-guidance'} />
          {fieldErrors.password ? <small id="register-password-error" className="field-error">{fieldErrors.password}</small> : <small id="password-guidance" className="field-hint">Use at least 12 characters; no more than 72 UTF-8 bytes.</small>}
        </label>
        <label className="auth-field" htmlFor="register-confirm-password">
          <span>Confirm password</span>
          <input id="register-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" maxLength={72} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} aria-invalid={Boolean(fieldErrors.confirmPassword)} aria-describedby={fieldErrors.confirmPassword ? 'register-confirm-error' : undefined} />
          {fieldErrors.confirmPassword && <small id="register-confirm-error" className="field-error">{fieldErrors.confirmPassword}</small>}
        </label>
        <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'} <Icon name="arrow" size={17} /></button>
        <p className="auth-privacy-note">Your password is securely hashed and never returned by the API.</p>
      </form>
    </AuthPageShell>
  );
}
