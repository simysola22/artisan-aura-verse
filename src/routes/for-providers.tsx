import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard } from "@/components/glass/glass";
import { ArrowRight, ShieldCheck, Star, UserCircle2 } from "lucide-react";

export const Route = createFileRoute("/for-providers")({
  head: () => ({
    meta: [
      { title: "For artisans & professionals — Kraftly" },
      { name: "description", content: "A profile that earns trust. Verified credentials, real portfolios, calm messaging." },
    ],
  }),
  component: ForProvidersPage,
});

function ForProvidersPage() {
  return (
    <PublicShell>
      <header className="mx-auto max-w-3xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
          Your craft, taken seriously.
        </h1>
        <p className="mt-3 text-muted-foreground">
          Showcase real work, add verified credentials, and let quality speak louder than
          gimmicks. Kraftly is where serious artisans and professionals build their reputation.
        </p>
        <Link
          to="/auth/register"
          className="mt-6 inline-flex items-center gap-2 rounded-xl gradient-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-crimson"
        >
          Create your provider profile <ArrowRight className="h-4 w-4" />
        </Link>
      </header>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {[
          { icon: UserCircle2, title: "A profile that stands out", body: "Cinematic layouts, portfolio-first design." },
          { icon: ShieldCheck, title: "Real verification", body: "A trusted badge — never bought, always earned." },
          { icon: Star, title: "Ranked on fit", body: "No auction dynamics. Discovery favors substance." },
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
