import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import FlagshipCourseOverviewPage from '../../src/pages/FlagshipCourseOverviewPage.jsx';
import AppRoutes from '../../src/routes/AppRoutes.jsx';
import { courseApi } from '../../src/services/courseApi.js';

vi.mock('../../src/services/courseApi.js', () => ({
  courseApi: { flagshipPreview: vi.fn() },
}));
vi.mock('../../src/components/Icon.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/SiteHeader.jsx', () => ({ default: () => null }));

const preview = {
  title: 'B.Sc. Nursing Entrance Preparation',
  description: 'A structured learning programme covering Physics, Chemistry and Biology to help students prepare for B.Sc. Nursing entrance examinations.',
  category: 'Government Competitive Exam Preparation',
  subjects: ['Physics', 'Chemistry', 'Biology'],
  status: 'draft',
};

describe('flagship course overview', () => {
  beforeEach(() => {
    courseApi.flagshipPreview.mockResolvedValue({ preview });
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
    vi.clearAllMocks();
  });

  it('shows only the approved draft overview details and no purchase actions', async () => {
    render(<FlagshipCourseOverviewPage />);

    expect(await screen.findByRole('heading', { name: preview.title })).toBeTruthy();
    expect(screen.getByText(preview.description)).toBeTruthy();
    expect(screen.getByText(preview.category)).toBeTruthy();
    expect(screen.getByText('Coming soon · Draft')).toBeTruthy();
    expect(screen.getByText('This course is currently being prepared. Enrollment will open soon.')).toBeTruthy();
    expect(screen.getAllByText(/^(Physics|Chemistry|Biology)$/u).map((node) => node.textContent)).toEqual(preview.subjects);
    expect(screen.getAllByRole('link', { name: /Back to Courses/i }).some((link) => link.getAttribute('href') === '/courses')).toBe(true);
    expect(screen.queryByRole('button', { name: /purchase|enroll|checkout/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /purchase|enroll|checkout/i })).toBeNull();
    expect(courseApi.flagshipPreview).toHaveBeenCalledTimes(1);
  });

  it('routes the dedicated overview URL to the draft preview page', async () => {
    window.history.pushState({}, '', '/courses/bsc-nursing-entrance-preparation/overview');
    render(<AppRoutes />);

    expect(await screen.findByRole('heading', { name: preview.title })).toBeTruthy();
  });
});
