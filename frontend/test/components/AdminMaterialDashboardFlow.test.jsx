import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminDashboardPage from '../../src/pages/AdminDashboardPage.jsx';
import { adminApi } from '../../src/services/adminApi.js';

vi.mock('../../src/services/adminApi.js', () => ({
  adminApi: {
    login: vi.fn(), logout: vi.fn(), changePassword: vi.fn(), profile: vi.fn(), overview: vi.fn(),
    list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), uploadPdf: vi.fn(),
  },
  formatRupees: (value) => `₹${value}`,
}));

const examId = '507f1f77bcf86cd799439211';
const subjectId = '507f1f77bcf86cd799439212';
const firstPageExamId = '507f1f77bcf86cd799439214';
const courseId = '507f1f77bcf86cd799439215';

describe('admin dashboard study material create flow', () => {
  beforeEach(() => {
    adminApi.profile.mockReset().mockResolvedValue({ user: { name: 'Admin User', username: 'mednexora-admin' } });
    adminApi.overview.mockReset().mockResolvedValue({ metrics: {} });
    adminApi.list.mockReset().mockImplementation((resource, filters = {}) => {
      const items = resource === 'exams' && filters.page === 1
        ? [{ _id: firstPageExamId, name: 'First-page examination', publicationStatus: 'draft' }]
        : resource === 'exams'
          ? [{ _id: examId, name: 'Existing target examination', publicationStatus: 'draft' }]
        : resource === 'subjects'
          ? [{ _id: subjectId, name: 'Physics', exam: { _id: examId, name: 'Existing target examination' }, publicationStatus: 'draft' }]
          : resource === 'courses'
            ? [{ _id: courseId, product: { title: 'B.Sc. Nursing Entrance Preparation' }, publicationStatus: 'draft' }]
          : [];
      const pages = resource === 'exams' ? 2 : 1;
      const total = resource === 'exams' ? 51 : items.length;
      return Promise.resolve({ items, pagination: { page: filters.page ?? 1, limit: 50, total, pages } });
    });
    adminApi.create.mockReset().mockResolvedValue({ product: { id: '507f1f77bcf86cd799439213' } });
  });

  afterEach(() => cleanup());

  it('preserves the examination ID from a paginated admin exams response through POST and creates a draft material', async () => {
    render(<AdminDashboardPage />);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Study Materials' }));

    await waitFor(() => expect(document.getElementById('admin-field-products-exam')).toBeTruthy());
    const examSelect = document.getElementById('admin-field-products-exam');
    expect(Array.from(examSelect.options).map((option) => option.value)).toContain(examId);
    expect(examSelect.value).toBe('');
    expect(examSelect.options[0].textContent).toMatch(/Choose/u);
    fireEvent.change(examSelect, { target: { value: examId } });
    const subjectSelect = screen.getByLabelText(/Subject \(not required for multi-subject courses\)/i);
    expect(Array.from(subjectSelect.options).map((option) => option.value)).toEqual(['', subjectId]);
    fireEvent.change(subjectSelect, { target: { value: subjectId } });
    const linkedCourseSelect = screen.getByLabelText(/Linked course \(optional\)/i);
    expect(Array.from(linkedCourseSelect.options).map((option) => option.value)).toContain(courseId);
    expect(Array.from(linkedCourseSelect.options).some((option) => /B\.Sc\. Nursing Entrance Preparation · draft/u.test(option.textContent))).toBe(true);
    fireEvent.change(linkedCourseSelect, { target: { value: courseId } });
    fireEvent.change(document.getElementById('admin-field-products-title'), { target: { value: 'Draft Physics notes' } });
    fireEvent.change(document.getElementById('admin-field-products-slug'), { target: { value: 'draft-physics-notes' } });
    fireEvent.change(document.getElementById('admin-field-products-description'), { target: { value: 'Draft Physics notes linked to the selected examination.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }));

    await waitFor(() => expect(adminApi.create).toHaveBeenCalledTimes(1));
    expect(adminApi.list).toHaveBeenCalledWith('exams', { page: 2, limit: 50 }, expect.anything());
    expect(adminApi.create).toHaveBeenCalledWith('products', expect.objectContaining({
      exam: examId,
      subject: subjectId,
      course: courseId,
      resourceType: 'notes',
      publicationStatus: 'draft',
      title: 'Draft Physics notes',
      slug: 'draft-physics-notes',
    }));
  }, 15000);
});
