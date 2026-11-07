import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import StudentDashboardPage from '../../src/pages/StudentDashboardPage.jsx';
import { authApi } from '../../src/services/authApi.js';

vi.mock('../../src/services/authApi.js', () => {
  class AuthApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
  return { AuthApiError, authApi: { studentDashboard: vi.fn() } };
});
vi.mock('../../src/context/AuthContext.jsx', () => {
  const refreshSession = vi.fn();
  return { useAuth: () => ({ user: { name: 'Asha Student' }, refreshSession }) };
});
vi.mock('../../src/components/SiteHeader.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/Icon.jsx', () => ({ default: () => null }));

describe('student My Library', () => {
  beforeEach(() => authApi.studentDashboard.mockResolvedValue({
    user: { name: 'Asha Student', email: 'asha@example.test' },
    dashboard: {
      summary: {},
      purchased: {
        courses: [],
        materials: [
          { id: 'biology-free', title: 'Biology revision notes', description: 'Biology notes.', resourceType: 'notes', accessSource: 'free', acquiredAt: '2026-11-01T00:00:00Z', subject: 'Biology', exam: 'Configured exam', downloadAvailable: true, downloadUrl: '/api/student/resources/biology-free/download' },
          { id: 'physics-paid', title: 'Physics formula sheets', description: 'Physics formulas.', resourceType: 'notes', accessSource: 'purchase', acquiredAt: '2026-11-02T00:00:00Z', subject: 'Physics', exam: 'Configured exam', downloadAvailable: true, downloadUrl: '/api/student/resources/physics-paid/download' },
        ],
      },
      recentAttempts: [], analytics: {}, orders: [], freePractice: { questionBanks: [], mockTests: [] },
    },
  }));

  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('shows free and purchased access and filters library items by search', async () => {
    render(<StudentDashboardPage />);
    expect(await screen.findByRole('heading', { name: 'Your study materials' })).toBeTruthy();
    expect(screen.getByText(/Free access · Study notes/)).toBeTruthy();
    expect(screen.getByText(/Purchased · Study notes/)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Download PDF' })[0].getAttribute('href')).toBe('/api/student/resources/biology-free/download');

    fireEvent.change(screen.getByLabelText('Search your library'), { target: { value: 'Physics' } });
    expect(await screen.findByRole('heading', { name: /Physics formula sheets/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Biology revision notes/ })).toBeNull();
  });

  it('labels partially refunded orders clearly in the student dashboard', async () => {
    authApi.studentDashboard.mockResolvedValueOnce({
      user: { name: 'Asha Student', email: 'asha@example.test' },
      dashboard: {
        summary: {}, purchased: { courses: [], materials: [] }, recentAttempts: [], analytics: {},
        orders: [{ id: 'order-partial-1', status: 'partially_refunded', amountPaise: 12000, createdAt: '2026-11-06T00:00:00Z', items: [{ title: 'Biology notes' }] }],
        freePractice: { questionBanks: [], mockTests: [] },
      },
    });
    render(<StudentDashboardPage />);
    expect(await screen.findByText('Partially refunded')).toBeTruthy();
  });
});
