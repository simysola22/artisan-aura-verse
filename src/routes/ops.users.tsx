import { createFileRoute } from "@tanstack/react-router";
import { OpsShell } from "@/layouts/OpsShell";
import { GlassCard } from "@/components/glass/glass";
import { useQuery } from "@tanstack/react-query";
import { providersApi } from "@/api";

export const Route = createFileRoute("/ops/users")({
  head: () => ({ meta: [{ title: "Users — Ops" }, { name: "robots", content: "noindex" }] }),
  component: OpsUsers,
});

function OpsUsers() {
  const q = useQuery({ queryKey: ["providers"], queryFn: providersApi.list });
  return (
    <OpsShell>
      <h1 className="text-xl font-semibold tracking-tight">Users</h1>
      <GlassCard className="mt-6 overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {q.data?.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium">{p.displayName}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.email}</td>
                <td className="px-4 py-3 capitalize text-muted-foreground">provider · {p.kind}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(p.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassCard>
    </OpsShell>
  );
}
