import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import AdminCurriculumPanel from '../../src/components/admin/AdminCurriculumPanel.jsx';
import { adminApi } from '../../src/services/adminApi.js';

vi.mock('../../src/services/adminApi.js', () => ({
  adminApi: {
    list: vi.fn(), overview: vi.fn(), profile: vi.fn(), login: vi.fn(), logout: vi.fn(), changePassword: vi.fn(),
    create: vi.fn(), update: vi.fn(), remove: vi.fn(), uploadPdf: vi.fn(),
  },
  formatRupees: (value) => `₹${value}`,
}));

const exam = { _id: 'exam-1', name: 'Configured examination', publicationStatus: 'published' };
const subjects = [
  { _id: 'subject-physics', exam, name: 'Physics', slug: 'physics', description: 'Configured Physics description.', sortOrder: 0, publicationStatus: 'published' },
  { _id: 'subject-chemistry', exam, name: 'Chemistry', slug: 'chemistry', description: '', sortOrder: 1, publicationStatus: 'draft' },
  { _id: 'subject-biology', exam, name: 'Biology', slug: 'biology', description: '', sortOrder: 2, publicationStatus: 'draft' },
];
const course = {
  _id: 'course-1', exam, subjects, publicationStatus: 'draft',
  product: { slug: 'bsc-nursing-entrance-preparation', title: 'B.Sc. Nursing Entrance Preparation' },
  modules: [{ _id: 'module-1', title: 'Existing module', subject: 'subject-physics', chapter: 'chapter-1', sortOrder: 0, lessons: [{ _id: 'lesson-1', title: 'Existing lesson', publicationStatus: 'draft' }] }],
};
const chapters = [
  { _id: 'chapter-1', exam, subject: 'subject-physics', name: 'Existing chapter', slug: 'existing-chapter', description: '', sortOrder: 0, publicationStatus: 'draft' },
];
const topics = [
  { _id: 'topic-1', exam, subject: 'subject-physics', chapter: 'chapter-1', name: 'Existing topic', slug: 'existing-topic', description: '', sortOrder: 0, publicationStatus: 'draft' },
];

function renderCurriculum(props = {}) {
  return render(<AdminCurriculumPanel exams={[exam]} subjects={subjects} chapters={chapters} topics={topics} courses={[course]} products={[]} questionBanks={[]} onSaved={vi.fn()} {...props} />);
}

