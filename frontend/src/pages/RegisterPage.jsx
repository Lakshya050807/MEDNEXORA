import { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import AuthPageShell from '../components/AuthPageShell.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { authApi } from '../services/authApi.js';
import { registrationErrorMessage, validateRegistration } from '../utils/registrationValidation.js';

const cooldownSeconds = 60;

export default function RegisterPage({ navigate = (path) => window.location.assign(path) } = {}) {
  const { user, register } = useAuth();
  const [stage, setStage] = useState('email');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [invitationToken, setInvitationToken] = useState('');
  const [otp, setOtp] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const emailRef = useRef(null);
  const otpRef = useRef(null);

  useEffect(() => {
    if (!resendSeconds) return undefined;
    const timer = window.setTimeout(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  useEffect(() => {
    if (stage === 'email') emailRef.current?.focus();
    if (stage === 'otp') otpRef.current?.focus();
  }, [stage]);

  if (user) {
    return (
      <AuthPageShell title="You’re signed in." description="Continue to your student dashboard.">
        <a className="auth-submit" href="/student/dashboard">Open dashboard <Icon name="arrow" size={17} /></a>
      </AuthPageShell>
    );
  }

  const normalizedEmail = email.trim();

  const handleRequestOtp = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    const emailError = validateRegistration({ name: 'Candidate', email, password: '', confirmPassword: '' }).email;
    if (emailError) {
      setFieldErrors({ email: emailError });
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      const result = await authApi.requestRegistrationOtp({
        email: normalizedEmail,
        ...(invitationToken.trim() ? { invitationToken: invitationToken.trim() } : {}),
      });
      setNotice(result?.message || 'If this email address can be used for registration, a verification code will be sent.');
      setResendSeconds(cooldownSeconds);
      setStage('otp');
    } catch (requestError) {
      setError(registrationErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!/^\d{6}$/u.test(otp)) {
      setFieldErrors({ otp: 'Enter the six-digit verification code.' });
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      const result = await authApi.verifyRegistrationOtp({ email: normalizedEmail, otp });
      if (typeof result?.verificationToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(result.verificationToken)) {
        setError('Email verification could not be completed. Please request a new code.');
        return;
      }
      setVerificationToken(result.verificationToken);
      setOtp('');
      setNotice(result.message || 'Email verified. Continue creating your student account.');
      setStage('details');
    } catch (requestError) {
      setError(registrationErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (submitting || resendSeconds > 0) return;
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      const result = await authApi.requestRegistrationOtp({
        email: normalizedEmail,
        ...(invitationToken.trim() ? { invitationToken: invitationToken.trim() } : {}),
      });
      setNotice(result?.message || 'If this email address can be used for registration, a verification code will be sent.');
      setOtp('');
      setResendSeconds(cooldownSeconds);
    } catch (requestError) {
      setError(registrationErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangeEmail = () => {
    setStage('email');
    setInvitationToken('');
    setOtp('');
    setVerificationToken('');
    setError('');
    setNotice('');
    setFieldErrors({});
    setResendSeconds(0);
  };

  const handleCreateAccount = async (event) => {
    event.preventDefault();
    setError('');
    const trimmedName = name.trim();
    const nextErrors = validateRegistration({ name, email, password, confirmPassword });
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    if (!verificationToken) {
      setStage('email');
      setError('Verify your email address before creating an account.');
      return;
    }

    setSubmitting(true);
    try {
      await register({
        name: trimmedName,
        email: normalizedEmail,
        password,
        verificationToken,
        ...(invitationToken.trim() ? { invitationToken: invitationToken.trim() } : {}),
      });
      setStage('success');
      navigate('/student/dashboard');
    } catch (requestError) {
      setError(registrationErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageShell
      eyebrow="GOVERNMENT COMPETITIVE EXAM PREPARATION"
      title={stage === 'details' ? 'Create your candidate account.' : stage === 'success' ? 'Your account is ready.' : 'Verify your email to begin.'}
      description={stage === 'details'
        ? 'Your email is verified. Add your account details to finish registration.'
        : stage === 'success'
          ? 'Your MEDNEXORA student account has been created.'
          : 'Confirm your email address before creating a student account.'}
      footer={<span>Already have an account? <a href="/login">Log in</a></span>}
    >
      {error && <div className="auth-error" role="alert">{error}</div>}
      {notice && <p className="auth-feedback" role="status">{notice}</p>}

      {stage === 'email' && (
        <form className="auth-form" onSubmit={handleRequestOtp} noValidate>
          <label className="auth-field" htmlFor="register-email">
            <span>Email address</span>
            <input
              ref={emailRef}
              id="register-email"
              aria-label="Email address"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'register-email-error' : undefined}
            />
            {fieldErrors.email && <small id="register-email-error" className="field-error">{fieldErrors.email}</small>}
          </label>
          <label className="auth-field" htmlFor="register-invitation-code">
            <span>Administrator invitation code <small>if provided</small></span>
            <input
              id="register-invitation-code"
              aria-label="Administrator invitation code"
              name="invitationToken"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck="false"
              maxLength={64}
              value={invitationToken}
              onChange={(event) => setInvitationToken(event.target.value.trim())}
            />
          </label>
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? 'Sending code…' : 'Send Verification Code'} <Icon name="arrow" size={17} />
          </button>
          <p className="auth-privacy-note">Email verification is required before an account can be created. Restricted staging registration also requires a valid code issued by an administrator.</p>
        </form>
      )}

      {stage === 'otp' && (
        <form className="auth-form" onSubmit={handleVerifyOtp} noValidate>
          <p className="auth-field-hint">Verification for <strong>{normalizedEmail}</strong></p>
          <label className="auth-field" htmlFor="register-otp">
            <span>Six-digit verification code</span>
            <input
              ref={otpRef}
              id="register-otp"
              aria-label="Six-digit verification code"
              name="otp"
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/gu, '').slice(0, 6))}
              aria-invalid={Boolean(fieldErrors.otp)}
              aria-describedby={fieldErrors.otp ? 'register-otp-error' : 'register-otp-hint'}
            />
            {fieldErrors.otp
              ? <small id="register-otp-error" className="field-error">{fieldErrors.otp}</small>
              : <small id="register-otp-hint" className="auth-field-hint">Enter the code from your email. It expires after 10 minutes.</small>}
          </label>
          <button className="auth-submit" type="submit" disabled={submitting || otp.length !== 6}>
            {submitting ? 'Verifying…' : 'Verify Email'} <Icon name="arrow" size={17} />
          </button>
          <div className="auth-resend-row">
            <button className="auth-resend-button" type="button" onClick={handleResend} disabled={submitting || resendSeconds > 0}>
              {resendSeconds > 0 ? 'Resend code in ' + resendSeconds + 's' : 'Resend verification code'}
            </button>
            <button className="auth-resend-button" type="button" onClick={handleChangeEmail} disabled={submitting}>Change email</button>
          </div>
        </form>
      )}

      {stage === 'details' && (
        <form className="auth-form" onSubmit={handleCreateAccount} noValidate>
          <label className="auth-field" htmlFor="register-name">
            <span>Full name</span>
            <input id="register-name" aria-label="Full name" name="name" type="text" autoComplete="name" maxLength={80} required value={name} onChange={(event) => setName(event.target.value)} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'register-name-error' : undefined} />
            {fieldErrors.name && <small id="register-name-error" className="field-error">{fieldErrors.name}</small>}
          </label>
          <label className="auth-field" htmlFor="register-verified-email">
            <span>Verified email address</span>
            <input id="register-verified-email" aria-label="Verified email address" name="email" type="email" autoComplete="email" value={normalizedEmail} readOnly aria-describedby="register-verified-email-hint" />
            <small id="register-verified-email-hint" className="auth-field-hint">This address was verified for this registration.</small>
          </label>
          <label className="auth-field" htmlFor="register-password">
            <span>Password <small>12+ characters</small></span>
            <input id="register-password" aria-label="Password" name="password" type="password" autoComplete="new-password" maxLength={72} required value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'register-password-error' : 'password-guidance'} />
            {fieldErrors.password ? <small id="register-password-error" className="field-error">{fieldErrors.password}</small> : <small id="password-guidance" className="auth-field-hint">Use at least 12 characters; no more than 72 UTF-8 bytes.</small>}
          </label>
          <label className="auth-field" htmlFor="register-confirm-password">
            <span>Confirm password</span>
            <input id="register-confirm-password" aria-label="Confirm password" name="confirmPassword" type="password" autoComplete="new-password" maxLength={72} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} aria-invalid={Boolean(fieldErrors.confirmPassword)} aria-describedby={fieldErrors.confirmPassword ? 'register-confirm-error' : undefined} />
            {fieldErrors.confirmPassword && <small id="register-confirm-error" className="field-error">{fieldErrors.confirmPassword}</small>}
          </label>
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'} <Icon name="arrow" size={17} />
          </button>
          <p className="auth-privacy-note">Your password is securely hashed and never returned by the API.</p>
        </form>
      )}
    </AuthPageShell>
  );
}
