/**
 * PMP auth context — bridges Clerk identity to the PMP backend.
 *
 * STATE MACHINE (real / Clerk mode):
 *
 *   "loading"    — Clerk has not yet initialized. Render nothing auth-sensitive.
 *   "anon"       — Clerk loaded; no active session. User is not signed in.
 *   "syncing"    — Clerk session is active; PMP identity is being fetched or created.
 *                  This is set immediately when isSignedIn flips to true so the UI
 *                  can show a deterministic "setting up your account" state instead
 *                  of racing between stale "anon" and eventual "authed".
 *   "authed"     — Clerk session active AND PMP identity resolved. Full access.
 *   "sync_error" — Clerk session active but PMP identity could not be fetched or
 *                  created (backend unavailable, network error, server error).
 *                  The user is NOT silently treated as anonymous. The UI must show
 *                  a clear error and offer a retry button.
 *   "suspended"  — Clerk session active but the PMP account is suspended (403).
 *                  Do not attempt to provision. Surface to user.
 *
 * Mock mode (no CLERK_PUBLISHABLE_KEY):
 *   Uses the localStorage-backed mock flow. Status is limited to
 *   "loading" | "anon" | "authed" — mock mode has no backend and therefore
 *   no sync_error or suspended states.
 *
 * Consumer API:
 *   const { status, user, session, login, register, logout, recover,
 *           pmpIdentity, syncError, retrySync } = useAuth();
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

export type AuthStatus =
  | "loading"    // Clerk not yet initialized
  | "anon"       // Clerk loaded, no active session
  | "syncing"    // Clerk signed in, PMP identity being established
  | "authed"     // Clerk + PMP both resolved
  | "sync_error" // Clerk signed in but PMP sync failed (show error + retry)
  | "suspended"; // Clerk signed in but PMP account is suspended

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  session: AuthSession | null;
  /** Human-readable error when status === "sync_error". */
  syncError: string | null;
  /** Retry the PMP identity sync after a sync_error. */
  retrySync: () => void;
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
  /** Real mode: full PMP identity. null in mock mode or before sync completes. */
  pmpIdentity: PmpIdentityResponse | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toUserRole(accountType: string): UserRole {
  if (accountType === "provider") return "provider";
  if (accountType === "employer") return "employer";
  return "ops";
}

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
  if (role === "ops") {
    return {
      id: user.id,
      email: user.email ?? "",
      role: "ops",
      displayName: user.displayName ?? "",
      avatarUrl: user.avatarUrl ?? undefined,
      createdAt: user.createdAt,
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

// ─── Mock-mode provider ───────────────────────────────────────────────────────

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
  const [status, setStatus] = useState<AuthStatus>("loading");
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

  const retrySync = useCallback(() => {
    // No-op in mock mode — there is no backend sync.
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      session,
      syncError: null,
      retrySync,
      login,
      register,
      logout,
      recover,
      pmpIdentity: null,
    }),
    [status, user, session, retrySync, login, register, logout, recover],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Real (Clerk-backed) provider ─────────────────────────────────────────────

function ClerkBackedAuthProvider({ children }: { children: ReactNode }) {
  const { getToken, isSignedIn, isLoaded, signOut } = useClerkAuth();
  const { user: clerkUser } = useClerkUser();

  const [status, setStatus] = useState<AuthStatus>("loading");
  const [pmpIdentity, setPmpIdentity] = useState<PmpIdentityResponse | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // retryKey increments trigger a re-run of the identity-load effect.
  const [retryKey, setRetryKey] = useState(0);

  // Guard against concurrent loads (e.g. React Strict Mode double-invoke).
  const loadingRef = useRef(false);

  // Register the Clerk token getter so every apiFetch({ auth: true }) call
  // automatically attaches a fresh Bearer token.
  useEffect(() => {
    setApiTokenGetter(() => getToken());
    return () => {
      setApiTokenGetter(null);
    };
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      // Clerk loaded and no active session — user is genuinely signed out.
      setPmpIdentity(null);
      setUser(null);
      setSyncError(null);
      setStatus("anon");
      loadingRef.current = false;
      return;
    }

    // Clerk session is active. Guard against concurrent executions.
    if (loadingRef.current) return;
    loadingRef.current = true;

    // Immediately signal that PMP identity resolution is in progress.
    // This prevents the UI from flashing "anon" or rendering workspace
    // content before we know whether PMP sync will succeed.
    setStatus("syncing");
    setSyncError(null);

    async function loadIdentity() {
      try {
        // ── Step 1: try to fetch existing PMP identity ──
        console.info("[PMP] Fetching identity via GET /v1/auth/me");
        const identity = await authApi.me();
        console.info("[PMP] Identity loaded:", identity.user.id, identity.user.accountType);

        // ── Step 1b: check for account-type mismatch ──────────────────────
        // Clerk unsafeMetadata (set by <SignUp unsafeMetadata={{ accountType }}>)
        // and localStorage (set by storePendingRegistration before Clerk flow)
        // are the user's declared intent at signup time.  If the DB record has
        // a different account type — e.g. old-bug accounts created as "employer"
        // because localStorage was wiped by Clerk's email-verification redirect —
        // call sync to correct it.  The backend sync endpoint now updates the
        // existing record when it detects a mismatch, instead of returning it
        // unchanged.
        const metaAccountType = clerkUser?.unsafeMetadata?.accountType as
          | "employer"
          | "provider"
          | undefined;
        const localAccountType = localStorage.getItem(PENDING_ACCOUNT_TYPE_KEY) as
          | "employer"
          | "provider"
          | null;
        const intendedAccountType = metaAccountType ?? localAccountType ?? null;

        if (
          intendedAccountType &&
          intendedAccountType !== identity.user.accountType
        ) {
          console.info(
            "[PMP] Account type mismatch — DB has",
            identity.user.accountType,
            "but intended",
            intendedAccountType,
            "— correcting via POST /v1/auth/sync",
          );
          try {
            const corrected = await authApi.sync({ accountType: intendedAccountType });
            // Clean up pending keys now that the correction succeeded.
            localStorage.removeItem(PENDING_ACCOUNT_TYPE_KEY);
            localStorage.removeItem(PENDING_DISPLAY_NAME_KEY);
            localStorage.removeItem(PENDING_PROVIDER_KIND_KEY);
            console.info("[PMP] Account type corrected to:", corrected.user.accountType);
            setPmpIdentity(corrected);
            setUser(toFrontendUser(corrected));
            setSyncError(null);
            setStatus("authed");
            return;
          } catch (correctionErr) {
            // Correction is best-effort. If it fails, fall through and use
            // the identity as returned by /me — do not block the user.
            console.warn("[PMP] Account type correction failed (non-fatal):", correctionErr);
          }
        }

        setPmpIdentity(identity);
        setUser(toFrontendUser(identity));
        setSyncError(null);
        setStatus("authed");
        return;
      } catch (meErr) {
        const meStatus = (meErr as { status?: number }).status;
        console.info("[PMP] GET /v1/auth/me failed with status:", meStatus);

        // ── Suspended account — do not provision ──
        if (meStatus === 403) {
          console.warn("[PMP] Account suspended — contact support.");
          setStatus("suspended");
          return;
        }

        // ── Step 2: attempt to create/recover PMP identity via sync ──
        // sync() is idempotent: returns the existing record if the user
        // already has one, or creates a new one using the pending
        // registration data written to localStorage before the Clerk flow.
        //
        // Resolution order for accountType:
        //   1. clerkUser.unsafeMetadata.accountType (set before Clerk signup)
        //   2. localStorage fallback (for backwards compat)
        //   3. default to "employer"
        //
        // localStorage is used (not sessionStorage) because Clerk's OAuth
        // and email-verification flows do full-page redirects through
        // accounts.clerk.com, which wipes sessionStorage.
        const metaAccountType = clerkUser?.unsafeMetadata?.accountType as
          | "employer"
          | "provider"
          | undefined;
        const localAccountType = localStorage.getItem(PENDING_ACCOUNT_TYPE_KEY) as
          | "employer"
          | "provider"
          | null;
        const accountType = metaAccountType ?? localAccountType ?? "employer";

        const metaProviderKind = clerkUser?.unsafeMetadata?.providerKind as
          | "artisan"
          | "professional"
          | undefined;
        const localProviderKind = localStorage.getItem(PENDING_PROVIDER_KIND_KEY) as
          | "artisan"
          | "professional"
          | null;
        const providerKind = metaProviderKind ?? localProviderKind ?? undefined;

        const pendingDisplayName = localStorage.getItem(PENDING_DISPLAY_NAME_KEY);
        const displayName = pendingDisplayName ?? clerkUser?.fullName ?? undefined;

        console.info("[PMP] Syncing identity via POST /v1/auth/sync with accountType:", accountType);

        try {
          const syncInput: {
            accountType: "employer" | "provider";
            displayName?: string;
            providerKind?: "artisan" | "professional";
          } = { accountType };
          if (displayName) syncInput.displayName = displayName;
          if (providerKind) syncInput.providerKind = providerKind;

          const identity = await authApi.sync(syncInput);
          console.info("[PMP] Identity synced:", identity.user.id, identity.user.accountType);

          // Clean up pending keys after a successful sync.
          localStorage.removeItem(PENDING_ACCOUNT_TYPE_KEY);
          localStorage.removeItem(PENDING_DISPLAY_NAME_KEY);
          localStorage.removeItem(PENDING_PROVIDER_KIND_KEY);

          setPmpIdentity(identity);
          setUser(toFrontendUser(identity));
          setSyncError(null);
          setStatus("authed");
        } catch (syncErr) {
          // ── Sync failed — backend is unreachable or returned an error ──
          // Do NOT silently fall back to "anon". The Clerk session is valid;
          // the failure is a backend/network problem that the user should see.
          const errMsg =
            syncErr instanceof Error
              ? syncErr.message
              : "Unexpected error contacting the server";
          console.error("[PMP] Identity sync failed:", syncErr);
          setSyncError(
            `Could not set up your PMP account. ${errMsg}. ` +
              "Check that the backend is running, then try again.",
          );
          setStatus("sync_error");
        }
      } finally {
        loadingRef.current = false;
      }
    }

    void loadIdentity();
  }, [isLoaded, isSignedIn, clerkUser, retryKey]);

  const retrySync = useCallback(() => {
    loadingRef.current = false; // allow the effect to re-enter
    setRetryKey((k) => k + 1);
  }, []);

  const logout = useCallback(async () => {
    await signOut();
    setPmpIdentity(null);
    setUser(null);
    setSyncError(null);
    setStatus("anon");
    loadingRef.current = false;
  }, [signOut]);

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
    () => ({
      status,
      user,
      session: null,
      syncError,
      retrySync,
      login,
      register,
      logout,
      recover,
      pmpIdentity,
    }),
    [status, user, syncError, retrySync, pmpIdentity, login, register, logout, recover],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Public provider ──────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
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
