import { USE_MOCK_API, apiFetch } from "./client";
import { mockAuth } from "./mock/adapter";
import type { AuthSession, User } from "@/types";

export interface LoginInput {
  email: string;
  password: string;
}
export interface RegisterInput {
  email: string;
  password: string;
  role: "employer" | "provider";
  displayName: string;
}
export interface AuthResponse {
  session: AuthSession;
  user: User;
}

export function login(input: LoginInput): Promise<AuthResponse> {
  if (USE_MOCK_API) return mockAuth.login(input.email, input.password);
  return apiFetch<AuthResponse>("/auth/login", { method: "POST", body: input, auth: false });
}
export function register(input: RegisterInput): Promise<AuthResponse> {
  if (USE_MOCK_API) return mockAuth.register(input);
  return apiFetch<AuthResponse>("/auth/register", { method: "POST", body: input, auth: false });
}
export function logout(): Promise<void> {
  if (USE_MOCK_API) return mockAuth.logout();
  return apiFetch<void>("/auth/logout", { method: "POST" });
}
export function recover(email: string): Promise<{ ok: true }> {
  if (USE_MOCK_API) return mockAuth.recover(email);
  return apiFetch("/auth/recover", { method: "POST", body: { email }, auth: false });
}
