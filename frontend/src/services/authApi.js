class AuthApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...options,
      cache: 'no-store',
    });
  } catch {
    throw new AuthApiError('The server could not be reached. Check that the API is running.', 0);
  }

  if (response.status === 204) return null;

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new AuthApiError(payload?.message || 'Something went wrong. Please try again later.', response.status);
  }
  return payload;
}

function postJson(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const authApi = {
  register: (details) => postJson('/auth/register', details),
  login: (credentials) => postJson('/auth/login', credentials),
  logout: () => postJson('/auth/logout', {}),
  currentUser: () => request('/auth/me'),
  studentDashboard: () => request('/student/dashboard'),
  claimFreeMaterial: (productId) => postJson(`/student/resources/${encodeURIComponent(productId)}/access`, {}),
};

export { AuthApiError };
