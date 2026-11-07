export class AdminApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`/api/admin${path}`, {
      method,
      credentials: 'same-origin',
      signal,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new AdminApiError('The admin API could not be reached. Check that the backend is running.');
  }
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) throw new AdminApiError(payload?.message || 'The admin request could not be completed.', response.status);
  return payload ?? {};
}

async function uploadPdf(file, { signal } = {}) {
  let response;
  try {
    response = await fetch('/api/admin/uploads/pdf', {
      method: 'POST',
      credentials: 'same-origin',
      signal,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/pdf' },
      body: file,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new AdminApiError('The private PDF upload could not reach the server.');
  }
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) throw new AdminApiError(payload?.message || 'The private PDF could not be uploaded.', response.status);
  return payload ?? {};
}

function queryString(values) {
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(values ?? {})) {
    let value = rawValue;
    if (key === 'page' || key === 'limit') {
      if (value === undefined || value === null || value === '') continue;
      if (typeof value !== 'number' && typeof value !== 'string') continue;
      const parsed = typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value);
      const maximum = key === 'page' ? 1000 : 50;
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) continue;
      value = parsed;
    }
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const adminApi = {
  login: (credentials) => request('/login', { method: 'POST', body: credentials }),
  logout: () => request('/logout', { method: 'POST', body: {} }),
  changePassword: (credentials) => request('/password', { method: 'POST', body: credentials }),
  profile: (options = {}) => request('/me', options),
  overview: (options = {}) => request('/overview', options),
  list: (resource, filters = {}, options = {}) => request(`/${resource}${queryString(filters)}`, options),
  create: (resource, data, options = {}) => request(`/${resource}`, { ...options, method: 'POST', body: data }),
  update: (resource, id, data, options = {}) => request(`/${resource}/${encodeURIComponent(id)}`, { ...options, method: 'PATCH', body: data }),
  remove: (resource, id, options = {}) => request(`/${resource}/${encodeURIComponent(id)}`, { ...options, method: 'DELETE' }),
  uploadPdf,
};

export function formatRupees(paise = 0) {
  if (!Number.isSafeInteger(paise)) return 'Not set';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(paise || 0) / 100);
}
