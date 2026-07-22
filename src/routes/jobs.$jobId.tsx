import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  MapPin,
  Clock,
  ArrowLeft,
  Loader2,
  BadgeCheck,
  Edit,
  Users,
  CheckCircle,
} from "lucide-react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard, GlassPanel } from "@/components/glass/glass";
import { jobsApi } from "@/api";
import type { Job, JobApplication } from "@/api/jobs";
import { DataStateBoundary } from "@/components/common/data-state";
import { useAuth } from "@/features/auth/auth-context";
import { useState } from "react";

export const Route = createFileRoute("/jobs/$jobId")({
  head: () => ({ meta: [{ title: "Job details — PMP" }] }),
  component: JobDetailPage,
});

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  closed: "Closed",
};

const APP_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Pending", tone: "text-muted-foreground" },
  reviewed: { label: "Reviewed", tone: "text-warning" },
  shortlisted: { label: "Shortlisted", tone: "text-primary" },
  rejected: { label: "Rejected", tone: "text-destructive" },
  accepted: { label: "Accepted", tone: "text-success" },
};

function JobDetailPage() {
  const { jobId } = useParams({ from: "/jobs/$jobId" });
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => jobsApi.getJob(jobId),
  });

  const isEmployer = status === "authed" && user?.role === "employer";
  const isProvider = status === "authed" && user?.role === "provider";

  // Check if provider has already applied
  const hasAppliedQuery = useQuery({
    queryKey: ["job-applied", jobId],
    queryFn: () => jobsApi.hasApplied(jobId),
    enabled: isProvider,
  });

  // For employer: load applications
  const applicationsQuery = useQuery({
    queryKey: ["job-applications", jobId],
    queryFn: () => jobsApi.listJobApplications(jobId),
    enabled: isEmployer,
  });

  const publishMutation = useMutation({
    mutationFn: () => jobsApi.publishJob(jobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["job", jobId] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["my-jobs"] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => jobsApi.closeJob(jobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["job", jobId] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["my-jobs"] });
    },
  });

  const updateAppMutation = useMutation({
    mutationFn: ({ appId, status }: { appId: string; status: string }) =>
      jobsApi.updateApplication(appId, status as "pending" | "reviewed" | "shortlisted" | "rejected" | "accepted"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["job-applications", jobId] });
    },
  });

  return (
    <PublicShell>
      <Link
        to="/jobs"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to jobs
      </Link>

      <DataStateBoundary loading={jobQuery.isLoading} error={jobQuery.error} onRetry={() => jobQuery.refetch()}>
        {jobQuery.data && (
          <JobDetail
            job={jobQuery.data.job}
            isEmployer={isEmployer}
            isProvider={isProvider}
            hasApplied={hasAppliedQuery.data?.applied ?? false}
            applications={applicationsQuery.data?.applications}
            onPublish={() => publishMutation.mutate()}
            onClose={() => closeMutation.mutate()}
            isPublishing={publishMutation.isPending}
            isClosing={closeMutation.isPending}
            onUpdateApp={(appId, status) => updateAppMutation.mutate({ appId, status })}
            isUpdatingApp={updateAppMutation.isPending}
            jobId={jobId}
          />
        )}
      </DataStateBoundary>
    </PublicShell>
  );
}

