import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard, GlassPanel } from "@/components/glass/glass";
import { searchApi, referenceApi } from "@/api";
import { DataStateBoundary } from "@/components/common/data-state";
import type { SearchFilters } from "@/types";
import { ProviderCard } from "@/features/providers/provider-card";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/search")({
  head: () => ({ meta: [{ title: "Discover providers — PMP" }] }),
  component: SearchPage,
});

function SearchPage() {
  const [filters, setFilters] = useState<SearchFilters>({ sort: "relevance" });
  const results = useQuery({
    queryKey: ["search", filters],
    queryFn: () => searchApi.providers(filters),
  });
  const categories = useQuery({
    queryKey: ["ref", "categories"],
    queryFn: referenceApi.categories,
  });

  function update<K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  return (
    <PublicShell>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Discover providers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ranking is fair and controlled by our platform — results reflect fit, not spend.
        </p>
      </header>

      <GlassPanel className="mt-6 grid gap-3 p-4 md:grid-cols-[1fr_auto_auto_auto]">
        <label className="relative">
          <span className="sr-only">Search</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search by name, headline, skill…"
            value={filters.q ?? ""}
            onChange={(e) => update("q", e.target.value)}
            className="w-full rounded-lg border border-input bg-background/60 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </label>
        <select
          aria-label="Provider type"
          value={filters.kind ?? ""}
          onChange={(e) => update("kind", (e.target.value || undefined) as SearchFilters["kind"])}
          className="rounded-lg border border-input bg-background/60 px-3 py-2.5 text-sm"
        >
          <option value="">All types</option>
          <option value="artisan">Artisans</option>
          <option value="professional">Professionals</option>
        </select>
        <select
          aria-label="Category"
          value={filters.category ?? ""}
          onChange={(e) => update("category", e.target.value || undefined)}
          className="rounded-lg border border-input bg-background/60 px-3 py-2.5 text-sm"
        >
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort"
          value={filters.sort}
          onChange={(e) => update("sort", e.target.value as SearchFilters["sort"])}
          className="rounded-lg border border-input bg-background/60 px-3 py-2.5 text-sm"
        >
          <option value="relevance">Most relevant</option>
          <option value="rating">Top rated</option>
          <option value="recent">Recently joined</option>
        </select>
      </GlassPanel>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <FilterChip
          active={filters.verified === true}
          onClick={() => update("verified", filters.verified ? undefined : true)}
        >
          Verified only
        </FilterChip>
        <FilterChip
          active={!!filters.location}
          onClick={() => update("location", filters.location ? undefined : "London")}
        >
          Near London
        </FilterChip>
      </div>

      <section className="mt-6">
        <DataStateBoundary
          loading={results.isLoading}
          error={results.error}
          empty={results.data?.items.length === 0}
          emptyTitle="No providers matched your filters"
          emptyDescription="Try removing a filter or widening your search terms."
          onRetry={() => results.refetch()}
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {results.data?.items.map((p) => (
              <ProviderCard key={p.id} provider={p} />
            ))}
          </div>
        </DataStateBoundary>
      </section>
    </PublicShell>
  );
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border/60 bg-muted/40 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// unused import guard
void GlassCard;
