/**
 * Rate limiting middleware.
 *
 * Uses a pluggable RateLimitStore so the backing implementation can be
 * swapped for Redis (or any distributed counter) without changing business
 * logic. The in-memory store is suitable for local development and tests
 * only — it does NOT coordinate across multiple process instances.
 *
 * NOTE: Do not use the in-memory store in a multi-instance production
 * deployment. Each instance would maintain independent counters, making the
 * configured limits N× too permissive (where N = instance count).
 * Replace with a Redis-backed store before horizontal scaling.
 */
import type { MiddlewareHandler, Context } from "hono";
import { createMiddleware } from "hono/factory";
import { TooManyRequestsError } from "../errors/index.js";

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface RateLimitStore {
  /**
   * Increment the counter for `key` and return the new count.
   * The store is responsible for expiring the counter after `windowMs`.
   */
  increment(key: string, windowMs: number): Promise<number>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory store (dev/test only)
// ---------------------------------------------------------------------------

interface MemoryBucket {
  count: number;
  resetAt: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, MemoryBucket>();

  async increment(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || now > existing.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return 1;
    }

    existing.count += 1;
    return existing.count;
  }

  async close(): Promise<void> {
    this.buckets.clear();
  }
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  /** Duration of the rate-limit window in milliseconds. Default: 60 000. */
  windowMs?: number;
  /** Maximum allowed requests per window per key. Default: 100. */
  max?: number;
  /** Derive the rate-limit key from the request. Default: client IP. */
  keyFn?: (c: Context) => string;
  /** Backing store. Default: in-memory (not suitable for production scale). */
  store?: RateLimitStore;
}

const defaultStore = new MemoryRateLimitStore();

export function rateLimit(options: RateLimitOptions = {}): MiddlewareHandler {
  const {
    windowMs = 60_000,
    max = 100,
    keyFn = (c) =>
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown",
    store = defaultStore,
  } = options;

  return createMiddleware(async (c, next) => {
    const key = `rl:${keyFn(c)}`;
    const count = await store.increment(key, windowMs);

    c.header("x-ratelimit-limit", String(max));
    c.header("x-ratelimit-remaining", String(Math.max(0, max - count)));

    if (count > max) {
      c.header("retry-after", String(Math.ceil(windowMs / 1_000)));
      throw new TooManyRequestsError();
    }

    await next();
  });
}
