import { createFileRoute } from "@tanstack/react-router";
import { OpsShell } from "@/layouts/OpsShell";
import { EmptyState } from "@/components/common/data-state";
import { LifeBuoy } from "lucide-react";

export const Route = createFileRoute("/ops/support")({
  head: () => ({ meta: [{ title: "Support — Ops" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <OpsShell>
      <h1 className="text-xl font-semibold tracking-tight">Support</h1>
      <div className="mt-6">
        <EmptyState
          icon={<LifeBuoy className="h-6 w-6" />}
          title="No open tickets"
          description="Support conversations initiated by users will appear here."
        />
      </div>
    </OpsShell>
  ),
});
