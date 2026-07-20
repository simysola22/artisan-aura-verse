import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck, MessagesSquare, Search, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard, GlassPanel } from "@/components/glass/glass";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Precious Market Place (PMP) — the premium marketplace for artisans & professionals" },
      {
        name: "description",
        content:
          "Discover verified artisans and professionals. Trusted profiles, transparent verification, and a beautiful hiring experience.",
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <PublicShell>
      <section className="relative pt-6 md:pt-12">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-glass px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Verified providers, transparent process
          </span>
          <h1 className="mt-5 text-balance text-4xl font-semibold tracking-tight md:text-6xl">
            Hire the right{" "}
            <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              artisan or professional
            </span>
            , not the loudest one.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-muted-foreground md:text-lg">
            A premium marketplace with rigorous verification, real portfolios, and an elegant
            messaging experience — built to feel like the tool professionals deserve.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/auth/register"
              className="inline-flex items-center gap-2 rounded-xl gradient-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-crimson transition-opacity hover:opacity-95"
            >
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/search"
              className="inline-flex items-center gap-2 rounded-xl glass-surface px-5 py-3 text-sm font-semibold hover:bg-accent"
            >
              Browse providers
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-16 grid max-w-5xl gap-4 md:grid-cols-3">
          {[
            {
              icon: Search,
              title: "Precise discovery",
              body: "Filter by category, skill, verification and location. Ranking is fair and transparent.",
            },
            {
              icon: ShieldCheck,
              title: "Serious verification",
              body: "Evidence-backed profiles reviewed by our verification team. No inflated credentials.",
            },
            {
              icon: MessagesSquare,
              title: "Elegant messaging",
              body: "Start conversations in a calm, focused inbox designed for real work.",
            },
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

        <GlassPanel className="mx-auto mt-16 grid max-w-5xl gap-8 p-8 md:grid-cols-2">
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
              <Wrench className="h-4 w-4" />
              For providers
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
              A profile that earns trust, not attention.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Showcase real work, add certifications, and let verification do the talking. Whether
              you're an artisan or a professional, your craft deserves better than a job board.
            </p>
            <Link
              to="/auth/register"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
            >
              Create your profile <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
              <BadgeCheck className="h-4 w-4" />
              For hirers
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
              Confidence, before the first message.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Every verified provider has been reviewed against evidence. Search, shortlist, and
              start a conversation — no gimmicks, no auction dynamics.
            </p>
            <Link
              to="/search"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
            >
              Explore the marketplace <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </GlassPanel>
      </section>
    </PublicShell>
  );
}