describe('Admin curriculum interface', () => {
  beforeEach(() => {
    adminApi.create.mockReset().mockResolvedValue({});
    adminApi.update.mockReset().mockResolvedValue({});
    adminApi.remove.mockReset().mockResolvedValue({});
  });

  afterEach(() => cleanup());

  it('shows exactly the three configured flagship subjects and curriculum totals', () => {
    renderCurriculum();
    expect(screen.getByRole('heading', { name: 'B.Sc. Nursing Entrance Preparation' })).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Physics curriculum' })).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Chemistry curriculum' })).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Biology curriculum' })).toBeTruthy();
    expect(screen.getAllByText('PRIMARY SUBJECT')).toHaveLength(3);
    expect(screen.getByText('Total subjects')).toBeTruthy();
    expect(screen.getByText('Total chapters')).toBeTruthy();
    expect(screen.getByText('Total topics')).toBeTruthy();
    expect(screen.getByText('Published')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('edits a subject through the existing subject API without changing its canonical course identity', async () => {
    renderCurriculum();
    const physics = screen.getByRole('article', { name: 'Physics curriculum' });
    fireEvent.click(within(physics).getByRole('button', { name: 'Edit subject' }));
    fireEvent.change(screen.getByLabelText('Subject name'), { target: { value: 'Physics' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated subject description.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await vi.waitFor(() => expect(adminApi.update).toHaveBeenCalledWith('subjects', 'subject-physics', expect.objectContaining({
      name: 'Physics', slug: 'physics', description: 'Updated subject description.', exam: 'exam-1',
    })));
  });

  it('creates a chapter under the selected subject with a draft state and generated slug', async () => {
    renderCurriculum();
    const physics = screen.getByRole('article', { name: 'Physics curriculum' });
    fireEvent.click(within(physics).getByRole('button', { name: 'Add chapter' }));
    fireEvent.change(screen.getByLabelText('Chapter title'), { target: { value: 'Administrator supplied chapter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await vi.waitFor(() => expect(adminApi.create).toHaveBeenCalledWith('chapters', expect.objectContaining({
      name: 'Administrator supplied chapter', slug: 'administrator-supplied-chapter', exam: 'exam-1', subject: 'subject-physics', publicationStatus: 'draft',
    })));
  });

  it('updates chapter description and display order through the existing chapter API', async () => {
    renderCurriculum();
    fireEvent.click(screen.getByRole('button', { name: 'Edit chapter Existing chapter' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Chapter description entered by an administrator.' } });
    fireEvent.change(screen.getByLabelText('Display order'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await vi.waitFor(() => expect(adminApi.update).toHaveBeenCalledWith('chapters', 'chapter-1', expect.objectContaining({
      description: 'Chapter description entered by an administrator.', sortOrder: 7, exam: 'exam-1', subject: 'subject-physics',
    })));
  });

  it('creates a topic under its selected chapter without adding lesson content', async () => {
    renderCurriculum();
    const chapter = screen.getByRole('region', { name: 'Chapter Existing chapter' });
    fireEvent.click(within(chapter).getByRole('button', { name: 'Add topic' }));
    fireEvent.change(screen.getByLabelText('Topic title'), { target: { value: 'Administrator supplied topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await vi.waitFor(() => expect(adminApi.create).toHaveBeenCalledWith('topics', expect.objectContaining({
      name: 'Administrator supplied topic', slug: 'administrator-supplied-topic', exam: 'exam-1', subject: 'subject-physics', chapter: 'chapter-1', publicationStatus: 'draft',
    })));
  });

  it('saves a lesson topic mapping using the existing course update API and preserves lesson IDs', async () => {
    renderCurriculum();
    fireEvent.change(screen.getByLabelText('Topic for Existing lesson'), { target: { value: 'topic-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save mapping' }));

    await vi.waitFor(() => expect(adminApi.update).toHaveBeenCalledWith('courses', 'course-1', {
      modules: [expect.objectContaining({
        _id: 'module-1',
        lessons: [expect.objectContaining({ _id: 'lesson-1', topic: 'topic-1' })],
      })],
    }));
  });

  it('does not offer subject deletion and surfaces server hierarchy errors', async () => {
    adminApi.update.mockRejectedValueOnce({ message: 'Publish the examination and subject before publishing this chapter.' });
    renderCurriculum();
    expect(screen.queryByRole('button', { name: /delete.*subject/i })).toBeNull();
    fireEvent.click(within(screen.getByRole('region', { name: 'Chapter Existing chapter' })).getByRole('button', { name: 'Publish chapter Existing chapter' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Publish the examination and subject/)).toBeTruthy();
  });

  it('publishes and unpublishes a chapter through its existing PATCH API and updates the status immediately', async () => {
    const onSaved = vi.fn();
    adminApi.update
      .mockResolvedValueOnce({ chapter: { ...chapters[0], publicationStatus: 'published' } })
      .mockResolvedValueOnce({ chapter: { ...chapters[0], publicationStatus: 'draft' } });
    renderCurriculum({ onSaved });
    const chapter = screen.getByRole('region', { name: 'Chapter Existing chapter' });

    fireEvent.click(within(chapter).getByRole('button', { name: 'Publish chapter Existing chapter' }));
    await vi.waitFor(() => expect(adminApi.update).toHaveBeenNthCalledWith(1, 'chapters', 'chapter-1', { publicationStatus: 'published' }));
    expect(await within(chapter).findByText('published')).toBeTruthy();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(within(chapter).getByRole('button', { name: 'Publish chapter Existing chapter' }).disabled).toBe(true);
    expect(within(chapter).getByRole('button', { name: 'Unpublish chapter Existing chapter' }).disabled).toBe(false);

    fireEvent.click(within(chapter).getByRole('button', { name: 'Unpublish chapter Existing chapter' }));
    await vi.waitFor(() => expect(adminApi.update).toHaveBeenNthCalledWith(2, 'chapters', 'chapter-1', { publicationStatus: 'draft' }));
    expect(await within(chapter).findByText('draft')).toBeTruthy();
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it('publishes and unpublishes a topic through its existing PATCH API and updates the status immediately', async () => {
    const publishedChapter = [{ ...chapters[0], publicationStatus: 'published' }];
    const onSaved = vi.fn();
    adminApi.update
      .mockResolvedValueOnce({ topic: { ...topics[0], publicationStatus: 'published' } })
      .mockResolvedValueOnce({ topic: { ...topics[0], publicationStatus: 'draft' } });
    renderCurriculum({ chapters: publishedChapter, onSaved });
    const topicRow = screen.getByText('Existing topic').closest('.curriculum-topic-row');

    fireEvent.click(within(topicRow).getByRole('button', { name: 'Publish topic Existing topic' }));
    await vi.waitFor(() => expect(adminApi.update).toHaveBeenNthCalledWith(1, 'topics', 'topic-1', { publicationStatus: 'published' }));
    expect(await within(topicRow).findByText('published')).toBeTruthy();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(within(topicRow).getByRole('button', { name: 'Publish topic Existing topic' }).disabled).toBe(true);
    expect(within(topicRow).getByRole('button', { name: 'Unpublish topic Existing topic' }).disabled).toBe(false);

    fireEvent.click(within(topicRow).getByRole('button', { name: 'Unpublish topic Existing topic' }));
    await vi.waitFor(() => expect(adminApi.update).toHaveBeenNthCalledWith(2, 'topics', 'topic-1', { publicationStatus: 'draft' }));
    expect(await within(topicRow).findByText('draft')).toBeTruthy();
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it('shows unpublished parent prerequisites and exposes only explicit parent publication actions', async () => {
    const onNavigate = vi.fn();
    renderCurriculum({ exams: [{ ...exam, publicationStatus: 'draft' }], onNavigate });
    expect(screen.getByText(/must be published manually before a chapter/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manage examination' }));
    expect(onNavigate).toHaveBeenCalledWith('exams');
    expect(adminApi.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Publish subject Chemistry' }));
    await vi.waitFor(() => expect(adminApi.update).toHaveBeenCalledWith('subjects', 'subject-chemistry', { publicationStatus: 'published' }));
    expect(adminApi.update).not.toHaveBeenCalledWith('exams', expect.anything(), expect.anything());
    expect(adminApi.update).not.toHaveBeenCalledWith('courses', expect.anything(), expect.anything());
  });

});
