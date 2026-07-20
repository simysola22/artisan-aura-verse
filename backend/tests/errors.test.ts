import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
  InternalError,
} from "../src/errors/index.js";

describe("Error classes", () => {
  it("ValidationError serializes correctly", () => {
    const err = new ValidationError("Bad input", { field: "email" });
    const body = err.toBody();
    expect(body.status).toBe(400);
    expect(body.code).toBe("validation_error");
    expect(body.message).toBe("Bad input");
    expect(body.details).toEqual({ field: "email" });
  });

  it("UnauthorizedError has status 401", () => {
    const err = new UnauthorizedError();
    expect(err.status).toBe(401);
    expect(err.code).toBe("unauthorized");
  });

  it("NotFoundError message includes resource name", () => {
    const err = new NotFoundError("Provider");
    expect(err.message).toContain("Provider");
    expect(err.status).toBe(404);
  });

  it("ConflictError has status 409", () => {
    const err = new ConflictError("Email already registered");
    expect(err.status).toBe(409);
    expect(err.code).toBe("conflict");
  });

  it("TooManyRequestsError has status 429", () => {
    const err = new TooManyRequestsError();
    expect(err.status).toBe(429);
    expect(err.code).toBe("rate_limited");
  });

  it("InternalError has status 500", () => {
    const err = new InternalError();
    expect(err.status).toBe(500);
    expect(err.code).toBe("internal_error");
  });

  it("toBody() omits details when not set", () => {
    const err = new UnauthorizedError();
    const body = err.toBody();
    expect("details" in body).toBe(false);
  });
});

describe("App error handler", () => {
  const app = createApp();

  // Add a test-only route that throws different errors
  app.get("/test/validation-error", () => {
    throw new ValidationError("Name is required", { field: "name" });
  });

  app.get("/test/unauthorized", () => {
    throw new UnauthorizedError();
  });

  app.get("/test/app-error", () => {
    throw new AppError(422, "unprocessable", "Cannot process");
  });

  app.get("/test/unexpected-error", () => {
    throw new Error("Unexpected boom");
  });

  it("maps ValidationError to 400 JSON", async () => {
    const res = await app.request("/test/validation-error");
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("validation_error");
    expect(body["details"]).toEqual({ field: "name" });
  });

  it("maps UnauthorizedError to 401 JSON", async () => {
    const res = await app.request("/test/unauthorized");
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("unauthorized");
  });

  it("maps generic AppError to its own status", async () => {
    const res = await app.request("/test/app-error");
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("unprocessable");
  });

  it("maps unexpected Error to 500 with safe message", async () => {
    const res = await app.request("/test/unexpected-error");
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("internal_error");
    // Must NOT leak internal error message
    expect(body["message"]).not.toContain("Unexpected boom");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await app.request("/does-not-exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("not_found");
  });
});
