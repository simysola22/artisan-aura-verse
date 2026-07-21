import { USE_MOCK_API, apiFetch } from "./client";
import { mockProviders } from "./mock/adapter";
import type { SearchFilters, SearchResult } from "@/types";

export function providers(filters: SearchFilters): Promise<SearchResult> {
  if (USE_MOCK_API) return mockProviders.search(filters);
  return apiFetch<SearchResult>("/v1/search/providers", {
    query: filters as Record<string, string>,
  });
}
