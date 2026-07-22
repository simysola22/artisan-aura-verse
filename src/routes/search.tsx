import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Search as SearchIcon } from "lucide-react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassPanel } from "@/components/glass/glass";
import { searchApi, referenceApi } from "@/api";
import { DataStateBoundary } from "@/components/common/data-state";
import type { SearchFilters } from "@/types";
import { ProviderCard } from "@/features/providers/provider-card";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/search")({
  head: () => ({ meta: [{ title: "Discover providers — PMP" }] }),
  component: SearchPage,
});

const PAGE_SIZE = 12;

function SearchPage() {
  const [filters, setFilters] = useState<SearchFilters>({ sort: "relevance" });
  const [locationInput, setLocationInput] = useState("");
  const [page, setPage] = useState(0);

  const results = useQuery({
    queryKey: ["search", filters, page] as const,
    queryFn: () =>
      searchApi.providers({
        ...filters,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });

  const categories = useQuery({
    queryKey: ["ref", "categories"],
    queryFn: referenceApi.categories,
  });

  function update<K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  }

  function applyLocation() {
    update("location", locationInput.trim() || undefined);
  }

  const totalItems = results.data?.total ?? results.data?.items.length ?? 0;
  const totalPages = Math.ceil(totalItems / PAGE_SIZE);

  return (
    <PublicShell>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Discover providers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ranking is fair and controlled by our platform — results reflect fit, not spend.
        </p>
      </header>

      {/* Main filter bar */}
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

      {/* Secondary filter row */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <FilterChip
          active={filters.verified === true}
          onClick={() => update("verified", filters.verified ? undefined : true)}
        >
          Verified only
        </FilterChip>

        {/* Location filter — text input instead of hardcoded "London" */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            applyLocation();
          }}
          className="flex items-center gap-1"
        >
          <input
            type="text"
            value={locationInput}
            onChange={(e) => setLocationInput(e.target.value)}
            placeholder="City / region…"
            className={cn(
              "h-7 rounded-full border px-3 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition-colors",
              filters.location
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/60 bg-muted/40 text-muted-foreground",
            )}
          />
          {locationInput.trim() && (
            <button
              type="submit"
              className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20"
            >
              Filter
            </button>
          )}
          {filters.location && (
            <button
              type="button"
              onClick={() => {
                setLocationInput("");
                update("location", undefined);
              }}
              className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Clear location
            </button>
          )}
        </form>
      </div>

      {/* Results */}
      <section className="mt-6">
        <DataStateBoundary
          loading={results.isLoading}
          error={results.error}
          empty={results.data?.items.length === 0}
          emptyTitle="No providers matched your filters"
          emptyDescription="Try removing a filter or widening your search terms."
          onRetry={() => results.refetch()}
        >
          <>
            {results.data && totalItems > 0 && (
              <p className="mb-3 text-xs text-muted-foreground">
                {totalItems} result{totalItems !== 1 ? "s" : ""}
                {filters.location ? ` near ${filters.location}` : ""}
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {results.data?.items.map((p) => (
                <ProviderCard key={p.id} provider={p} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input disabled:opacity-40 hover:bg-accent"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input disabled:opacity-40 hover:bg-accent"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </>
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
