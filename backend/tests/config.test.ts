import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfig, resetConfig } from "../src/config/index.js";

// Store original env values to restore after each test
const originalEnv: Record<string, string | undefined> = {};
const tracked = ["JWT_SECRET", "NODE_ENV", "PORT", "DATABASE_URL", "REDIS_URL"];

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
  it("returns valid config when required vars are set", () => {
    process.env["JWT_SECRET"] = "a-valid-secret-that-is-long-enough-here";
    const cfg = getConfig();
    expect(cfg.JWT_SECRET).toBe("a-valid-secret-that-is-long-enough-here");
    expect(cfg.NODE_ENV).toBe("test");
  });

  it("throws when JWT_SECRET is missing", () => {
    delete process.env["JWT_SECRET"];
    expect(() => getConfig()).toThrow(/invalid configuration/i);
  });

  it("throws when JWT_SECRET is too short", () => {
    process.env["JWT_SECRET"] = "tooshort";
    expect(() => getConfig()).toThrow();
  });

  it("uses default PORT of 3000", () => {
    process.env["JWT_SECRET"] = "a-valid-secret-that-is-long-enough-here";
    delete process.env["PORT"];
    const cfg = getConfig();
    expect(cfg.PORT).toBe(3000);
  });

  it("coerces PORT to a number", () => {
    process.env["JWT_SECRET"] = "a-valid-secret-that-is-long-enough-here";
    process.env["PORT"] = "4000";
    const cfg = getConfig();
    expect(cfg.PORT).toBe(4000);
  });

  it("caches config across calls", () => {
    process.env["JWT_SECRET"] = "a-valid-secret-that-is-long-enough-here";
    const a = getConfig();
    const b = getConfig();
    expect(a).toBe(b); // same reference
  });

  it("reloads config after resetConfig()", () => {
    process.env["JWT_SECRET"] = "a-valid-secret-that-is-long-enough-here";
    const a = getConfig();
    resetConfig();
    process.env["JWT_SECRET"] = "another-valid-secret-at-least-32-chars!!";
    const b = getConfig();
    expect(a).not.toBe(b);
    expect(b.JWT_SECRET).toBe("another-valid-secret-at-least-32-chars!!");
  });
});
