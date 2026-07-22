import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard } from "@/components/glass/glass";
import { jobsApi } from "@/api";
import { DataStateBoundary, EmptyState } from "@/components/common/data-state";
import { useAuth } from "@/features/auth/auth-context";
import { useEffect } from "react";

export const Route = createFileRoute("/jobs/applications")({
  head: () => ({ meta: [{ title: "My Applications — PMP" }] }),
  component: MyApplicationsPage,
});

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-muted text-muted-foreground" },
  reviewed: { label: "Under review", cls: "bg-warning/10 text-warning" },
  shortlisted: { label: "Shortlisted", cls: "bg-primary/10 text-primary" },
  accepted: { label: "Accepted", cls: "bg-success/10 text-success" },
  rejected: { label: "Rejected", cls: "bg-destructive/10 text-destructive" },
  withdrawn: { label: "Withdrawn", cls: "bg-muted text-muted-foreground" },
};

function MyApplicationsPage() {
  const { status, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "anon") {
      void navigate({ to: "/auth/login", replace: true });
    }
  }, [status, navigate]);

  const q = useQuery({
    queryKey: ["my-applications"],
    queryFn: jobsApi.listMyApplications,
    enabled: status === "authed",
  });

  if (status === "loading" || status === "syncing") {
    return (
      <PublicShell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </PublicShell>
    );
  }

  if (status === "anon") return null;

  if (user?.role !== "provider") {
    return (
      <PublicShell>
        <GlassCard className="mx-auto max-w-md p-8 text-center mt-16">
          <p className="font-semibold">Providers only</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Only provider accounts track job applications here.
          </p>
          <Link to="/jobs" className="mt-4 inline-block text-sm text-primary hover:underline">
            Browse jobs
          </Link>
        </GlassCard>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">My applications</h1>
        <Link
          to="/jobs"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Browse jobs
        </Link>
      </div>

      <div className="mt-6">
        <DataStateBoundary
          loading={q.isLoading}
          error={q.error}
          empty={q.data?.applications.length === 0}
          emptyTitle="No applications yet"
          emptyDescription="Browse jobs and apply to get started."
          onRetry={() => q.refetch()}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {q.data?.applications.map((app) => {
              const s = STATUS_CONFIG[app.status] ?? STATUS_CONFIG.pending!;
              return (
                <GlassCard key={app.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-sm font-semibold leading-tight">
                      {app.jobTitle ?? "Job"}
                    </h2>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
                      {s.label}
                    </span>
                  </div>
                  {app.coverMessage && (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {app.coverMessage}
                    </p>
                  )}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {new Date(app.createdAt).toLocaleDateString()}
                    </span>
                    <Link
                      to="/jobs/$jobId"
                      params={{ jobId: app.jobId }}
                      className="text-xs text-primary hover:underline"
                    >
                      View job →
                    </Link>
                  </div>
                </GlassCard>
              );
            })}
          </div>
        </DataStateBoundary>
      </div>
    </PublicShell>
  );
}
