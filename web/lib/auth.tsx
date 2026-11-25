'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, session } from './api';
import type { User } from './types';

interface AuthContextValue {
  user: User | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: { name: string; email: string; password: string; role: 'CUSTOMER' | 'PROVIDER' }): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  // localStorage only exists in the browser, so the session is read after mount.
  useEffect(() => {
    setUser(session.user());
    setReady(true);
  }, []);

  const finish = useCallback((res: AuthResponse) => {
    session.save(res, res.user);
    setUser(res.user);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => finish(await api.post<AuthResponse>('/auth/login', { email, password })),
    [finish],
  );
  const register = useCallback(
    async (input: { name: string; email: string; password: string; role: 'CUSTOMER' | 'PROVIDER' }) =>
      finish(await api.post<AuthResponse>('/auth/register', input)),
    [finish],
  );
  const logout = useCallback(async () => {
    const refreshToken = session.refreshToken();
    if (refreshToken) await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    session.clear();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, ready, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
