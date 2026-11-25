import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AdminLoginPage from '../../src/pages/AdminLoginPage.jsx';
import AdminDashboardPage from '../../src/pages/AdminDashboardPage.jsx';
import { adminApi } from '../../src/services/adminApi.js';

vi.mock('../../src/services/adminApi.js', () => ({
  adminApi: {
    login: vi.fn(), logout: vi.fn(), changePassword: vi.fn(), profile: vi.fn(), overview: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), uploadPdf: vi.fn(),
  },
  formatRupees: (value) => `₹${value}`,
}));
vi.mock('../../src/components/AuthPageShell.jsx', () => ({
  default: ({ title, description, footer, children }) => <section><h1>{title}</h1><p>{description}</p>{children}<div>{footer}</div></section>,
}));
vi.mock('../../src/components/BrandLink.jsx', () => ({ default: () => <div>MEDNEXORA</div> }));
vi.mock('../../src/components/Icon.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/admin/AdminOrderPanel.jsx', () => ({ default: () => <div>Orders section</div> }));
vi.mock('../../src/components/admin/AdminResourcePanel.jsx', () => ({ default: ({ title, fields = [] }) => <div><div>{title} section</div>{fields.map((field) => <span key={field.name}>{field.label}</span>)}</div> }));
vi.mock('../../src/components/admin/AdminStudentPanel.jsx', () => ({ default: () => <div>Students section</div> }));
vi.mock('../../src/components/admin/AdminSettingsPanel.jsx', () => ({ default: () => <div>Settings section</div> }));

