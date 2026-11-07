import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import CourseCatalogPage from '../../src/pages/CourseCatalogPage.jsx';
import { courseApi } from '../../src/services/courseApi.js';

vi.mock('../../src/services/courseApi.js', () => ({
  courseApi: { list: vi.fn() },
}));
vi.mock('../../src/components/Icon.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/SiteHeader.jsx', () => ({ default: () => null }));

describe('course catalogue', () => {
  beforeEach(() => {
    courseApi.list.mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the draft flagship teaser with exactly Physics, Chemistry, and Biology and no enrollment action', async () => {
    const { container } = render(<CourseCatalogPage />);

    expect(await screen.findByRole('heading', { name: 'B.Sc. Nursing Entrance Preparation' })).toBeTruthy();
    expect(screen.getByText(/A structured learning programme covering Physics, Chemistry and Biology/)).toBeTruthy();
    expect(screen.getByText('Draft · not available for enrollment')).toBeTruthy();
    expect(container.querySelector('.course-coming-soon-art')).not.toBeNull();
    expect(container.querySelector('.course-coming-soon-copy')).not.toBeNull();
    expect(screen.getByText('ENTRANCE PREPARATION')).toBeTruthy();
    const subjectTags = screen.getAllByText(/^(Physics|Chemistry|Biology)$/u);
    expect(subjectTags.map((tag) => tag.textContent)).toEqual(['Physics', 'Chemistry', 'Biology']);
    const overviewLink = screen.getByRole('link', { name: 'Open course overview: B.Sc. Nursing Entrance Preparation' });
    expect(overviewLink.getAttribute('href')).toBe('/courses/bsc-nursing-entrance-preparation/overview');
    overviewLink.focus();
    expect(document.activeElement).toBe(overviewLink);
    await waitFor(() => expect(courseApi.list).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /Enroll|Buy|View course/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Enroll|Buy|Purchase/i })).toBeNull();
  });

  it('renders published course category, price, and the API-provided subject tags', async () => {
    courseApi.list.mockResolvedValue({ items: [{
      id: 'course-1',
      courseType: 'video-course',
      category: 'Government Competitive Exam Preparation',
      lessonCount: 0,
      durationMinutes: null,
      subjects: [{ id: 'physics', name: 'Physics' }],
      product: { title: 'Published Physics course', slug: 'bsc-nursing-entrance-preparation', description: 'Published course description.', currentPricePaise: 50000, isFree: false },
    }] });

    render(<CourseCatalogPage />);

    expect(await screen.findByRole('heading', { name: 'Published Physics course' })).toBeTruthy();
    expect(screen.getAllByText('Government Competitive Exam Preparation').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Physics').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Course outline in progress')).toBeTruthy();
    expect(screen.getByRole('link', { name: /View course/i })).toBeTruthy();
    expect(screen.queryByText('Draft · not available for enrollment')).toBeNull();
  });
});
