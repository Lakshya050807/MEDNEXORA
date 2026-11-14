import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminResourcePanel from '../../src/components/admin/AdminResourcePanel.jsx';
import { adminApi } from '../../src/services/adminApi.js';

vi.mock('../../src/services/adminApi.js', () => ({
  adminApi: {
    list: vi.fn(), overview: vi.fn(), profile: vi.fn(), login: vi.fn(), logout: vi.fn(), changePassword: vi.fn(),
    create: vi.fn(), update: vi.fn(), remove: vi.fn(), removeCourseLesson: vi.fn(), uploadPdf: vi.fn(),
  },
  formatRupees: (value) => `₹${value}`,
}));

describe('Admin study material creation errors', () => {
  beforeEach(() => {
    adminApi.list.mockReset().mockResolvedValue({ items: [], pagination: { page: 1, pages: 1, total: 0 } });
    adminApi.create.mockReset();
  });
  afterEach(() => cleanup());

  it('shows the safe backend message for an unexpected database create failure', async () => {
    const message = 'Something went wrong. Please try again later.';
    adminApi.create.mockRejectedValueOnce(new Error(message));
    const fields = [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'slug', label: 'URL slug', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'textarea', required: true },
    ];
    const { container } = render(<AdminResourcePanel resource="products" title="Study Materials" description="Manage resources." fields={fields} columns={[]} />);
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Draft notes' } });
    fireEvent.change(screen.getByLabelText(/URL slug/), { target: { value: 'draft-notes' } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'A draft resource description.' } });
    fireEvent.submit(container.querySelector('form.admin-resource-form'));

    await waitFor(() => expect(adminApi.create).toHaveBeenCalledWith('products', expect.objectContaining({ slug: 'draft-notes' })));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(screen.queryByText(/MongoServerError|keyPattern|E11000/)).toBeNull();
  });
});

describe('Admin question bank editor', () => {
  beforeEach(() => {
    adminApi.list.mockReset().mockResolvedValue({ items: [], pagination: { page: 1, pages: 1, total: 0 } });
    adminApi.create.mockReset().mockResolvedValue({ questionBank: { _id: 'bank-1' } });
  });

  afterEach(() => cleanup());

  it('collects four options, the correct answer, explanation, topic and status in the existing API payload', async () => {
    const fields = [
      { name: 'exam', label: 'Target examination', type: 'select', required: true, options: [{ value: 'exam-1', label: 'Exam' }] },
      { name: 'subject', label: 'Subject', type: 'select', required: true, options: [{ value: 'subject-1', label: 'Biology' }] },
      { name: 'title', label: 'Question bank title', type: 'text', required: true },
      { name: 'questions', label: 'Questions', type: 'question-builder', defaultValue: [] },
      { name: 'publicationStatus', label: 'Publication status', type: 'select', defaultValue: 'draft', options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }] },
    ];
    const { container } = render(<AdminResourcePanel resource="question-banks" title="Question banks" description="Manage MCQs." fields={fields} columns={[]} options={{ topics: [{ _id: 'topic-1', name: 'Cell topic', exam: 'exam-1', subject: 'subject-1', publicationStatus: 'published' }] }} />);
    fireEvent.change(await screen.findByLabelText(/Target examination/), { target: { value: 'exam-1' } });
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: 'subject-1' } });
    fireEvent.change(screen.getByLabelText(/Question bank title/), { target: { value: 'Biology practice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    fireEvent.change(screen.getByLabelText('Question prompt'), { target: { value: 'Which option is selected?' } });
    for (const [index, label] of ['Option A', 'Option B', 'Option C', 'Option D'].entries()) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: `Answer ${index + 1}` } });
    }
    fireEvent.change(screen.getByLabelText('Correct answer'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Topic (optional)'), { target: { value: 'topic-1' } });
    fireEvent.change(screen.getByLabelText('Answer explanation'), { target: { value: 'Administrator-reviewed explanation.' } });
    fireEvent.change(screen.getByLabelText('Publication status'), { target: { value: 'published' } });
    fireEvent.submit(container.querySelector('form.admin-resource-form'));

    await waitFor(() => expect(adminApi.create).toHaveBeenCalledWith('question-banks', expect.objectContaining({
      exam: 'exam-1', subject: 'subject-1', title: 'Biology practice', publicationStatus: 'published',
      questions: [expect.objectContaining({ prompt: 'Which option is selected?', options: ['Answer 1', 'Answer 2', 'Answer 3', 'Answer 4'], correctAnswerIndex: 2, topic: 'topic-1', explanation: 'Administrator-reviewed explanation.' })],
    })));
  });
});

describe('Admin mock-test preview', () => {
  beforeEach(() => {
    adminApi.list.mockReset().mockResolvedValue({
      items: [{
        _id: 'test-1', title: 'Configured Biology test', description: 'Student-facing test description.', instructions: 'Read carefully.',
        questionCount: 1, durationMinutes: 30, totalMarks: 4, marksPerQuestion: 4, negativeMarkingEnabled: false,
        exam: { name: 'Configured examination' }, questionBanks: [{ _id: 'bank-1', title: 'Biology questions' }], publicationStatus: 'draft',
      }], pagination: { page: 1, pages: 1, total: 1 },
    });
  });

  afterEach(() => cleanup());

  it('previews student-visible question content without rendering answer keys or explanations', async () => {
    render(<AdminResourcePanel
      resource="mock-tests"
      title="Mock tests"
      description="Manage mock tests."
      fields={[]}
      columns={[{ name: 'title', label: 'Mock test' }]}
      previewType="mock-test"
      options={{ questionBanks: [{
        _id: 'bank-1', questions: [{
          _id: 'question-1', prompt: 'Which option is displayed to a student?', options: ['Option one', 'Option two', 'Option three', 'Option four'],
          correctAnswerIndex: 1, explanation: 'This explanation is private until review is permitted.',
        }],
      }] }}
    />);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));

    const dialog = await screen.findByRole('dialog', { name: 'Mock test preview' });
    expect(dialog.textContent).toContain('Which option is displayed to a student?');
    expect(dialog.textContent).toContain('Option four');
    expect(dialog.textContent).not.toContain('This explanation is private');
    expect(dialog.textContent).not.toContain('Correct answer');
    expect(dialog.textContent).toContain('does not start an attempt');
  });
});
