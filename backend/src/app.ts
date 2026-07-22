/**
 * Application factory.
 *
 * createApp() is called once at startup and also in tests (each test gets a
 * fresh app instance). No global state leaks between test cases.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { loggerMiddleware } from "./middleware/logger.js";
import { securityHeaders } from "./middleware/security.js";
import { rateLimit, type RateLimitStore, type RateLimitOptions } from "./middleware/rate-limit.js";
import { health } from "./routes/health.js";
import { createAuthRouter, type AuthIdentityService } from "./routes/auth.js";
import { createProviderRouter } from "./routes/providers.js";
import { createEmployerRouter } from "./routes/employers.js";
import { createReferenceRouter } from "./routes/reference.js";
import { createVerificationRouter } from "./routes/verification.js";
import { createSearchRouter } from "./routes/search.js";
import { createMessagingRouter } from "./routes/messaging.js";
import { createBillingRouter } from "./routes/billing.js";
import { createOpsRouter } from "./routes/ops.js";
import { createJobsRouter } from "./routes/jobs.js";
import { pubsub as defaultPubsub, type PubSub } from "./lib/pubsub.js";
import type { AppError } from "./errors/index.js";
import { logger } from "./lib/logger.js";
import { type ClerkAuthAdapter, createClerkAdapter } from "./lib/clerk.js";
import { type PaymentProvider, getPaystackProvider } from "./lib/payment/index.js";
import { getDb } from "./db/client.js";
import { resolveIdentity, provisionUser, updateCachedProfile } from "./services/identity.js";

export interface AppOptions {
  corsOrigin?: string;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
  rateLimitStore?: RateLimitStore;
  /**
   * Inject a mock Clerk adapter for tests.
   * When omitted, the real adapter is created lazily from CLERK_SECRET_KEY.
   */
  clerkAdapter?: ClerkAuthAdapter;
  /**
   * Inject a mock identity service for tests.
   * When omitted, the real service backed by PostgreSQL is used.
   */
  identityService?: AuthIdentityService;
  /**
   * Inject a mock database for tests.
   * When omitted, the real Drizzle/PostgreSQL client is used.
   */
  db?: import("./db/client.js").Db;
  /**
   * Inject a mock PubSub for tests.
   * When omitted, the in-memory singleton is used.
   */
  pubsub?: PubSub;
  /**
   * Inject a mock payment provider for tests.
   * When omitted, the real Paystack provider is used (lazily from PAYSTACK_SECRET_KEY).
   */
  paymentProvider?: PaymentProvider;
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();

  // ── Clerk adapter — real in production, injected mock in tests ────────────
  const clerkAdapter: ClerkAuthAdapter =
    options.clerkAdapter ?? createClerkAdapter(process.env["CLERK_SECRET_KEY"] ?? "");

  // ── Identity service — real in production, injected mock in tests ─────────
  const identityService: AuthIdentityService = options.identityService ?? {
    resolve: (clerkUserId) => resolveIdentity(getDb(), clerkUserId),
    provision: (params) => provisionUser(getDb(), params),
    updateProfile: (userId, profile) => updateCachedProfile(getDb(), userId, profile),
  };

  // ── Global middleware (order matters) ─────────────────────────────────────

  // 1. Request ID — must come first so all subsequent middleware can read it
  app.use("*", requestIdMiddleware);

  // 2. Security headers
  app.use("*", securityHeaders);

  // 3. CORS
  const origin = options.corsOrigin ?? process.env["CORS_ORIGIN"] ?? "http://localhost:5000";
  app.use(
    "*",
    cors({
      origin,
      allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders: ["X-Request-Id", "X-RateLimit-Limit", "X-RateLimit-Remaining"],
      credentials: true,
      maxAge: 86_400,
    }),
  );

  // 4. Rate limiting
  const rlOpts: RateLimitOptions = {
    windowMs: options.rateLimitWindowMs ?? Number(process.env["RATE_LIMIT_WINDOW_MS"] ?? 60_000),
    max: options.rateLimitMax ?? Number(process.env["RATE_LIMIT_MAX"] ?? 100),
  };
  if (options.rateLimitStore !== undefined) {
    rlOpts.store = options.rateLimitStore;
  }
  app.use("*", rateLimit(rlOpts));

  // 5. Request logging
  app.use("*", loggerMiddleware);

  // ── Routes ────────────────────────────────────────────────────────────────

  app.route("/", health);

  // Auth routes — /v1/auth/me, /v1/auth/sync
  app.route("/", createAuthRouter(clerkAdapter, identityService));

  // Stage 3 — Core domain routes
  const db = options.db ?? getDb();
  app.route("/", createProviderRouter(db, clerkAdapter, identityService.resolve));
  app.route("/", createEmployerRouter(db, clerkAdapter, identityService.resolve));
  app.route("/", createReferenceRouter(db));

  // Stage 4 — Verification system
  app.route("/", createVerificationRouter(db, clerkAdapter, identityService.resolve));

  // Stage 5 — Search & Ranking (public endpoint, no auth required)
  app.route("/", createSearchRouter(db));

  // Stage 7 — Messaging
  const ps = options.pubsub ?? defaultPubsub;
  app.route("/", createMessagingRouter(db, clerkAdapter, identityService.resolve, ps));

  // Stage 8 — Payments / Billing
  const paymentProvider: PaymentProvider = options.paymentProvider ?? getPaystackProvider();
  app.route("/", createBillingRouter(db, clerkAdapter, identityService.resolve, paymentProvider));

  // Stage 9 — Operations (user management, support, moderation, audit)
  app.route("/", createOpsRouter(db, clerkAdapter, identityService.resolve));

  // Stage 10 — Job Marketplace
  app.route("/", createJobsRouter(db, clerkAdapter, identityService.resolve));

  // ── 404 fallback ─────────────────────────────────────────────────────────

  app.notFound((c) =>
    c.json(
      {
        status: 404,
        code: "not_found",
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
      404,
    ),
  );

  // ── Centralized error handler ──────────────────────────────────────────────

  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? "unknown";

    // Known application errors — return their own status + code
    if ("status" in err && "code" in err) {
      const appErr = err as AppError;
      if (appErr.status < 500) {
        logger.info(
          { requestId, err: { code: appErr.code, message: appErr.message } },
          "client error",
        );
      } else {
        logger.error({ requestId, err }, "application error");
      }
      return c.json(appErr.toBody(), appErr.status as ContentfulStatusCode);
    }

    // Unexpected errors — log the full stack, return a safe generic message
    logger.error({ requestId, err }, "unhandled error");
    return c.json(
      {
        status: 500,
        code: "internal_error",
        message: "An unexpected error occurred",
      },
      500,
    );
  });

  return app;
}
