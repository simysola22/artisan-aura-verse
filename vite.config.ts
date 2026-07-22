// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    server: {
      host: "0.0.0.0",
      port: 5000,
      allowedHosts: true,
      // In dev, proxy all /v1/* requests to the Hono backend (port 3000).
      // This avoids CORS issues and removes the need to set VITE_API_BASE_URL
      // during local development. In production VITE_API_BASE_URL is set to the
      // deployed backend URL and this proxy is unused (it only applies to the
      // Vite dev server, not the production build).
      proxy: {
        "/v1": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
      },
    },
    define: {
      // Expose CLERK_PUBLISHABLE_KEY (Replit secret) as VITE_CLERK_PUBLISHABLE_KEY so Vite
      // bundles it into the client bundle without requiring the VITE_ prefix on the secret name.
      // Falls back to VITE_CLERK_PUBLISHABLE_KEY if that is set directly instead.
      "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(
        process.env.VITE_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY || "",
      ),
      // Expose API_BASE_URL (non-prefixed Replit secret) as VITE_API_BASE_URL.
      // When empty the app uses the Vite dev proxy above; no env var needed for
      // local development. For production set VITE_API_BASE_URL to the backend URL.
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(
        process.env.VITE_API_BASE_URL || process.env.API_BASE_URL || "",
      ),
      // VITE_APP_URL: absolute origin of the deployed app.
      // Leave unset in development — appUrl() falls back to window.location.origin
      // so it automatically works on localhost, Replit preview, and Vercel previews.
      // In production deployments set this to https://artisan-aura-verse.vercel.app
      "import.meta.env.VITE_APP_URL": JSON.stringify(
        process.env.VITE_APP_URL || process.env.APP_URL || "",
      ),
    },
  },
});
