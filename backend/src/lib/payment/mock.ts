/**
 * Mock payment provider — test use only.
 *
 * Returns deterministic, configurable results without any network calls.
 * Inject via AppOptions.paymentProvider in tests.
 */

import type {
  PaymentProvider,
  InitializeCheckoutParams,
  CheckoutResult,
  VerifyPaymentResult,
  WebhookVerifyResult,
} from "./types.js";

export class MockPaymentProvider implements PaymentProvider {
  /** Calls made to initializeCheckout — inspect in tests. */
  readonly initCalls: InitializeCheckoutParams[] = [];
  /** Calls made to verifyPayment — inspect in tests. */
  readonly verifyCalls: string[] = [];

  /** Override these to control what each method returns. */
  initResult: CheckoutResult = {
    authorizationUrl: "https://checkout.paystack.com/mock_ref",
    reference: "mock_ref",
  };

  verifyResult: VerifyPaymentResult = {
    reference: "mock_ref",
    status: "success",
    amountMinor: 500000,
    currency: "NGN",
    providerPaymentId: "mock_txn_1",
    email: "user@example.com",
    paidAt: new Date().toISOString(),
  };

  webhookResult: WebhookVerifyResult = {
    valid: true,
    eventId: "mock_event_1",
    eventType: "charge.success",
    reference: "mock_ref",
    status: "success",
    amountMinor: 500000,
    providerPaymentId: "mock_txn_1",
  };

  async initializeCheckout(params: InitializeCheckoutParams): Promise<CheckoutResult> {
    this.initCalls.push(params);
    return { ...this.initResult };
  }

  async verifyPayment(reference: string): Promise<VerifyPaymentResult> {
    this.verifyCalls.push(reference);
    return { ...this.verifyResult };
  }

  async verifyWebhook(_rawBody: string, _signature: string): Promise<WebhookVerifyResult> {
    return { ...this.webhookResult };
  }

  /** Reset recorded calls between tests. */
  reset(): void {
    this.initCalls.length = 0;
    this.verifyCalls.length = 0;
  }
}
