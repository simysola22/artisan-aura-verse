import { USE_MOCK_API, apiFetch } from "./client";
import { mockRef } from "./mock/adapter";
import type { Category, Skill } from "@/types";

export function categories(): Promise<Category[]> {
  if (USE_MOCK_API) return mockRef.categories();
  // Backend returns { categories: Category[] } — unwrap before returning.
  return apiFetch<{ categories: Category[] }>("/v1/reference/categories").then(
    (r) => r.categories,
  );
}
export function skills(): Promise<Skill[]> {
  if (USE_MOCK_API) return mockRef.skills();
  // Backend returns { skills: Skill[] } — unwrap before returning.
  return apiFetch<{ skills: Skill[] }>("/v1/reference/skills").then((r) => r.skills);
}
