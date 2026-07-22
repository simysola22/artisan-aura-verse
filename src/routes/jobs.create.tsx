import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard } from "@/components/glass/glass";
import { jobsApi } from "@/api";
import type { WorkType } from "@/api/jobs";
import { useAuth } from "@/features/auth/auth-context";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/jobs/create")({
  head: () => ({ meta: [{ title: "Post a Job — PMP" }] }),
  component: CreateJobPage,
});

function CreateJobPage() {
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Auth guard
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
          <p className="mt-2 text-sm text-muted-foreground">
            Only employer accounts can post jobs.
          </p>
          <Link to="/jobs" className="mt-4 inline-block text-sm text-primary hover:underline">
            Browse jobs instead
          </Link>
        </GlassCard>
      </PublicShell>
    );
  }

  return <CreateJobForm onSuccess={(jobId) => navigate({ to: "/jobs/$jobId", params: { jobId } })} />;
}

function CreateJobForm({ onSuccess }: { onSuccess: (jobId: string) => void }) {
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [skillInput, setSkillInput] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [workType, setWorkType] = useState<WorkType>("onsite");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [deadline, setDeadline] = useState("");
  const [publish, setPublish] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      jobsApi.createJob({
        title: title.trim(),
        description: description.trim(),
        category: category.trim() || undefined,
        skills,
        location: location.trim() || undefined,
        workType,
        budgetMin: budgetMin ? Number(budgetMin) : undefined,
        budgetMax: budgetMax ? Number(budgetMax) : undefined,
        currency,
        deadline: deadline || undefined,
      }),
    onSuccess: async (data) => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["my-jobs"] });
      if (publish) {
        try {
          await jobsApi.publishJob(data.job.id);
        } catch {
          // publish failed, job remains draft
        }
      }
      onSuccess(data.job.id);
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Failed to create job");
    },
  });

  function addSkill() {
    const s = skillInput.trim();
    if (s && !skills.includes(s) && skills.length < 30) {
      setSkills((prev) => [...prev, s]);
      setSkillInput("");
    }
  }

  function removeSkill(s: string) {
    setSkills((prev) => prev.filter((x) => x !== s));
  }

  function handleSubmit(e: React.FormEvent, shouldPublish: boolean) {
    e.preventDefault();
    setFormError(null);
    if (!title.trim()) { setFormError("Job title is required."); return; }
    if (description.trim().length < 10) { setFormError("Description must be at least 10 characters."); return; }
    setPublish(shouldPublish);
    createMutation.mutate();
  }

  return (
    <PublicShell>
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Post a Job</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fill in the details below. You can save as a draft and publish when ready.
        </p>

        <form className="mt-6 space-y-5">
          {formError && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              {formError}
            </div>
          )}

          <GlassCard className="p-6 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Job details
            </h2>

            <div className="space-y-1">
              <label className="text-sm font-medium">Title *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Senior Plumber needed in Lagos"
                className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                maxLength={200}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Description *</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the work, requirements, and what you're looking for…"
                rows={5}
                className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                maxLength={10000}
              />
              <p className="text-xs text-muted-foreground text-right">
                {description.length}/10,000
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">Category</label>
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Plumbing, Design, Accounting"
                  className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Work type</label>
                <select
                  value={workType}
                  onChange={(e) => setWorkType(e.target.value as WorkType)}
                  className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="onsite">On-site</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Location</label>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Lagos, Nigeria"
                className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Skills */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Required skills</label>
              <div className="flex gap-2">
                <input
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }}
                  placeholder="Type a skill and press Enter"
                  className="flex-1 rounded-lg border border-input bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={addSkill}
                  className="rounded-lg border border-input px-3 py-2 text-sm hover:bg-accent"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {skills.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary"
                    >
                      {s}
                      <button
                        type="button"
                        onClick={() => removeSkill(s)}
                        className="hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </GlassCard>

          <GlassCard className="p-6 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Budget & timeline
            </h2>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Min budget</label>
                <input
                  type="number"
                  min={0}
                  value={budgetMin}
                  onChange={(e) => setBudgetMin(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Max budget</label>
                <input
                  type="number"
                  min={0}
                  value={budgetMax}
                  onChange={(e) => setBudgetMax(e.target.value)}
                  placeholder="0"
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

            <div className="space-y-1">
              <label className="text-sm font-medium">Application deadline</label>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value ? new Date(e.target.value).toISOString() : "")}
                className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </GlassCard>

          <div className="flex flex-wrap gap-3 justify-end">
            <button
              type="button"
              onClick={(e) => handleSubmit(e, false)}
              disabled={createMutation.isPending}
              className="rounded-lg border border-input px-4 py-2 text-sm hover:bg-accent disabled:opacity-60 inline-flex items-center gap-2"
            >
              {createMutation.isPending && !publish && <Loader2 className="h-4 w-4 animate-spin" />}
              Save as draft
            </button>
            <button
              type="button"
              onClick={(e) => handleSubmit(e, true)}
              disabled={createMutation.isPending}
              className="rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson disabled:opacity-60 inline-flex items-center gap-2"
            >
              {createMutation.isPending && publish && <Loader2 className="h-4 w-4 animate-spin" />}
              Publish job
            </button>
          </div>
        </form>
      </div>
    </PublicShell>
  );
}
