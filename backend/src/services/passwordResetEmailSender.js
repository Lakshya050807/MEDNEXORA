const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails';
const VERIFIED_SENDER = 'no-reply@mail.mednexora.site';

function isUsableApiKey(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && /^[!-~]+$/u.test(value);
}

export function createPasswordResetEmailSender(email, { fetchImpl = globalThis.fetch } = {}) {
  const apiKey = isUsableApiKey(email?.apiKey) ? email.apiKey : '';
  const configured = email?.configured === true && Boolean(apiKey);
  if (configured && typeof fetchImpl !== 'function') {
    throw new TypeError('Password reset email delivery is unavailable.');
  }

  return Object.freeze({
    configured,
    async sendPasswordReset({ to, url }) {
      if (!configured) throw new Error('Password reset email is not configured.');
      try {
        const response = await fetchImpl(RESEND_EMAILS_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: VERIFIED_SENDER,
            to: [to],
            subject: 'Reset your MEDNEXORA password',
            text: `To reset your password, open this link within 60 minutes:\n\n${url}\n\nIf you did not request a reset, you can ignore this message.`,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        });
        if (!response?.ok) throw new Error('Provider rejected the request.');
      } catch {
        const error = new Error('Email delivery failed.');
        error.name = 'EmailDeliveryError';
        throw error;
      }
    },
  });
}
