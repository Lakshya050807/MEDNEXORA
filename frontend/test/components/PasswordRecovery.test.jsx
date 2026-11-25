import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { authApi } from '../../src/services/authApi.js';
import LoginPage from '../../src/pages/LoginPage.jsx';
import PasswordRecoveryPage from '../../src/pages/PasswordRecoveryPage.jsx';
import AppRoutes from '../../src/routes/AppRoutes.jsx';

vi.mock('../../src/services/authApi.js', () => ({
  authApi: {
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

vi.mock('../../src/context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: null, login: vi.fn() }),
}));

vi.mock('../../src/components/AuthPageShell.jsx', () => ({
  default: ({ title, description, children, footer }) => <main><h1>{title}</h1><p>{description}</p>{children}<footer>{footer}</footer></main>,
}));

describe('Forgot Password frontend', () => {
  beforeEach(() => {
    authApi.requestPasswordReset.mockReset();
    authApi.resetPassword.mockReset();
    window.history.replaceState({}, '', '/login');
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('shows the Forgot Password link from student login', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: 'Forgot your password?' }).getAttribute('href')).toBe('/forgot-password');
  });

  it('registers the explicit forgot-password route', async () => {
    window.history.replaceState({}, '', '/forgot-password');
    render(<AppRoutes />);
    expect(await screen.findByRole('heading', { name: 'Reset your password.' })).toBeTruthy();
    expect(screen.getByLabelText('Email address')).toBeTruthy();
  });

  it('registers the explicit reset-password route', async () => {
    window.history.replaceState({}, '', '/reset-password#token=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    render(<AppRoutes />);
    expect(await screen.findByRole('heading', { name: 'Choose a new password.' })).toBeTruthy();
    expect(screen.getByLabelText('New password')).toBeTruthy();
  });

  it('submits email and displays only the generic request response', async () => {
    const generic = 'If an account exists for that email, reset instructions will be sent.';
    authApi.requestPasswordReset.mockResolvedValue({ message: generic });
    render(<PasswordRecoveryPage mode="forgot" />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: ' student@example.test ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset instructions' }));
    expect((await screen.findByRole('status')).textContent).toBe(generic);
    expect(authApi.requestPasswordReset).toHaveBeenCalledWith('student@example.test');
  });

  it('blocks duplicate submits while the request is pending', async () => {
    let finish;
    authApi.requestPasswordReset.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<PasswordRecoveryPage mode="forgot" />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'student@example.test' } });
    const button = screen.getByRole('button', { name: 'Send reset instructions' });
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(authApi.requestPasswordReset).toHaveBeenCalledTimes(1);
    finish({ message: 'If an account exists for that email, reset instructions will be sent.' });
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });

  it('validates password confirmation before calling the reset endpoint and accepts a fragment token', async () => {
    window.history.replaceState({}, '', '/reset-password#token=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    authApi.resetPassword.mockResolvedValue({ message: 'Your password has been updated. Please log in again.' });
    render(<PasswordRecoveryPage mode="reset" />);
    expect(window.location.hash).toBe('');

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-long-enough-password-1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-long-enough-password-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Passwords do not match.');
    expect(authApi.resetPassword).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-long-enough-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByRole('link', { name: 'Return to login' })).toBeTruthy();
    expect(authApi.resetPassword).toHaveBeenCalledWith({
      token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      password: 'a-long-enough-password-1',
      confirmPassword: 'a-long-enough-password-1',
    });
  });

  it('shows an invalid or expired reset error and a safe network error', async () => {
    window.history.replaceState({}, '', '/reset-password#token=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    authApi.resetPassword.mockRejectedValueOnce(new Error('This password reset link is invalid or expired.'));
    render(<PasswordRecoveryPage mode="reset" />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-long-enough-password-1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-long-enough-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This password reset link is invalid or expired.');

    authApi.resetPassword.mockRejectedValueOnce(new Error('The server could not be reached. Check that the API is running.'));
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect((await screen.findByRole('alert')).textContent).toContain('The server could not be reached.');
  });
});
