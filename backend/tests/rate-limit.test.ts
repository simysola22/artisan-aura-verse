import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { MemoryRateLimitStore } from "../src/middleware/rate-limit.js";

describe("Rate limiting middleware", () => {
  it("allows requests within the limit", async () => {
    const store = new MemoryRateLimitStore();
    const app = createApp({
      rateLimitWindowMs: 60_000,
      rateLimitMax: 5,
      rateLimitStore: store,
    });

    for (let i = 0; i < 5; i++) {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
    }
  });

  it("blocks requests beyond the limit with 429", async () => {
    const store = new MemoryRateLimitStore();
    const app = createApp({
      rateLimitWindowMs: 60_000,
      rateLimitMax: 2,
      rateLimitStore: store,
    });

    await app.request("/health");
    await app.request("/health");
    const blocked = await app.request("/health");

    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("rate_limited");
  });

  it("sets x-ratelimit-limit and x-ratelimit-remaining headers", async () => {
    const store = new MemoryRateLimitStore();
    const app = createApp({
      rateLimitWindowMs: 60_000,
      rateLimitMax: 10,
      rateLimitStore: store,
    });

    const res = await app.request("/health");
    expect(res.headers.get("x-ratelimit-limit")).toBe("10");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("9");
  });

  it("sets retry-after header on 429", async () => {
    const store = new MemoryRateLimitStore();
    const app = createApp({
      rateLimitWindowMs: 60_000,
      rateLimitMax: 1,
      rateLimitStore: store,
    });

    await app.request("/health");
    const blocked = await app.request("/health");

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });
});
