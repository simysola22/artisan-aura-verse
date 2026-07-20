import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BadgeCheck, Clock, MessageSquare, Search, ShieldCheck } from "lucide-react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard, GlassPanel } from "@/components/glass/glass";
import { providersApi, messagingApi } from "@/api";
import { DataStateBoundary } from "@/components/common/data-state";
import { useAuth } from "@/features/auth/auth-context";
import { ProviderCard } from "@/features/providers/provider-card";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Kraftly" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = useAuth();
  const providersQuery = useQuery({ queryKey: ["providers"], queryFn: providersApi.list });
  const conversationsQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: messagingApi.listConversations,
  });

  return (
    <PublicShell>
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            {user ? `Welcome back, ${user.displayName.split(" ")[0]}` : "Welcome"}
          </p>
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">Your workspace</h1>
        </div>
        <Link
          to="/search"
          className="inline-flex shrink-0 items-center gap-2 rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson hover:opacity-95"
        >
          <Search className="h-4 w-4" /> Find a provider
        </Link>
      </header>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {[
          { icon: MessageSquare, label: "Active conversations", value: conversationsQuery.data?.length ?? "—" },
          { icon: ShieldCheck, label: "Verified providers", value: providersQuery.data?.filter((p) => p.verification === "verified").length ?? "—" },
          { icon: Clock, label: "Average response", value: "2h 14m" },
        ].map((s) => (
          <GlassCard key={s.label} className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{s.label}</span>
              <s.icon className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-3 text-2xl font-semibold">{s.value}</div>
          </GlassCard>
        ))}
      </section>

      <section className="mt-10">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Featured providers</h2>
          <Link to="/search" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            Explore all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <DataStateBoundary
          loading={providersQuery.isLoading}
          error={providersQuery.error}
          empty={providersQuery.data?.length === 0}
          onRetry={() => providersQuery.refetch()}
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {providersQuery.data?.slice(0, 6).map((p) => (
              <ProviderCard key={p.id} provider={p} />
            ))}
          </div>
        </DataStateBoundary>
      </section>

      <section className="mt-10">
        <GlassPanel className="p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <BadgeCheck className="h-4 w-4" /> Verification & trust
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Every verified provider has been reviewed by our team against submitted evidence. In a
            future release, automated checks may complement human review — the badge means the
            same thing either way.
          </p>
        </GlassPanel>
      </section>
    </PublicShell>
  );
}
