import { clearAdminSessionCookie } from '../utils/session.js';

export function requireAdminAuth({ UserModel }) {
  return async function adminAuthentication(request, response, next) {
    const adminId = request.session?.adminId;
    if (!adminId) return response.status(401).json({ message: 'Please log in to continue.' });

    try {
      const userQuery = UserModel.findById(adminId);
      const user = await (typeof userQuery?.select === 'function' ? userQuery.select('+adminSessionVersion') : userQuery);
      if (!user) {
        request.session.destroy(() => {});
        clearAdminSessionCookie(response);
        return response.status(401).json({ message: 'Please log in to continue.' });
      }
      if (user.role !== 'admin') return response.status(403).json({ message: 'Administrator access is required.' });
      if ((Number(request.session.adminSessionVersion) || 0) !== (Number(user.adminSessionVersion) || 0)) {
        request.session.destroy(() => {});
        clearAdminSessionCookie(response);
        return response.status(401).json({ message: 'Please log in to continue.' });
      }
      request.admin = user;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export default requireAdminAuth;
