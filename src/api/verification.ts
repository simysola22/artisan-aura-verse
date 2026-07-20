import { USE_MOCK_API, apiFetch } from "./client";
import { mockVerification } from "./mock/adapter";
import type { VerificationApplication } from "@/types";

export function status(providerId: string): Promise<VerificationApplication> {
  if (USE_MOCK_API) return mockVerification.status(providerId);
  return apiFetch<VerificationApplication>(`/verification/${providerId}`);
}
export function submit(
  providerId: string,
  payload: Partial<VerificationApplication>,
): Promise<VerificationApplication> {
  if (USE_MOCK_API) return mockVerification.submit(providerId, payload);
  return apiFetch<VerificationApplication>(`/verification/${providerId}`, {
    method: "POST",
    body: payload,
  });
}
