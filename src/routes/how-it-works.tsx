import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassPanel } from "@/components/glass/glass";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How it works — PMP" },
      {
        name: "description",
        content:
          "How Precious Market Place (PMP) connects hirers with verified artisans and professionals.",
      },
    ],
  }),
  component: HowItWorksPage,
});

function HowItWorksPage() {
  const steps = [
    { n: 1, title: "Create your account", body: "Sign up as a hirer or provider in a minute." },
    {
      n: 2,
      title: "Build a profile",
      body: "Providers add skills, experience, certifications, and portfolio.",
    },
    { n: 3, title: "Verify", body: "Our team reviews evidence. A badge appears when verified." },
    {
      n: 4,
      title: "Discover & connect",
      body: "Hirers search, shortlist, and start conversations.",
    },
  ];
  return (
    <PublicShell>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        How Precious Market Place works
      </h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        A calm, evidence-first process for both sides of the marketplace.
      </p>
      <GlassPanel className="mt-8 grid gap-6 p-6 md:grid-cols-2 md:p-8">
        {steps.map((s) => (
          <div key={s.n} className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl gradient-primary text-sm font-semibold text-primary-foreground">
              {s.n}
            </span>
            <div>
              <div className="text-base font-semibold">{s.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
            </div>
          </div>
        ))}
      </GlassPanel>
    </PublicShell>
  );
}
