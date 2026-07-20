/**
 * Cache abstraction.
 *
 * The application always talks to this interface — never to a specific
 * implementation. Swap the driver in createCache() to use Redis, Valkey,
 * or any Redis-compatible store without touching business logic.
 *
 * Current drivers:
 *   "memory" — in-process Map, suitable for local dev and tests only.
 *              Does NOT share state across multiple process instances.
 *   "redis"  — not yet implemented; placeholder to show the seam.
 */

export interface CacheDriver {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory driver (local dev / tests only)
// ---------------------------------------------------------------------------

interface MemoryEntry {
  value: string;
  expiresAt: number | null;
}

class MemoryCacheDriver implements CacheDriver {
  private readonly store = new Map<string, MemoryEntry>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1_000 : null,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCache(redisUrl?: string): CacheDriver {
  if (redisUrl) {
    // TODO (Stage 2): instantiate ioredis / @redis/client pointing at redisUrl.
    // The CacheDriver interface is intentionally identical to the Redis command
    // subset needed here so the swap is a one-liner.
    throw new Error(
      "Redis cache driver is not yet implemented. " +
        "Remove REDIS_URL to use the in-memory driver for local development.",
    );
  }
  return new MemoryCacheDriver();
}
