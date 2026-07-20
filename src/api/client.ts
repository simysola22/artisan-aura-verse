/**
 * Thin API client wrapper.
 *
 * Today all domain modules route through the in-memory mock adapter (see
 * `src/api/mock/`), but this client is where a real backend transport will
 * be wired in. Keep transport concerns here — never in feature components.
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
  return API_BASE_URL ? url.toString().replace("http://placeholder", "") : url.pathname + url.search;
}

function getAuthToken(): string | null {
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
    const token = getAuthToken();
    if (token) finalHeaders.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(buildUrl(path, query), {
    ...rest,
    headers: finalHeaders,
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
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
