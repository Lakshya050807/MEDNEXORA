import { createHmac } from 'node:crypto';

function duplicateKeyError(error) {
  return error?.code === 11000;
}

/**
 * Shared fixed-window limiter backed by MongoDB. Identifier values (client IP
 * or a normalized account key) are HMACed before storage; the compound unique
 * index makes increments process-safe across API instances.
 */
export function createMongoRateLimiter({
  RateLimitModel,
  secret,
  scope,
  windowMs,
  max,
  keyResolver,
  message = 'Too many requests. Please try again later.',
  unavailableMessage = 'Password reset is temporarily unavailable.',
  now = () => new Date(),
}) {
  if (!RateLimitModel || typeof RateLimitModel.findOneAndUpdate !== 'function'
    || typeof secret !== 'string' || secret.length < 32
    || !['request', 'complete', 'registration-request', 'registration-complete', 'staging-invitation-write',
      'student-login-ip', 'student-login-account', 'admin-login-ip', 'admin-login-account'].includes(scope)
    || !Number.isSafeInteger(windowMs) || windowMs < 1000
    || !Number.isSafeInteger(max) || max < 1) {
    throw new TypeError('MongoDB rate limiter configuration is invalid.');
  }

  return async function mongoRateLimit(request, response, next) {
    const current = now();
    const windowStart = new Date(Math.floor(current.getTime() / windowMs) * windowMs);
    const expiresAt = new Date(windowStart.getTime() + 2 * windowMs);
    let identifier;
    try {
      identifier = keyResolver ? keyResolver(request) : (request.ip || request.socket?.remoteAddress || 'unknown');
    } catch {
      identifier = '';
    }
    if (typeof identifier !== 'string' || !identifier || Buffer.byteLength(identifier, 'utf8') > 512) {
      // Malformed account fields share one bounded bucket. The separate IP
      // limiter remains the primary control for malformed requests.
      identifier = keyResolver ? 'invalid-account-key' : 'unknown-client-ip';
    }
    const ipHash = createHmac('sha256', secret).update(`${scope}\0${identifier}`, 'utf8').digest('hex');
    const filter = { scope, ipHash, windowStart };

    let bucket;
    try {
      try {
        bucket = await RateLimitModel.findOneAndUpdate(filter, {
          $inc: { count: 1 },
          $setOnInsert: { expiresAt },
        }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
      } catch (error) {
        if (!duplicateKeyError(error)) throw error;
        // Concurrent first requests can race on the unique bucket index. The
        // winner inserts; losers retry as ordinary atomic increments.
        bucket = await RateLimitModel.findOneAndUpdate(filter, {
          $inc: { count: 1 },
        }, { returnDocument: 'after' });
      }
    } catch {
      response.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return response.status(503).json({ message: unavailableMessage });
    }

    if (!bucket || !Number.isSafeInteger(bucket.count)) {
      response.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return response.status(503).json({ message: unavailableMessage });
    }
    if (bucket.count > max) {
      const retryAfterMs = windowStart.getTime() + windowMs - current.getTime();
      response.set('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      return response.status(429).json({ message });
    }
    return next();
  };
}

export default createMongoRateLimiter;
