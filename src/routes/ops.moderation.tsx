import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Flag, X } from "lucide-react";
import { OpsShell } from "@/layouts/OpsShell";
import { GlassCard } from "@/components/glass/glass";
import { DataStateBoundary } from "@/components/common/data-state";
import * as opsApi from "@/api/ops";
import type { ModerationReport } from "@/api/ops";

export const Route = createFileRoute("/ops/moderation")({
  head: () => ({ meta: [{ title: "Moderation — Ops" }, { name: "robots", content: "noindex" }] }),
  component: ModerationPage,
});

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-warning/10 text-warning" },
  under_review: { label: "Under review", cls: "bg-primary/10 text-primary" },
  action_taken: { label: "Action taken", cls: "bg-destructive/10 text-destructive" },
  dismissed: { label: "Dismissed", cls: "bg-muted text-muted-foreground" },
};

const ACTION_TYPES = [
  { value: "warning", label: "Issue warning" },
  { value: "suspension", label: "Suspend account" },
  { value: "removal", label: "Remove content" },
  { value: "dismissal", label: "Dismiss report" },
];

function ReportDetail({
  reportId,
  onClose,
}: {
  reportId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [actionType, setActionType] = useState("warning");
  const [notes, setNotes] = useState("");

  const q = useQuery({
    queryKey: ["ops-report", reportId],
    queryFn: () => opsApi.getReport(reportId),
  });

  const markReview = useMutation({
    mutationFn: () => opsApi.reviewReport(reportId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops-report", reportId] });
      qc.invalidateQueries({ queryKey: ["ops-reports"] });
    },
  });

  const takeAction = useMutation({
    mutationFn: () => opsApi.takeModerationAction(reportId, { actionType, notes: notes || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops-report", reportId] });
      qc.invalidateQueries({ queryKey: ["ops-reports"] });
      setNotes("");
    },
  });

  const report = q.data?.report;
  const s = report ? (STATUS_CONFIG[report.status] ?? STATUS_CONFIG.pending!) : null;
  const canAct = report && report.status !== "dismissed" && report.status !== "action_taken";

  return (
    <GlassCard className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <div>
          {s && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>}
          <h2 className="mt-1 text-sm font-semibold">
            {report ? `${report.targetType} report` : "Loading…"}
          </h2>
        </div>
        <button onClick={onClose} className="rounded p-1 hover:bg-accent" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {q.isLoading ? (
          <div className="flex justify-center pt-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : report ? (
          <>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Target type</dt>
                <dd className="capitalize font-medium">{report.targetType}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Target ID</dt>
                <dd className="font-mono text-xs truncate">{report.targetId}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Reason</dt>
                <dd className="font-medium">{report.reason}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Reported</dt>
                <dd>{new Date(report.createdAt).toLocaleDateString()}</dd>
              </div>
              {report.details && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Details</dt>
                  <dd className="mt-1 text-sm">{report.details}</dd>
                </div>
              )}
            </dl>

            {(report.actions ?? []).length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions taken</h3>
                <ul className="mt-2 space-y-2">
                  {report.actions!.map((a) => (
                    <li key={a.id} className="rounded-lg bg-muted/50 p-3 text-sm">
                      <div className="font-medium capitalize">{a.actionType.replace(/_/g, " ")}</div>
                      {a.notes && <p className="mt-0.5 text-xs text-muted-foreground">{a.notes}</p>}
                      <div className="mt-1 text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {canAct && (
              <div className="rounded-xl border border-border p-4">
                <h3 className="text-sm font-semibold">Take action</h3>

                {report.status === "pending" && (
                  <button
                    onClick={() => markReview.mutate()}
                    disabled={markReview.isPending}
                    className="mt-2 rounded-lg border border-input px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    {markReview.isPending ? "Marking…" : "Mark as under review"}
                  </button>
                )}

                <div className="mt-3 space-y-2">
                  <label className="text-xs text-muted-foreground">Action type</label>
                  <select
                    value={actionType}
                    onChange={(e) => setActionType(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none"
                  >
                    {ACTION_TYPES.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notes (optional)…"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                  />
                  <button
                    onClick={() => takeAction.mutate()}
                    disabled={takeAction.isPending}
                    className="rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson disabled:opacity-60"
                  >
                    {takeAction.isPending ? "Applying…" : "Apply action"}
                  </button>
                  {takeAction.isError && (
                    <p className="text-xs text-destructive">Failed. Please try again.</p>
                  )}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </GlassCard>
  );
}

function ModerationPage() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const q = useQuery({
    queryKey: ["ops-reports", filter],
    queryFn: () => opsApi.listReports(filter ? { status: filter } : undefined),
  });

  return (
    <OpsShell>
      <h1 className="text-xl font-semibold tracking-tight">Moderation reports</h1>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {["", "pending", "under_review", "action_taken", "dismissed"].map((v) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${filter === v ? "gradient-primary text-primary-foreground shadow-crimson" : "border border-input hover:bg-accent"}`}
          >
            {v === "" ? "All" : STATUS_CONFIG[v]?.label ?? v}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_400px]">
        <GlassCard className="p-2">
          <DataStateBoundary
            loading={q.isLoading}
            error={q.error}
            empty={q.data?.reports.length === 0}
            emptyTitle="No reports"
            emptyDescription="User reports will appear here."
            onRetry={() => q.refetch()}
          >
            <ul className="divide-y divide-border/60">
              {q.data?.reports.map((r) => {
                const s = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.pending!;
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => setActiveId(r.id)}
                      className="flex w-full items-center gap-3 rounded-xl p-4 text-left transition-colors hover:bg-accent"
                    >
                      <Flag className="h-4 w-4 shrink-0 text-destructive" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium capitalize">{r.reason}</span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
                            {s.label}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {r.targetType} · {new Date(r.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </DataStateBoundary>
        </GlassCard>

        {activeId ? (
          <ReportDetail reportId={activeId} onClose={() => setActiveId(null)} />
        ) : (
          <GlassCard className="hidden p-8 text-center text-sm text-muted-foreground lg:grid place-items-center">
            <div>
              <Flag className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2">Select a report to review and take action.</p>
            </div>
          </GlassCard>
        )}
      </div>
    </OpsShell>
  );
}
