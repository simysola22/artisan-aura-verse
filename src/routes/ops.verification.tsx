import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { OpsShell } from "@/layouts/OpsShell";
import { GlassCard } from "@/components/glass/glass";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { verificationApi } from "@/api";
import type { VerificationCase, BackendCaseStatus } from "@/api/verification";
import { DataStateBoundary } from "@/components/common/data-state";
import {
  BadgeCheck,
  Clock,
  ShieldAlert,
  ChevronDown,
  Loader2,
  FileText,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/features/auth/auth-context";

export const Route = createFileRoute("/ops/verification")({
  head: () => ({
    meta: [{ title: "Verification queue — Ops" }, { name: "robots", content: "noindex" }],
  }),
  component: OpsVerification,
});

const STATUS_FILTERS: { label: string; value: BackendCaseStatus | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Submitted", value: "submitted" },
  { label: "Under review", value: "under_review" },
  { label: "Info requested", value: "info_requested" },
  { label: "Resubmitted", value: "resubmitted" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
];

function OpsVerification() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<BackendCaseStatus | undefined>(undefined);
  const [activeCase, setActiveCase] = useState<string | null>(null);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["ops-verification-cases", statusFilter],
    queryFn: () => verificationApi.listAll(statusFilter),
  });

  const claimMutation = useMutation({
    mutationFn: (caseId: string) => verificationApi.claimCase(caseId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ops-verification-cases"] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (caseId: string) => verificationApi.approveCase(caseId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ops-verification-cases"] });
      setActiveCase(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ caseId, reason }: { caseId: string; reason: string }) =>
      verificationApi.rejectCase(caseId, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ops-verification-cases"] });
      setActiveCase(null);
    },
  });

  return (
    <OpsShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Verification queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review submitted evidence and approve, reject, or request more information.
          </p>
        </div>
        {/* Status filter */}
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => setStatusFilter(f.value)}
              className={
                "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
                (statusFilter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "border border-input hover:bg-accent")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <DataStateBoundary loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
        {q.data?.cases.length === 0 ? (
          <GlassCard className="mt-6 p-8 text-center">
            <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">No verification cases found.</p>
          </GlassCard>
        ) : (
          <GlassCard className="mt-6 overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Case ID</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Evidence</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {q.data?.cases.map((c) => (
                  <>
                    <tr key={c.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {c.id.slice(0, 12)}…
                      </td>
                      <td className="px-4 py-3 capitalize">{c.verificationType}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.evidence.length} item{c.evidence.length !== 1 ? "s" : ""}
                      </td>
                      <td className="px-4 py-3">
                        <StatusChip status={c.status} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {c.submittedAt ? new Date(c.submittedAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() =>
                              setActiveCase(activeCase === c.id ? null : c.id)
                            }
                            className="rounded-md border border-input px-2.5 py-1 text-xs hover:bg-accent inline-flex items-center gap-1"
                          >
                            Review <ChevronDown className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {activeCase === c.id && (
                      <tr key={`${c.id}-detail`}>
                        <td colSpan={6} className="bg-muted/20 px-4 py-4">
                          <CaseDetail
                            verificationCase={c}
                            onClaim={() => claimMutation.mutate(c.id)}
                            onApprove={() => approveMutation.mutate(c.id)}
                            onReject={(reason) => rejectMutation.mutate({ caseId: c.id, reason })}
                            isClaiming={claimMutation.isPending}
                            isApproving={approveMutation.isPending}
                            isRejecting={rejectMutation.isPending}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </GlassCard>
        )}
      </DataStateBoundary>
    </OpsShell>
  );
}

function CaseDetail({
  verificationCase,
  onClaim,
  onApprove,
  onReject,
  isClaiming,
  isApproving,
  isRejecting,
}: {
  verificationCase: VerificationCase;
  onClaim: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  isClaiming: boolean;
  isApproving: boolean;
  isRejecting: boolean;
}) {
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const isActionable =
    verificationCase.status === "submitted" ||
    verificationCase.status === "under_review" ||
    verificationCase.status === "resubmitted";

  return (
    <div className="space-y-4">
      {/* Evidence list */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Evidence ({verificationCase.evidence.length})</h3>
        {verificationCase.evidence.length === 0 ? (
          <p className="text-xs text-muted-foreground">No evidence uploaded.</p>
        ) : (
          <ul className="space-y-1.5">
            {verificationCase.evidence.map((ev) => (
              <li key={ev.id} className="flex items-center gap-2 text-xs">
                <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground capitalize">
                  {ev.evidenceType.replace(/_/g, " ")}
                </span>
                <span className="font-medium">{ev.label}</span>
                <a
                  href={ev.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline truncate max-w-[200px]"
                >
                  {ev.fileUrl}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {verificationCase.requestedInfoMessage && (
        <div className="rounded-lg bg-warning/10 border border-warning/30 p-3 text-xs">
          <span className="font-semibold text-warning-foreground">Info requested: </span>
          {verificationCase.requestedInfoMessage}
        </div>
      )}

      {/* Actions */}
      {isActionable && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
          {verificationCase.status === "submitted" && (
            <button
              onClick={onClaim}
              disabled={isClaiming}
              className="rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-60 inline-flex items-center gap-1"
            >
              {isClaiming && <Loader2 className="h-3 w-3 animate-spin" />}
              Claim for review
            </button>
          )}
          <button
            onClick={onApprove}
            disabled={isApproving}
            className="rounded-md bg-success/10 border border-success/30 text-success px-3 py-1.5 text-xs hover:bg-success/20 disabled:opacity-60 inline-flex items-center gap-1"
          >
            {isApproving && <Loader2 className="h-3 w-3 animate-spin" />}
            Approve
          </button>
          <button
            onClick={() => setShowReject((v) => !v)}
            className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive px-3 py-1.5 text-xs hover:bg-destructive/20"
          >
            Reject
          </button>
        </div>
      )}

      {showReject && (
        <div className="space-y-2">
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection (required)"
            rows={2}
            className="w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={() => {
              if (rejectReason.trim()) {
                onReject(rejectReason.trim());
                setShowReject(false);
                setRejectReason("");
              }
            }}
            disabled={!rejectReason.trim() || isRejecting}
            className="rounded-md bg-destructive text-destructive-foreground px-3 py-1.5 text-xs disabled:opacity-60 inline-flex items-center gap-1"
          >
            {isRejecting && <Loader2 className="h-3 w-3 animate-spin" />}
            Confirm rejection
          </button>
        </div>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: BackendCaseStatus }) {
  const map: Record<BackendCaseStatus, { icon: typeof BadgeCheck; tone: string; label: string }> = {
    draft: { icon: ShieldAlert, tone: "text-muted-foreground", label: "Draft" },
    submitted: { icon: Clock, tone: "text-warning", label: "Submitted" },
    under_review: { icon: Clock, tone: "text-warning", label: "Under review" },
    info_requested: { icon: ShieldAlert, tone: "text-warning", label: "Info requested" },
    resubmitted: { icon: Clock, tone: "text-primary", label: "Resubmitted" },
    approved: { icon: BadgeCheck, tone: "text-success", label: "Approved" },
    rejected: { icon: ShieldAlert, tone: "text-destructive", label: "Rejected" },
    escalated: { icon: ShieldAlert, tone: "text-destructive", label: "Escalated" },
  };
  const m = map[status] ?? map.draft;
  return (
    <span className={"inline-flex items-center gap-1 text-xs font-medium " + m.tone}>
      <m.icon className="h-3.5 w-3.5" />
      {m.label}
    </span>
  );
}
