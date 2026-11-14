import mongoose from 'mongoose';
import User from '../src/models/User.js';
import { hashPassword, validAdminUsername, validEmail, passwordValidationMessage } from '../src/utils/credentials.js';

function validatedLocalTestUri(value) {
  if (process.env.NODE_ENV !== 'test' || process.env.E2E_RUN !== '1') {
    throw new Error('The E2E admin fixture can run only in the isolated test runner.');
  }
  if (!value || value !== process.env.MONGODB_URI) {
    throw new Error('An explicit isolated E2E MongoDB URI is required.');
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('The E2E MongoDB URI is invalid.'); }
  const host = parsed.hostname.replace(/^\[|\]$/gu, '');
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)
    || decodeURIComponent(parsed.pathname.slice(1)) !== 'mednexora_e2e'
    || parsed.username || parsed.password || parsed.search) {
    throw new Error('The E2E MongoDB URI must use the local disposable mednexora_e2e database without credentials.');
  }
  return value;
}

async function main() {
  const uri = validatedLocalTestUri(process.env.E2E_MONGODB_URI);
  const username = process.env.E2E_ADMIN_USERNAME ?? '';
  const email = process.env.E2E_ADMIN_EMAIL ?? '';
  const password = process.env.E2E_ADMIN_PASSWORD ?? '';
  if (!validAdminUsername(username) || !validEmail(email) || passwordValidationMessage(password)) {
    throw new Error('The E2E administrator fixture is missing valid test-only credentials.');
  }
  await mongoose.connect(uri, { autoIndex: true });
  await User.init();
  await User.create({
    name: 'MEDNEXORA E2E Administrator',
    email,
    adminUsername: username,
    passwordHash: await hashPassword(password),
    role: 'admin',
  });
  await mongoose.disconnect();
  process.stdout.write('Disposable E2E administrator fixture created.\n');
}

main().catch(async (error) => {
  process.stderr.write(`${error.message}\n`);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
