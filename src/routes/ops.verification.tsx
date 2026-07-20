import { createFileRoute } from "@tanstack/react-router";
import { OpsShell } from "@/layouts/OpsShell";
import { GlassCard } from "@/components/glass/glass";
import { useQuery } from "@tanstack/react-query";
import { providersApi } from "@/api";
import { DataStateBoundary } from "@/components/common/data-state";
import { BadgeCheck, Clock, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/ops/verification")({
  head: () => ({
    meta: [{ title: "Verification queue — Ops" }, { name: "robots", content: "noindex" }],
  }),
  component: OpsVerification,
});

function OpsVerification() {
  const q = useQuery({ queryKey: ["providers"], queryFn: providersApi.list });
  return (
    <OpsShell>
      <h1 className="text-xl font-semibold tracking-tight">Verification queue</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Review submitted evidence and approve or request more information.
      </p>
      <DataStateBoundary loading={q.isLoading} error={q.error}>
        <GlassCard className="mt-6 overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {q.data?.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium">{p.displayName}</td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{p.kind}</td>
                  <td className="px-4 py-3">
                    <StatusChip status={p.verification} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="rounded-md border border-input px-2.5 py-1 text-xs hover:bg-accent">
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </GlassCard>
      </DataStateBoundary>
    </OpsShell>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { icon: typeof BadgeCheck; tone: string }> = {
    verified: { icon: BadgeCheck, tone: "text-success" },
    in_review: { icon: Clock, tone: "text-warning" },
    additional_info_requested: { icon: ShieldAlert, tone: "text-warning" },
    unverified: { icon: ShieldAlert, tone: "text-muted-foreground" },
    rejected: { icon: ShieldAlert, tone: "text-destructive" },
  };
  const m = map[status] ?? map.unverified!;
  return (
    <span className={"inline-flex items-center gap-1 text-xs " + m.tone}>
      <m.icon className="h-3.5 w-3.5" />
      {status.replace(/_/g, " ")}
    </span>
  );
}
