import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard, GlassPanel } from "@/components/glass/glass";
import { verificationApi } from "@/api";
import type { AddEvidenceInput, EvidenceItem, EvidenceType } from "@/api/verification";
import { DataStateBoundary } from "@/components/common/data-state";
import { useAuth } from "@/features/auth/auth-context";
import {
  BadgeCheck,
  Clock,
  Loader2,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { VerificationStatus } from "@/types";

export const Route = createFileRoute("/verification")({
  head: () => ({ meta: [{ title: "Verification — PMP" }] }),
  component: VerificationPage,
});

const statusMeta: Record<
  VerificationStatus,
  { label: string; tone: string; icon: typeof BadgeCheck }
> = {
  unverified: { label: "Not started", tone: "text-muted-foreground", icon: ShieldAlert },
  in_review: { label: "In review", tone: "text-warning", icon: Clock },
  additional_info_requested: { label: "Info requested", tone: "text-warning", icon: ShieldAlert },
  verified: { label: "Verified", tone: "text-success", icon: ShieldCheck },
  rejected: { label: "Rejected", tone: "text-destructive", icon: ShieldAlert },
};

// Map each step index to a default evidence type
const stepEvidenceTypes: EvidenceType[] = [
  "identity_document", // Identity
  "employment_evidence", // Experience
  "certificate",        // Certifications
  "portfolio_evidence", // Portfolio
];

const evidenceTypeLabels: Record<EvidenceType, string> = {
  identity_document: "Identity Document",
  cv_resume: "CV / Resume",
  certificate: "Certificate",
  work_sample: "Work Sample",
  portfolio_evidence: "Portfolio Evidence",
  employment_evidence: "Employment Evidence",
  reference: "Reference",
  other: "Other",
};

const ALL_EVIDENCE_TYPES: EvidenceType[] = [
  "identity_document",
  "cv_resume",
  "certificate",
  "work_sample",
  "portfolio_evidence",
  "employment_evidence",
  "reference",
  "other",
];

function VerificationPage() {
  const { user, status } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "anon") {
      void navigate({ to: "/auth/login", replace: true });
    }
  }, [status, navigate]);

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
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
          <ShieldAlert className="h-10 w-10 text-muted-foreground" />
          <p className="text-base font-semibold">Providers only</p>
          <p className="max-w-md text-sm text-muted-foreground">
            The verification page is only accessible to provider accounts.
          </p>
        </div>
      </PublicShell>
    );
  }

  const providerKind = (user as { kind?: string }).kind as "artisan" | "professional" | undefined;
  return <VerificationContent providerId={user.id} providerKind={providerKind ?? "artisan"} />;
}

