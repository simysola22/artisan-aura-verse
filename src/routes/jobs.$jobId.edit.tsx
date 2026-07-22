import { createFileRoute, useNavigate, useParams, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Loader2, ArrowLeft, Save } from "lucide-react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard } from "@/components/glass/glass";
import { jobsApi } from "@/api";
import type { UpdateJobInput, WorkType } from "@/api/jobs";
import { useAuth } from "@/features/auth/auth-context";

export const Route = createFileRoute("/jobs/$jobId/edit")({
  head: () => ({ meta: [{ title: "Edit Job — PMP" }] }),
  component: EditJobPage,
});

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-50";
const selectCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

function EditJobPage() {
  const { jobId } = useParams({ from: "/jobs/$jobId/edit" });
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => jobsApi.getJob(jobId),
    enabled: status === "authed",
  });

  const [form, setForm] = useState<UpdateJobInput>({});
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (jobQuery.data?.job && !seeded) {
      const j = jobQuery.data.job;
      setForm({
        title: j.title ?? "",
        description: j.description ?? "",
        location: j.location ?? "",
        workType: j.workType ?? "remote",
        budgetMin: j.budgetMin ?? undefined,
        budgetMax: j.budgetMax ?? undefined,
        currency: j.currency ?? "NGN",
        skills: j.skills ?? [],
        deadline: j.deadline ?? "",
      });
      setSeeded(true);
    }
  }, [jobQuery.data, seeded]);

  const updateMut = useMutation({
    mutationFn: (input: UpdateJobInput) => jobsApi.updateJob(jobId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      void navigate({ to: "/jobs/$jobId", params: { jobId } });
    },
  });

  // Guards
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
  if (user?.role !== "employer") {
    return (
      <PublicShell>
        <GlassCard className="mx-auto max-w-md p-8 text-center mt-16">
          <p className="font-semibold">Employers only</p>
          <Link to="/jobs" className="mt-4 inline-block text-sm text-primary hover:underline">
            Browse jobs
          </Link>
        </GlassCard>
      </PublicShell>
    );
  }

  function patch<K extends keyof UpdateJobInput>(key: K, val: UpdateJobInput[K]) {
    setForm((f) => ({ ...f, [key]: val }));
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

      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Edit job</h1>

      {jobQuery.isLoading ? (
        <div className="mt-8 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <GlassCard className="mt-6 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Job title</label>
              <input
                className={inputCls}
                value={(form.title as string) ?? ""}
                onChange={(e) => patch("title", e.target.value)}
                placeholder="e.g. Senior Plumber"
              />
            </div>
            <div className="sm:col-span-2 flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <textarea
                rows={6}
                className={inputCls}
                value={(form.description as string) ?? ""}
                onChange={(e) => patch("description", e.target.value)}
                placeholder="Describe the job…"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Location</label>
              <input
                className={inputCls}
                value={(form.location as string) ?? ""}
                onChange={(e) => patch("location", e.target.value)}
                placeholder="City or remote"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Work type</label>
              <select
                className={selectCls}
                value={(form.workType as string) ?? "remote"}
                onChange={(e) => patch("workType", e.target.value as WorkType)}
              >
                <option value="remote">Remote</option>
                <option value="onsite">On-site</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Min budget</label>
              <input
                type="number"
                min={0}
                className={inputCls}
                value={form.budgetMin ?? ""}
                onChange={(e) => patch("budgetMin", e.target.value ? Number(e.target.value) : undefined)}
                placeholder="0"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Max budget</label>
              <input
                type="number"
                min={0}
                className={inputCls}
                value={form.budgetMax ?? ""}
                onChange={(e) => patch("budgetMax", e.target.value ? Number(e.target.value) : undefined)}
                placeholder="0"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Currency</label>
              <input
                className={inputCls}
                value={(form.currency as string) ?? "NGN"}
                onChange={(e) => patch("currency", e.target.value)}
                placeholder="NGN"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Deadline (optional)</label>
              <input
                type="date"
                className={inputCls}
                value={(form.deadline as string) ?? ""}
                onChange={(e) => patch("deadline", e.target.value || undefined)}
              />
            </div>
          </div>
          <button
            onClick={() => updateMut.mutate(form)}
            disabled={updateMut.isPending || !form.title}
            className="mt-6 inline-flex items-center gap-2 rounded-lg gradient-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-crimson disabled:opacity-60"
          >
            {updateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </button>
          {updateMut.isError && (
            <p className="mt-2 text-xs text-destructive">Failed to save. Please try again.</p>
          )}
        </GlassCard>
      )}
    </PublicShell>
  );
}
