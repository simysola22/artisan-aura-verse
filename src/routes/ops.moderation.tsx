import { createFileRoute } from "@tanstack/react-router";
import { OpsShell } from "@/layouts/OpsShell";
import { EmptyState } from "@/components/common/data-state";
import { Flag } from "lucide-react";

export const Route = createFileRoute("/ops/moderation")({
  head: () => ({ meta: [{ title: "Moderation — Ops" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <OpsShell>
      <h1 className="text-xl font-semibold tracking-tight">Moderation</h1>
      <div className="mt-6">
        <EmptyState
          icon={<Flag className="h-6 w-6" />}
          title="No open reports"
          description="Reports flagged by users or automated systems will appear here."
        />
      </div>
    </OpsShell>
  ),
});