function VerificationContent({ providerId, providerKind }: { providerId: string; providerKind: "artisan" | "professional" }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["verification", providerId],
    queryFn: () => verificationApi.status(providerId),
  });

  // Also load the raw case to get evidence items
  const casesQuery = useQuery({
    queryKey: ["verification-cases"],
    queryFn: () => verificationApi.getCases(),
  });

  const submit = useMutation({
    mutationFn: () => verificationApi.submit(providerId, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["verification", providerId] });
      void qc.invalidateQueries({ queryKey: ["verification-cases"] });
    },
  });

  const [step, setStep] = useState(1);
  const steps = ["Identity", "Experience", "Certifications", "Portfolio", "Review"];

  // Get the active case (most recently updated non-rejected)
  const activeCase = casesQuery.data?.cases?.[0] ?? null;
  const caseId = activeCase?.id ?? null;

  // Filter evidence for the current step
  const currentStepEvidence: EvidenceItem[] = activeCase?.evidence?.filter(
    (e) => e.evidenceType === stepEvidenceTypes[step - 1],
  ) ?? [];

  return (
    <PublicShell>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Verification</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Submit evidence for our verification team. In future releases, some checks may be
            automated — the badge means the same thing either way.
          </p>
        </div>
        <DataStateBoundary loading={q.isLoading} error={q.error}>
          {q.data ? <StatusPill status={q.data.status} /> : null}
        </DataStateBoundary>
      </header>

      {q.data?.requestedInfo && q.data.requestedInfo.length > 0 ? (
        <GlassPanel className="mt-6 border-warning/40 bg-warning/10 p-4 text-sm">
          <div className="font-semibold text-warning-foreground">
            Additional information requested
          </div>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
            {q.data.requestedInfo.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </GlassPanel>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-[240px_1fr]">
        <nav aria-label="Verification steps">
          <ol className="space-y-1">
            {steps.map((s, i) => {
              const active = step === i + 1;
              // Count evidence for this step
              const stepEvidence = activeCase?.evidence?.filter(
                (e) => e.evidenceType === stepEvidenceTypes[i],
              ) ?? [];
              return (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => setStep(i + 1)}
                    className={
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm " +
                      (active
                        ? "bg-accent font-semibold text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50")
                    }
                  >
                    <span
                      className={
                        "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs " +
                        (active
                          ? "gradient-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground")
                      }
                    >
                      {i + 1}
                    </span>
                    <span className="flex-1">{s}</span>
                    {stepEvidence.length > 0 && (
                      <span className="rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary">
                        {stepEvidence.length}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <GlassCard className="p-6">
          {step < steps.length ? (
            <EvidenceStepPanel
              stepName={steps[step - 1]!}
              stepIndex={step - 1}
              caseId={caseId}
              providerId={providerId}
              providerKind={providerKind}
              evidence={currentStepEvidence}
              onEvidenceChange={() => {
                void qc.invalidateQueries({ queryKey: ["verification-cases"] });
                void qc.invalidateQueries({ queryKey: ["verification", providerId] });
              }}
            />
          ) : (
            <ReviewStep
              caseId={caseId}
              providerId={providerId}
              steps={steps.slice(0, -1)}
              allEvidence={activeCase?.evidence ?? []}
            />
          )}

          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="rounded-lg border border-input px-4 py-2 text-sm hover:bg-accent"
            >
              Back
            </button>
            {step < steps.length ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(steps.length, s + 1))}
                className="rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={() => submit.mutate()}
                disabled={submit.isPending}
                className="rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson disabled:opacity-60"
              >
                {submit.isPending ? "Submitting…" : "Submit for review"}
              </button>
            )}
          </div>
        </GlassCard>
      </div>
    </PublicShell>
  );
}

function EvidenceStepPanel({
  stepName,
  stepIndex,
  caseId,
  providerId,
  providerKind,
  evidence,
  onEvidenceChange,
}: {
  stepName: string;
  stepIndex: number;
  caseId: string | null;
  providerId: string;
  providerKind: "artisan" | "professional";
  evidence: EvidenceItem[];
  onEvidenceChange: () => void;
}) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [evidenceType, setEvidenceType] = useState<EvidenceType>(
    stepEvidenceTypes[stepIndex] ?? "other",
  );
  const [formError, setFormError] = useState<string | null>(null);

  const createCaseMutation = useMutation({
    mutationFn: () => verificationApi.createCase(providerKind),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["verification-cases"] });
      void qc.invalidateQueries({ queryKey: ["verification", providerId] });
    },
  });

  const addMutation = useMutation({
    mutationFn: async (input: AddEvidenceInput) => {
      let activeCaseId = caseId;
      if (!activeCaseId) {
        const created = await verificationApi.createCase(providerKind);
        activeCaseId = created.case.id;
        await qc.invalidateQueries({ queryKey: ["verification-cases"] });
      }
      return verificationApi.addEvidence(activeCaseId, input);
    },
    onSuccess: () => {
      setLabel("");
      setUrl("");
      setEvidenceType(stepEvidenceTypes[stepIndex] ?? "other");
      setShowForm(false);
      setFormError(null);
      onEvidenceChange();
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Failed to add evidence");
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (evidenceId: string) => {
      if (!caseId) return;
      await verificationApi.removeEvidence(caseId, evidenceId);
    },
    onSuccess: () => {
      onEvidenceChange();
    },
  });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !url.trim()) {
      setFormError("Label and URL are required.");
      return;
    }
    setFormError(null);
    addMutation.mutate({ evidenceType, label: label.trim(), fileUrl: url.trim() });
  }

  return (
    <>
      <h2 className="text-base font-semibold">{stepName}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Provide supporting evidence for this section. Add URLs to documents or files hosted online.
      </p>

      {/* Evidence list */}
      {evidence.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {evidence.map((ev) => (
            <li
              key={ev.id}
              className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{ev.label}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {evidenceTypeLabels[ev.evidenceType] ?? ev.evidenceType}
                  {" · "}
                  <a
                    href={ev.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {ev.fileUrl}
                  </a>
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeMutation.mutate(ev.id)}
                disabled={removeMutation.isPending}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-60"
                aria-label="Remove evidence"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No evidence added for this step yet.</p>
      )}

      {/* Add evidence form */}
      {showForm ? (
        <form onSubmit={handleAdd} className="mt-4 space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Add evidence</span>
            <button
              type="button"
              onClick={() => { setShowForm(false); setFormError(null); }}
              className="rounded p-1 text-muted-foreground hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Evidence type</label>
            <select
              value={evidenceType}
              onChange={(e) => setEvidenceType(e.target.value as EvidenceType)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            >
              {ALL_EVIDENCE_TYPES.map((t) => (
                <option key={t} value={t}>{evidenceTypeLabels[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. National ID Card"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/my-document.pdf"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
          </div>
          {formError ? (
            <p className="text-sm text-destructive">{formError}</p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={addMutation.isPending || createCaseMutation.isPending}
              className="rounded-lg gradient-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-crimson disabled:opacity-60"
            >
              {addMutation.isPending ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setFormError(null); }}
              className="rounded-lg border border-input px-3 py-1.5 text-sm hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border/60 px-3 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Plus className="h-4 w-4" />
          Add evidence
        </button>
      )}
    </>
  );
}

function ReviewStep({
  caseId,
  providerId,
  steps,
  allEvidence,
}: {
  caseId: string | null;
  providerId: string;
  steps: string[];
  allEvidence: EvidenceItem[];
}) {
  void caseId;
  void providerId;
  return (
    <>
      <h2 className="text-base font-semibold">Review</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Review your evidence before submitting. Click "Submit for review" when ready.
      </p>
      <div className="mt-4 space-y-4">
        {steps.map((stepName, i) => {
          const stepEvidence = allEvidence.filter(
            (e) => e.evidenceType === stepEvidenceTypes[i],
          );
          return (
            <div key={stepName}>
              <div className="text-sm font-medium">{stepName}</div>
              {stepEvidence.length > 0 ? (
                <ul className="mt-1 space-y-1">
                  {stepEvidence.map((ev) => (
                    <li key={ev.id} className="text-xs text-muted-foreground">
                      {ev.label} — {evidenceTypeLabels[ev.evidenceType]}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">No evidence added.</p>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function StatusPill({ status }: { status: VerificationStatus }) {
  const meta = statusMeta[status];
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-glass px-3 py-1 text-xs font-medium " +
        meta.tone
      }
    >
      <meta.icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  );
}
