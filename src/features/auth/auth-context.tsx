/**
 * PMP auth context — bridges Clerk identity to the PMP backend.
 *
 * Real mode (VITE_API_BASE_URL set, VITE_CLERK_PUBLISHABLE_KEY set):
 *   - Clerk owns session lifecycle (sign-in, sign-up, token refresh, sign-out).
 *   - This provider reacts to Clerk's isSignedIn state, fetches the PMP
 *     identity from GET /v1/auth/me, and falls back to POST /v1/auth/sync
 *     for newly registered users (reads accountType from sessionStorage).
 *   - The Clerk getToken() function is registered with the API client so
 *     every apiFetch() call automatically gets a fresh Bearer token.
 *
 * Mock mode (no VITE_API_BASE_URL or VITE_USE_MOCK_API=true):
 *   - Keeps the existing localStorage-backed mock auth flow so the app
 *     remains fully usable without a backend or Clerk key.
 *
 * Consumer API (unchanged for all existing UI code):
 *   const { status, user, session, login, register, logout, recover } = useAuth();
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
// Clerk hooks — imported at module level but only called inside ClerkBackedAuthProvider,
// which is only rendered in real mode. This satisfies React's rules of hooks because
// hooks are always called from the same component on every render of that component.
import {
  useAuth as useClerkAuth,
  useUser as useClerkUser,
} from "@clerk/clerk-react";
import type { AuthSession, User, UserRole } from "@/types";
import { authApi } from "@/api";
import { CLERK_PUBLISHABLE_KEY, setApiTokenGetter } from "@/api/client";
import type { PmpIdentityResponse } from "@/api/auth";
import {
  PENDING_ACCOUNT_TYPE_KEY,
  PENDING_DISPLAY_NAME_KEY,
  PENDING_PROVIDER_KIND_KEY,
} from "./pending-registration";

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = "loading" | "anon" | "authed";

interface AuthContextValue {
  status: Status;
  user: User | null;
  session: AuthSession | null;
  /** Mock mode only: sign in with email + password. */
  login: (email: string, password: string) => Promise<void>;
  /** Mock mode only: register with email, password, displayName, and role. */
  register: (input: {
    email: string;
    password: string;
    displayName: string;
    role: "employer" | "provider";
  }) => Promise<void>;
  /** Sign out the current user. */
  logout: () => Promise<void>;
  /** Mock mode only: request a password recovery email. */
  recover: (email: string) => Promise<void>;
  /** Real mode: full PMP identity with roles and permissions. null in mock mode. */
  pmpIdentity: PmpIdentityResponse | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map backend accountType → frontend UserRole for existing UI consumers. */
function toUserRole(accountType: string): UserRole {
  if (accountType === "provider") return "provider";
  if (accountType === "employer") return "employer";
  return "ops";
}

/** Shape the backend PmpIdentityResponse into the existing frontend User type. */
function toFrontendUser(identity: PmpIdentityResponse): User {
  const { user } = identity;
  const role = toUserRole(user.accountType);
  if (role === "provider") {
    return {
      id: user.id,
      email: user.email ?? "",
      role: "provider",
      displayName: user.displayName ?? "",
      avatarUrl: user.avatarUrl ?? undefined,
      createdAt: user.createdAt,
      kind: (user.providerKind as "artisan" | "professional") ?? "artisan",
      headline: "",
      category: "",
      skills: [],
      experience: [],
      certifications: [],
      portfolio: [],
      verification: "unverified",
    };
  }
  return {
    id: user.id,
    email: user.email ?? "",
    role: "employer",
    displayName: user.displayName ?? "",
    avatarUrl: user.avatarUrl ?? undefined,
    createdAt: user.createdAt,
  };
}

// ─── Mock-mode provider (localStorage-backed, no Clerk) ───────────────────────

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

function MockAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
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

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await authApi.login({ email, password });
      persist(res.session, res.user);
    },
    [persist],
  );

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      displayName: string;
      role: "employer" | "provider";
    }) => {
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
    () => ({ status, user, session, login, register, logout, recover, pmpIdentity: null }),
    [status, user, session, login, register, logout, recover],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Real (Clerk-backed) provider ─────────────────────────────────────────────
// Only rendered when USE_MOCK_API is false. Clerk hooks are valid here because
// this component is always mounted under <ClerkProvider> in real mode.

function ClerkBackedAuthProvider({ children }: { children: ReactNode }) {
  const { getToken, isSignedIn, isLoaded, signOut } = useClerkAuth();
  const { user: clerkUser } = useClerkUser();

  const [status, setStatus] = useState<Status>("loading");
  const [pmpIdentity, setPmpIdentity] = useState<PmpIdentityResponse | null>(null);
  const [user, setUser] = useState<User | null>(null);

  // Register the Clerk token getter with the API client.
  // Every apiFetch({ auth: true }) call will automatically include a fresh Bearer token.
  useEffect(() => {
    setApiTokenGetter(() => getToken());
    return () => {
      setApiTokenGetter(null);
    };
  }, [getToken]);

  // Guard against concurrent identity loads (e.g. React Strict Mode double-invoke).
  const loadingRef = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setPmpIdentity(null);
      setUser(null);
      setStatus("anon");
      loadingRef.current = false;
      return;
    }

    if (loadingRef.current) return;
    loadingRef.current = true;

    async function loadIdentity() {
      try {
        // Try to load the existing PMP identity for this Clerk user.
        const identity = await authApi.me();
        setPmpIdentity(identity);
        setUser(toFrontendUser(identity));
        setStatus("authed");
      } catch (err) {
        const errStatus = (err as { status?: number }).status;
        if (errStatus === 401) {
          // No PMP identity yet — new user. Provision one using the pending
          // registration data stored in sessionStorage by the register page.
          const accountType =
            (sessionStorage.getItem(PENDING_ACCOUNT_TYPE_KEY) as "employer" | "provider") ??
            "employer";
          const pendingDisplayName = sessionStorage.getItem(PENDING_DISPLAY_NAME_KEY);
          const displayName = pendingDisplayName ?? clerkUser?.fullName ?? undefined;
          const providerKind =
            (sessionStorage.getItem(PENDING_PROVIDER_KIND_KEY) as
              | "artisan"
              | "professional"
              | null) ?? undefined;

          try {
            const syncInput: { accountType: "employer" | "provider"; displayName?: string; providerKind?: "artisan" | "professional" } = { accountType };
            if (displayName) syncInput.displayName = displayName;
            if (providerKind) syncInput.providerKind = providerKind;

            const identity = await authApi.sync(syncInput);

            // Clean up pending keys after successful sync.
            sessionStorage.removeItem(PENDING_ACCOUNT_TYPE_KEY);
            sessionStorage.removeItem(PENDING_DISPLAY_NAME_KEY);
            sessionStorage.removeItem(PENDING_PROVIDER_KIND_KEY);

            setPmpIdentity(identity);
            setUser(toFrontendUser(identity));
            setStatus("authed");
          } catch {
            // Sync failed — Clerk session is valid but PMP provisioning failed.
            setStatus("anon");
          }
        } else {
          setStatus("anon");
        }
      } finally {
        loadingRef.current = false;
      }
    }

    void loadIdentity();
  }, [isLoaded, isSignedIn, clerkUser]);

  const logout = useCallback(async () => {
    await signOut();
    setPmpIdentity(null);
    setUser(null);
    setStatus("anon");
  }, [signOut]);

  // These are no-ops in real mode — Clerk components handle sign-in/up.
  const login = useCallback(async (_e: string, _p: string) => {
    throw new Error("Use Clerk SignIn component for authentication.");
  }, []);
  const register = useCallback(async () => {
    throw new Error("Use Clerk SignUp component for registration.");
  }, []);
  const recover = useCallback(async (_email: string) => {
    throw new Error("Password recovery is handled by Clerk.");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, session: null, login, register, logout, recover, pmpIdentity }),
    [status, user, pmpIdentity, login, register, logout, recover],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Public provider — selects real vs mock automatically ─────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  // Use ClerkBackedAuthProvider whenever a publishable key is present — this mirrors
  // the ClerkProvider mounting condition in RootComponent exactly.
  // Fall back to mock only when no key is configured (no ClerkProvider in the tree).
  if (!CLERK_PUBLISHABLE_KEY) {
    return <MockAuthProvider>{children}</MockAuthProvider>;
  }
  return <ClerkBackedAuthProvider>{children}</ClerkBackedAuthProvider>;
}

// ─── Consumer hook ────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

