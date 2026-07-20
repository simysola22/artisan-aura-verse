import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

describe("Security headers", () => {
  const app = createApp();

  it("sets x-content-type-options", async () => {
    const res = await app.request("/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("sets x-frame-options to DENY", async () => {
    const res = await app.request("/health");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("sets referrer-policy", async () => {
    const res = await app.request("/health");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("sets permissions-policy", async () => {
    const res = await app.request("/health");
    expect(res.headers.get("permissions-policy")).toBeTruthy();
  });
});
