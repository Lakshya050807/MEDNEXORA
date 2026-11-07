export class RazorpayGatewayError extends Error {
  constructor(message = 'The payment provider could not complete the request.', status = 502) {
    super(message);
    this.name = 'RazorpayGatewayError';
    this.status = status;
  }
}

export function createRazorpayGateway({ keyId, keySecret, fetchImpl = globalThis.fetch } = {}) {
  function assertConfigured() {
    if (!keyId || !keySecret) throw new RazorpayGatewayError('Razorpay is not configured on this server.', 503);
  }

  async function request(path, { method = 'GET', body } = {}) {
    assertConfigured();
    if (typeof fetchImpl !== 'function') throw new RazorpayGatewayError('Payment requests are unavailable on this server.', 503);
    let response;
    try {
      response = await fetchImpl(`https://api.razorpay.com/v1${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new RazorpayGatewayError('The payment provider could not be reached.');
    }

    let payload;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      throw new RazorpayGatewayError(response.status >= 500
        ? 'The payment provider is temporarily unavailable.'
        : 'The payment provider rejected the request.');
    }
    if (!payload || typeof payload !== 'object') throw new RazorpayGatewayError();
    return payload;
  }

  return Object.freeze({
    createOrder: ({ amount, currency = 'INR', receipt }) => request('/orders', {
      method: 'POST',
      body: { amount, currency, receipt },
    }),
    fetchPayment: (paymentId) => request(`/payments/${encodeURIComponent(paymentId)}`),
    listOrderPayments: (orderId) => request(`/orders/${encodeURIComponent(orderId)}/payments`),
  });
}
