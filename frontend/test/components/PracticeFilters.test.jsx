import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import PracticePage from '../../src/pages/PracticePage.jsx';
import { practiceApi } from '../../src/services/practiceApi.js';
import { catalogApi } from '../../src/services/catalogApi.js';

vi.mock('../../src/services/practiceApi.js', () => ({
  practiceApi: { listQuestionBanks: vi.fn(), listMockTests: vi.fn() },
}));
vi.mock('../../src/services/catalogApi.js', () => ({
  catalogApi: { listExams: vi.fn(), listSubjects: vi.fn(), listTopics: vi.fn() },
}));
vi.mock('../../src/components/Icon.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/SiteHeader.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/SiteFooter.jsx', () => ({ default: () => null }));

describe('practice deep links from a course lesson', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
    vi.clearAllMocks();
  });

  it('loads the examination, subject and topic filters from the lesson practice link', async () => {
    const examId = '507f1f77bcf86cd799439201';
    const subjectId = '507f1f77bcf86cd799439202';
    const topicId = '507f1f77bcf86cd799439203';
    window.history.replaceState({}, '', `/practice?examId=${examId}&subjectId=${subjectId}&topicId=${topicId}`);
    practiceApi.listQuestionBanks.mockResolvedValue({ items: [] });
    practiceApi.listMockTests.mockResolvedValue({ items: [] });
    catalogApi.listExams.mockResolvedValue([{ id: examId, name: 'Configured exam' }]);
    catalogApi.listSubjects.mockResolvedValue([{ id: subjectId, name: 'Biology' }]);
    catalogApi.listTopics.mockResolvedValue([{ id: topicId, name: 'Configured topic' }]);

    render(<PracticePage />);
    await waitFor(() => expect(practiceApi.listQuestionBanks).toHaveBeenCalledWith({ examId, subjectId, topicId, limit: 50 }, expect.any(Object)));
  });
});
