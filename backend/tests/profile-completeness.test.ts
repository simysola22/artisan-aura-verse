/**
 * Profile completeness computation tests.
 *
 * These are pure-function tests — no DB, no network.
 * The completeness functions are the testable core of the scoring system.
 */
import { describe, it, expect } from "vitest";
import { computeProviderCompleteness } from "../src/services/provider-profile.js";
import { computeEmployerCompleteness } from "../src/services/employer-profile.js";

// ─── Provider completeness ─────────────────────────────────────────────────────

describe("computeProviderCompleteness()", () => {
  const empty = {
    headline: null,
    about: null,
    primaryCategoryId: null,
    location: null,
  };

  const emptyCounts = {
    skillCount: 0,
    experienceCount: 0,
    portfolioCount: 0,
    certificationCount: 0,
  };

  it("returns 5 for an empty profile (availability always contributes 5)", () => {
    expect(computeProviderCompleteness(empty, emptyCounts)).toBe(5);
  });

  it("adds 15 for headline", () => {
    const score = computeProviderCompleteness(
      { ...empty, headline: "Senior Plumber" },
      emptyCounts,
    );
    expect(score).toBe(20); // 15 + 5 (availability)
  });

  it("adds 15 for about", () => {
    const score = computeProviderCompleteness({ ...empty, about: "I am a plumber" }, emptyCounts);
    expect(score).toBe(20);
  });

  it("adds 10 for primary category", () => {
    const score = computeProviderCompleteness(
      { ...empty, primaryCategoryId: "cat_skilled_trades" },
      emptyCounts,
    );
    expect(score).toBe(15);
  });

  it("adds 10 for at least one skill", () => {
    const score = computeProviderCompleteness(empty, { ...emptyCounts, skillCount: 1 });
    expect(score).toBe(15);
  });

  it("adds 15 for at least one experience entry", () => {
    const score = computeProviderCompleteness(empty, { ...emptyCounts, experienceCount: 1 });
    expect(score).toBe(20);
  });

  it("adds 10 for location", () => {
    const score = computeProviderCompleteness(
      { ...empty, location: "Lagos, Nigeria" },
      emptyCounts,
    );
    expect(score).toBe(15);
  });

  it("adds 10 for at least one portfolio item", () => {
    const score = computeProviderCompleteness(empty, { ...emptyCounts, portfolioCount: 1 });
    expect(score).toBe(15);
  });

  it("adds 10 for at least one certification", () => {
    const score = computeProviderCompleteness(empty, {
      ...emptyCounts,
      certificationCount: 1,
    });
    expect(score).toBe(15);
  });

  it("returns 100 for a fully completed profile", () => {
    const score = computeProviderCompleteness(
      {
        headline: "Senior Plumber",
        about: "10 years experience",
        primaryCategoryId: "cat_skilled_trades",
        location: "Lagos",
      },
      { skillCount: 3, experienceCount: 2, portfolioCount: 1, certificationCount: 1 },
    );
    expect(score).toBe(100);
  });

  it("never exceeds 100", () => {
    // All fields filled plus extra counts
    const score = computeProviderCompleteness(
      {
        headline: "X",
        about: "Y",
        primaryCategoryId: "cat_x",
        location: "Z",
      },
      { skillCount: 99, experienceCount: 99, portfolioCount: 99, certificationCount: 99 },
    );
    expect(score).toBeLessThanOrEqual(100);
  });

  it("only counts the presence of items, not the number", () => {
    const withOne = computeProviderCompleteness(empty, { ...emptyCounts, skillCount: 1 });
    const withTen = computeProviderCompleteness(empty, { ...emptyCounts, skillCount: 10 });
    expect(withOne).toBe(withTen);
  });
});

// ─── Employer completeness ─────────────────────────────────────────────────────

describe("computeEmployerCompleteness()", () => {
  const empty = {
    displayName: null,
    description: null,
    industry: null,
    location: null,
    websiteUrl: null,
    logoUrl: null,
  };

  it("returns 0 for a completely empty profile", () => {
    expect(computeEmployerCompleteness(empty)).toBe(0);
  });

  it("adds 20 for display name", () => {
    expect(computeEmployerCompleteness({ ...empty, displayName: "Acme Ltd" })).toBe(20);
  });

  it("adds 25 for description", () => {
    expect(computeEmployerCompleteness({ ...empty, description: "We are a tech company" })).toBe(
      25,
    );
  });

  it("adds 15 for industry", () => {
    expect(computeEmployerCompleteness({ ...empty, industry: "Technology" })).toBe(15);
  });

  it("adds 20 for location", () => {
    expect(computeEmployerCompleteness({ ...empty, location: "Abuja" })).toBe(20);
  });

  it("adds 10 for website URL", () => {
    expect(computeEmployerCompleteness({ ...empty, websiteUrl: "https://example.com" })).toBe(10);
  });

  it("adds 10 for logo URL", () => {
    expect(computeEmployerCompleteness({ ...empty, logoUrl: "https://example.com/logo.png" })).toBe(
      10,
    );
  });

  it("returns 100 for a fully completed profile", () => {
    const score = computeEmployerCompleteness({
      displayName: "Acme Ltd",
      description: "We hire the best",
      industry: "Technology",
      location: "Lagos",
      websiteUrl: "https://acme.com",
      logoUrl: "https://acme.com/logo.png",
    });
    expect(score).toBe(100);
  });

  it("never exceeds 100", () => {
    const score = computeEmployerCompleteness({
      displayName: "X",
      description: "Y",
      industry: "Z",
      location: "W",
      websiteUrl: "https://x.com",
      logoUrl: "https://x.com/logo.png",
    });
    expect(score).toBeLessThanOrEqual(100);
  });
});
