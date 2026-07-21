/**
 * Thin API client wrapper.
 *
 * Transport concerns live here — never in feature components.
 *
 * Token getting: the auth context calls setApiTokenGetter() once on mount
 * to register an async getter that returns the current Clerk session token.
 * apiFetch() awaits that getter before every authenticated request so the
 * token is always fresh.
 */

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, opts: { status?: number; code?: string; details?: unknown } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status ?? 500;
    this.code = opts.code;
    this.details = opts.details;
  }
}

export const API_BASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) || "";

export const USE_MOCK_API =
  !API_BASE_URL ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_USE_MOCK_API === "true");

/**
 * The Clerk publishable key baked in at build time.
 * Empty string when not provided (treated as falsy — app falls back to mock mode).
 */
export const CLERK_PUBLISHABLE_KEY =
  (typeof import.meta !== "undefined" &&
    (import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY as string | undefined)) ||
  "";

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  auth?: boolean;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const base = API_BASE_URL.replace(/\/$/, "");
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`, "http://placeholder");
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return API_BASE_URL
    ? url.toString().replace("http://placeholder", "")
    : url.pathname + url.search;
}

/**
 * Async token getter registered by the auth context.
 *
 * In real mode: returns the Clerk session token (via useAuth().getToken).
 * In mock mode: returns the localStorage mock token for backward compat.
 * Null means no active session → request is sent without Authorization header.
 */
let _tokenGetter: (() => Promise<string | null>) | null = null;

export function setApiTokenGetter(getter: (() => Promise<string | null>) | null): void {
  _tokenGetter = getter;
}

export async function getAuthToken(): Promise<string | null> {
  if (_tokenGetter) return _tokenGetter();
  // Fallback: legacy localStorage mock token (only active when no getter is registered)
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("mp.session.token");
  } catch {
    return null;
  }
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, query, auth = true, headers, ...rest } = opts;
  const finalHeaders = new Headers(headers);
  finalHeaders.set("Accept", "application/json");
  if (body !== undefined && !(body instanceof FormData)) {
    finalHeaders.set("Content-Type", "application/json");
  }
  if (auth) {
    const token = await getAuthToken();
    if (token) finalHeaders.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(buildUrl(path, query), {
    ...rest,
    headers: finalHeaders,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });

  if (!res.ok) {
    let details: unknown;
    try {
      details = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.statusText || "Request failed", {
      status: res.status,
      details,
    });
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
