import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { OpsShell } from "@/layouts/OpsShell";
import { GlassCard } from "@/components/glass/glass";
import { Flag, LifeBuoy, Loader2, ShieldCheck, Users } from "lucide-react";
import * as opsApi from "@/api/ops";

export const Route = createFileRoute("/ops/")({
  head: () => ({ meta: [{ title: "Ops — PMP Internal" }, { name: "robots", content: "noindex" }] }),
  component: OpsOverview,
});

function OpsOverview() {
  const q = useQuery({
    queryKey: ["ops-overview"],
    queryFn: opsApi.getOverview,
  });

  const data = q.data;

  const stats = [
    { icon: ShieldCheck, label: "In verification queue", value: data?.verificationQueueSize },
    { icon: Flag, label: "Open moderation reports", value: data?.openReports },
    { icon: LifeBuoy, label: "Open support tickets", value: data?.openTickets },
    { icon: Users, label: "Signups (7d)", value: data?.recentSignups },
  ];

  return (
    <OpsShell>
      <h1 className="text-xl font-semibold tracking-tight">Operations overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Live stats from the backend.
      </p>
      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <GlassCard key={s.label} className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{s.label}</span>
              <s.icon className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-3 text-2xl font-semibold">
              {q.isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : q.isError ? (
                <span className="text-sm text-destructive">—</span>
              ) : (
                (s.value ?? 0)
              )}
            </div>
          </GlassCard>
        ))}
      </section>
    </OpsShell>
  );
}
