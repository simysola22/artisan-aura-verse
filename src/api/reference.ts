import { USE_MOCK_API, apiFetch } from "./client";
import { mockRef } from "./mock/adapter";
import type { Category, Skill } from "@/types";

export function categories(): Promise<Category[]> {
  if (USE_MOCK_API) return mockRef.categories();
  return apiFetch<Category[]>("/reference/categories");
}
export function skills(): Promise<Skill[]> {
  if (USE_MOCK_API) return mockRef.skills();
  return apiFetch<Skill[]>("/reference/skills");
}
