import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard, GlassPanel } from "@/components/glass/glass";
import { verificationApi } from "@/api";
import { DataStateBoundary } from "@/components/common/data-state";
import { useAuth } from "@/features/auth/auth-context";
import { BadgeCheck, Clock, FileUp, ShieldAlert, ShieldCheck } from "lucide-react";
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

function VerificationPage() {
  const { user } = useAuth();
  const providerId = user?.role === "provider" ? user.id : "p3"; // demo fallback
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["verification", providerId],
    queryFn: () => verificationApi.status(providerId),
  });
  const submit = useMutation({
    mutationFn: () => verificationApi.submit(providerId, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["verification", providerId] }),
  });

  const [step, setStep] = useState(1);
  const steps = ["Identity", "Experience", "Certifications", "Portfolio", "Review"];

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
                        "grid h-6 w-6 place-items-center rounded-full text-xs " +
                        (active
                          ? "gradient-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground")
                      }
                    >
                      {i + 1}
                    </span>
                    {s}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <GlassCard className="p-6">
          <h2 className="text-base font-semibold">{steps[step - 1]}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Provide supporting evidence for this section. Uploads are stored securely.
          </p>
          <div className="mt-4 grid place-items-center rounded-2xl border border-dashed border-border/60 bg-muted/30 p-8 text-center">
            <FileUp className="h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Drag & drop files here, or{" "}
              <button type="button" className="font-medium text-primary hover:underline">
                choose files
              </button>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">PDF, JPG, PNG — up to 10 MB each</p>
          </div>

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
