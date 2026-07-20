import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

describe("GET /health", () => {
  const app = createApp();

  it("returns 200 with status ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
  });

  it("includes a timestamp in ISO-8601 format", async () => {
    const res = await app.request("/health");
    const body = (await res.json()) as Record<string, unknown>;
    expect(() => new Date(body["timestamp"] as string)).not.toThrow();
    expect(body["timestamp"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("includes the environment", async () => {
    const res = await app.request("/health");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["environment"]).toBe("test");
  });

  it("echoes x-request-id from the request", async () => {
    const res = await app.request("/health", {
      headers: { "x-request-id": "test-req-123" },
    });
    expect(res.headers.get("x-request-id")).toBe("test-req-123");
  });

  it("generates a request ID when none is provided", async () => {
    const res = await app.request("/health");
    const id = res.headers.get("x-request-id");
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
    expect(id!.length).toBeGreaterThan(0);
  });
});

describe("GET /ready", () => {
  const app = createApp();

  it("returns 200 when DATABASE_URL is not set (unconfigured is ok)", async () => {
    // In test environment, DATABASE_URL is not set
    const savedUrl = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];

    const res = await app.request("/ready");
    const body = (await res.json()) as Record<string, unknown>;

    // Should NOT be 503 — unconfigured DB is not an error
    expect(res.status).toBe(200);
    expect(body["status"]).toBe("ready");
    const checks = body["checks"] as Record<string, Record<string, string>>;
    expect(checks["database"]?.["status"]).toBe("unconfigured");

    if (savedUrl !== undefined) process.env["DATABASE_URL"] = savedUrl;
  });

  it("includes a timestamp", async () => {
    const res = await app.request("/ready");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["timestamp"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
