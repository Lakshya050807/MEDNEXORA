import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AttemptRunner } from '../../src/pages/PracticePage.jsx';
import { practiceApi } from '../../src/services/practiceApi.js';

vi.mock('../../src/services/practiceApi.js', () => ({
  practiceApi: {
    getAttempt: vi.fn(),
    saveAnswer: vi.fn(),
    submitAttempt: vi.fn(),
  },
}));

vi.mock('../../src/components/Icon.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/SiteHeader.jsx', () => ({ default: () => null }));

const TEST_NOW = Date.UTC(2026, 10, 5, 10, 0, 0);
let serverAttempt;

function makeAttempt(overrides = {}) {
  return {
    id: 'attempt-1',
    mode: 'mock',
    title: 'Government Exam Mock Test',
    status: 'in-progress',
    startedAt: new Date(TEST_NOW).toISOString(),
    expiresAt: new Date(TEST_NOW + 120_000).toISOString(),
    durationMinutes: 2,
    maximumMarks: 3,
    negativeMarkingEnabled: true,
    negativeMarksPerQuestion: 0.25,
    allowAnswerReview: true,
    questions: [
      { id: 'q-1', order: 1, prompt: 'First assigned question', options: ['First option', 'Second option'], selectedOptionIndex: 1, markedForReview: false, subjectId: 's1', subjectName: 'Biology', chapterId: 'c1', chapterName: 'Cell', image: { url: 'https://cdn.example.test/question-1.png', mimeType: 'image/png', altText: 'Cell illustration' }, review: { isCorrect: true, correctAnswerIndex: 1, explanation: 'Never shown before submission.' } },
      { id: 'q-2', order: 2, prompt: 'Second assigned question', options: ['Option A', 'Option B'], selectedOptionIndex: null, markedForReview: false, subjectId: 's2', subjectName: 'Chemistry', chapterId: 'c2', chapterName: 'Matter' },
      { id: 'q-3', order: 3, prompt: 'Third assigned question', options: ['Choice A', 'Choice B'], selectedOptionIndex: null, markedForReview: false, subjectId: 's3', subjectName: 'Physics', chapterId: 'c3', chapterName: 'Motion' },
    ],
    ...overrides,
  };
}

function clone(value) {
  return structuredClone(value);
}

function timedResult(attempt, serverNow = TEST_NOW) {
  return { attempt: clone(attempt), serverNow };
}

function submittedAttempt() {
  const attempt = clone(serverAttempt);
  attempt.status = 'submitted';
  attempt.submittedAt = new Date(TEST_NOW + 1000).toISOString();
  attempt.result = { score: 1, maximumMarks: 3, correctAnswers: 1, incorrectAnswers: 1, unansweredQuestions: 1, accuracyPercent: 50 };
  attempt.questions[0].review = { isCorrect: true, correctAnswerIndex: 1, explanation: 'Explanation available after submission.' };
  return attempt;
}

function installServerMocks() {
  practiceApi.getAttempt.mockImplementation(async () => timedResult(serverAttempt));
  practiceApi.saveAnswer.mockImplementation(async (_attemptId, questionId, updates) => {
    serverAttempt = {
      ...serverAttempt,
      questions: serverAttempt.questions.map((question) => question.id === questionId ? { ...question, ...updates } : question),
    };
    return timedResult(serverAttempt);
  });
  practiceApi.submitAttempt.mockImplementation(async () => {
    serverAttempt = submittedAttempt();
    return timedResult(serverAttempt);
  });
}

async function renderAttempt() {
  const view = render(<AttemptRunner attemptId="attempt-1" />);
  await screen.findByRole('heading', { name: 'First assigned question' });
  return view;
}

