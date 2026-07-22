import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, LifeBuoy, ChevronRight, X, Send } from "lucide-react";
import { OpsShell } from "@/layouts/OpsShell";
import { GlassCard } from "@/components/glass/glass";
import { DataStateBoundary } from "@/components/common/data-state";
import * as opsApi from "@/api/ops";
import type { SupportTicket } from "@/api/ops";

export const Route = createFileRoute("/ops/support")({
  head: () => ({ meta: [{ title: "Support — Ops" }, { name: "robots", content: "noindex" }] }),
  component: SupportPage,
});

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-primary/10 text-primary" },
  in_progress: { label: "In progress", cls: "bg-warning/10 text-warning" },
  waiting: { label: "Waiting", cls: "bg-muted text-muted-foreground" },
  resolved: { label: "Resolved", cls: "bg-success/10 text-success" },
  closed: { label: "Closed", cls: "bg-muted text-muted-foreground" },
};

const PRIORITY_CONFIG: Record<string, { label: string; cls: string }> = {
  low: { label: "Low", cls: "text-muted-foreground" },
  medium: { label: "Medium", cls: "text-warning" },
  high: { label: "High", cls: "text-destructive" },
  urgent: { label: "Urgent", cls: "font-bold text-destructive" },
};

function TicketRow({ ticket, onSelect }: { ticket: SupportTicket; onSelect: () => void }) {
  const s = STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.open!;
  const p = PRIORITY_CONFIG[ticket.priority] ?? PRIORITY_CONFIG.medium!;
  return (
    <button
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-xl p-4 text-left transition-colors hover:bg-accent"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{ticket.subject}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
            {s.label}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className={p.cls}>{p.label}</span>
          <span>·</span>
          <span>{new Date(ticket.createdAt).toLocaleDateString()}</span>
          {ticket.category ? <><span>·</span><span>{ticket.category}</span></> : null}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function TicketDetail({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");

  const q = useQuery({
    queryKey: ["ops-ticket", ticketId],
    queryFn: () => opsApi.getTicket(ticketId),
  });

  const addMsg = useMutation({
    mutationFn: () => opsApi.addTicketMessage(ticketId, msg, false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops-ticket", ticketId] });
      setMsg("");
    },
  });

  const closeTicket = useMutation({
    mutationFn: () => opsApi.closeTicket(ticketId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops-ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["ops-tickets"] });
    },
  });

  const ticket = q.data?.ticket;
  const s = ticket ? (STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.open!) : null;

  return (
    <GlassCard className="flex flex-col h-[min(80vh,700px)]">
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {s && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>}
            {ticket && ticket.status !== "closed" && ticket.status !== "resolved" && (
              <button
                onClick={() => closeTicket.mutate()}
                disabled={closeTicket.isPending}
                className="rounded px-2 py-0.5 text-[11px] border border-input hover:bg-accent"
              >
                {closeTicket.isPending ? "Closing…" : "Close ticket"}
              </button>
            )}
          </div>
          <h2 className="mt-1 truncate text-sm font-semibold">{ticket?.subject ?? "Loading…"}</h2>
        </div>
        <button onClick={onClose} className="rounded p-1 hover:bg-accent" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {q.isLoading ? (
          <div className="flex justify-center pt-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          ticket?.messages?.map((m) => (
            <div key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.isInternal ? "bg-muted/50 italic text-muted-foreground" : "glass-surface"}`}>
              <span className="text-xs font-medium text-muted-foreground">{new Date(m.createdAt).toLocaleString()} {m.isInternal ? "· Internal" : ""}</span>
              <p className="mt-1">{m.body}</p>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (msg.trim()) addMsg.mutate(); }}
        className="border-t border-border/60 p-3"
      >
        <div className="flex items-center gap-2">
          <input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder="Reply to ticket…"
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
          <button
            type="submit"
            disabled={!msg.trim() || addMsg.isPending}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg gradient-primary text-primary-foreground shadow-crimson disabled:opacity-60"
            aria-label="Send reply"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </GlassCard>
  );
}

function SupportPage() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const q = useQuery({
    queryKey: ["ops-tickets", filter],
    queryFn: () => opsApi.listTickets(filter ? { status: filter } : undefined),
  });

  return (
    <OpsShell>
      <h1 className="text-xl font-semibold tracking-tight">Support tickets</h1>

      <div className="mt-4 flex items-center gap-2">
        {["", "open", "in_progress", "waiting", "resolved", "closed"].map((v) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${filter === v ? "gradient-primary text-primary-foreground shadow-crimson" : "border border-input hover:bg-accent"}`}
          >
            {v === "" ? "All" : STATUS_CONFIG[v]?.label ?? v}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_420px]">
        <GlassCard className="p-2">
          <DataStateBoundary
            loading={q.isLoading}
            error={q.error}
            empty={q.data?.tickets.length === 0}
            emptyTitle="No tickets"
            emptyDescription="Support tickets from users will appear here."
            onRetry={() => q.refetch()}
          >
            <ul className="divide-y divide-border/60">
              {q.data?.tickets.map((t) => (
                <li key={t.id}>
                  <TicketRow ticket={t} onSelect={() => setActiveId(t.id)} />
                </li>
              ))}
            </ul>
          </DataStateBoundary>
        </GlassCard>

        {activeId ? (
          <TicketDetail ticketId={activeId} onClose={() => setActiveId(null)} />
        ) : (
          <GlassCard className="hidden p-8 text-center text-sm text-muted-foreground lg:grid place-items-center">
            <div>
              <LifeBuoy className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2">Select a ticket to view the conversation.</p>
            </div>
          </GlassCard>
        )}
      </div>
    </OpsShell>
  );
}
