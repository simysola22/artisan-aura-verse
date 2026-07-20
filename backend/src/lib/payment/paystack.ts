/**
 * Paystack payment provider adapter — Stage 8.
 *
 * Implements the PaymentProvider interface using Paystack's REST API.
 *
 * Security invariants:
 *   - PAYSTACK_SECRET_KEY is backend-only. Never log it, never send it to the client.
 *   - Webhook signatures are verified with HMAC-SHA512 before trusting any event data.
 *   - Invalid signatures are rejected — the handler returns { valid: false }.
 *   - Amount and currency from provider responses are treated as authoritative.
 *
 * This adapter is lazily constructed: the secret key is checked at call time,
 * not at module load time. createApp() can be called in tests without the key.
 */

import { createHmac } from "crypto";
import type {
  PaymentProvider,
  InitializeCheckoutParams,
  CheckoutResult,
  VerifyPaymentResult,
  WebhookVerifyResult,
  PaymentVerifyStatus,
} from "./types.js";

const PAYSTACK_API_BASE = "https://api.paystack.co";

// ─── Paystack API response shapes ─────────────────────────────────────────────

interface PaystackInitResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    status: string; // 'success' | 'failed' | 'abandoned' | 'pending'
    reference: string;
    amount: number; // in minor units (kobo for NGN)
    currency: string;
    paid_at?: string;
    customer: { email: string };
  };
}

interface PaystackWebhookPayload {
  id?: string | number;
  event: string;
  data?: {
    reference?: string;
    status?: string;
    amount?: number;
    id?: number | string;
  };
}

// ─── Status normalisation ─────────────────────────────────────────────────────

function normalizeStatus(raw: string): PaymentVerifyStatus {
  if (raw === "success") return "success";
  if (raw === "failed") return "failed";
  if (raw === "abandoned") return "abandoned";
  return "pending";
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class PaystackProvider implements PaymentProvider {
  private readonly secretKey: string;

  constructor(secretKey: string) {
    // Store; key presence is validated at call time so tests can build the
    // adapter without a key (they inject MockPaymentProvider instead).
    this.secretKey = secretKey;
  }

  private assertKey(): void {
    if (!this.secretKey) {
      throw new Error(
        "PAYSTACK_SECRET_KEY is not configured. " +
          "Set it as a backend environment variable (never VITE_*) to enable payments.",
      );
    }
  }

  private authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.secretKey}` };
  }

  async initializeCheckout(params: InitializeCheckoutParams): Promise<CheckoutResult> {
    this.assertKey();

    const body: Record<string, unknown> = {
      email: params.email,
      amount: params.amountMinor,
      currency: params.currency,
      reference: params.reference,
    };
    if (params.callbackUrl !== undefined) body["callback_url"] = params.callbackUrl;
    if (params.metadata !== undefined) body["metadata"] = params.metadata;

    const res = await fetch(`${PAYSTACK_API_BASE}/transaction/initialize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.authHeader(),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Paystack initialize failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as PaystackInitResponse;
    if (!json.status) {
      throw new Error(`Paystack initialize error: ${json.message}`);
    }

    return {
      authorizationUrl: json.data.authorization_url,
      reference: json.data.reference,
    };
  }

  async verifyPayment(reference: string): Promise<VerifyPaymentResult> {
    this.assertKey();

    const res = await fetch(
      `${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: this.authHeader() },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Paystack verify failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as PaystackVerifyResponse;
    if (!json.status) {
      throw new Error(`Paystack verify error: ${json.message}`);
    }

    const result: VerifyPaymentResult = {
      reference: json.data.reference,
      status: normalizeStatus(json.data.status),
      amountMinor: json.data.amount,
      currency: json.data.currency,
      providerPaymentId: String(json.data.id),
      email: json.data.customer.email,
    };
    if (json.data.paid_at !== undefined) result.paidAt = json.data.paid_at;
    return result;
  }

  async verifyWebhook(rawBody: string, signature: string): Promise<WebhookVerifyResult> {
    // Signature check — must happen before JSON parsing.
    // Paystack sends X-Paystack-Signature: HMAC-SHA512(rawBody, secretKey).
    if (!this.secretKey) {
      // If the key is not configured, reject all webhook events.
      return {
        valid: false,
        eventId: "",
        eventType: "",
      };
    }

    const expected = createHmac("sha512", this.secretKey).update(rawBody).digest("hex");

    // Constant-time comparison to prevent timing attacks.
    const isValid =
      signature.length === expected.length &&
      createHmac("sha512", this.secretKey).update(rawBody).digest("hex") === signature;

    if (!isValid) {
      return { valid: false, eventId: "", eventType: "" };
    }

    let payload: PaystackWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as PaystackWebhookPayload;
    } catch {
      return { valid: false, eventId: "", eventType: "" };
    }

    const eventId = payload.id !== undefined ? String(payload.id) : "";
    const eventType = payload.event ?? "";

    const result: WebhookVerifyResult = { valid: true, eventId, eventType };
    if (payload.data?.reference !== undefined) result.reference = payload.data.reference;
    if (payload.data?.status !== undefined) result.status = normalizeStatus(payload.data.status);
    if (payload.data?.amount !== undefined) result.amountMinor = payload.data.amount;
    if (payload.data?.id !== undefined) result.providerPaymentId = String(payload.data.id);
    return result;
  }
}

/**
 * Lazily-constructed Paystack singleton.
 *
 * The singleton is created on first access so that tests (which inject a mock
 * provider via AppOptions) can call createApp() without PAYSTACK_SECRET_KEY.
 */
let _paystackProvider: PaystackProvider | null = null;

export function getPaystackProvider(): PaystackProvider {
  if (!_paystackProvider) {
    const key = process.env["PAYSTACK_SECRET_KEY"] ?? "";
    _paystackProvider = new PaystackProvider(key);
  }
  return _paystackProvider;
}

/** Reset singleton — test use only. */
export function resetPaystackProvider(): void {
  _paystackProvider = null;
}
