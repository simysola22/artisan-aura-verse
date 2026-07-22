import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BadgeCheck, Loader2, MapPin, MessageSquare, Star, ArrowLeft } from "lucide-react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard, GlassPanel } from "@/components/glass/glass";
import { messagingApi, providersApi } from "@/api";
import { DataStateBoundary } from "@/components/common/data-state";
import { useAuth } from "@/features/auth/auth-context";

export const Route = createFileRoute("/providers/$providerId")({
  head: () => ({ meta: [{ title: "Provider profile — PMP" }] }),
  component: ProviderProfilePage,
});

function ProviderProfilePage() {
  const { providerId } = useParams({ from: "/providers/$providerId" });
  const navigate = useNavigate();
  const { status, user } = useAuth();

  const q = useQuery({
    queryKey: ["provider", providerId],
    queryFn: () => providersApi.get(providerId),
  });

  // Create or retrieve the conversation with this provider, then navigate to it.
  const messageMutation = useMutation({
    mutationFn: async () => {
      // q.data.userId is the provider's PMP user ID (from UserBase).
      const providerUserId = (q.data as any)?.userId as string | undefined;
      if (!providerUserId) throw new Error("Provider user ID not found");
      const conv = await messagingApi.createConversation(providerUserId);
      return conv;
    },
    onSuccess: (conv) => {
      void navigate({
        to: "/messages/$conversationId",
        params: { conversationId: conv.id },
      });
    },
  });

  return (
    <PublicShell>
      <Link
        to="/search"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to search
      </Link>
      <DataStateBoundary loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
        {q.data ? (
          <>
            <GlassPanel className="p-6 md:p-8">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 md:flex md:items-center">
                <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl gradient-primary text-xl font-semibold text-primary-foreground md:h-20 md:w-20">
                  {q.data.displayName
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-xl font-semibold tracking-tight md:text-2xl">
                      {q.data.displayName}
                    </h1>
                    {q.data.verification === "verified" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        <BadgeCheck className="h-3.5 w-3.5" /> Verified
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
                        {q.data.verification.replace(/_/g, " ")}
                      </span>
                    )}
                    <span className="rounded-full bg-accent px-2 py-0.5 text-xs capitalize text-accent-foreground">
                      {q.data.kind}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground md:text-base">
                    {q.data.headline}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    {q.data.serviceArea ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" /> {q.data.serviceArea}
                      </span>
                    ) : null}
                    {q.data.ratingAverage ? (
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 fill-current text-warning" />
                        {q.data.ratingAverage.toFixed(1)} ({q.data.ratingCount ?? 0} reviews)
                      </span>
                    ) : null}
                    {q.data.hourlyRate ? (
                      <span>
                        From {q.data.currency ?? ""} {q.data.hourlyRate}/hr
                      </span>
                    ) : null}
                  </div>
                </div>
                {status === "authed" && user?.role !== "provider" && (
                  <button
                    onClick={() => messageMutation.mutate()}
                    disabled={messageMutation.isPending}
                    className="col-span-2 inline-flex items-center justify-center gap-2 rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson md:col-auto disabled:opacity-60"
                  >
                    {messageMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MessageSquare className="h-4 w-4" />
                    )}
                    Message
                  </button>
                )}
                {(status === "anon" || user?.role === "provider") && (
                  <Link
                    to="/messages"
                    className="col-span-2 inline-flex items-center justify-center gap-2 rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson md:col-auto"
                  >
                    <MessageSquare className="h-4 w-4" /> Message
                  </Link>
                )}
              </div>
            </GlassPanel>

            <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
              <div className="space-y-6">
                {q.data.about ? (
                  <GlassCard className="p-6">
                    <h2 className="text-base font-semibold">About</h2>
                    <p className="mt-2 text-sm text-muted-foreground">{q.data.about}</p>
                  </GlassCard>
                ) : null}
                <GlassCard className="p-6">
                  <h2 className="text-base font-semibold">Skills</h2>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {q.data.skills.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No skills listed yet.</p>
                    ) : (
                      q.data.skills.map((s) => (
                        <span
                          key={s.id}
                          className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                        >
                          {s.name}
                        </span>
                      ))
                    )}
                  </div>
                </GlassCard>
                <GlassCard className="p-6">
                  <h2 className="text-base font-semibold">Experience</h2>
                  {q.data.experience.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">No experience added yet.</p>
                  ) : (
                    <ul className="mt-3 space-y-3">
                      {q.data.experience.map((e) => (
                        <li key={e.id} className="border-l-2 border-primary/40 pl-3">
                          <div className="text-sm font-medium">{e.role}</div>
                          <div className="text-xs text-muted-foreground">
                            {e.organization} · {new Date(e.startDate).getFullYear()}
                            {e.endDate ? `–${new Date(e.endDate).getFullYear()}` : " – present"}
                          </div>
                          {e.description ? (
                            <p className="mt-1 text-sm text-muted-foreground">{e.description}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </GlassCard>

                <GlassCard className="p-6">
                  <h2 className="text-base font-semibold">Portfolio</h2>
                  {q.data.portfolio.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">No portfolio items yet.</p>
                  ) : (
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {q.data.portfolio.map((p) => (
                        <div
                          key={p.id}
                          className="aspect-square overflow-hidden rounded-xl bg-muted"
                        >
                          <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">
                            {p.title}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </GlassCard>
              </div>

              <aside className="space-y-6">
                <GlassCard className="p-6">
                  <h2 className="text-base font-semibold">Certifications</h2>
                  {q.data.certifications.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">None listed.</p>
                  ) : (
                    <ul className="mt-3 space-y-2 text-sm">
                      {q.data.certifications.map((c) => (
                        <li key={c.id}>
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">{c.issuer}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </GlassCard>
                <GlassCard className="p-6">
                  <h2 className="text-base font-semibold">Availability</h2>
                  <p className="mt-2 text-sm capitalize text-muted-foreground">
                    {q.data.availability ?? "Contact provider"}
                  </p>
                </GlassCard>
              </aside>
            </div>
          </>
        ) : null}
      </DataStateBoundary>
    </PublicShell>
  );
}
