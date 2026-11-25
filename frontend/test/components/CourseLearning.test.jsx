import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CourseLearningPage from '../../src/pages/CourseLearningPage.jsx';
import { courseApi } from '../../src/services/courseApi.js';
import { catalogApi } from '../../src/services/catalogApi.js';

vi.mock('../../src/services/courseApi.js', () => ({
  courseApi: { get: vi.fn(), progress: vi.fn(), playback: vi.fn(), lessonContent: vi.fn(), completeLesson: vi.fn() },
}));
vi.mock('../../src/services/catalogApi.js', () => ({ catalogApi: { listProducts: vi.fn() } }));
vi.mock('../../src/components/Icon.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/SiteHeader.jsx', () => ({ default: () => null }));

const courseId = '507f1f77bcf86cd799439201';
const topicId = '507f1f77bcf86cd799439205';
const course = {
  id: courseId,
  product: { title: 'Configured biology course' },
  exam: { id: '507f1f77bcf86cd799439203', name: 'Configured exam' },
  modules: [{
    id: '507f1f77bcf86cd799439206',
    title: 'Configured chapter',
    subject: { id: '507f1f77bcf86cd799439204', name: 'Biology' },
    chapter: { id: '507f1f77bcf86cd799439207', name: 'Configured chapter' },
    lessons: [
      { id: '507f1f77bcf86cd799439208', title: 'Text lesson', description: '', topic: { id: topicId, name: 'Configured topic' } },
      { id: '507f1f77bcf86cd799439209', title: 'Next lesson', description: '', topic: { id: topicId, name: 'Configured topic' } },
    ],
  }],
};

describe('course learning content', () => {
  beforeEach(() => {
    courseApi.get.mockResolvedValue({ course });
    courseApi.progress.mockResolvedValue({ progress: { completedLessonIds: [], percent: 0, completedCount: 0, totalLessons: 2 } });
    courseApi.playback.mockResolvedValue({ available: false, message: 'A video is not configured.' });
    courseApi.lessonContent.mockImplementation(async (_courseId, lessonId) => ({ lesson: { title: lessonId.endsWith('208') ? 'Text lesson' : 'Next lesson', contentText: `Content for ${lessonId.endsWith('208') ? 'text lesson' : 'next lesson'}.` } }));
    catalogApi.listProducts.mockResolvedValue({ items: [{ id: '507f1f77bcf86cd799439210', slug: 'topic-notes', title: 'Configured topic notes', isFree: true }] });
    courseApi.completeLesson.mockResolvedValue({ progress: { completedLessonIds: ['507f1f77bcf86cd799439208'], percent: 50, completedCount: 1, totalLessons: 2 } });
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
    vi.clearAllMocks();
  });

  it('loads protected lesson text, topic resources and practice links without exposing text through the public outline', async () => {
    render(<CourseLearningPage courseId={courseId} />);

    expect(await screen.findByText('Content for text lesson.')).toBeTruthy();
    const resourceLink = await screen.findByRole('link', { name: 'Configured topic notes' });
    expect(resourceLink.getAttribute('href')).toBe('/products/topic-notes');
    const practiceLink = screen.getByRole('link', { name: /Practice topic MCQs/i });
    expect(practiceLink.getAttribute('href')).toContain(`examId=${course.exam.id}`);
    expect(practiceLink.getAttribute('href')).toContain(`subjectId=${course.modules[0].subject.id}`);
    expect(practiceLink.getAttribute('href')).toContain(`topicId=${topicId}`);
    expect(courseApi.lessonContent).toHaveBeenCalledWith(courseId, course.modules[0].lessons[0].id, expect.any(Object));
    expect(catalogApi.listProducts).toHaveBeenCalledWith({ examId: course.exam.id, subjectId: course.modules[0].subject.id, topicId, limit: 10 }, expect.any(Object));
  });

  it('supports previous and next lessons and saves completion for a text lesson', async () => {
    render(<CourseLearningPage courseId={courseId} />);
    expect(await screen.findByText('Content for text lesson.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark lesson complete' }));
    await waitFor(() => expect(courseApi.completeLesson).toHaveBeenCalledWith(courseId, course.modules[0].lessons[0].id));

    fireEvent.click(screen.getByRole('button', { name: 'Next lesson' }));
    expect(await screen.findByText('Content for next lesson.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous lesson' }));
    expect(await screen.findByText('Content for text lesson.')).toBeTruthy();
  });
});
