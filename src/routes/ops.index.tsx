import { createFileRoute } from "@tanstack/react-router";
import { OpsShell } from "@/layouts/OpsShell";
import { GlassCard } from "@/components/glass/glass";
import { Flag, LifeBuoy, ShieldCheck, Users } from "lucide-react";

export const Route = createFileRoute("/ops/")({
  head: () => ({ meta: [{ title: "Ops — PMP Internal" }, { name: "robots", content: "noindex" }] }),
  component: OpsOverview,
});

function OpsOverview() {
  const stats = [
    { icon: ShieldCheck, label: "In verification queue", value: 12 },
    { icon: Flag, label: "Moderation reports", value: 3 },
    { icon: LifeBuoy, label: "Open support tickets", value: 5 },
    { icon: Users, label: "Signups (7d)", value: 84 },
  ];
  return (
    <OpsShell>
      <h1 className="text-xl font-semibold tracking-tight">Operations overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Frontend surface only. All actions here call the backend when connected.
      </p>
      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <GlassCard key={s.label} className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{s.label}</span>
              <s.icon className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-3 text-2xl font-semibold">{s.value}</div>
          </GlassCard>
        ))}
      </section>
    </OpsShell>
  );
}
