import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { clearSessionCookie, destroyStudentSession, regenerateStudentSession } from '../utils/session.js';
import { toStudentProfile } from '../utils/student.js';
import { hashPassword, normalizeEmail, passwordValidationMessage, validEmail } from '../utils/credentials.js';

const dummyPasswordHash = bcrypt.hashSync(randomBytes(32).toString('hex'), 12);

function duplicateEmailError(error) {
  return error?.code === 11000 && (error?.keyPattern?.email || error?.keyValue?.email);
}

function sendDuplicateEmail(response) {
  return response.status(409).json({
    message: 'This email is already registered. Please log in instead.',
  });
}

export function createAuthController({ UserModel }) {
  return {
    register: async (request, response, next) => {
      const body = request.body ?? {};
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const email = normalizeEmail(body.email);
      const password = typeof body.password === 'string' ? body.password : '';

      const missingFields = [];
      if (!name) missingFields.push('name');
      if (!email) missingFields.push('email address');
      if (!password) missingFields.push('password');
      if (missingFields.length) {
        return response.status(400).json({ message: `Missing required fields: ${missingFields.join(', ')}.` });
      }

      if (name.length < 2 || name.length > 80) {
        return response.status(400).json({ message: 'Enter your name using 2 to 80 characters.' });
      }
      if (!validEmail(email)) {
        return response.status(400).json({ message: 'Please enter a valid email address.' });
      }
      const passwordError = passwordValidationMessage(password);
      if (passwordError) return response.status(400).json({ message: passwordError });

      try {
        if (await UserModel.exists({ email })) return sendDuplicateEmail(response);

        const passwordHash = await hashPassword(password);
        const user = await UserModel.create({ name, email, passwordHash, role: 'student' });
        await regenerateStudentSession(request, user._id ?? user.id);
        return response.status(201).json({ user: toStudentProfile(user) });
      } catch (error) {
        if (duplicateEmailError(error)) return sendDuplicateEmail(response);
        return next(error);
      }
    },

    login: async (request, response, next) => {
      const email = normalizeEmail(request.body?.email);
      const password = typeof request.body?.password === 'string' ? request.body.password : '';

      if (!validEmail(email) || !password || Buffer.byteLength(password, 'utf8') > 72) {
        return response.status(400).json({ message: 'Enter a valid email address and password.' });
      }

      try {
        const user = await UserModel.findOne({ email }).select('+passwordHash');
        const passwordHash = user?.passwordHash ?? dummyPasswordHash;
        const passwordMatches = await bcrypt.compare(password, passwordHash);
        if (!user || !passwordMatches || user.role !== 'student') {
          return response.status(401).json({ message: 'Email or password is incorrect.' });
        }

        await regenerateStudentSession(request, user._id ?? user.id);
        return response.status(200).json({ user: toStudentProfile(user) });
      } catch (error) {
        return next(error);
      }
    },

    logout: async (request, response, next) => {
      try {
        await destroyStudentSession(request);
        clearSessionCookie(response);
        return response.status(204).end();
      } catch (error) {
        return next(error);
      }
    },

    profile: (request, response) => response.status(200).json({ user: request.student }),
  };
}
