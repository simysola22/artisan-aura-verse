import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard } from "@/components/glass/glass";
import { jobsApi } from "@/api";
import { DataStateBoundary } from "@/components/common/data-state";
import { useAuth } from "@/features/auth/auth-context";
import { ArrowLeft, Loader2, CheckCircle } from "lucide-react";

export const Route = createFileRoute("/jobs/$jobId/apply")({
  head: () => ({ meta: [{ title: "Apply — PMP" }] }),
  component: ApplyPage,
});

function ApplyPage() {
  const { jobId } = useParams({ from: "/jobs/$jobId/apply" });
  const { status, user } = useAuth();
  const navigate = useNavigate();

  if (status === "loading" || status === "syncing") {
    return (
      <PublicShell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </PublicShell>
    );
  }

  if (status === "anon") {
    void navigate({ to: "/auth/login", replace: true });
    return null;
  }

  if (user?.role !== "provider") {
    return (
      <PublicShell>
        <GlassCard className="mx-auto max-w-md p-8 text-center mt-16">
          <p className="font-semibold">Providers only</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Only provider accounts can apply to jobs.
          </p>
          <Link to="/jobs/$jobId" params={{ jobId }} className="mt-4 inline-block text-sm text-primary hover:underline">
            Back to job
          </Link>
        </GlassCard>
      </PublicShell>
    );
  }

  return <ApplyForm jobId={jobId} />;
}

function ApplyForm({ jobId }: { jobId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [coverMessage, setCoverMessage] = useState("");
  const [proposedRate, setProposedRate] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => jobsApi.getJob(jobId),
  });

  const hasAppliedQuery = useQuery({
    queryKey: ["job-applied", jobId],
    queryFn: () => jobsApi.hasApplied(jobId),
  });

  const applyMutation = useMutation({
    mutationFn: () =>
      jobsApi.applyToJob(jobId, {
        coverMessage: coverMessage.trim(),
        proposedRate: proposedRate ? Number(proposedRate) : undefined,
        currency,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["job-applied", jobId] });
      void qc.invalidateQueries({ queryKey: ["my-applications"] });
      setSubmitted(true);
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Failed to submit application");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (coverMessage.trim().length < 10) {
      setFormError("Cover message must be at least 10 characters.");
      return;
    }
    applyMutation.mutate();
  }

  if (submitted) {
    return (
      <PublicShell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
          <CheckCircle className="h-14 w-14 text-success" />
          <h1 className="text-2xl font-semibold">Application submitted!</h1>
          <p className="text-sm text-muted-foreground max-w-sm">
            Your application has been sent to the employer. You'll be notified if they respond.
          </p>
          <div className="flex gap-3">
            <Link
              to="/jobs"
              className="rounded-lg border border-input px-4 py-2 text-sm hover:bg-accent"
            >
              Browse more jobs
            </Link>
            <Link
              to="/dashboard"
              className="rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <Link
        to="/jobs/$jobId"
        params={{ jobId }}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to job
      </Link>

      <DataStateBoundary loading={jobQuery.isLoading} error={jobQuery.error}>
        {jobQuery.data && (
          <div className="mx-auto max-w-2xl">
            <h1 className="text-xl font-semibold sm:text-2xl">
              Apply: {jobQuery.data.job.title}
            </h1>
            {jobQuery.data.job.employerDisplayName && (
              <p className="mt-1 text-sm text-muted-foreground">
                {jobQuery.data.job.employerDisplayName}
              </p>
            )}

            {/* Already applied */}
            {hasAppliedQuery.data?.applied && (
              <GlassCard className="mt-6 p-6 text-center">
                <CheckCircle className="mx-auto h-8 w-8 text-success" />
                <p className="mt-2 font-medium">You've already applied to this job</p>
                <Link
                  to="/jobs/$jobId"
                  params={{ jobId }}
                  className="mt-2 inline-block text-sm text-primary hover:underline"
                >
                  Back to job details
                </Link>
              </GlassCard>
            )}

            {/* Closed */}
            {jobQuery.data.job.status === "closed" && (
              <GlassCard className="mt-6 p-6 text-center text-sm text-muted-foreground">
                This job is closed and no longer accepting applications.
              </GlassCard>
            )}

            {/* Application form */}
            {!hasAppliedQuery.data?.applied && jobQuery.data.job.status === "published" && (
              <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                {formError && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                    {formError}
                  </div>
                )}

                <GlassCard className="p-6 space-y-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">
                      Cover message *
                    </label>
                    <textarea
                      value={coverMessage}
                      onChange={(e) => setCoverMessage(e.target.value)}
                      placeholder="Introduce yourself, explain your relevant experience, and why you're a great fit for this role…"
                      rows={6}
                      maxLength={5000}
                      className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    />
                    <p className="text-xs text-muted-foreground text-right">
                      {coverMessage.length}/5,000
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">
                        Proposed rate{" "}
                        <span className="text-muted-foreground">(optional)</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={proposedRate}
                        onChange={(e) => setProposedRate(e.target.value)}
                        placeholder="e.g. 50000"
                        className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Currency</label>
                      <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="NGN">NGN</option>
                        <option value="USD">USD</option>
                        <option value="GBP">GBP</option>
                        <option value="EUR">EUR</option>
                      </select>
                    </div>
                  </div>
                </GlassCard>

                <div className="flex justify-end gap-3">
                  <Link
                    to="/jobs/$jobId"
                    params={{ jobId }}
                    className="rounded-lg border border-input px-4 py-2 text-sm hover:bg-accent"
                  >
                    Cancel
                  </Link>
                  <button
                    type="submit"
                    disabled={applyMutation.isPending}
                    className="rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson disabled:opacity-60 inline-flex items-center gap-2"
                  >
                    {applyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Submit application
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </DataStateBoundary>
    </PublicShell>
  );
}
