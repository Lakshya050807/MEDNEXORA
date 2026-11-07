import { normalizeProduct } from '../data/catalog.js';

export class CatalogApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'CatalogApiError';
    this.status = status;
  }
}

async function getJson(path, { signal } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, { credentials: 'same-origin', signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new CatalogApiError('The catalogue server could not be reached. Check that the API is running.');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) throw new CatalogApiError(payload?.message || 'The catalogue request could not be completed.', response.status);
  return payload ?? {};
}

function queryString(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const catalogApi = {
  async listProducts(filters = {}, options = {}) {
    const result = await getJson(`/products${queryString(filters)}`, options);
    return { ...result, items: (result.items ?? []).map(normalizeProduct) };
  },
  async getProduct(id, options = {}) {
    const result = await getJson(`/products/${encodeURIComponent(id)}`, options);
    return { ...result, product: result.product ? normalizeProduct(result.product) : null };
  },
  async listExams(options = {}) {
    const result = await getJson('/exams', options);
    return result.items ?? [];
  },
  async getExam(id, options = {}) {
    return getJson(`/exams/${encodeURIComponent(id)}`, options);
  },
  async listSubjects(examId, options = {}) {
    const result = await getJson(`/subjects${queryString({ examId })}`, options);
    return result.items ?? [];
  },
  async listTopics(subjectId, { signal, chapterId } = {}) {
    if (!subjectId) return [];
    const result = await getJson(`/topics${queryString({ subjectId, chapterId })}`, { signal });
    return result.items ?? [];
  },
  async listChapters(subjectId, options = {}) {
    if (!subjectId) return [];
    const result = await getJson(`/chapters${queryString({ subjectId })}`, options);
    return result.items ?? [];
  },
};