describe('MEDNEXORA admin panel', () => {
  beforeEach(() => {
    adminApi.login.mockReset();
    adminApi.logout.mockReset();
    adminApi.profile.mockReset();
    adminApi.overview.mockReset();
    adminApi.list.mockReset();
    adminApi.overview.mockResolvedValue({ metrics: {}, contentReadiness: { counts: {}, issues: [], courses: [] } });
  });

  afterEach(() => cleanup());

  it('logs in using a distinct admin username and password form', async () => {
    adminApi.login.mockImplementation(() => new Promise(() => {}));
    render(<AdminLoginPage />);
    fireEvent.change(screen.getByLabelText('Admin username'), { target: { value: 'mednexora-admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'very-secure-admin-password' } });
    fireEvent.click(screen.getByRole('button', { name: /Admin sign in/i }));
    await vi.waitFor(() => expect(adminApi.login).toHaveBeenCalledWith({ username: 'mednexora-admin', password: 'very-secure-admin-password' }));
    expect(screen.getByRole('button', { name: /Verifying/i }).hasAttribute('disabled')).toBe(true);
  });

  it('does not render admin dashboard content without a verified admin session', async () => {
    adminApi.profile.mockRejectedValue({ status: 401, message: 'Please log in to continue.' });
    adminApi.overview.mockResolvedValue({ metrics: {}, contentReadiness: { counts: {}, issues: [], courses: [] } });
    adminApi.list.mockResolvedValue({ items: [] });
    render(<AdminDashboardPage />);
    expect(await screen.findByRole('heading', { name: 'Admin sign in required.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Continue to admin login' }).getAttribute('href')).toBe('/admin/login');
    expect(screen.queryByText('Registered students')).toBeNull();
  });

  it('requests dashboard reference lists using supported integer pagination', async () => {
    adminApi.profile.mockResolvedValue({ user: { name: 'Admin User', username: 'mednexora-admin' } });
    adminApi.overview.mockResolvedValue({ metrics: {}, contentReadiness: { counts: {}, issues: [], courses: [] } });
    adminApi.list.mockResolvedValue({ items: [] });
    render(<AdminDashboardPage />);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();

    const requestedLists = adminApi.list.mock.calls.map(([resource, filters]) => ({ resource, filters }));
    expect(requestedLists).toHaveLength(7);
    for (const { filters } of requestedLists) {
      expect(filters.page).toBe(1);
      expect(filters.limit).toBe(50);
      expect(Number.isSafeInteger(filters.limit)).toBe(true);
    }
  });

  it('shows database-derived readiness counts, course checklist warnings and links to admin editors', async () => {
    adminApi.profile.mockResolvedValue({ user: { name: 'Admin User', username: 'mednexora-admin' } });
    adminApi.overview.mockResolvedValue({ metrics: {}, contentReadiness: {
      counts: {
        courses: { total: 1, published: 0, draft: 1, archived: 0 },
        subjects: { total: 3, published: 2, draft: 1, archived: 0 },
        chapters: { total: 1, published: 0, draft: 1, archived: 0 },
        topics: { total: 0, published: 0, draft: 0, archived: 0 },
        lessons: { total: 0, published: 0, draft: 0, archived: 0 },
        mcqs: { total: 0, published: 0, draft: 0, archived: 0 },
        mockTests: { total: 1, published: 0, draft: 1, archived: 0 },
        studyMaterials: { total: 2, published: 1, draft: 1, archived: 0 },
      },
      issues: [
        { key: 'courses-without-published-subjects', label: 'Courses without published subjects', count: 1, section: 'courses', examples: [{ id: 'course-1', name: 'Draft course' }] },
        { key: 'topics-without-learning-content', label: 'Topics without mapped lessons or valid questions', count: 1, section: 'curriculum', examples: [{ id: 'topic-1', name: 'Draft topic' }] },
      ],
      courses: [{ id: 'course-1', title: 'B.Sc. Nursing Entrance Preparation', publicationStatus: 'draft', issueCount: 1, checks: [
        { label: 'Configured subjects published', section: 'curriculum', status: 'warning', detail: '0 of 3 configured subjects are published.' },
      ] }],
    } });
    adminApi.list.mockResolvedValue({ items: [] });
    render(<AdminDashboardPage />);

    expect(await screen.findByRole('heading', { name: 'Educational content readiness' })).toBeTruthy();
    expect(screen.getByText('B.Sc. Nursing Entrance Preparation')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Courses without published subjects')).toBeTruthy();
    expect(screen.getByText('Draft topic')).toBeTruthy();
    expect(adminApi.overview).toHaveBeenCalledWith(expect.objectContaining({ includeContentReadiness: true, signal: expect.any(AbortSignal) }));

    fireEvent.click(screen.getByRole('button', { name: /Open Courses/i }));
    expect(await screen.findByText('Courses section')).toBeTruthy();
  });

  it('keeps the admin workspace usable and shows a retry state when readiness reporting fails', async () => {
    adminApi.profile.mockResolvedValue({ user: { name: 'Admin User', username: 'mednexora-admin' } });
    adminApi.overview.mockResolvedValue({ metrics: {}, contentReadinessError: 'Readiness could not be calculated.' });
    adminApi.list.mockResolvedValue({ items: [] });
    render(<AdminDashboardPage />);

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Content readiness unavailable' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Readiness could not be calculated.');
    expect(screen.getByText('Registered students')).toBeTruthy();
  });

  it('exposes the study material editor metadata, private upload and category filters in the existing admin panel', async () => {
    adminApi.profile.mockResolvedValue({ user: { name: 'Admin User', username: 'mednexora-admin' } });
    adminApi.overview.mockResolvedValue({ metrics: {}, contentReadiness: { counts: {}, issues: [], courses: [] } });
    adminApi.list.mockResolvedValue({ items: [] });
    render(<AdminDashboardPage />);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Study Materials' }));

    expect(await screen.findByText('Detailed description')).toBeTruthy();
    expect(screen.getByText('Material category')).toBeTruthy();
    expect(screen.getByText('Access type')).toBeTruthy();
    expect(screen.getByText('Language')).toBeTruthy();
    expect(screen.getByText('Upload or replace private PDF')).toBeTruthy();
    expect(screen.getByText('Public preview excerpt')).toBeTruthy();
  });

  it('keeps examination management simple and removes official-source controls', async () => {
    adminApi.profile.mockResolvedValue({ user: { name: 'Admin User', username: 'mednexora-admin' } });
    adminApi.overview.mockResolvedValue({ metrics: {} });
    adminApi.list.mockResolvedValue({ items: [] });
    render(<AdminDashboardPage />);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Examinations' }));

    for (const label of ['Examination Name', 'URL slug', 'Region (optional)', 'Description', 'Eligibility Notes', 'Syllabus Notes', 'Exam Pattern Notes', 'Primary Target Examination', 'Publication status']) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
    expect(screen.queryByText(/Official sources|verified source|publication evidence/i)).toBeNull();
  });

  it('revalidates a restored admin page from browser back-forward cache', async () => {
    adminApi.profile.mockResolvedValueOnce({ user: { name: 'Admin User', username: 'mednexora-admin' } })
      .mockRejectedValueOnce({ status: 401, message: 'Please log in to continue.' });
    adminApi.overview.mockResolvedValue({ metrics: { studentCount: 3 }, contentReadiness: { counts: {}, issues: [], courses: [] } });
    adminApi.list.mockResolvedValue({ items: [] });
    render(<AdminDashboardPage />);
    expect(await screen.findByText('Registered students')).toBeTruthy();

    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    window.dispatchEvent(restored);

    expect(await screen.findByRole('heading', { name: 'Admin sign in required.' })).toBeTruthy();
    expect(screen.queryByText('Registered students')).toBeNull();
  });
});
