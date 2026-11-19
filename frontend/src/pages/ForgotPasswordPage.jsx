import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import AuthPageShell from '../components/AuthPageShell.jsx';
import { authApi } from '../services/authApi.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;
const genericRequestMessage = 'If an account exists, an email with password reset instructions will be sent.';
const passwordResetSuccessMessage = 'Your password has been reset. Please log in with your new password.';
const resendCooldownMs = 60_000;

function navigateToLogin() {
  window.location.assign('/login');
}

function passwordErrors({ otp, newPassword, confirmPassword }) {
  const errors = {};
  if (!/^\d{6}$/u.test(otp)) errors.otp = 'Enter the six-digit code from the reset email.';
  if (!newPassword) errors.newPassword = 'Enter a new password.';
  else if ([...newPassword].length < 12) errors.newPassword = 'Password must be at least 12 characters.';
  else if (new TextEncoder().encode(newPassword).length > 72) errors.newPassword = 'Password must be no more than 72 UTF-8 bytes.';
  if (!confirmPassword) errors.confirmPassword = 'Please confirm your new password.';
  else if (newPassword !== confirmPassword) errors.confirmPassword = 'The passwords do not match.';
  return errors;
}

export default function ForgotPasswordPage({ navigate = navigateToLogin }) {
  const [stage, setStage] = useState('request');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);

  useEffect(() => {
    if (stage !== 'success') return undefined;
    const timeout = window.setTimeout(() => navigate('/login'), 1400);
    return () => window.clearTimeout(timeout);
  }, [stage, navigate]);

  useEffect(() => {
    if (!cooldownUntil) return undefined;
    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setResendSeconds(remaining);
      if (remaining === 0) window.clearInterval(interval);
    };
    const interval = window.setInterval(updateRemaining, 1000);
    updateRemaining();
    return () => window.clearInterval(interval);
  }, [cooldownUntil]);

  const startCooldown = () => {
    const nextCooldown = Date.now() + resendCooldownMs;
    setCooldownUntil(nextCooldown);
    setResendSeconds(60);
  };

  const handleRequest = async (event) => {
    event.preventDefault();
    if (submitting || resendSeconds > 0) return;
    setError('');
    setMessage('');
    const normalizedEmail = email.trim();
    const nextErrors = {};
    if (!normalizedEmail) nextErrors.email = 'Email address is required.';
    else if (!emailPattern.test(normalizedEmail) || normalizedEmail.length > 254) nextErrors.email = 'Please enter a valid email address.';
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    startCooldown();
    try {
      const result = await authApi.requestPasswordReset({ email: normalizedEmail });
      setEmail(normalizedEmail);
      setOtp('');
      setStage('reset');
      setMessage(typeof result?.message === 'string' ? result.message : genericRequestMessage);
    } catch (requestError) {
      setError(requestError.message || 'Something went wrong. Please try again later.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleComplete = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setMessage('');
    const nextErrors = passwordErrors({ otp, newPassword, confirmPassword });
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      const result = await authApi.completePasswordReset({
        email,
        otp,
        newPassword,
        confirmPassword,
      });
      setMessage(typeof result?.message === 'string' ? result.message : passwordResetSuccessMessage);
      setStage('success');
    } catch (requestError) {
      setError(requestError.message || 'Something went wrong. Please try again later.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (submitting || resendSeconds > 0) return;
    setError('');
    setMessage('');
    setOtp('');
    setSubmitting(true);
    startCooldown();
    try {
      const result = await authApi.requestPasswordReset({ email });
      setMessage(typeof result?.message === 'string' ? result.message : genericRequestMessage);
    } catch (requestError) {
      setError(requestError.message || 'Something went wrong. Please try again later.');
    } finally {
      setSubmitting(false);
    }
  };

  const changeEmail = () => {
    setStage('request');
    setOtp('');
    setNewPassword('');
    setConfirmPassword('');
    setMessage('');
    setError('');
    setFieldErrors({});
  };

  if (stage === 'success') {
    return (
      <AuthPageShell
        eyebrow="PASSWORD UPDATED"
        title="Your password is reset."
        description="Your password has been changed. You are not signed in automatically."
        footer={<span>Ready to continue? <a href="/login">Go to login</a></span>}
      >
        <div className="auth-reset-success">
          <p className="auth-feedback" role="status" aria-live="polite">{message || passwordResetSuccessMessage}</p>
          <a className="auth-submit" href="/login">Go to login <Icon name="arrow" size={17} /></a>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell
      eyebrow="STUDENT ACCOUNT RECOVERY"
      title={stage === 'request' ? 'Reset your password.' : 'Enter your reset code.'}
      description={stage === 'request'
        ? 'Enter your student account email. If an account exists, reset instructions will be sent.'
        : `If an account exists for ${email}, a reset code will be sent. Enter the six-digit code and choose a new password.`}
      footer={<span>Remembered your password? <a href="/login">Return to login</a></span>}
    >
      {message && <p className="auth-feedback" role="status" aria-live="polite">{message}</p>}
      {error && <div className="auth-error" role="alert">{error}</div>}

      {stage === 'request' ? (
        <form className="auth-form" onSubmit={handleRequest} noValidate>
          <label className="auth-field" htmlFor="reset-email">
            <span>Email address</span>
            <input
              id="reset-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'reset-email-error' : undefined}
              required
            />
            {fieldErrors.email && <small id="reset-email-error" className="field-error">{fieldErrors.email}</small>}
          </label>
          <button className="auth-submit" type="submit" disabled={submitting || resendSeconds > 0}>
            {submitting ? 'Sending…' : resendSeconds > 0 ? `Try again in ${resendSeconds}s` : 'Send reset code'}
          </button>
        </form>
      ) : (
        <>
          <form className="auth-form" onSubmit={handleComplete} noValidate>
            <label className="auth-field" htmlFor="reset-otp">
              <span>Six-digit code</span>
              <input
                id="reset-otp"
                name="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/gu, '').slice(0, 6))}
                aria-invalid={Boolean(fieldErrors.otp)}
                aria-describedby={fieldErrors.otp ? 'reset-otp-error' : undefined}
                required
              />
              {fieldErrors.otp && <small id="reset-otp-error" className="field-error">{fieldErrors.otp}</small>}
            </label>
            <label className="auth-field" htmlFor="reset-new-password">
              <span>New password</span>
              <input
                id="reset-new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                maxLength={72}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                aria-invalid={Boolean(fieldErrors.newPassword)}
                aria-describedby={fieldErrors.newPassword ? 'reset-new-password-error' : 'reset-password-guidance'}
                required
              />
              {fieldErrors.newPassword
                ? <small id="reset-new-password-error" className="field-error">{fieldErrors.newPassword}</small>
                : <small id="reset-password-guidance" className="auth-field-hint">Use at least 12 characters; no more than 72 UTF-8 bytes.</small>}
            </label>
            <label className="auth-field" htmlFor="reset-confirm-password">
              <span>Confirm new password</span>
              <input
                id="reset-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                maxLength={72}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                aria-invalid={Boolean(fieldErrors.confirmPassword)}
                aria-describedby={fieldErrors.confirmPassword ? 'reset-confirm-password-error' : undefined}
                required
              />
              {fieldErrors.confirmPassword && <small id="reset-confirm-password-error" className="field-error">{fieldErrors.confirmPassword}</small>}
            </label>
            <button className="auth-submit" type="submit" disabled={submitting}>
              {submitting ? 'Resetting password…' : 'Reset password'}
            </button>
          </form>
          <div className="auth-resend-row">
            <button className="auth-resend-button" type="button" onClick={handleResend} disabled={submitting || resendSeconds > 0}>
              {submitting ? 'Please wait…' : resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : 'Resend reset code'}
            </button>
            <button className="auth-resend-button" type="button" onClick={changeEmail} disabled={submitting}>Use a different email</button>
          </div>
        </>
      )}
    </AuthPageShell>
  );
}
