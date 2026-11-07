export class PaymentApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'PaymentApiError';
    this.status = status;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api/payments${path}`, { credentials: 'same-origin', ...options });
  } catch {
    throw new PaymentApiError('The payment server could not be reached. Check that the API is running.');
  }
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) throw new PaymentApiError(payload?.message || 'The payment request could not be completed.', response.status);
  return payload ?? {};
}

function postJson(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const paymentApi = {
  createCheckout: (body) => postJson('/orders', body),
  verifyPayment: (orderId, body) => postJson(`/orders/${encodeURIComponent(orderId)}/verify`, body),
  reconcileOrder: (orderId, body = {}) => postJson(`/orders/${encodeURIComponent(orderId)}/reconcile`, body),
  async listOrders({ page = 1, limit = 20 } = {}) {
    return request(`/orders?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`);
  },
  async getOrder(orderId) {
    return request(`/orders/${encodeURIComponent(orderId)}`);
  },
};
