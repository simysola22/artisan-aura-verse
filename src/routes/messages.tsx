import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard } from "@/components/glass/glass";
import { messagingApi } from "@/api";
import { DataStateBoundary, EmptyState } from "@/components/common/data-state";
import { useAuth } from "@/features/auth/auth-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/messages")({
  head: () => ({ meta: [{ title: "Messages — PMP" }] }),
  component: MessagesIndex,
});

function MessagesIndex() {
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

  return <MessagesLayout />;
}

export function MessagesLayout({ activeId }: { activeId?: string } = {}) {
  const { user } = useAuth();
  // Fallback to the mock seed id so the demo works before real auth is wired.
  const currentUserId = user?.id ?? "me";
  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: messagingApi.listConversations,
  });

  return (
    <PublicShell>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Messages</h1>
      <div className="mt-6 grid gap-4 md:grid-cols-[320px_1fr]">
        <GlassCard className="p-2">
          <DataStateBoundary
            loading={conversations.isLoading}
            error={conversations.error}
            empty={conversations.data?.length === 0}
            emptyTitle="No conversations yet"
            emptyDescription="Start one from a provider profile."
          >
            <ul className="divide-y divide-border/60">
              {conversations.data?.map((c) => {
                const other =
                  c.participants.find((p) => p.id !== currentUserId) ?? c.participants[0]!;
                const active = c.id === activeId;
                return (
                  <li key={c.id}>
                    <Link
                      to="/messages/$conversationId"
                      params={{ conversationId: c.id }}
                      className={cn(
                        "flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-accent",
                        active && "bg-accent",
                      )}
                    >
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg gradient-primary text-sm font-semibold text-primary-foreground">
                        {other.displayName
                          .split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join("")}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{other.displayName}</span>
                          {c.unreadCount > 0 ? (
                            <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                              {c.unreadCount}
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.lastMessage?.body ?? "—"}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </DataStateBoundary>
        </GlassCard>

        {activeId ? (
          <ConversationView conversationId={activeId} />
        ) : (
          <GlassCard className="grid place-items-center p-10">
            <EmptyState
              icon={<MessageSquare className="h-6 w-6" />}
              title="Choose a conversation"
              description="Select a thread on the left to view messages."
            />
          </GlassCard>
        )}
      </div>
    </PublicShell>
  );
}

export function ConversationView({ conversationId }: { conversationId: string }) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? "me";

  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const messages = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => messagingApi.listMessages(conversationId),
  });
  const send = useMutation({
    mutationFn: (body: string) => messagingApi.sendMessage(conversationId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  // SSE realtime subscription — inject incoming messages directly into the cache.
  useEffect(() => {
    const unsub = messagingApi.subscribe(conversationId, (msg) => {
      qc.setQueryData(["messages", conversationId], (old: import("@/types").Message[] | undefined) => {
        if (!old) return [msg];
        // Deduplicate in case the sender's own message arrives via SSE too.
        if (old.some((m) => m.id === msg.id)) return old;
        return [...old, msg];
      });
      // Keep conversation list preview up to date.
      qc.invalidateQueries({ queryKey: ["conversations"] });
    });
    return unsub;
  }, [conversationId, qc]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    send.mutate(draft.trim());
    setDraft("");
  }

  return (
    <GlassCard className="flex h-[min(70vh,640px)] flex-col p-0">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <DataStateBoundary
          loading={messages.isLoading}
          error={messages.error}
          empty={messages.data?.length === 0}
          emptyTitle="No messages yet"
          emptyDescription="Say hello — providers usually respond within a few hours."
        >
          {messages.data?.map((m) => {
            const mine = m.senderId === currentUserId;
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                    mine
                      ? "gradient-primary text-primary-foreground"
                      : "glass-surface text-foreground",
                  )}
                >
                  {m.body}
                </div>
              </div>
            );
          })}
        </DataStateBoundary>
      </div>
      <form onSubmit={onSubmit} className="border-t border-border/60 p-3">
        <label htmlFor="composer" className="sr-only">
          Message
        </label>
        <div className="flex items-center gap-2">
          <input
            id="composer"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a message…"
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
          <button
            type="submit"
            disabled={!draft.trim() || send.isPending}
            aria-label="Send message"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg gradient-primary text-primary-foreground shadow-crimson disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </GlassCard>
  );
}
