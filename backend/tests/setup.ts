/**
 * Global test setup.
 *
 * Stage 2: JWT_SECRET has been removed (Clerk owns auth tokens).
 * Tests inject a mock ClerkAuthAdapter — no live Clerk calls are made.
 *
 * The only required env var for the config module is NODE_ENV=test.
 * CLERK_SECRET_KEY is optional in the schema; the real adapter is never
 * created in tests (mock is injected via AppOptions).
 */
import { resetConfig } from "../src/config/index.js";

process.env["NODE_ENV"] = "test";

// Reset the config cache before each test so env overrides take effect
beforeEach(() => {
  resetConfig();
});

afterEach(() => {
  resetConfig();
});
