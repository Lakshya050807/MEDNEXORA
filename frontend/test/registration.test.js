import test from 'node:test';
import assert from 'node:assert/strict';
import { authApi, AuthApiError } from '../src/services/authApi.js';
import { registrationErrorMessage, validateRegistration } from '../src/utils/registrationValidation.js';

const validDetails = {
  name: 'Riya Student',
  email: 'riya@example.com',
  password: 'nursing-student-pass-4',
  confirmPassword: 'nursing-student-pass-4',
};

test('registration validation identifies missing fields and gives specific email/password guidance', () => {
  assert.deepEqual(validateRegistration({ name: '', email: '', password: '', confirmPassword: '' }), {
    name: 'Full name is required.',
    email: 'Email address is required.',
    password: 'Password is required.',
    confirmPassword: 'Please confirm your password.',
  });
  assert.equal(validateRegistration({ ...validDetails, email: 'invalid' }).email, 'Please enter a valid email address.');
  assert.equal(validateRegistration({ ...validDetails, password: 'short', confirmPassword: 'short' }).password, 'Password must be at least 12 characters.');
  assert.equal(validateRegistration({ ...validDetails, password: '🩺'.repeat(19), confirmPassword: '🩺'.repeat(19) }).password, 'Password must be no more than 72 UTF-8 bytes.');
});

test('registration page error helper preserves a safe backend message', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const safeMessage = 'This email is already registered. Please log in instead.';
  globalThis.fetch = async () => new Response(JSON.stringify({ message: safeMessage }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  });

  await assert.rejects(authApi.register({ name: 'Riya', email: 'riya@example.com', password: 'nursing-student-pass-4' }), (error) => {
    assert.ok(error instanceof AuthApiError);
    assert.equal(registrationErrorMessage(error), safeMessage);
    return true;
  });
});

test('registration error fallback is safe when an unexpected response has no message', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response('unavailable', { status: 500 });

  await assert.rejects(authApi.register({ name: 'Riya', email: 'riya@example.com', password: 'nursing-student-pass-4' }), (error) => {
    assert.equal(registrationErrorMessage(error), 'Something went wrong. Please try again later.');
    return true;
  });
});

test('authentication and dashboard requests bypass the browser HTTP cache', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ user: { id: 'student-1' }, dashboard: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  await authApi.login({ email: 'student@example.test', password: 'test-password' });
  await authApi.currentUser();
  await authApi.studentDashboard();

  assert.deepEqual(calls.map((call) => call.url), ['/api/auth/login', '/api/auth/me', '/api/student/dashboard']);
  assert.ok(calls.every((call) => call.options.cache === 'no-store'));
  assert.ok(calls.every((call) => call.options.credentials === 'same-origin'));
});
