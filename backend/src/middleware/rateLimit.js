const maxTrackedClients = 20_000;

/**
 * A small per-process limiter for sensitive endpoints. Deployments with more
 * than one API process must also enforce a shared limit at the proxy/gateway.
 */
export function createRateLimiter({ windowMs, max, message = 'Too many requests. Please try again later.' }) {
  if (!Number.isSafeInteger(windowMs) || windowMs < 1000 || !Number.isSafeInteger(max) || max < 1) {
    throw new TypeError('Rate limit windowMs and max must be positive integers.');
  }

  const clients = new Map();
  let callsSinceCleanup = 0;

  return function rateLimit(request, response, next) {
    const now = Date.now();
    if (++callsSinceCleanup % 256 === 0) {
      for (const [key, bucket] of clients) {
        if (bucket.resetAt <= now) clients.delete(key);
      }
    }

    const key = request.ip || request.socket?.remoteAddress || 'unknown';
    let bucket = clients.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (clients.size >= maxTrackedClients) {
        for (const [client, value] of clients) {
          if (value.resetAt <= now) clients.delete(client);
        }
      }
      if (!clients.has(key) && clients.size >= maxTrackedClients) {
        response.set('Retry-After', String(Math.ceil(windowMs / 1000)));
        return response.status(429).json({ message });
      }
      bucket = { count: 0, resetAt: now + windowMs };
      clients.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    response.set('RateLimit-Limit', String(max));
    response.set('RateLimit-Remaining', String(remaining));
    response.set('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      response.set('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return response.status(429).json({ message });
    }
    return next();
  };
}

export default createRateLimiter;
