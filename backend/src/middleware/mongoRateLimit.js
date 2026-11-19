import { createHmac } from 'node:crypto';

function duplicateKeyError(error) {
  return error?.code === 11000;
}

/**
 * Shared fixed-window per-IP limiter backed by MongoDB. IP values are HMACed
 * before storage; the compound unique index makes increments process-safe.
 */
export function createMongoRateLimiter({
  RateLimitModel,
  secret,
  scope,
  windowMs,
  max,
  message = 'Too many requests. Please try again later.',
  unavailableMessage = 'Password reset is temporarily unavailable.',
  now = () => new Date(),
}) {
  if (!RateLimitModel || typeof RateLimitModel.findOneAndUpdate !== 'function'
    || typeof secret !== 'string' || secret.length < 32
    || !['request', 'complete', 'registration-request', 'registration-complete', 'staging-invitation-write'].includes(scope)
    || !Number.isSafeInteger(windowMs) || windowMs < 1000
    || !Number.isSafeInteger(max) || max < 1) {
    throw new TypeError('MongoDB rate limiter configuration is invalid.');
  }

  return async function mongoRateLimit(request, response, next) {
    const current = now();
    const windowStart = new Date(Math.floor(current.getTime() / windowMs) * windowMs);
    const expiresAt = new Date(windowStart.getTime() + 2 * windowMs);
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    const ipHash = createHmac('sha256', secret).update(`${scope}\0${ip}`, 'utf8').digest('hex');
    const filter = { scope, ipHash, windowStart };

    let bucket;
    try {
      try {
        bucket = await RateLimitModel.findOneAndUpdate(filter, {
          $inc: { count: 1 },
          $setOnInsert: { expiresAt },
        }, { upsert: true, new: true, setDefaultsOnInsert: true });
      } catch (error) {
        if (!duplicateKeyError(error)) throw error;
        // Concurrent first requests can race on the unique bucket index. The
        // winner inserts; losers retry as ordinary atomic increments.
        bucket = await RateLimitModel.findOneAndUpdate(filter, {
          $inc: { count: 1 },
        }, { new: true });
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
