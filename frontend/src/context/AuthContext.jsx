import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AuthApiError, authApi } from '../services/authApi.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);

  const refreshSession = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await authApi.currentUser();
      setUser(result.user);
      setStatus('authenticated');
      return result.user;
    } catch (error) {
      setUser(null);
      setStatus(error instanceof AuthApiError && error.status === 401 ? 'anonymous' : 'unavailable');
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const revalidateRestoredPage = (event) => {
      if (!event.persisted) return;
      document.documentElement.dataset.authRevalidating = 'true';
      void refreshSession();
    };
    window.addEventListener('pageshow', revalidateRestoredPage);
    return () => window.removeEventListener('pageshow', revalidateRestoredPage);
  }, [refreshSession]);

  useEffect(() => {
    if (status !== 'loading') delete document.documentElement.dataset.authRevalidating;
  }, [status]);

  const login = useCallback(async (credentials) => {
    const result = await authApi.login(credentials);
    setUser(result.user);
    setStatus('authenticated');
    return result.user;
  }, []);

  const register = useCallback(async (details) => {
    const result = await authApi.register(details);
    setUser(result.user);
    setStatus('authenticated');
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo(() => ({ status, user, login, register, logout, refreshSession }), [status, user, login, register, logout, refreshSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