describe('student mock-test attempt interface', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/practice/attempts/attempt-1');
    serverAttempt = makeAttempt();
    installServerMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('clears a selected answer by saving null without changing questions', async () => {
    await renderAttempt();

    fireEvent.click(screen.getByRole('button', { name: 'Clear response' }));

    await waitFor(() => expect(practiceApi.saveAnswer).toHaveBeenCalledWith('attempt-1', 'q-1', { selectedOptionIndex: null }));
    expect(screen.getByRole('heading', { name: 'First assigned question' })).toBeTruthy();
    expect(screen.getByText('QUESTION 1 OF 3')).toBeTruthy();
  });

  it('keeps server-assigned order while previous, next and palette navigation work', async () => {
    await renderAttempt();

    fireEvent.click(screen.getByRole('button', { name: /Next question/ }));
    expect(screen.getByRole('heading', { name: 'Second assigned question' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('heading', { name: 'First assigned question' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Go to question 3/ }));
    expect(screen.getByRole('heading', { name: 'Third assigned question' })).toBeTruthy();
    expect(screen.getByText('QUESTION 3 OF 3')).toBeTruthy();
  });

  it('marks and unmarks a question for review and updates its palette state', async () => {
    await renderAttempt();

    fireEvent.click(screen.getByRole('button', { name: 'Mark for review' }));
    const markedButton = await screen.findByRole('button', { name: 'Go to question 1, current question, answered, marked for review' });
    expect(markedButton.className).toContain('is-review');

    fireEvent.click(screen.getByRole('button', { name: 'Remove review mark' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Go to question 1, current question, answered' }).className).not.toContain('is-review'));
  });

  it('shows submission counts and lets the student return to the active test', async () => {
    serverAttempt.questions[1].markedForReview = true;
    await renderAttempt();

    fireEvent.click(screen.getByRole('button', { name: 'Submit test' }));
    const dialog = screen.getByRole('dialog', { name: 'Submit this test?' });
    const counts = [...dialog.querySelectorAll('.practice-submit-counts > div')].map((card) => card.textContent.replace(/\s+/g, ' ').trim());
    expect(counts).toEqual(['1Answered', '2Unanswered', '1Marked for review']);
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Return to test' }));
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Confirm submission' }));
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Return to test' }));
    expect(screen.queryByText(/Never shown before submission\./)).toBeNull();
    expect(practiceApi.submitAttempt).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Return to test' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'First assigned question' })).toBeTruthy();
  });

  it('submits once after confirmation and transitions to the result review', async () => {
    let finishSubmission;
    practiceApi.submitAttempt.mockImplementation(() => new Promise((resolve) => { finishSubmission = resolve; }));
    await renderAttempt();

    fireEvent.click(screen.getByRole('button', { name: 'Submit test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm submission' }));
    expect(await screen.findByRole('button', { name: 'Submitting…' })).toBeTruthy();
    expect(practiceApi.submitAttempt).toHaveBeenCalledTimes(1);

    await act(async () => finishSubmission(timedResult(submittedAttempt())));
    expect(await screen.findByRole('heading', { name: 'Your result' })).toBeTruthy();
    expect(window.location.pathname).toBe('/practice/attempts/attempt-1/results');
    expect(screen.getByText('Correct answer: B. Second option')).toBeTruthy();
    expect(practiceApi.submitAttempt).toHaveBeenCalledTimes(1);
  });

  it('shows safe submission errors and keeps the test available for retry', async () => {
    practiceApi.submitAttempt.mockRejectedValue(new Error('The test could not be submitted. Please try again.'));
    await renderAttempt();
    fireEvent.click(screen.getByRole('button', { name: 'Submit test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm submission' }));

    expect((await screen.findByRole('alert')).textContent).toContain('The test could not be submitted. Please try again.');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'First assigned question' })).toBeTruthy();
  });

  it('restores the saved position and server-saved responses after refreshing', async () => {
    const firstRun = await renderAttempt();
    fireEvent.click(screen.getByRole('button', { name: /Next question/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next question/ }));
    await waitFor(() => expect(window.sessionStorage.getItem('practice-attempt-current-index:attempt-1')).toBe('2'));
    firstRun.unmount();

    render(<AttemptRunner attemptId="attempt-1" />);
    await screen.findByRole('heading', { name: 'Third assigned question' });
    expect(screen.getByRole('heading', { name: 'Third assigned question' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to question 1, answered' })).toBeTruthy();
    expect(screen.queryByText(/Correct answer:/i)).toBeNull();
    expect(practiceApi.getAttempt).toHaveBeenCalledTimes(2);
  });

  it('renders HTTPS question images with alt text and a graceful failed-image state', async () => {
    await renderAttempt();
    const image = screen.getByRole('img', { name: 'Cell illustration' });
    expect(image.getAttribute('src')).toBe('https://cdn.example.test/question-1.png');

    fireEvent.error(image);
    expect(await screen.findByText('Question image could not be loaded.')).toBeTruthy();
  });

  it('keeps navigation and timer controls available at a narrow viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    await renderAttempt();

    expect(screen.getByRole('timer', { name: 'Time left 02:00' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Question navigation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear response' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit test' })).toBeTruthy();
  });

  it('anchors the countdown to the server response date and asks the server to expire the attempt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_NOW + 60_000);
    serverAttempt = makeAttempt({ expiresAt: new Date(TEST_NOW + 60_000).toISOString() });
    let readCount = 0;
    practiceApi.getAttempt.mockImplementation(async () => {
      readCount += 1;
      if (readCount === 1) return timedResult(serverAttempt, TEST_NOW);
      const expired = submittedAttempt();
      expired.status = 'timed-out';
      return timedResult(expired, TEST_NOW + 2000);
    });

    render(<AttemptRunner attemptId="attempt-1" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole('timer', { name: 'Time left 01:00' })).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(62_000); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole('heading', { name: 'Your result' })).toBeTruthy();
    expect(practiceApi.getAttempt).toHaveBeenCalledTimes(2);
    expect(practiceApi.submitAttempt).not.toHaveBeenCalled();
  });

  it('warns before leaving an active attempt and removes the warning after submission', async () => {
    await renderAttempt();
    const activeExit = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(activeExit);
    expect(activeExit.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Submit test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm submission' }));
    await screen.findByRole('heading', { name: 'Your result' });
    const submittedExit = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(submittedExit);
    expect(submittedExit.defaultPrevented).toBe(false);
  });
});
