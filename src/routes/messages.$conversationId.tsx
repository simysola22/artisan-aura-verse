import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { PublicShell } from "@/layouts/PublicShell";
import { useAuth } from "@/features/auth/auth-context";
import { MessagesLayout } from "./messages";

export const Route = createFileRoute("/messages/$conversationId")({
  head: () => ({ meta: [{ title: "Conversation — PMP" }] }),
  component: ConversationPage,
});

function ConversationPage() {
  const { conversationId } = useParams({ from: "/messages/$conversationId" });
  const { status } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "anon") {
      void navigate({ to: "/auth/login", replace: true });
    }
  }, [status, navigate]);

  if (status === "loading" || status === "syncing") {
    return (
      <PublicShell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </PublicShell>
    );
  }

  if (status === "anon") return null;

  return <MessagesLayout activeId={conversationId} />;
}
