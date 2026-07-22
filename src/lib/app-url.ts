/**
 * Returns the absolute origin of this application.
 *
 * Priority:
 *   1. VITE_APP_URL — set explicitly for production deployments.
 *   2. window.location.origin — correct for any dev/preview environment
 *      (localhost, Replit dev domain, Vercel preview, etc.) and for
 *      production builds that don't set VITE_APP_URL.
 *   3. "" — SSR fallback; Clerk components run client-side only so this
 *      path is never reached in practice.
 *
 * Usage:
 *   forceRedirectUrl={appUrl("/dashboard")}
 */
export function appUrl(path = ""): string {
  const base =
    (import.meta.env.VITE_APP_URL as string | undefined)?.replace(/\/$/, "") ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
