export class PracticeApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'PracticeApiError';
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, signal, includeServerTime = false } = {}) {
  let response;
  try {
    response = await fetch(`/api/student/practice${path}`, {
      method,
      credentials: 'same-origin',
      signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new PracticeApiError('The practice service could not be reached. Check that the API is running.');
  }
  let payload = null;
  try { payload = await response.json(); } catch { /* An empty response is handled below. */ }
  if (!response.ok) throw new PracticeApiError(payload?.message || 'The practice request could not be completed.', response.status);
  if (includeServerTime && payload && typeof payload === 'object') {
    const headerTime = Date.parse(response.headers.get('date') ?? '');
    payload.serverNow = Number.isFinite(headerTime) ? headerTime : Date.now();
  }
  return payload ?? {};
}

function queryString(values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const practiceApi = {
  listQuestionBanks: (filters = {}, options = {}) => request(`/question-banks${queryString(filters)}`, options),
  listMockTests: (options = {}) => request('/mock-tests', options),
  listAttempts: (filters = {}, options = {}) => request(`/attempts${queryString(filters)}`, options),
  getAttempt: (id, options = {}) => request(`/attempts/${encodeURIComponent(id)}`, { ...options, includeServerTime: true }),
  startPractice: (questionBankId, topicId) => request('/attempts', { method: 'POST', body: { mode: 'practice', questionBankId, ...(topicId ? { topicId } : {}) } }),
  startMockTest: (mockTestId) => request('/attempts', { method: 'POST', body: { mode: 'mock', mockTestId } }),
  saveAnswer: (attemptId, questionId, updates) => request(`/attempts/${encodeURIComponent(attemptId)}/questions/${encodeURIComponent(questionId)}`, { method: 'PATCH', body: updates, includeServerTime: true }),
  submitAttempt: (attemptId) => request(`/attempts/${encodeURIComponent(attemptId)}/submit`, { method: 'POST', body: {}, includeServerTime: true }),
};
