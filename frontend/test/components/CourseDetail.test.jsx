import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CourseDetailPage from '../../src/pages/CourseDetailPage.jsx';
import { courseApi } from '../../src/services/courseApi.js';
import { useAuth } from '../../src/context/AuthContext.jsx';

vi.mock('../../src/services/courseApi.js', () => ({
  courseApi: { get: vi.fn(), myCourses: vi.fn(), getPreviewPlayback: vi.fn(), enroll: vi.fn() },
}));
vi.mock('../../src/context/AuthContext.jsx', () => ({ useAuth: vi.fn() }));
vi.mock('../../src/components/Icon.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/SiteHeader.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/SiteFooter.jsx', () => ({ default: () => null }));

const courseId = '507f1f77bcf86cd799439201';
const course = {
  id: courseId,
  product: { id: '507f1f77bcf86cd799439202', slug: 'free-beta-course', title: 'Free beta course', description: 'A configured free beta course.', isFree: true, currentPricePaise: 0 },
  exam: { id: '507f1f77bcf86cd799439203', name: 'Configured examination' },
  category: 'Government Competitive Exam Preparation',
  subjects: [{ id: '507f1f77bcf86cd799439204', name: 'Physics' }],
  modules: [],
  outline: [],
};

describe('course enrollment action', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ user: null });
    courseApi.get.mockResolvedValue({ course });
    courseApi.myCourses.mockResolvedValue({ items: [] });
    courseApi.enroll.mockResolvedValue({ access: { source: 'free' } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('routes anonymous students to login with a safe course return path', async () => {
    render(<CourseDetailPage courseId={courseId} />);
    const link = await screen.findByRole('link', { name: /Log in to enroll/i });
    expect(link.getAttribute('href')).toBe(`/login?next=${encodeURIComponent(`/courses/${courseId}`)}`);
    expect(courseApi.enroll).not.toHaveBeenCalled();
  });

  it('claims a free course through the authenticated backend and then offers learning access', async () => {
    useAuth.mockReturnValue({ user: { id: 'student-1', name: 'Student' } });
    render(<CourseDetailPage courseId={courseId} />);
    const button = await screen.findByRole('button', { name: /Enroll for free/i });
    fireEvent.click(button);

    await waitFor(() => expect(courseApi.enroll).toHaveBeenCalledWith(courseId));
    expect((await screen.findAllByRole('link', { name: /Continue learning/i })).length).toBeGreaterThan(0);
  });

  it('shows learning access for an existing enrollment instead of offering another claim', async () => {
    useAuth.mockReturnValue({ user: { id: 'student-1', name: 'Student' } });
    courseApi.myCourses.mockResolvedValue({ items: [{ id: courseId }] });
    render(<CourseDetailPage courseId={courseId} />);

    expect(await screen.findByRole('link', { name: /Continue learning/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Enroll for free/i })).toBeNull();
  });
});
