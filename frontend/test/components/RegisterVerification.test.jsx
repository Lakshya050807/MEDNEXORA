import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RegisterPage from '../../src/pages/RegisterPage.jsx';
import AppRoutes from '../../src/routes/AppRoutes.jsx';
import { authApi, AuthApiError } from '../../src/services/authApi.js';

const { authState } = vi.hoisted(() => ({ authState: { user: null, register: vi.fn() } }));
vi.mock('../../src/context/AuthContext.jsx', () => ({
  useAuth: () => authState,
}));

vi.mock('../../src/services/authApi.js', () => {
  class MockAuthApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }
  return {
    AuthApiError: MockAuthApiError,
    authApi: {
      register: vi.fn(),
      requestRegistrationOtp: vi.fn(),
      verifyRegistrationOtp: vi.fn(),
      login: vi.fn(),
      currentUser: vi.fn(),
      logout: vi.fn(),
      requestPasswordReset: vi.fn(),
      completePasswordReset: vi.fn(),
      studentDashboard: vi.fn(),
      claimFreeMaterial: vi.fn(),
    },
  };
});

const email = 'student@example.test';
const token = 'A'.repeat(43);
const genericRequestMessage = 'If this email address can be used for registration, a verification code will be sent.';

describe('student registration email verification flow', () => {
  beforeEach(() => {
    authState.user = null;
    authState.register.mockReset();
    authApi.requestRegistrationOtp.mockReset();
    authApi.verifyRegistrationOtp.mockReset();
    window.history.replaceState({}, '', '/register');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1366 });
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers /register explicitly and begins with an email-only step', () => {
    render(<AppRoutes />);
    expect(screen.getByRole('heading', { name: 'Verify your email to begin.' })).toBeTruthy();
    expect(screen.getByLabelText('Email address')).toBeTruthy();
    expect(screen.queryByLabelText('Full name')).toBeNull();
  });

  it('validates email before requesting a code and shows a generic response', async () => {
    authApi.requestRegistrationOtp.mockResolvedValue({ message: genericRequestMessage });
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: /Send Verification Code/u }));
    expect(await screen.findByText('Email address is required.')).toBeTruthy();
    expect(authApi.requestRegistrationOtp).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Email address/u), { target: { value: '  ' + email + '  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Send Verification Code/u }));
    expect((await screen.findByRole('status')).textContent).toContain(genericRequestMessage);
    expect(screen.getByLabelText(/^Six-digit verification code/u)).toBeTruthy();
    expect(authApi.requestRegistrationOtp).toHaveBeenCalledWith({ email });
  });

  it('prevents duplicate request submissions while a request is pending', async () => {
    let resolveRequest;
    authApi.requestRegistrationOtp.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
    const button = screen.getByRole('button', { name: /Send Verification Code/u });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(authApi.requestRegistrationOtp).toHaveBeenCalledTimes(1);
    resolveRequest({ message: genericRequestMessage });
    expect(await screen.findByLabelText(/^Six-digit verification code/u)).toBeTruthy();
  });

  it('accepts pasted digits only, rejects invalid codes, and proceeds only with a server proof token', async () => {
    authApi.requestRegistrationOtp.mockResolvedValue({ message: genericRequestMessage });
    authApi.verifyRegistrationOtp
      .mockRejectedValueOnce(new AuthApiError('The code is invalid or expired. Request a new code and try again.', 400))
      .mockResolvedValueOnce({ message: 'Email verified. Continue creating your student account.', verificationToken: token });
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
    fireEvent.click(screen.getByRole('button', { name: /Send Verification Code/u }));
    const otpInput = await screen.findByLabelText(/^Six-digit verification code/u);
    expect(otpInput.getAttribute('inputmode')).toBe('numeric');
    expect(otpInput.getAttribute('maxlength')).toBe('6');
    fireEvent.change(otpInput, { target: { value: '12x3456' } });
    expect(otpInput.value).toBe('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verify Email' }));
    expect((await screen.findByRole('alert')).textContent).toContain('invalid or expired');
    expect(screen.queryByLabelText('Full name')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Verify Email' }));
    expect(await screen.findByLabelText('Full name')).toBeTruthy();
    expect(screen.getByLabelText(/^Verified email address/u).value).toBe(email);
    expect(authApi.verifyRegistrationOtp).toHaveBeenCalledWith({ email, otp: '123456' });
  });

  it('checks password confirmation and sends the verified server token on final registration', async () => {
    const navigate = vi.fn();
    authApi.requestRegistrationOtp.mockResolvedValue({ message: genericRequestMessage });
    authApi.verifyRegistrationOtp.mockResolvedValue({ verificationToken: token });
    authState.register.mockResolvedValue({ id: 'student-1' });
    render(<RegisterPage navigate={navigate} />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
    fireEvent.click(screen.getByRole('button', { name: /Send Verification Code/u }));
    fireEvent.change(await screen.findByLabelText(/^Six-digit verification code/u), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify Email' }));
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Student Name' } });
    fireEvent.change(screen.getByLabelText(/^Password/u), { target: { value: 'secure-student-password-2026' } });
    fireEvent.change(screen.getByLabelText(/^Confirm password/u), { target: { value: 'different-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('The passwords do not match.')).toBeTruthy();
    expect(authState.register).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Confirm password/u), { target: { value: 'secure-student-password-2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(authState.register).toHaveBeenCalledWith({
      name: 'Student Name',
      email,
      password: 'secure-student-password-2026',
      verificationToken: token,
    }));
    expect(navigate).toHaveBeenCalledWith('/student/dashboard');
    expect(window.localStorage.length).toBe(0);
  });

  it('carries an admin invitation code through OTP verification without opening public registration', async () => {
    const navigate = vi.fn();
    const invitationToken = 'B'.repeat(43);
    authApi.requestRegistrationOtp.mockResolvedValue({ message: genericRequestMessage });
    authApi.verifyRegistrationOtp.mockResolvedValue({ verificationToken: token });
    authState.register.mockResolvedValue({ id: 'invited-student' });
    render(<RegisterPage navigate={navigate} />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
    fireEvent.change(screen.getByLabelText('Administrator invitation code'), { target: { value: invitationToken } });
    fireEvent.click(screen.getByRole('button', { name: /Send Verification Code/u }));
    await waitFor(() => expect(authApi.requestRegistrationOtp).toHaveBeenCalledWith({ email, invitationToken }));
    fireEvent.change(await screen.findByLabelText(/^Six-digit verification code/u), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify Email' }));
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Invited Student' } });
    fireEvent.change(screen.getByLabelText(/^Password/u), { target: { value: 'safe-student-password-2026' } });
    fireEvent.change(screen.getByLabelText(/^Confirm password/u), { target: { value: 'safe-student-password-2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(authState.register).toHaveBeenCalledWith({
      name: 'Invited Student',
      email,
      password: 'safe-student-password-2026',
      verificationToken: token,
      invitationToken,
    }));
    expect(navigate).toHaveBeenCalledWith('/student/dashboard');
  });

  it('enforces a 60-second resend cooldown and keeps the form usable on mobile', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    authApi.requestRegistrationOtp.mockResolvedValue({ message: genericRequestMessage });
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Send Verification Code/u }));
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Resend code in 60s' }).disabled).toBe(true);
    for (let second = 0; second < 60; second += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }
    expect(screen.getByRole('button', { name: 'Resend verification code' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Verify Email' })).toBeTruthy();
  });

  it('shows a safe backend error and does not advance when delivery is unavailable', async () => {
    authApi.requestRegistrationOtp.mockRejectedValue(new AuthApiError('Student registration is temporarily unavailable.', 503));
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
    fireEvent.click(screen.getByRole('button', { name: /Send Verification Code/u }));
    expect((await screen.findByRole('alert')).textContent).toContain('Student registration is temporarily unavailable.');
    expect(screen.queryByLabelText('Six-digit verification code')).toBeNull();
  });
});
