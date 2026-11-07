import { env } from '../config/env.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export function verifyOrigin(request, response, next) {
  if (safeMethods.has(request.method)) return next();
  const origin = request.get('origin');
  const fetchSite = request.get('sec-fetch-site');
  if ((origin && origin !== env.appOrigin)
    || fetchSite === 'cross-site'
    || (env.nodeEnv === 'production' && !origin)) {
    return response.status(403).json({ message: 'This request origin is not allowed.' });
  }
  return next();
}
