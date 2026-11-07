import 'dotenv/config';
import mongoose from 'mongoose';
import { StringDecoder } from 'node:string_decoder';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import User from '../src/models/User.js';
import { hashPassword, normalizeAdminUsername, normalizeEmail, passwordValidationMessage, validAdminUsername, validEmail } from '../src/utils/credentials.js';

export class AdminAccountError extends Error {
  constructor(message, code = 'INVALID_INPUT') {
    super(message);
    this.name = 'AdminAccountError';
    this.code = code;
  }
}

function duplicateEmailError(error) {
  return error?.code === 11000 && Boolean(error?.keyPattern?.email || error?.keyValue?.email);
}

function duplicateUsernameError(error) {
  return error?.code === 11000 && Boolean(error?.keyPattern?.adminUsername || error?.keyValue?.adminUsername);
}

export async function createAdminAccount({ UserModel = User, name, username, email, password, confirmPassword }) {
  const fullName = typeof name === 'string' ? name.trim() : '';
  const normalizedUsername = normalizeAdminUsername(username);
  const normalizedEmail = normalizeEmail(email);
  const passwordValue = typeof password === 'string' ? password : '';
  const confirmation = typeof confirmPassword === 'string' ? confirmPassword : '';

  const missingFields = [];
  if (!fullName) missingFields.push('Full name');
  if (!normalizedUsername) missingFields.push('Admin username');
  if (!normalizedEmail) missingFields.push('Email address');
  if (!passwordValue) missingFields.push('Password');
  if (!confirmation) missingFields.push('Confirm password');
  if (missingFields.length) {
    throw new AdminAccountError(`Missing required fields: ${missingFields.join(', ')}.`);
  }
  if (fullName.length < 2 || fullName.length > 80) {
    throw new AdminAccountError('Full name must be between 2 and 80 characters.');
  }
  if (!validAdminUsername(normalizedUsername)) {
    throw new AdminAccountError('Admin username must be 3 to 32 characters using letters, numbers, dots, underscores, or hyphens.');
  }
  if (!validEmail(normalizedEmail)) {
    throw new AdminAccountError('Please enter a valid email address.');
  }
  const passwordError = passwordValidationMessage(passwordValue);
  if (passwordError) throw new AdminAccountError(passwordError);
  if (confirmation !== passwordValue) throw new AdminAccountError('Passwords do not match.');

  if (await UserModel.exists({ adminUsername: normalizedUsername })) {
    throw new AdminAccountError('That admin username is already in use.', 'DUPLICATE_USERNAME');
  }
  if (await UserModel.exists({ email: normalizedEmail })) {
    throw new AdminAccountError('This email is already registered. No existing account was changed.', 'DUPLICATE_EMAIL');
  }

  const passwordHash = await hashPassword(passwordValue);
  try {
    const admin = await UserModel.create({
      name: fullName,
      adminUsername: normalizedUsername,
      email: normalizedEmail,
      passwordHash,
      role: 'admin',
    });
    return { id: String(admin._id ?? admin.id), name: admin.name, username: admin.adminUsername, email: admin.email, role: admin.role };
  } catch (error) {
    if (duplicateUsernameError(error)) {
      throw new AdminAccountError('That admin username is already in use.', 'DUPLICATE_USERNAME');
    }
    if (duplicateEmailError(error)) {
      throw new AdminAccountError('This email is already registered. No existing account was changed.', 'DUPLICATE_EMAIL');
    }
    throw error;
  }
}

export function assertInteractiveTerminal(input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    throw new AdminAccountError('Run this command in an interactive terminal. Passwords are collected without echo and must not be passed as command-line arguments.', 'NON_INTERACTIVE');
  }
}

function createTerminalPrompter(input, output) {
  let swallowNextLineFeed = false;

  const ask = (promptText, { hidden = false } = {}) => new Promise((resolvePromise, rejectPromise) => {
    let value = '';
    let escapeState = 0;
    const decoder = new StringDecoder('utf8');
    let restored = false;
    const cleanup = () => {
      if (restored) return;
      restored = true;
      input.off('data', onData);
      try { input.setRawMode(false); } catch { /* Restore best-effort when a terminal is closing. */ }
      input.pause();
      output.write('\n');
    };
    const onData = (buffer) => {
      const characters = decoder.write(buffer);
      for (const character of characters) {
        if (swallowNextLineFeed) {
          swallowNextLineFeed = false;
          if (character === '\n') continue;
        }
        if (escapeState === 1) {
          escapeState = character === '[' || character === ']' || character === 'O' ? 2 : 0;
          continue;
        }
        if (escapeState === 2) {
          if (character >= '@' && character <= '~') escapeState = 0;
          continue;
        }
        if (character === '\u001b') {
          escapeState = 1;
          continue;
        }
        if (character === '\u0003' || character === '\u0004') {
          cleanup();
          rejectPromise(new AdminAccountError('Admin account creation cancelled.', 'CANCELLED'));
          return;
        }
        if (character === '\r' || character === '\n') {
          swallowNextLineFeed = character === '\r';
          cleanup();
          resolvePromise(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          if (value) {
            value = Array.from(value).slice(0, -1).join('');
            if (!hidden) output.write('\b \b');
          }
          continue;
        }
        if (character.codePointAt(0) < 32) continue;
        value += character;
        if (!hidden) output.write(character);
      }
    };

    try {
      output.write(promptText);
      input.setRawMode(true);
      input.resume();
      input.on('data', onData);
    } catch {
      cleanup();
      rejectPromise(new AdminAccountError('Unable to read input securely in this terminal.', 'TERMINAL_ERROR'));
    }
  });

  return {
    askVisible: (promptText) => ask(promptText),
    askHidden: (promptText) => ask(promptText, { hidden: true }),
  };
}

export async function promptForAccount({ input = process.stdin, output = process.stdout } = {}) {
  assertInteractiveTerminal(input, output);
  const prompts = createTerminalPrompter(input, output);
  const name = await prompts.askVisible('Full name: ');
  const username = await prompts.askVisible('Admin username: ');
  const email = await prompts.askVisible('Email address: ');
  const password = await prompts.askHidden('Password (input hidden): ');
  const confirmPassword = await prompts.askHidden('Confirm password (input hidden): ');
  return { name, username, email, password, confirmPassword };
}

async function main() {
  let connected = false;
  try {
    assertInteractiveTerminal();
    const credentials = await promptForAccount();
    const { env } = await import('../src/config/env.js');
    await mongoose.connect(env.mongoUri);
    connected = true;
    await User.init();
    const admin = await createAdminAccount({ ...credentials, UserModel: User });
    console.log(`Admin account created for ${admin.email}. Sign in at /admin/login using the configured admin username.`);
  } catch (error) {
    if (error instanceof AdminAccountError) console.error(error.message);
    else if (duplicateUsernameError(error)) console.error('That admin username is already in use. No existing account was changed.');
    else if (duplicateEmailError(error)) console.error('This email is already registered. No existing account was changed.');
    else console.error('Admin account creation failed. Check the database connection and server configuration.');
    process.exitCode = 1;
  } finally {
    if (connected) await mongoose.disconnect().catch(() => {});
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) await main();
