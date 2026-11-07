import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { clearAdminSessionCookie, destroyAdminSession, regenerateAdminSession } from '../utils/session.js';
import {
  hashPassword,
  normalizeAdminUsername,
  normalizeEmail,
  passwordValidationMessage,
  validAdminUsername,
  validEmail,
} from '../utils/credentials.js';

const dummyPasswordHash = bcrypt.hashSync(randomBytes(32).toString('hex'), 12);

function safeUser(user) {
  return {
    id: String(user._id ?? user.id),
    name: user.name,
    email: user.email,
    username: user.adminUsername ?? '',
  };
}

export function createAdminAuthController({ UserModel }) {
  return {
    login: async (request, response, next) => {
      const username = normalizeAdminUsername(request.body?.username);
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      if (username.length > 254 || !password || Buffer.byteLength(password, 'utf8') > 72) {
        await bcrypt.compare(password || 'invalid', dummyPasswordHash);
        return response.status(401).json({ message: 'Username or password is incorrect.' });
      }
      try {
        let user = validAdminUsername(username)
          ? await UserModel.findOne({ adminUsername: username }).select('+passwordHash +adminSessionVersion')
          : null;

        // Keep existing admin accounts usable until a username is provisioned.
        // The login form still accepts this only as a username field, and new
        // accounts always receive an explicit unique username.
        if (!user && validEmail(username)) {
          const legacyAdmin = await UserModel.findOne({ email: normalizeEmail(username) }).select('+passwordHash +adminSessionVersion');
          if (legacyAdmin?.role === 'admin' && !legacyAdmin.adminUsername) user = legacyAdmin;
        }

        const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? dummyPasswordHash);
        if (!user || user.role !== 'admin' || !passwordMatches) {
          return response.status(401).json({ message: 'Username or password is incorrect.' });
        }
        const version = Number(user.adminSessionVersion) || 0;
        await regenerateAdminSession(request, user._id ?? user.id, version);
        return response.status(200).json({ user: safeUser(user) });
      } catch (error) { return next(error); }
    },

    logout: async (request, response, next) => {
      try {
        await destroyAdminSession(request);
        clearAdminSessionCookie(response);
        return response.status(204).end();
      } catch (error) { return next(error); }
    },

    profile: (request, response) => response.status(200).json({ user: safeUser(request.admin) }),

    changePassword: async (request, response, next) => {
      const currentPassword = typeof request.body?.currentPassword === 'string' ? request.body.currentPassword : '';
      const newPassword = typeof request.body?.newPassword === 'string' ? request.body.newPassword : '';
      const confirmPassword = typeof request.body?.confirmPassword === 'string' ? request.body.confirmPassword : '';
      if (!currentPassword || !newPassword || !confirmPassword) {
        return response.status(400).json({ message: 'Enter your current password, new password, and confirmation.' });
      }
      const passwordError = passwordValidationMessage(newPassword);
      if (passwordError) return response.status(400).json({ message: passwordError });
      if (newPassword !== confirmPassword) return response.status(400).json({ message: 'New passwords do not match.' });
      if (currentPassword === newPassword) return response.status(400).json({ message: 'Choose a new password that differs from your current password.' });

      try {
        const adminId = String(request.admin._id ?? request.admin.id);
        const userQuery = UserModel.findById(adminId);
        const user = await (typeof userQuery?.select === 'function' ? userQuery.select('+passwordHash +adminSessionVersion') : userQuery);
        if (!user || user.role !== 'admin') return response.status(401).json({ message: 'Please log in to continue.' });
        const currentMatches = await bcrypt.compare(currentPassword, user.passwordHash ?? dummyPasswordHash);
        if (!currentMatches) return response.status(400).json({ message: 'Current password is incorrect.' });
        user.passwordHash = await hashPassword(newPassword);
        user.adminSessionVersion = (Number(user.adminSessionVersion) || 0) + 1;
        await user.save();
        await regenerateAdminSession(request, adminId, user.adminSessionVersion);
        return response.status(200).json({ message: 'Administrator password updated.' });
      } catch (error) { return next(error); }
    },
  };
}

export default createAdminAuthController;
