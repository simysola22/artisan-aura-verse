/**
 * Provider-specific dashboard sections.
 * Uses real API data for jobs and applications.
 */
import { ArrowRight, Briefcase, ClipboardList, Loader2, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { jobsApi } from "@/api";
import { GlassCard } from "@/components/glass/glass";
import type { Job, JobApplication } from "@/api/jobs";

const APP_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Pending", tone: "text-muted-foreground" },
  reviewed: { label: "Reviewed", tone: "text-warning" },
  shortlisted: { label: "Shortlisted 🎉", tone: "text-primary" },
  rejected: { label: "Not selected", tone: "text-destructive" },
  accepted: { label: "Accepted ✓", tone: "text-success" },
};

function JobListCard({ job }: { job: Job }) {
  return (
    <GlassCard className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-sm line-clamp-2">{job.title}</h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
          {job.workType}
        </span>
      </div>
      {job.employerDisplayName && (
        <p className="text-xs text-muted-foreground">{job.employerDisplayName}</p>
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
      <Link
        to="/jobs/$jobId"
        params={{ jobId: job.id }}
        className="mt-auto rounded-md gradient-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground text-center shadow-sm"
      >
        View & Apply
      </Link>
    </GlassCard>
  );
}

function ApplicationCard({ app }: { app: JobApplication }) {
  const statusMeta = APP_STATUS_LABELS[app.status] ?? { label: app.status, tone: "text-muted-foreground" };
  return (
    <GlassCard className="flex flex-col gap-1.5 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-sm line-clamp-2">{app.jobTitle}</p>
        <span className={`text-xs shrink-0 ${statusMeta.tone}`}>{statusMeta.label}</span>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2">{app.coverMessage}</p>
      <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
        <span>{new Date(app.createdAt).toLocaleDateString()}</span>
        <Link
          to="/jobs/$jobId"
          params={{ jobId: app.jobId }}
          className="text-primary hover:underline"
        >
          View job
        </Link>
      </div>
    </GlassCard>
  );
}

interface ProviderSectionsProps {
  providerSkills?: string[];
  providerCategory?: string;
}

export function ProviderSections({ providerCategory }: ProviderSectionsProps) {
  const jobsQuery = useQuery({
    queryKey: ["jobs"],
    queryFn: () => jobsApi.listJobs({ limit: 20 }),
  });

  const applicationsQuery = useQuery({
    queryKey: ["my-applications"],
    queryFn: jobsApi.listMyApplications,
  });

  // Filter recommended jobs by provider's category if available
  const allJobs = jobsQuery.data?.jobs ?? [];
  const recommended = providerCategory
    ? allJobs.filter(
        (j) => (j.category ?? "").toLowerCase() === providerCategory.toLowerCase(),
      )
    : [];

  return (
    <>
      {/* ── My Applications ── */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold tracking-tight">My Applications</h2>
            {applicationsQuery.data && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {applicationsQuery.data.applications.length}
              </span>
            )}
          </div>
        </div>

        {applicationsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading applications…
          </div>
        ) : applicationsQuery.data?.applications.length === 0 ? (
          <GlassCard className="p-6 text-center">
            <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">No applications yet.</p>
            <Link
              to="/jobs"
              className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              Browse available jobs <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </GlassCard>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {applicationsQuery.data?.applications.slice(0, 6).map((a) => (
              <ApplicationCard key={a.id} app={a} />
            ))}
          </div>
        )}
      </section>

      {/* ── Available Jobs ── */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold tracking-tight">Available Jobs</h2>
          </div>
          <Link
            to="/jobs"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {jobsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading jobs…
          </div>
        ) : allJobs.length === 0 ? (
          <GlassCard className="p-6 text-center text-sm text-muted-foreground">
            No jobs posted yet. Check back soon!
          </GlassCard>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {allJobs.slice(0, 6).map((j) => (
              <JobListCard key={j.id} job={j} />
            ))}
          </div>
        )}
      </section>

      {/* ── Recommended ── */}
      {recommended.length > 0 && (
        <section className="mt-10">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold tracking-tight">Recommended for You</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {recommended.slice(0, 3).map((j) => (
              <JobListCard key={j.id} job={j} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
