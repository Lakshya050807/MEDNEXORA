import { clearSessionCookie } from '../utils/session.js';
import { toStudentProfile } from '../utils/student.js';

export function requireStudentAuth({ UserModel }) {
  return async function studentAuthentication(request, response, next) {
    const userId = request.session?.userId;
    if (!userId) {
      return response.status(401).json({ message: 'Please log in to continue.' });
    }

    try {
      const userQuery = UserModel.findById(userId);
      const user = await (typeof userQuery?.select === 'function'
        ? userQuery.select('+studentSessionVersion')
        : userQuery);
      if (!user) {
        request.session.destroy(() => {});
        clearSessionCookie(response);
        return response.status(401).json({ message: 'Please log in to continue.' });
      }
      if (user.role !== 'student') {
        return response.status(403).json({ message: 'Student access is required.' });
      }
      const storedSessionVersion = request.session.studentSessionVersion === undefined
        ? 0
        : Number(request.session.studentSessionVersion);
      const currentSessionVersion = Number(user.studentSessionVersion ?? 0);
      if (!Number.isSafeInteger(storedSessionVersion) || storedSessionVersion < 0
        || !Number.isSafeInteger(currentSessionVersion) || currentSessionVersion < 0
        || storedSessionVersion !== currentSessionVersion) {
        request.session.destroy(() => {});
        clearSessionCookie(response);
        return response.status(401).json({ message: 'Please log in to continue.' });
      }

      request.user = user;
      request.student = toStudentProfile(user);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
