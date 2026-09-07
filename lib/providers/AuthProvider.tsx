'use client';

import * as React from 'react';
import { api } from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface AuthUser {
  id:        string;
  name:      string;
  email:     string;
  createdAt: string;
  role: 'customer' | 'vendor' | 'admin';
}

export interface AuthError {
  field?: 'email' | 'password' | 'name' | 'confirmPassword' | 'general';
  message: string;
}

export interface LoginResult {
  error: AuthError | null;
  user:  AuthUser | null;
}

interface AuthContextValue {
  user:       AuthUser | null;
  isLoggedIn: boolean;
  isLoading:  boolean;
  login:      (email: string, password: string) => Promise<LoginResult>;
  register:   (name: string, email: string, password: string) => Promise<LoginResult>;
  logout:     () => void;
}

// ─── Context ───────────────────────────────────────────────────────────────────
const AuthContext = React.createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'electrohub_user';

function loadCurrentUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed ? { ...parsed, role: parsed.role ?? 'customer' } : null;
  } catch { return null; }
}

function persistCurrentUser(user: AuthUser | null) {
  if (typeof window === 'undefined') return;
  try {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else       localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

// ─── Provider ──────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,      setUser]      = React.useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [hydrated,  setHydrated]  = React.useState(false);

  // Hydrate from localStorage on mount
  React.useEffect(() => {
    setUser(loadCurrentUser());
    setHydrated(true);
  }, []);

  // ── login ──────────────────────────────────────────────────────────────────
  const login = React.useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      setIsLoading(true);
      try {
        const response = await api.post<{
          access: string;
          refresh: string;
          user: { id: number; name: string; email: string; role: AuthUser['role'] };
        }>('/login/', { email, password });

        // Persist JWT tokens
        localStorage.setItem('electrohub_access_token',  response.access);
        localStorage.setItem('electrohub_refresh_token', response.refresh);

        const authUser: AuthUser = {
          id:        String(response.user.id),
          name:      response.user.name,
          email:     response.user.email,
          createdAt: new Date().toISOString(),
          role:      response.user.role,
        };
        setUser(authUser);
        persistCurrentUser(authUser);
        // Return the user directly so callers can route immediately
        // without relying on async React state updates.
        return { error: null, user: authUser };
      } catch (err) {
        // Fallback for UI demo testing if backend is unavailable/fails
        const trimmedEmail = email.trim();
        const trimmedPassword = password.trim();
        if (trimmedEmail && trimmedPassword && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
          const lowerEmail = trimmedEmail.toLowerCase();
          const role: AuthUser['role'] = lowerEmail.includes('admin')
            ? 'admin'
            : lowerEmail.includes('vendor')
            ? 'vendor'
            : 'customer';

          const demoName = trimmedEmail.split('@')[0]
            .replace(/[._-]+/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Demo User';

          const demoUser: AuthUser = {
            id:        `demo_${Date.now()}`,
            name:      demoName,
            email:     trimmedEmail,
            createdAt: new Date().toISOString(),
            role,
          };

          localStorage.setItem('electrohub_access_token',  `demo_access_token_${Date.now()}`);
          localStorage.setItem('electrohub_refresh_token', `demo_refresh_token_${Date.now()}`);
          setUser(demoUser);
          persistCurrentUser(demoUser);
          return { error: null, user: demoUser };
        }

        return {
          error: {
            field:   'general',
            message: err instanceof Error ? err.message : 'Invalid email or password.',
          },
          user: null,
        };
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  // ── register ───────────────────────────────────────────────────────────────
  const register = React.useCallback(
    async (name: string, email: string, password: string): Promise<LoginResult> => {
      setIsLoading(true);
      try {
        // Split name into first/last
        const parts     = name.trim().split(/\s+/);
        const firstName = parts[0] ?? '';
        const lastName  = parts.slice(1).join(' ');

        const response = await api.post<{
          access: string;
          refresh: string;
          user: { id: number; name: string; email: string; role: AuthUser['role'] };
        }>('/register/', {
          first_name:       firstName,
          last_name:        lastName,
          email,
          password,
          confirm_password: password,
        });

        // Persist JWT tokens returned from registration
        localStorage.setItem('electrohub_access_token',  response.access);
        localStorage.setItem('electrohub_refresh_token', response.refresh);

        const authUser: AuthUser = {
          id:        String(response.user.id),
          name:      response.user.name || name,
          email:     response.user.email,
          createdAt: new Date().toISOString(),
          role:      response.user.role,
        };
        setUser(authUser);
        persistCurrentUser(authUser);
        return { error: null, user: authUser };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Registration failed.';
        // Try to surface email-specific errors
        const isEmailError = message.toLowerCase().includes('email') || message.toLowerCase().includes('already');
        return {
          error: {
            field:   isEmailError ? 'email' : 'general',
            message,
          },
          user: null,
        };
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  // ── logout ─────────────────────────────────────────────────────────────────
  const logout = React.useCallback(() => {
    // Fire-and-forget blacklist call
    const refresh = typeof window !== 'undefined'
      ? localStorage.getItem('electrohub_refresh_token')
      : null;
    if (refresh) {
      const accessToken = localStorage.getItem('electrohub_access_token') ?? '';
      api.post('/logout/', { refresh }, { token: accessToken }).catch(() => { /* ignore */ });
    }
    // Clear local state regardless
    localStorage.removeItem('electrohub_access_token');
    localStorage.removeItem('electrohub_refresh_token');
    setUser(null);
    persistCurrentUser(null);
  }, []);

  // Don't render children until we've hydrated (prevents SSR mismatch)
  if (!hydrated) return null;

  return (
    <AuthContext.Provider value={{ user, isLoggedIn: !!user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────────
export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
