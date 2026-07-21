/**
 * Provider-specific dashboard sections.
 *
 * All data shown here is clearly labelled demo/placeholder data.
 * Replace the DEMO_* imports with real API queries once the listings
 * feature is implemented — the component structure stays the same.
 */
import { ArrowRight, FlaskConical, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { JobCard } from "./job-card";
import { DEMO_JOBS } from "./demo-data";
import { GlassCard } from "@/components/glass/glass";
import type { Provider } from "@/types";

function DemoBanner() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-medium text-warning">
      <FlaskConical className="h-3 w-3" />
      Demo data — not real listings
    </span>
  );
}

interface ProviderSectionsProps {
  /** The authenticated provider's skills/categories — used to filter recommendations. */
  providerSkills?: string[];
  providerCategory?: string;
}

export function ProviderSections({ providerCategory }: ProviderSectionsProps) {
  // Filter recommended jobs by provider category when available
  const recommended = providerCategory
    ? DEMO_JOBS.filter(
        (j) => j.category.toLowerCase() === providerCategory.toLowerCase(),
      )
    : DEMO_JOBS.slice(0, 3);

  const allJobs = DEMO_JOBS;

  return (
    <>
      {/* ── Available Jobs ── */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Available Jobs</h2>
            <DemoBanner />
          </div>
          <Link
            to="/search"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {allJobs.map((j) => (
            <JobCard key={j.id} job={j} variant="apply" />
          ))}
        </div>
      </section>

      {/* ── Recommended Opportunities ── */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold tracking-tight">Recommended for You</h2>
          </div>
          <DemoBanner />
        </div>
        {recommended.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {recommended.map((j) => (
              <JobCard key={j.id} job={j} variant="apply" />
            ))}
          </div>
        ) : (
          <GlassCard className="p-6 text-center text-sm text-muted-foreground">
            Complete your profile with your skills and category to see personalised
            recommendations here.
          </GlassCard>
        )}
      </section>
    </>
  );
}
