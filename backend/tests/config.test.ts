import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfig, resetConfig } from "../src/config/index.js";

// Store original env values to restore after each test
const originalEnv: Record<string, string | undefined> = {};
const tracked = ["NODE_ENV", "PORT", "DATABASE_URL", "REDIS_URL", "CLERK_SECRET_KEY"];

beforeEach(() => {
  tracked.forEach((k) => {
    originalEnv[k] = process.env[k];
  });
  resetConfig();
});

afterEach(() => {
  tracked.forEach((k) => {
    if (originalEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = originalEnv[k];
    }
  });
  resetConfig();
});

describe("getConfig()", () => {
  it("returns valid config with no required vars in test mode", () => {
    // Stage 2: JWT_SECRET is no longer required. Config should parse with only NODE_ENV=test.
    const cfg = getConfig();
    expect(cfg.NODE_ENV).toBe("test");
  });

  it("uses default PORT of 3000", () => {
    delete process.env["PORT"];
    const cfg = getConfig();
    expect(cfg.PORT).toBe(3000);
  });

  it("coerces PORT to a number", () => {
    process.env["PORT"] = "4000";
    const cfg = getConfig();
    expect(cfg.PORT).toBe(4000);
  });

  it("CLERK_SECRET_KEY is optional in schema", () => {
    delete process.env["CLERK_SECRET_KEY"];
    const cfg = getConfig();
    expect(cfg.CLERK_SECRET_KEY).toBeUndefined();
  });

  it("reads CLERK_SECRET_KEY when provided", () => {
    process.env["CLERK_SECRET_KEY"] = "sk_test_placeholder";
    const cfg = getConfig();
    expect(cfg.CLERK_SECRET_KEY).toBe("sk_test_placeholder");
  });

  it("caches config across calls", () => {
    const a = getConfig();
    const b = getConfig();
    expect(a).toBe(b); // same reference
  });

  it("reloads config after resetConfig()", () => {
    const a = getConfig();
    resetConfig();
    process.env["PORT"] = "7777";
    const b = getConfig();
    expect(a).not.toBe(b);
    expect(b.PORT).toBe(7777);
    delete process.env["PORT"];
  });
});
