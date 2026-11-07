import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AuthApiError, authApi } from '../../src/services/authApi.js';
import { AuthProvider, useAuth } from '../../src/context/AuthContext.jsx';
import ProtectedStudentRoute from '../../src/pages/ProtectedStudentRoute.jsx';

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
      studentDashboard: vi.fn(),
    },
  };
});

vi.mock('../../src/components/AuthPageShell.jsx', () => ({
  default: ({ title, description, children }) => <section><h1>{title}</h1><p>{description}</p>{children}</section>,
}));

vi.mock('../../src/pages/StudentDashboardPage.jsx', () => ({
  default: () => <div>Student dashboard details</div>,
}));

const student = { id: 'student-1', name: 'Asha Student', email: 'asha@example.test' };

function ProtectedDashboard({ navigate }) {
  return <AuthProvider><ProtectedStudentRoute navigate={navigate}><div>Private student dashboard for Asha</div></ProtectedStudentRoute></AuthProvider>;
}

function LogoutHarness() {
  const { status, user, logout } = useAuth();
  return <><p>{status}</p>{user && <p>Private student information</p>}<button type="button" onClick={() => void logout()}>Log out now</button></>;
}

function persistedPageShow() {
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: true });
  return event;
}

describe('student authentication on restored browser history pages', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.authRevalidating;
    window.history.replaceState(null, '', '/student/dashboard');
    authApi.currentUser.mockReset();
    authApi.login.mockReset();
    authApi.register.mockReset();
    authApi.logout.mockReset();
    authApi.studentDashboard.mockReset();
  });

  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.authRevalidating;
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  it('rechecks the server session after a back-forward-cache restore and hides stale private content', async () => {
    const navigate = vi.fn();
    authApi.currentUser
      .mockResolvedValueOnce({ user: student })
      .mockRejectedValueOnce(new AuthApiError('Please log in to continue.', 401));
    render(<ProtectedDashboard navigate={navigate} />);

    expect(await screen.findByText('Private student dashboard for Asha')).toBeTruthy();
    expect(authApi.currentUser).toHaveBeenCalledTimes(1);

    await act(async () => { window.dispatchEvent(persistedPageShow()); });
    expect(await screen.findByRole('heading', { name: 'Taking you to log in…' })).toBeTruthy();
    expect(screen.queryByText('Private student dashboard for Asha')).toBeNull();
    expect(authApi.currentUser).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith('/login?next=%2Fstudent%2Fdashboard');
    expect(document.documentElement.dataset.authRevalidating).toBeUndefined();
  });

  it('keeps dashboard access after a normal refresh when the server session is still valid', async () => {
    authApi.currentUser.mockResolvedValue({ user: student });
    const firstPage = render(<ProtectedDashboard />);
    expect(await screen.findByText('Private student dashboard for Asha')).toBeTruthy();
    firstPage.unmount();

    render(<ProtectedDashboard />);
    expect(await screen.findByText('Private student dashboard for Asha')).toBeTruthy();
    expect(authApi.currentUser).toHaveBeenCalledTimes(2);
  });

  it('clears the client authentication state after the server confirms logout', async () => {
    authApi.currentUser.mockResolvedValue({ user: student });
    authApi.logout.mockResolvedValue(null);
    render(<AuthProvider><LogoutHarness /></AuthProvider>);
    expect(await screen.findByText('Private student information')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Log out now' }));
    expect(await screen.findByText('anonymous')).toBeTruthy();
    expect(screen.queryByText('Private student information')).toBeNull();
    expect(authApi.logout).toHaveBeenCalledTimes(1);
  });

  it('does not trigger an extra verification for a pageshow event that is not a history restore', async () => {
    authApi.currentUser.mockResolvedValue({ user: student });
    render(<ProtectedDashboard />);
    expect(await screen.findByText('Private student dashboard for Asha')).toBeTruthy();

    await act(async () => { window.dispatchEvent(new Event('pageshow')); });
    expect(authApi.currentUser).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Private student dashboard for Asha')).toBeTruthy();
  });
});
