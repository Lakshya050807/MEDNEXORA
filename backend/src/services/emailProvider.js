const resendEndpoint = 'https://api.resend.com/emails';
const genericDeliveryError = 'Email delivery failed.';

function validEmailAddress(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(value);
}

/**
 * Creates a Resend-backed sender. The fetch implementation is injectable so
 * tests can exercise the adapter without making external requests.
 */
export function createResendEmailProvider({ apiKey, from, fetchImpl = globalThis.fetch } = {}) {
  const configuredApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  const configuredFrom = typeof from === 'string' ? from.trim() : '';

  return Object.freeze({
    async send({ to, subject, text, html } = {}) {
      if (!/^re_[A-Za-z0-9_-]{16,}$/u.test(configuredApiKey) || !validEmailAddress(configuredFrom)) {
        throw new Error('Email delivery is not configured.');
      }
      if (typeof fetchImpl !== 'function') throw new Error(genericDeliveryError);
      if (!validEmailAddress(to) || typeof subject !== 'string' || !subject.trim()
        || (typeof text !== 'string' && typeof html !== 'string')) {
        throw new TypeError('A valid recipient, subject, and email body are required.');
      }

      let response;
      try {
        response = await fetchImpl(resendEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${configuredApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from: configuredFrom, to, subject: subject.trim(), ...(text !== undefined ? { text } : {}), ...(html !== undefined ? { html } : {}) }),
        });
      } catch {
        throw new Error(genericDeliveryError);
      }

      if (!response?.ok) throw new Error(genericDeliveryError);
      return { sent: true };
    },
  });
}

export default createResendEmailProvider;
