import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthSession, User } from "@/types";
import { authApi } from "@/api";

type Status = "loading" | "anon" | "authed";

interface AuthContextValue {
  status: Status;
  user: User | null;
  session: AuthSession | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; displayName: string; role: "employer" | "provider" }) => Promise<void>;
  logout: () => Promise<void>;
  recover: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_KEY = "mp.session.token";
const USER_KEY = "mp.session.user";

function readStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

/**
 * Frontend-only auth context. Backed by the mock API adapter. Replace calls
 * inside login/register/logout with the real provider — the surface stays.
 * UI code MUST NOT treat this as authorization: backend enforces access.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    // Only hydrate on the client to avoid SSR/CSR mismatch.
    const token = typeof window !== "undefined" ? window.localStorage.getItem(SESSION_KEY) : null;
    const stored = readStoredUser();
    if (token && stored) {
      setSession({ token, userId: stored.id, expiresAt: "" });
      setUser(stored);
      setStatus("authed");
    } else {
      setStatus("anon");
    }
  }, []);

  const persist = useCallback((s: AuthSession, u: User) => {
    window.localStorage.setItem(SESSION_KEY, s.token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(u));
    setSession(s);
    setUser(u);
    setStatus("authed");
  }, []);

  const login = useCallback<AuthContextValue["login"]>(
    async (email, password) => {
      const res = await authApi.login({ email, password });
      persist(res.session, res.user);
    },
    [persist],
  );
  const register = useCallback<AuthContextValue["register"]>(
    async (input) => {
      const res = await authApi.register(input);
      persist(res.session, res.user);
    },
    [persist],
  );
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      window.localStorage.removeItem(SESSION_KEY);
      window.localStorage.removeItem(USER_KEY);
      setSession(null);
      setUser(null);
      setStatus("anon");
    }
  }, []);
  const recover = useCallback(async (email: string) => {
    await authApi.recover(email);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, session, login, register, logout, recover }),
    [status, user, session, login, register, logout, recover],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
