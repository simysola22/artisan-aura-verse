import { USE_MOCK_API, apiFetch } from "./client";
import { mockProviders } from "./mock/adapter";
import type { Provider } from "@/types";

export function list(): Promise<Provider[]> {
  if (USE_MOCK_API) return mockProviders.list();
  return apiFetch<Provider[]>("/providers");
}
export function get(id: string): Promise<Provider> {
  if (USE_MOCK_API) return mockProviders.get(id);
  return apiFetch<Provider>(`/providers/${id}`);
}
