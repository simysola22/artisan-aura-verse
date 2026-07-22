import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { OpsShell } from "@/layouts/OpsShell";
import { GlassCard } from "@/components/glass/glass";
import { DataStateBoundary } from "@/components/common/data-state";
import * as opsApi from "@/api/ops";
import type { OpsUser } from "@/api/ops";
import { Loader2, UserCheck, UserX } from "lucide-react";

export const Route = createFileRoute("/ops/users")({
  head: () => ({ meta: [{ title: "Users — Ops" }, { name: "robots", content: "noindex" }] }),
  component: OpsUsers,
});

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-success/10 text-success" },
  suspended: { label: "Suspended", cls: "bg-destructive/10 text-destructive" },
  pending: { label: "Pending", cls: "bg-warning/10 text-warning" },
  deleted: { label: "Deleted", cls: "bg-muted text-muted-foreground" },
};

function UserRow({ user, onAction }: { user: OpsUser; onAction: (userId: string, action: "suspend" | "reactivate") => void; pendingId: string | null }) {
  const s = STATUS_CONFIG[user.status] ?? { label: user.status, cls: "bg-muted text-muted-foreground" };
  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3 font-medium">{user.displayName ?? "—"}</td>
      <td className="px-4 py-3 text-muted-foreground">{user.email ?? "—"}</td>
      <td className="px-4 py-3 capitalize text-muted-foreground">{user.accountType}</td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
          {s.label}
        </span>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {new Date(user.createdAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          {user.status === "active" && (
            <button
              onClick={() => onAction(user.id, "suspend")}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-destructive/40 text-destructive hover:bg-destructive/10"
              title="Suspend account"
            >
              <UserX className="h-3 w-3" /> Suspend
            </button>
          )}
          {user.status === "suspended" && (
            <button
              onClick={() => onAction(user.id, "reactivate")}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-success/40 text-success hover:bg-success/10"
              title="Reactivate account"
            >
              <UserCheck className="h-3 w-3" /> Reactivate
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function OpsUsers() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<{ status?: string; accountType?: string }>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["ops-users", filter],
    queryFn: () => opsApi.listUsers({ ...filter, limit: 100 }),
  });

  const actionMutation = useMutation({
    mutationFn: ({ userId, action }: { userId: string; action: "suspend" | "reactivate" }) => {
      setPendingId(userId);
      return action === "suspend"
        ? opsApi.suspendUser(userId)
        : opsApi.reactivateUser(userId);
    },
    onSettled: () => {
      setPendingId(null);
      void qc.invalidateQueries({ queryKey: ["ops-users"] });
    },
  });

  const handleAction = (userId: string, action: "suspend" | "reactivate") => {
    if (window.confirm(action === "suspend" ? "Suspend this account?" : "Reactivate this account?")) {
      actionMutation.mutate({ userId, action });
    }
  };

  return (
    <OpsShell>
      <h1 className="text-xl font-semibold tracking-tight">Users</h1>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-1">Status:</span>
          {["", "active", "suspended", "pending"].map((v) => (
            <button
              key={v}
              onClick={() => setFilter((f) => ({ ...f, status: v || undefined }))}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                (filter.status ?? "") === v
                  ? "gradient-primary text-primary-foreground shadow-crimson"
                  : "border border-input hover:bg-accent"
              }`}
            >
              {v === "" ? "All" : (STATUS_CONFIG[v]?.label ?? v)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-1">Type:</span>
          {["", "provider", "employer"].map((v) => (
            <button
              key={v}
              onClick={() => setFilter((f) => ({ ...f, accountType: v || undefined }))}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                (filter.accountType ?? "") === v
                  ? "gradient-primary text-primary-foreground shadow-crimson"
                  : "border border-input hover:bg-accent"
              }`}
            >
              {v === "" ? "All" : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <GlassCard className="mt-6 overflow-hidden p-0">
        <DataStateBoundary
          loading={q.isLoading}
          error={q.error}
          empty={(q.data?.users.length ?? 0) === 0}
          emptyTitle="No users found"
          emptyDescription="No users match the current filters."
          onRetry={() => q.refetch()}
        >
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {q.data?.users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  onAction={handleAction}
                  pendingId={pendingId}
                />
              ))}
            </tbody>
          </table>
          {q.data && (
            <div className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
              {q.data.users.length} of {q.data.total} users
            </div>
          )}
        </DataStateBoundary>
      </GlassCard>
    </OpsShell>
  );
}
