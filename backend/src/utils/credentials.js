import bcrypt from 'bcryptjs';

const passwordSaltRounds = 12;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeAdminUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function validAdminUsername(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{2,31}$/u.test(value);
}

export function validEmail(email) {
  return email.length <= 254 && emailPattern.test(email);
}

export function passwordValidationMessage(password) {
  if (typeof password !== 'string' || !password) return 'Password is required.';
  if ([...password].length < 12) return 'Password must be at least 12 characters.';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password must be no more than 72 UTF-8 bytes.';
  return null;
}

export function hashPassword(password) {
  return bcrypt.hash(password, passwordSaltRounds);
}
