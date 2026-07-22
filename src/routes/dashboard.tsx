import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BadgeCheck, Clock, Loader2, MessageSquare, ShieldCheck } from "lucide-react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard, GlassPanel } from "@/components/glass/glass";
import { providersApi, messagingApi } from "@/api";
import { DataStateBoundary } from "@/components/common/data-state";
import { useAuth } from "@/features/auth/auth-context";
import { ProviderCard } from "@/features/providers/provider-card";
import { EmployerSections } from "@/features/dashboard/employer-sections";
import { ProviderSections } from "@/features/dashboard/provider-sections";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — PMP" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { status, user, syncError, retrySync } = useAuth();
  const navigate = useNavigate();
  const providersQuery = useQuery({ queryKey: ["providers"], queryFn: providersApi.list });
  const conversationsQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: messagingApi.listConversations,
  });

  // Unauthenticated — redirect to login. Do not show workspace content.
  useEffect(() => {
    if (status === "anon") {
      void navigate({ to: "/auth/login", replace: true });
    }
  }, [status, navigate]);

  // Clerk resolving or PMP identity being established — wait silently.
  if (status === "loading" || status === "syncing") {
    return (
      <PublicShell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            {status === "syncing" ? "Setting up your account…" : "Loading your workspace…"}
          </p>
        </div>
      </PublicShell>
    );
  }

  // PMP backend sync failed — show error with retry rather than silently falling through.
  if (status === "sync_error") {
    return (
      <PublicShell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
          <p className="text-base font-semibold text-destructive">Could not set up your account</p>
          <p className="max-w-md text-sm text-muted-foreground">{syncError}</p>
          <button
            onClick={retrySync}
            className="rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson transition-opacity hover:opacity-95"
          >
            Try again
          </button>
        </div>
      </PublicShell>
    );
  }

  // Account suspended.
  if (status === "suspended") {
    return (
      <PublicShell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
          <p className="text-base font-semibold">Account suspended</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Your account has been suspended. Please contact support for assistance.
          </p>
        </div>
      </PublicShell>
    );
  }

  // Redirect in-flight — render nothing to avoid a flash.
  if (status === "anon") return null;

  // status === "authed" from here — user is guaranteed non-null.
  const firstName = user?.displayName?.split(" ")[0] ?? "there";

  return (
    <PublicShell>
      {/* ── Header ── */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            {user ? `Welcome back, ${firstName}` : "Welcome"}
          </p>
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
            Your workspace
          </h1>
        </div>
        <Link
          to="/search"
          className="inline-flex shrink-0 items-center gap-2 rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson hover:opacity-95"
        >
          <ShieldCheck className="h-4 w-4" />
          {user?.role === "provider" ? "Find Jobs" : "Find Talent"}
        </Link>
      </header>

      {/* ── Stats ── */}
      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {[
          {
            icon: MessageSquare,
            label: "Active conversations",
            value: conversationsQuery.data?.length ?? "—",
          },
          {
            icon: ShieldCheck,
            label: "Verified providers",
            value:
              providersQuery.data?.filter((p) => p.verification === "verified").length ?? "—",
          },
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

      {/* ── Role-specific marketplace sections ── */}
      {user?.role === "provider" ? (
        <ProviderSections
          providerCategory={
            user.role === "provider" && "category" in user
              ? (user as { category?: string }).category
              : undefined
          }
        />
      ) : (
        // employer, ops, or unauthenticated: show the employer view
        <EmployerSections />
      )}

      {/* ── Featured providers (live data) ── */}
      <section className="mt-10">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Featured Providers</h2>
          <Link
            to="/search"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
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

      {/* ── Trust panel ── */}
      <section className="mt-10">
        <GlassPanel className="p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <BadgeCheck className="h-4 w-4" /> Verification & trust
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Every verified provider has been reviewed by our team against submitted evidence. In a
            future release, automated checks may complement human review — the badge means the same
            thing either way.
          </p>
        </GlassPanel>
      </section>
    </PublicShell>
  );
}
