export class CourseApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'CourseApiError';
    this.status = status;
  }
}

async function getJson(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new CourseApiError('The course service could not be reached. Check that the API is running.');
  }
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) throw new CourseApiError(payload?.message || 'The course request could not be completed.', response.status);
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

export const courseApi = {
  async list(filters = {}, options = {}) {
    return getJson(`/courses${queryString(filters)}`, options);
  },
  async flagshipPreview(options = {}) {
    return getJson('/courses/flagship-preview', options);
  },
  async get(id, options = {}) {
    return getJson(`/courses/${encodeURIComponent(id)}`, options);
  },
  async getPreviewPlayback(courseId, lessonId, options = {}) {
    return getJson(`/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/preview`, options);
  },
  async myCourses(options = {}) {
    return getJson('/student/courses', options);
  },
  async progress(courseId, options = {}) {
    return getJson(`/student/courses/${encodeURIComponent(courseId)}/progress`, options);
  },
  async playback(courseId, lessonId, options = {}) {
    return getJson(`/student/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/playback`, options);
  },
  async completeLesson(courseId, lessonId, options = {}) {
    return getJson(`/student/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/complete`, { ...options, method: 'POST', body: {} });
  },
};
