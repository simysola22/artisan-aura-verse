import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard } from "@/components/glass/glass";
import { ArrowRight, BadgeCheck, MessagesSquare, Search } from "lucide-react";

export const Route = createFileRoute("/for-employers")({
  head: () => ({
    meta: [
      { title: "For hirers — Kraftly" },
      { name: "description", content: "Find and hire verified artisans and professionals with confidence." },
      { property: "og:title", content: "Hire on Kraftly" },
      { property: "og:description", content: "Discover verified providers. Beautiful discovery, real evidence, calm messaging." },
    ],
  }),
  component: ForEmployersPage,
});

function ForEmployersPage() {
  return (
    <PublicShell>
      <header className="mx-auto max-w-3xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">Hire with confidence.</h1>
        <p className="mt-3 text-muted-foreground">
          Discover artisans and professionals whose credentials have been evidenced. Search fairly,
          shortlist quickly, and start a conversation in seconds.
        </p>
        <Link
          to="/auth/register"
          className="mt-6 inline-flex items-center gap-2 rounded-xl gradient-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-crimson"
        >
          Create your hirer account <ArrowRight className="h-4 w-4" />
        </Link>
      </header>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {[
          { icon: Search, title: "Precision search", body: "Filter by category, skill, verification, and location." },
          { icon: BadgeCheck, title: "Evidence-backed profiles", body: "See real work and verified certifications." },
          { icon: MessagesSquare, title: "Calm messaging", body: "A focused inbox that respects everyone's time." },
        ].map((f) => (
          <GlassCard key={f.title} className="p-6">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
          </GlassCard>
        ))}
      </div>
    </PublicShell>
  );
}
