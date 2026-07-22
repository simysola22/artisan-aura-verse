import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, MapPin, Clock, Search, Loader2, Plus } from "lucide-react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard, GlassPanel } from "@/components/glass/glass";
import { jobsApi } from "@/api";
import type { Job, WorkType } from "@/api/jobs";
import { DataStateBoundary } from "@/components/common/data-state";
import { useAuth } from "@/features/auth/auth-context";
import { useState } from "react";

export const Route = createFileRoute("/jobs")({
  head: () => ({ meta: [{ title: "Browse Jobs — PMP" }] }),
  component: JobsPage,
});

const WORK_TYPE_LABELS: Record<WorkType, string> = {
  remote: "Remote",
  onsite: "On-site",
  hybrid: "Hybrid",
};

function JobsPage() {
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [workType, setWorkType] = useState<WorkType | "">("");

  const q = useQuery({
    queryKey: ["jobs", workType],
    queryFn: () => jobsApi.listJobs({ workType: workType || undefined, limit: 50 }),
  });

  const isEmployer = status === "authed" && user?.role === "employer";
  const isProvider = status === "authed" && user?.role === "provider";

  // Client-side search filter
  const filtered =
    q.data?.jobs.filter((j) => {
      if (!search.trim()) return true;
      const q2 = search.toLowerCase();
      return (
        j.title.toLowerCase().includes(q2) ||
        (j.description ?? "").toLowerCase().includes(q2) ||
        (j.category ?? "").toLowerCase().includes(q2) ||
        j.skills.some((s) => s.toLowerCase().includes(q2))
      );
    }) ?? [];

  return (
    <PublicShell>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Browse Jobs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {q.data?.total
              ? `${q.data.total} published opportunities`
              : "Discover opportunities from employers"}
          </p>
        </div>
        {isEmployer && (
          <Link
            to="/jobs/create"
            className="inline-flex items-center gap-2 rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson"
          >
            <Plus className="h-4 w-4" /> Post a Job
          </Link>
        )}
      </div>

      {/* Filters */}
      <GlassPanel className="mt-6 flex flex-wrap items-center gap-3 p-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search jobs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-input bg-background/50 py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <select
          value={workType}
          onChange={(e) => setWorkType(e.target.value as WorkType | "")}
          className="rounded-lg border border-input bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All work types</option>
          {(["remote", "onsite", "hybrid"] as WorkType[]).map((t) => (
            <option key={t} value={t}>
              {WORK_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </GlassPanel>

      {/* Job list */}
      <div className="mt-6">
        <DataStateBoundary loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
          {filtered.length === 0 ? (
            <GlassCard className="p-10 text-center">
              <Briefcase className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium">
                {search ? "No jobs match your search." : "No jobs posted yet."}
              </p>
              {isEmployer && !search && (
                <Link
                  to="/jobs/create"
                  className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" /> Post the first job
                </Link>
              )}
            </GlassCard>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((job) => (
                <JobCard key={job.id} job={job} isProvider={isProvider} />
              ))}
            </div>
          )}
        </DataStateBoundary>
      </div>
    </PublicShell>
  );
}

function JobCard({ job, isProvider }: { job: Job; isProvider: boolean }) {
  return (
    <GlassCard className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-tight line-clamp-2">{job.title}</h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
          {WORK_TYPE_LABELS[job.workType]}
        </span>
      </div>

      {job.employerDisplayName && (
        <p className="text-xs text-muted-foreground">{job.employerDisplayName}</p>
      )}

      <p className="text-sm text-muted-foreground line-clamp-2">{job.description}</p>

      {job.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {job.skills.slice(0, 4).map((s) => (
            <span
              key={s}
              className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
            >
              {s}
            </span>
          ))}
          {job.skills.length > 4 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              +{job.skills.length - 4}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {job.location && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" /> {job.location}
          </span>
        )}
        {(job.budgetMin || job.budgetMax) && (
          <span>
            {job.currency}{" "}
            {job.budgetMin && job.budgetMax
              ? `${job.budgetMin.toLocaleString()}–${job.budgetMax.toLocaleString()}`
              : (job.budgetMin ?? job.budgetMax)?.toLocaleString()}
          </span>
        )}
        {job.deadline && (
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(job.deadline).toLocaleDateString()}
          </span>
        )}
      </div>

      <Link
        to="/jobs/$jobId"
        params={{ jobId: job.id }}
        className="mt-auto rounded-lg border border-primary/40 px-3 py-1.5 text-center text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
      >
        {isProvider ? "View & Apply" : "View details"}
      </Link>
    </GlassCard>
  );
}
