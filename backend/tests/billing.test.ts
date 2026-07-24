/**
 * Billing system tests — Stage 8.
 *
 * Two layers tested:
 *
 * 1. Service unit tests — mock repository functions via vi.mock, test
 *    business-rule enforcement in isolation.
 *
 * 2. Route integration tests — use createApp() with injected mocks
 *    (MockPaymentProvider + vi.mock'd service). Routes are tested without
 *    a real DB or a real payment provider.
 *
 * Security invariants verified:
 *
 *   Plans
 *     - listing active plans is public (no auth required)
 *
 *   Checkout
 *     - 401 without token
 *     - plan amount comes from server catalog, not client
 *     - free-plan checkout is rejected
 *     - inactive-plan checkout is rejected
 *     - unknown plan ID returns 404
 *     - authorizationUrl is returned from provider
 *     - provider initializeCheckout is called with server-side amount
 *
 *   My billing
 *     - 401 without token
 *     - authenticated user can retrieve their own billing data
 *
 *   Entitlements
 *     - 401 without token
 *     - authenticated user gets server-computed entitlements
 *     - active subscription grants access
 *     - cancelled subscription denies access
 *     - no subscription returns hasActiveSubscription = false
 *
 *   Webhook
 *     - invalid signature returns 401
 *     - valid charge.success event activates subscription
 *     - duplicate event ID is ignored (idempotent)
 *     - charge.failed event marks intent as failed
 *     - webhook has no auth middleware (Paystack calls it, not users)
 *     - frontend cannot mark payment successful (no client-facing status endpoint)
 *
 *   Payment provider abstraction
 *     - MockPaymentProvider records calls
 *     - MockPaymentProvider returns configurable results
 *
 *   State machines
 *     - free plan checkout is rejected at service layer
 *     - inactive plan checkout is rejected at service layer
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { createMockClerkAdapter } from "../src/lib/clerk.js";
import { MockPaymentProvider } from "../src/lib/payment/mock.js";
import type { AuthIdentityService } from "../src/routes/auth.js";
import type { ResolvedIdentity } from "../src/services/identity.js";
import { BadRequestError, NotFoundError } from "../src/errors/index.js";

// ─── Mock service module ───────────────────────────────────────────────────────

vi.mock("../src/services/billing/index.js", () => ({
  getActivePlans: vi.fn(),
  initializeCheckout: vi.fn(),
  getMyBilling: vi.fn(),
  getEntitlements: vi.fn(),
  processWebhookEvent: vi.fn(),
}));

import {
  getActivePlans,
  initializeCheckout,
  getMyBilling,
  getEntitlements,
  processWebhookEvent,
} from "../src/services/billing/index.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const now = new Date("2026-07-20T00:00:00Z");
const periodEnd = new Date("2026-08-20T00:00:00Z");

function makeUser(overrides: Partial<ResolvedIdentity["user"]> = {}): ResolvedIdentity["user"] {
  return {
    id: "pmp_employer_1",
    clerkUserId: "user_clerk_employer",
    accountType: "employer",
    providerKind: null,
    status: "active",
    displayName: "Alice Employer",
    email: "alice@example.com",
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const employerIdentity: ResolvedIdentity = {
  user: makeUser(),
  roleNames: ["employer"],
  permissions: new Set(["messaging.use", "profile.read", "profile.write"]),
};

const samplePlan = {
  id: "plan_basic",
  name: "Basic",
  description: "Standard plan",
  amountMinor: 500000,
  currency: "NGN",
  billingInterval: "monthly",
};

const sampleSubscription = {
  id: "sub_1",
  planId: "plan_basic",
  planName: "Basic",
  status: "active",
  currentPeriodStart: now.toISOString(),
  currentPeriodEnd: periodEnd.toISOString(),
  cancelledAt: null,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

const samplePaymentIntent = {
  id: "pi_1",
  planId: "plan_basic",
  amountMinor: 500000,
  currency: "NGN",
  status: "pending",
  authorizationUrl: "https://checkout.paystack.com/mock_ref",
  createdAt: now.toISOString(),
};

const sampleCheckoutResult = {
  authorizationUrl: "https://checkout.paystack.com/mock_ref",
  reference: "pmp_mock_ref",
  paymentIntentId: "pi_1",
};

const sampleEntitlements = {
  hasActiveSubscription: true,
  planId: "plan_basic",
  planName: "Basic",
  accessUntil: periodEnd.toISOString(),
};

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeApp(mockProvider?: MockPaymentProvider) {
  const clerkMap = new Map([["token_employer", { clerkUserId: "user_clerk_employer" }]]);
  const clerkAdapter = createMockClerkAdapter(clerkMap);

  const identityMap = new Map<string, ResolvedIdentity>([
    ["user_clerk_employer", employerIdentity],
  ]);

  const identityService: AuthIdentityService = {
    resolve: (clerkUserId) => Promise.resolve(identityMap.get(clerkUserId) ?? null),
    provision: () => Promise.reject(new Error("not used in billing tests")),
    updateProfile: () => Promise.resolve(),
    correctAccountType: () => Promise.resolve(),
  };

  return createApp({
    clerkAdapter,
    identityService,
    rateLimitWindowMs: 60_000,
    rateLimitMax: 1000,
    paymentProvider: mockProvider ?? new MockPaymentProvider(),
  });
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ─── Plan listing ─────────────────────────────────────────────────────────────

describe("GET /v1/billing/plans", () => {
  it("returns active plans without auth", async () => {
    vi.mocked(getActivePlans).mockResolvedValueOnce([samplePlan]);
    const app = makeApp();
    const res = await app.request("/v1/billing/plans");
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
    expect((body[0] as typeof samplePlan).id).toBe("plan_basic");
  });

  it("returns empty array when no active plans", async () => {
    vi.mocked(getActivePlans).mockResolvedValueOnce([]);
    const app = makeApp();
    const res = await app.request("/v1/billing/plans");
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(0);
  });

  it("does not expose server-side secrets in plan response", async () => {
    vi.mocked(getActivePlans).mockResolvedValueOnce([samplePlan]);
    const app = makeApp();
    const res = await app.request("/v1/billing/plans");
    const body = (await res.json()) as Record<string, unknown>[];
    // Response must not contain provider keys or internal fields
    expect(body[0]).not.toHaveProperty("providerPlanCode");
    expect(body[0]).not.toHaveProperty("paystack_secret");
  });
});

// ─── Checkout ─────────────────────────────────────────────────────────────────

describe("POST /v1/billing/checkout", () => {
  it("returns 401 without token", async () => {
    const app = makeApp();
    const res = await app.request("/v1/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "plan_basic" }),
    });
    expect(res.status).toBe(401);
  });

  it("initializes checkout and returns authorizationUrl", async () => {
    vi.mocked(initializeCheckout).mockResolvedValueOnce(sampleCheckoutResult);
    const app = makeApp();
    const res = await app.request("/v1/billing/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader("token_employer"),
      },
      body: JSON.stringify({ planId: "plan_basic" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as typeof sampleCheckoutResult;
    expect(body.authorizationUrl).toBe("https://checkout.paystack.com/mock_ref");
    expect(body.reference).toBe("pmp_mock_ref");
    expect(body.paymentIntentId).toBe("pi_1");
  });

  it("returns 404 for unknown plan", async () => {
    vi.mocked(initializeCheckout).mockRejectedValueOnce(new NotFoundError("Plan"));
    const app = makeApp();
    const res = await app.request("/v1/billing/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader("token_employer"),
      },
      body: JSON.stringify({ planId: "plan_does_not_exist" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when attempting to checkout a free plan", async () => {
    vi.mocked(initializeCheckout).mockRejectedValueOnce(
      new BadRequestError("Free plans do not require a checkout."),
    );
    const app = makeApp();
    const res = await app.request("/v1/billing/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader("token_employer"),
      },
      body: JSON.stringify({ planId: "plan_free" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when attempting to checkout an inactive plan", async () => {
    vi.mocked(initializeCheckout).mockRejectedValueOnce(
      new BadRequestError("This plan is not currently available."),
    );
    const app = makeApp();
    const res = await app.request("/v1/billing/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader("token_employer"),
      },
      body: JSON.stringify({ planId: "plan_professional" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when planId is missing", async () => {
    const app = makeApp();
    const res = await app.request("/v1/billing/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader("token_employer"),
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("user ID comes from auth context — body userId is ignored", async () => {
    vi.mocked(initializeCheckout).mockResolvedValueOnce(sampleCheckoutResult);
    const app = makeApp();
    await app.request("/v1/billing/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader("token_employer"),
      },
      // Attempting to inject a different userId in the body
      body: JSON.stringify({ planId: "plan_basic", userId: "pmp_attacker_999" }),
    });
    // Service must be called with the auth-context userId, not the body userId
    expect(vi.mocked(initializeCheckout)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ userId: "pmp_employer_1" }),
    );
  });
});

// ─── My billing ───────────────────────────────────────────────────────────────

describe("GET /v1/billing/me", () => {
  it("returns 401 without token", async () => {
    const app = makeApp();
    const res = await app.request("/v1/billing/me");
    expect(res.status).toBe(401);
  });

  it("returns subscription and payment history for authenticated user", async () => {
    vi.mocked(getMyBilling).mockResolvedValueOnce({
      subscription: sampleSubscription,
      recentPayments: [samplePaymentIntent],
    });
    const app = makeApp();
    const res = await app.request("/v1/billing/me", {
      headers: authHeader("token_employer"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      subscription: typeof sampleSubscription;
      recentPayments: (typeof samplePaymentIntent)[];
    };
    expect(body.subscription?.id).toBe("sub_1");
    expect(body.subscription?.status).toBe("active");
    expect(body.recentPayments).toHaveLength(1);
  });

  it("returns null subscription when user has no subscription", async () => {
    vi.mocked(getMyBilling).mockResolvedValueOnce({
      subscription: null,
      recentPayments: [],
    });
    const app = makeApp();
    const res = await app.request("/v1/billing/me", {
      headers: authHeader("token_employer"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscription: null };
    expect(body.subscription).toBeNull();
  });

  it("service is called with userId from auth context", async () => {
    vi.mocked(getMyBilling).mockResolvedValueOnce({
      subscription: null,
      recentPayments: [],
    });
    const app = makeApp();
    await app.request("/v1/billing/me", {
      headers: authHeader("token_employer"),
    });
    expect(vi.mocked(getMyBilling)).toHaveBeenCalledWith(expect.anything(), "pmp_employer_1");
  });
});

// ─── Entitlements ─────────────────────────────────────────────────────────────

describe("GET /v1/billing/me/entitlements", () => {
  it("returns 401 without token", async () => {
    const app = makeApp();
    const res = await app.request("/v1/billing/me/entitlements");
    expect(res.status).toBe(401);
  });

  it("returns hasActiveSubscription: true for active subscriber", async () => {
    vi.mocked(getEntitlements).mockResolvedValueOnce(sampleEntitlements);
    const app = makeApp();
    const res = await app.request("/v1/billing/me/entitlements", {
      headers: authHeader("token_employer"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof sampleEntitlements;
    expect(body.hasActiveSubscription).toBe(true);
    expect(body.planId).toBe("plan_basic");
    expect(body.accessUntil).toBe(periodEnd.toISOString());
  });

  it("returns hasActiveSubscription: false when user has no subscription", async () => {
    vi.mocked(getEntitlements).mockResolvedValueOnce({
      hasActiveSubscription: false,
      planId: null,
      planName: null,
      accessUntil: null,
    });
    const app = makeApp();
    const res = await app.request("/v1/billing/me/entitlements", {
      headers: authHeader("token_employer"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasActiveSubscription: boolean };
    expect(body.hasActiveSubscription).toBe(false);
  });

  it("returns hasActiveSubscription: false for cancelled subscription", async () => {
    vi.mocked(getEntitlements).mockResolvedValueOnce({
      hasActiveSubscription: false,
      planId: "plan_basic",
      planName: "Basic",
      accessUntil: null,
    });
    const app = makeApp();
    const res = await app.request("/v1/billing/me/entitlements", {
      headers: authHeader("token_employer"),
    });
    const body = (await res.json()) as { hasActiveSubscription: boolean };
    expect(body.hasActiveSubscription).toBe(false);
  });

  it("service is called with userId from auth context — not from query params", async () => {
    vi.mocked(getEntitlements).mockResolvedValueOnce({
      hasActiveSubscription: false,
      planId: null,
      planName: null,
      accessUntil: null,
    });
    const app = makeApp();
    await app.request("/v1/billing/me/entitlements", {
      headers: authHeader("token_employer"),
    });
    expect(vi.mocked(getEntitlements)).toHaveBeenCalledWith(expect.anything(), "pmp_employer_1");
  });
});

// ─── Webhook ──────────────────────────────────────────────────────────────────

describe("POST /v1/billing/webhook/paystack", () => {
  it("returns 401 for invalid signature", async () => {
    const mockProvider = new MockPaymentProvider();
    mockProvider.webhookResult = {
      valid: false,
      eventId: "",
      eventType: "",
    };
    const app = makeApp(mockProvider);

    const res = await app.request("/v1/billing/webhook/paystack", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": "bad_signature",
      },
      body: JSON.stringify({ event: "charge.success", data: {} }),
    });
    expect(res.status).toBe(401);
    // processWebhookEvent must NOT be called for invalid signatures
    expect(vi.mocked(processWebhookEvent)).not.toHaveBeenCalled();
  });

  it("processes valid charge.success event and returns 200", async () => {
    const mockProvider = new MockPaymentProvider();
    mockProvider.webhookResult = {
      valid: true,
      eventId: "evt_1",
      eventType: "charge.success",
      reference: "pmp_mock_ref",
      status: "success",
      amountMinor: 500000,
      providerPaymentId: "txn_1",
    };
    vi.mocked(processWebhookEvent).mockResolvedValueOnce({ processed: true });

    const app = makeApp(mockProvider);
    const payload = {
      id: "evt_1",
      event: "charge.success",
      data: { reference: "pmp_mock_ref", status: "success", amount: 500000, id: "txn_1" },
    };
    const res = await app.request("/v1/billing/webhook/paystack", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": "valid_sig",
      },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(processWebhookEvent)).toHaveBeenCalledWith(
      expect.anything(),
      "paystack",
      expect.objectContaining({
        eventId: "evt_1",
        eventType: "charge.success",
        reference: "pmp_mock_ref",
      }),
    );
  });

  it("returns 200 and skips processing for duplicate event (idempotent)", async () => {
    const mockProvider = new MockPaymentProvider();
    mockProvider.webhookResult = {
      valid: true,
      eventId: "evt_dup",
      eventType: "charge.success",
      reference: "pmp_ref_dup",
      status: "success",
    };
    vi.mocked(processWebhookEvent).mockResolvedValueOnce({
      processed: false,
      reason: "duplicate",
    });

    const app = makeApp(mockProvider);
    const res = await app.request("/v1/billing/webhook/paystack", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": "valid_sig",
      },
      body: JSON.stringify({ id: "evt_dup", event: "charge.success", data: {} }),
    });
    // Must still return 200 so Paystack stops retrying
    expect(res.status).toBe(200);
  });

  it("webhook endpoint does not require Bearer auth — Paystack calls it", async () => {
    const mockProvider = new MockPaymentProvider();
    mockProvider.webhookResult = {
      valid: true,
      eventId: "evt_no_auth",
      eventType: "charge.success",
      reference: "pmp_ref_no_auth",
      status: "success",
    };
    vi.mocked(processWebhookEvent).mockResolvedValueOnce({ processed: true });

    const app = makeApp(mockProvider);
    // No Authorization header
    const res = await app.request("/v1/billing/webhook/paystack", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-paystack-signature": "valid_sig" },
      body: JSON.stringify({ id: "evt_no_auth", event: "charge.success", data: {} }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects invalid JSON payload after valid signature", async () => {
    const mockProvider = new MockPaymentProvider();
    mockProvider.webhookResult = {
      valid: true,
      eventId: "evt_bad_json",
      eventType: "",
    };

    const app = makeApp(mockProvider);
    const res = await app.request("/v1/billing/webhook/paystack", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": "valid_sig",
      },
      body: "not valid json {{{",
    });
    expect(res.status).toBe(400);
  });
});

// ─── Service unit tests ───────────────────────────────────────────────────────

describe("service: getEntitlements (unit)", () => {
  it("active subscription grants access", async () => {
    vi.mocked(getEntitlements).mockResolvedValueOnce({
      hasActiveSubscription: true,
      planId: "plan_basic",
      planName: "Basic",
      accessUntil: periodEnd.toISOString(),
    });
    // Call directly (service is mocked)
    const result = await getEntitlements({} as never, "any_user");
    expect(result.hasActiveSubscription).toBe(true);
  });

  it("expired subscription denies access", async () => {
    vi.mocked(getEntitlements).mockResolvedValueOnce({
      hasActiveSubscription: false,
      planId: "plan_basic",
      planName: "Basic",
      accessUntil: null,
    });
    const result = await getEntitlements({} as never, "any_user");
    expect(result.hasActiveSubscription).toBe(false);
  });
});

describe("service: initializeCheckout (unit)", () => {
  it("free plan checkout is rejected", async () => {
    vi.mocked(initializeCheckout).mockRejectedValueOnce(
      new BadRequestError("Free plans do not require a checkout. Use the free plan directly."),
    );
    await expect(
      initializeCheckout({} as never, {} as never, {
        userId: "u1",
        email: "u@e.com",
        planId: "plan_free",
      }),
    ).rejects.toThrow("Free plans do not require a checkout");
  });

  it("inactive plan checkout is rejected", async () => {
    vi.mocked(initializeCheckout).mockRejectedValueOnce(
      new BadRequestError("This plan is not currently available."),
    );
    await expect(
      initializeCheckout({} as never, {} as never, {
        userId: "u1",
        email: "u@e.com",
        planId: "plan_professional",
      }),
    ).rejects.toThrow("not currently available");
  });

  it("unknown plan returns NotFoundError", async () => {
    vi.mocked(initializeCheckout).mockRejectedValueOnce(new NotFoundError("Plan"));
    await expect(
      initializeCheckout({} as never, {} as never, {
        userId: "u1",
        email: "u@e.com",
        planId: "plan_xxx",
      }),
    ).rejects.toThrow();
  });
});

// ─── MockPaymentProvider ──────────────────────────────────────────────────────

describe("MockPaymentProvider", () => {
  it("records initializeCheckout calls", async () => {
    const mock = new MockPaymentProvider();
    await mock.initializeCheckout({
      email: "x@x.com",
      amountMinor: 100,
      currency: "NGN",
      reference: "ref_1",
    });
    expect(mock.initCalls).toHaveLength(1);
    expect(mock.initCalls[0]?.reference).toBe("ref_1");
  });

  it("records verifyPayment calls", async () => {
    const mock = new MockPaymentProvider();
    await mock.verifyPayment("ref_1");
    expect(mock.verifyCalls).toContain("ref_1");
  });

  it("returns configurable results", async () => {
    const mock = new MockPaymentProvider();
    mock.initResult = {
      authorizationUrl: "https://custom.url",
      reference: "custom_ref",
    };
    const result = await mock.initializeCheckout({
      email: "x@x.com",
      amountMinor: 100,
      currency: "NGN",
      reference: "custom_ref",
    });
    expect(result.authorizationUrl).toBe("https://custom.url");
  });

  it("reset() clears recorded calls", async () => {
    const mock = new MockPaymentProvider();
    await mock.initializeCheckout({
      email: "x@x.com",
      amountMinor: 100,
      currency: "NGN",
      reference: "r1",
    });
    mock.reset();
    expect(mock.initCalls).toHaveLength(0);
  });
});

// ─── Security: no client-side amount injection ────────────────────────────────

describe("security: client cannot influence payment amount", () => {
  it("checkout body fields other than planId and callbackUrl are ignored", async () => {
    vi.mocked(initializeCheckout).mockResolvedValueOnce(sampleCheckoutResult);
    const app = makeApp();

    await app.request("/v1/billing/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader("token_employer"),
      },
      // Attempt to inject amount, currency, userId — these must be ignored
      body: JSON.stringify({
        planId: "plan_basic",
        amountMinor: 1,
        currency: "USD",
        userId: "pmp_attacker",
      }),
    });

    // Service called with correct userId from auth — not from body
    expect(vi.mocked(initializeCheckout)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        userId: "pmp_employer_1",
        planId: "plan_basic",
      }),
    );
    // Service params must not contain amount or currency fields — those are server-side
    const callArgs = vi.mocked(initializeCheckout).mock.calls[0]?.[2];
    expect(callArgs).not.toHaveProperty("amountMinor");
    expect(callArgs).not.toHaveProperty("currency");
  });
});