function JobDetail({
  job,
  isEmployer,
  isProvider,
  hasApplied,
  applications,
  onPublish,
  onClose,
  isPublishing,
  isClosing,
  onUpdateApp,
  isUpdatingApp,
  jobId,
}: {
  job: Job;
  isEmployer: boolean;
  isProvider: boolean;
  hasApplied: boolean;
  applications?: JobApplication[];
  onPublish: () => void;
  onClose: () => void;
  isPublishing: boolean;
  isClosing: boolean;
  onUpdateApp: (appId: string, status: string) => void;
  isUpdatingApp: boolean;
  jobId: string;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      {/* Main content */}
      <div className="space-y-6">
        <GlassPanel className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold sm:text-2xl">{job.title}</h1>
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-xs font-medium " +
                    (job.status === "published"
                      ? "bg-success/10 text-success"
                      : job.status === "closed"
                      ? "bg-muted text-muted-foreground"
                      : "bg-warning/10 text-warning")
                  }
                >
                  {STATUS_LABELS[job.status] ?? job.status}
                </span>
              </div>
              {job.employerDisplayName && (
                <p className="mt-1 text-sm text-muted-foreground">{job.employerDisplayName}</p>
              )}
            </div>

            {/* Employer actions */}
            {isEmployer && (
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/jobs/$jobId/edit"
                  params={{ jobId: job.id }}
                  className="rounded-lg border border-input px-3 py-1.5 text-sm hover:bg-accent inline-flex items-center gap-1.5"
                >
                  <Edit className="h-4 w-4" /> Edit
                </Link>
                {job.status === "draft" && (
                  <button
                    onClick={onPublish}
                    disabled={isPublishing}
                    className="rounded-lg gradient-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-crimson disabled:opacity-60 inline-flex items-center gap-1.5"
                  >
                    {isPublishing && <Loader2 className="h-4 w-4 animate-spin" />}
                    Publish
                  </button>
                )}
                {job.status === "published" && (
                  <button
                    onClick={onClose}
                    disabled={isClosing}
                    className="rounded-lg border border-destructive/40 text-destructive px-3 py-1.5 text-sm hover:bg-destructive/10 disabled:opacity-60 inline-flex items-center gap-1.5"
                  >
                    {isClosing && <Loader2 className="h-4 w-4 animate-spin" />}
                    Close job
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Meta */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {job.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4" /> {job.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Briefcase className="h-4 w-4" />
              {job.workType === "remote" ? "Remote" : job.workType === "onsite" ? "On-site" : "Hybrid"}
            </span>
            {job.deadline && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                Deadline: {new Date(job.deadline).toLocaleDateString()}
              </span>
            )}
          </div>
        </GlassPanel>

        {/* Description */}
        <GlassCard className="p-6">
          <h2 className="text-base font-semibold">Description</h2>
          <div className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">
            {job.description}
          </div>
        </GlassCard>

        {/* Skills */}
        {job.skills.length > 0 && (
          <GlassCard className="p-6">
            <h2 className="text-base font-semibold">Required skills</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {job.skills.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary"
                >
                  {s}
                </span>
              ))}
            </div>
          </GlassCard>
        )}

        {/* Applications (employer-only) */}
        {isEmployer && applications !== undefined && (
          <GlassCard className="p-6">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-base font-semibold">
                Applications ({applications.length})
              </h2>
            </div>
            {applications.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No applications yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {applications.map((app) => (
                  <ApplicationRow
                    key={app.id}
                    app={app}
                    onUpdate={(status) => onUpdateApp(app.id, status)}
                    isUpdating={isUpdatingApp}
                  />
                ))}
              </ul>
            )}
          </GlassCard>
        )}
      </div>

      {/* Sidebar */}
      <div className="space-y-4">
        {/* Budget */}
        {(job.budgetMin || job.budgetMax) && (
          <GlassCard className="p-5">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Budget
            </h3>
            <p className="mt-2 text-lg font-semibold">
              {job.currency}{" "}
              {job.budgetMin && job.budgetMax
                ? `${job.budgetMin.toLocaleString()} – ${job.budgetMax.toLocaleString()}`
                : (job.budgetMin ?? job.budgetMax)?.toLocaleString()}
            </p>
          </GlassCard>
        )}

        {/* Apply / Already applied */}
        {isProvider && job.status === "published" && (
          <GlassCard className="p-5">
            {hasApplied ? (
              <div className="text-center">
                <CheckCircle className="mx-auto h-8 w-8 text-success" />
                <p className="mt-2 text-sm font-medium">You've applied to this job</p>
                <Link
                  to="/jobs/applications"
                  className="mt-2 inline-block text-sm text-primary hover:underline"
                >
                  View my applications
                </Link>
              </div>
            ) : (
              <Link
                to="/jobs/$jobId/apply"
                params={{ jobId }}
                className="block w-full rounded-lg gradient-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground shadow-crimson"
              >
                Apply now
              </Link>
            )}
          </GlassCard>
        )}

        {job.status === "closed" && (
          <GlassCard className="p-5 text-center text-sm text-muted-foreground">
            This job is closed and no longer accepting applications.
          </GlassCard>
        )}

        {/* Posted date */}
        <GlassCard className="p-5">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Posted
          </h3>
          <p className="mt-1 text-sm">
            {job.publishedAt
              ? new Date(job.publishedAt).toLocaleDateString()
              : new Date(job.createdAt).toLocaleDateString()}
          </p>
        </GlassCard>
      </div>
    </div>
  );
}

function ApplicationRow({
  app,
  onUpdate,
  isUpdating,
}: {
  app: JobApplication;
  onUpdate: (status: string) => void;
  isUpdating: boolean;
}) {
  const statusMeta = APP_STATUS_LABELS[app.status] ?? { label: app.status, tone: "text-muted-foreground" };

  return (
    <li className="rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {app.providerDisplayName ?? "Anonymous provider"}
          </p>
          <span className={`text-xs ${statusMeta.tone}`}>{statusMeta.label}</span>
        </div>
        <select
          value={app.status}
          onChange={(e) => onUpdate(e.target.value)}
          disabled={isUpdating}
          className="rounded border border-input bg-background/50 px-2 py-1 text-xs focus:outline-none"
        >
          <option value="pending">Pending</option>
          <option value="reviewed">Reviewed</option>
          <option value="shortlisted">Shortlisted</option>
          <option value="rejected">Rejected</option>
          <option value="accepted">Accepted</option>
        </select>
      </div>
      {app.proposedRate && (
        <p className="mt-1 text-xs text-muted-foreground">
          Proposed rate: {app.currency} {app.proposedRate.toLocaleString()}
        </p>
      )}
      <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{app.coverMessage}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {new Date(app.createdAt).toLocaleDateString()}
      </p>
    </li>
  );
}
