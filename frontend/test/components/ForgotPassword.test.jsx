import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../../src/context/AuthContext.jsx';
import AppRoutes from '../../src/routes/AppRoutes.jsx';
import ForgotPasswordPage from '../../src/pages/ForgotPasswordPage.jsx';
import { AuthApiError, authApi } from '../../src/services/authApi.js';

vi.mock('../../src/services/authApi.js', () => {
  class MockAuthApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  return {
    AuthApiError: MockAuthApiError,
    authApi: {
      currentUser: vi.fn(),
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      requestPasswordReset: vi.fn(),
      completePasswordReset: vi.fn(),
      studentDashboard: vi.fn(),
      claimFreeMaterial: vi.fn(),
    },
  };
});

const genericMessage = 'If an account exists, an email with password reset instructions will be sent.';
const email = 'student@example.test';
const validPassword = 'a-secure-new-password';

function renderRequestPage(props = {}) {
  return render(<ForgotPasswordPage {...props} />);
}

async function requestCode() {
  authApi.requestPasswordReset.mockResolvedValue({ message: genericMessage });
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
  if (vi.isFakeTimers()) {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
      await Promise.resolve();
    });
  } else {
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
    await screen.findByLabelText('Six-digit code');
  }
}

function enterValidResetDetails() {
  fireEvent.change(screen.getByLabelText('Six-digit code'), { target: { value: '012345' } });
  fireEvent.change(screen.getByLabelText(/^New password/u), { target: { value: validPassword } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: validPassword } });
}

describe('student forgot-password experience', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/forgot-password');
    authApi.currentUser.mockRejectedValue(new AuthApiError('Please log in to continue.', 401));
    authApi.requestPasswordReset.mockReset();
    authApi.completePasswordReset.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the Forgot password link on the existing login route', async () => {
    window.history.replaceState({}, '', '/login');
    render(<AuthProvider><AppRoutes /></AuthProvider>);

    const link = screen.getByRole('link', { name: 'Forgot password?' });
    expect(link.getAttribute('href')).toBe('/forgot-password');
  });

  it('registers /forgot-password as an explicit application route', () => {
    render(<AuthProvider><AppRoutes /></AuthProvider>);
    expect(screen.getByRole('heading', { name: 'Reset your password.' })).toBeTruthy();
    expect(screen.getByLabelText('Email address')).toBeTruthy();
  });

  it('submits email and displays the generic backend response before showing the OTP stage', async () => {
    authApi.requestPasswordReset.mockResolvedValue({ message: genericMessage });
    renderRequestPage();

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));

    expect((await screen.findByRole('status')).textContent).toContain(genericMessage);
    expect(screen.getByLabelText('Six-digit code')).toBeTruthy();
    expect(authApi.requestPasswordReset).toHaveBeenCalledWith({ email });
  });

  it('prevents repeated request submissions while the first request is pending', async () => {
    let resolveRequest;
    authApi.requestPasswordReset.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    renderRequestPage();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
    const sendButton = screen.getByRole('button', { name: 'Send reset code' });
    fireEvent.click(sendButton);
    expect(sendButton.disabled).toBe(true);
    fireEvent.click(sendButton);
    expect(authApi.requestPasswordReset).toHaveBeenCalledTimes(1);

    await act(async () => { resolveRequest({ message: genericMessage }); });
    expect(screen.getByLabelText('Six-digit code')).toBeTruthy();
  });

  it('submits OTP and new password, then navigates to login without signing the student in', async () => {
    const navigate = vi.fn();
    vi.useFakeTimers();
    authApi.completePasswordReset.mockResolvedValue({ message: 'Your password has been reset. Please log in with your new password.' });
    renderRequestPage({ navigate });
    await requestCode();
    enterValidResetDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'Your password is reset.' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Please log in with your new password.');
    expect(authApi.completePasswordReset).toHaveBeenCalledWith({
      email,
      otp: '012345',
      newPassword: validPassword,
      confirmPassword: validPassword,
    });

    await act(async () => { vi.advanceTimersByTime(1400); });
    expect(navigate).toHaveBeenCalledWith('/login');
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords before calling the completion API', async () => {
    renderRequestPage();
    await requestCode();
    fireEvent.change(screen.getByLabelText('Six-digit code'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText(/^New password/u), { target: { value: validPassword } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-different-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('The passwords do not match.')).toBeTruthy();
    expect(authApi.completePasswordReset).not.toHaveBeenCalled();
  });

  it('enforces a 60-second resend cooldown and starts a new cooldown after resend', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T10:00:00Z'));
    authApi.requestPasswordReset.mockResolvedValue({ message: genericMessage });
    renderRequestPage();
    await requestCode();

    const resend = screen.getByRole('button', { name: 'Resend code in 60s' });
    expect(resend.disabled).toBe(true);
    await act(async () => { vi.advanceTimersByTime(60_000); });
    const enabledResend = screen.getByRole('button', { name: 'Resend reset code' });
    expect(enabledResend.disabled).toBe(false);

    fireEvent.click(enabledResend);
    await act(async () => { await Promise.resolve(); });
    expect(authApi.requestPasswordReset).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Resend code in 60s' }).disabled).toBe(true);
  });

  it('shows safe invalid or expired OTP errors from the backend', async () => {
    authApi.completePasswordReset.mockRejectedValue(new AuthApiError('The code is invalid or expired. Please request a new code.', 400));
    renderRequestPage();
    await requestCode();
    enterValidResetDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect((await screen.findByRole('alert')).textContent).toContain('The code is invalid or expired. Please request a new code.');
    expect(screen.getByLabelText('Six-digit code')).toBeTruthy();
  });

  it('shows a safe network error without changing the request stage', async () => {
    authApi.requestPasswordReset.mockRejectedValue(new AuthApiError('The server could not be reached. Check that the API is running.', 0));
    renderRequestPage();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));

    expect((await screen.findByRole('alert')).textContent).toContain('The server could not be reached. Check that the API is running.');
    expect(screen.queryByLabelText('Six-digit code')).toBeNull();
  });

  it('keeps OTP entry usable at a narrow mobile viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    renderRequestPage();
    await requestCode();

    const otpInput = screen.getByLabelText('Six-digit code');
    expect(otpInput.getAttribute('inputmode')).toBe('numeric');
    expect(otpInput.getAttribute('maxlength')).toBe('6');
    expect(screen.getByRole('button', { name: /Reset password/u })).toBeTruthy();
  });
});
