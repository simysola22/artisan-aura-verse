/**
 * Employer-specific dashboard sections.
 * Uses real API data for jobs and providers.
 */
import { ArrowRight, Briefcase, Plus, Loader2, Users } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { jobsApi, providersApi } from "@/api";
import { GlassCard } from "@/components/glass/glass";
import type { Job } from "@/api/jobs";

function JobStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    published: "bg-success/10 text-success",
    closed: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${map[status] ?? "bg-muted"}`}>
      {status}
    </span>
  );
}

function EmployerJobCard({ job }: { job: Job }) {
  return (
    <GlassCard className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <Link
          to="/jobs/$jobId"
          params={{ jobId: job.id }}
          className="font-medium text-sm hover:text-primary line-clamp-2"
        >
          {job.title}
        </Link>
        <JobStatusBadge status={job.status} />
      </div>
      {job.location && (
        <p className="text-xs text-muted-foreground">{job.location} · {job.workType}</p>
      )}
      {job.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {job.skills.slice(0, 3).map((s) => (
            <span key={s} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
              {s}
            </span>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center gap-2 pt-1">
        <Link
          to="/jobs/$jobId"
          params={{ jobId: job.id }}
          className="rounded-md border border-input px-2.5 py-1 text-xs hover:bg-accent"
        >
          View
        </Link>
        {job.status === "draft" && (
          <Link
            to="/jobs/$jobId"
            params={{ jobId: job.id }}
            className="rounded-md gradient-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm"
          >
            Publish
          </Link>
        )}
      </div>
    </GlassCard>
  );
}

export function EmployerSections() {
  const jobsQuery = useQuery({
    queryKey: ["my-jobs"],
    queryFn: jobsApi.listMyJobs,
  });

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: providersApi.list,
  });

  return (
    <>
      {/* ── My Jobs ── */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold tracking-tight">My Jobs</h2>
            {jobsQuery.data && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {jobsQuery.data.jobs.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/jobs"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              Browse all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              to="/jobs/create"
              className="inline-flex items-center gap-1 rounded-lg gradient-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" /> Post job
            </Link>
          </div>
        </div>

        {jobsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading jobs…
          </div>
        ) : jobsQuery.data?.jobs.length === 0 ? (
          <GlassCard className="p-6 text-center">
            <Briefcase className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">No jobs posted yet.</p>
            <Link
              to="/jobs/create"
              className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Post your first job
            </Link>
          </GlassCard>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {jobsQuery.data?.jobs.slice(0, 6).map((j) => (
              <EmployerJobCard key={j.id} job={j} />
            ))}
          </div>
        )}
      </section>

      {/* ── Find Talent ── */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold tracking-tight">Find Talent</h2>
          </div>
          <Link
            to="/search"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Browse all providers <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {providersQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading providers…
          </div>
        ) : providersQuery.data?.length === 0 ? (
          <GlassCard className="p-6 text-center text-sm text-muted-foreground">
            No providers available yet.
          </GlassCard>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {providersQuery.data?.slice(0, 6).map((p) => (
              <GlassCard key={p.id} className="flex flex-col gap-2 p-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl gradient-primary text-sm font-semibold text-primary-foreground">
                    {(p.displayName ?? "?")
                      .split(" ")
                      .map((n: string) => n[0])
                      .slice(0, 2)
                      .join("")}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.displayName}</p>
                    <p className="text-xs text-muted-foreground capitalize">{p.kind}</p>
                  </div>
                </div>
                {p.headline && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{p.headline}</p>
                )}
                <Link
                  to="/providers/$providerId"
                  params={{ providerId: p.id }}
                  className="mt-auto rounded-md border border-input px-2.5 py-1 text-xs text-center hover:bg-accent"
                >
                  View profile
                </Link>
              </GlassCard>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
