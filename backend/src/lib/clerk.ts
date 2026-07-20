/**
 * Clerk authentication abstraction.
 *
 * The rest of the application depends only on the ClerkAuthAdapter interface.
 * The real implementation uses @clerk/backend; tests inject a mock.
 *
 * This boundary means:
 *   - No route or service file imports @clerk/backend directly.
 *   - Tests never call Clerk's live service.
 *   - Swapping Clerk for another identity provider only changes this file.
 */

import { verifyToken as clerkVerifyToken } from "@clerk/backend";

/** Minimal verified identity — everything the backend needs from Clerk. */
export interface ClerkVerifyResult {
  /** The Clerk user ID (the `sub` claim in the session token). */
  clerkUserId: string;
  /** The Clerk session ID (`sid` claim). Useful for audit logging. */
  sessionId?: string;
}

/**
 * Clean interface for Clerk token verification.
 * Implement this interface in tests to avoid live Clerk calls.
 */
export interface ClerkAuthAdapter {
  /**
   * Verify a Clerk session token.
   * Throws if the token is missing, malformed, expired, or rejected by Clerk.
   */
  verifyToken(token: string): Promise<ClerkVerifyResult>;
}

/**
 * Create the real Clerk adapter backed by @clerk/backend.
 *
 * @param secretKey  CLERK_SECRET_KEY — backend-only, never exposed to frontend.
 */
export function createClerkAdapter(secretKey: string): ClerkAuthAdapter {
  // Do not throw at construction time — throw at verifyToken time so that
  // createApp() can be called in tests (which inject a mock adapter) without
  // requiring CLERK_SECRET_KEY to be set in the environment.
  return {
    async verifyToken(token: string): Promise<ClerkVerifyResult> {
      if (!secretKey) {
        throw new Error(
          "CLERK_SECRET_KEY is not configured. Set it in your environment " +
            "or inject a mock ClerkAuthAdapter via AppOptions.clerkAdapter.",
        );
      }
      // verifyToken verifies the JWT signature against Clerk's JWKS and checks
      // expiry, audience, and other standard claims.
      const payload = await clerkVerifyToken(token, { secretKey });
      const result: ClerkVerifyResult = { clerkUserId: payload.sub };
      if (typeof payload.sid === "string") result.sessionId = payload.sid;
      return result;
    },
  };
}

/**
 * Create a deterministic mock adapter for use in tests.
 *
 * Pass a map of token → result (or Error to simulate rejection).
 * Any token not in the map is treated as invalid (throws).
 *
 * @example
 * const mock = createMockClerkAdapter(new Map([
 *   ['valid-token', { clerkUserId: 'user_abc' }],
 *   ['bad-token',   new Error('Invalid token')],
 * ]));
 */
export function createMockClerkAdapter(
  results: Map<string, ClerkVerifyResult | Error>,
): ClerkAuthAdapter {
  return {
    async verifyToken(token: string): Promise<ClerkVerifyResult> {
      const entry = results.get(token);
      if (entry === undefined) {
        throw new Error(`Mock: unknown token "${token}"`);
      }
      if (entry instanceof Error) {
        throw entry;
      }
      return entry;
    },
  };
}
