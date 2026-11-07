import { env } from '../config/env.js';

export function regenerateStudentSession(request, userId) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((regenerateError) => {
      if (regenerateError) return reject(regenerateError);
      request.session.userId = userId.toString();
      request.session.save((saveError) => {
        if (saveError) return reject(saveError);
        return resolve();
      });
    });
  });
}

export function regenerateAdminSession(request, adminId, sessionVersion = 0) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((regenerateError) => {
      if (regenerateError) return reject(regenerateError);
      request.session.adminId = adminId.toString();
      request.session.adminSessionVersion = Number(sessionVersion) || 0;
      request.session.save((saveError) => {
        if (saveError) return reject(saveError);
        return resolve();
      });
    });
  });
}

export function destroyStudentSession(request) {
  if (!request.session) return Promise.resolve();
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => error ? reject(error) : resolve());
  });
}

export function destroyAdminSession(request) {
  if (!request.session) return Promise.resolve();
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => error ? reject(error) : resolve());
  });
}

export function clearSessionCookie(response) {
  response.clearCookie(env.sessionCookieName, {
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: 'lax',
    path: '/',
  });
}

export function clearAdminSessionCookie(response) {
  response.clearCookie(env.adminSessionCookieName, {
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: 'lax',
    path: '/',
  });
}
