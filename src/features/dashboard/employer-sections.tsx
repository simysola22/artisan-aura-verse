/**
 * Employer-specific dashboard sections.
 *
 * All data shown here is clearly labelled demo/placeholder data.
 * Replace the DEMO_* imports with real API queries once the listings
 * feature is implemented — the component structure stays the same.
 */
import { ArrowRight, FlaskConical } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { TalentCard } from "./talent-card";
import { JobCard } from "./job-card";
import { DEMO_TALENTS, DEMO_JOBS } from "./demo-data";

function DemoBanner() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-medium text-warning">
      <FlaskConical className="h-3 w-3" />
      Demo data — not real listings
    </span>
  );
}

export function EmployerSections() {
  return (
    <>
      {/* ── Available Professionals ── */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Find Talent</h2>
            <DemoBanner />
          </div>
          <Link
            to="/search"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Browse all providers <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {DEMO_TALENTS.slice(0, 6).map((t) => (
            <TalentCard key={t.id} talent={t} />
          ))}
        </div>
      </section>

      {/* ── Open Opportunities ── */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Open Opportunities</h2>
            <DemoBanner />
          </div>
          <span className="text-sm text-muted-foreground">
            Post a job to appear here
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {DEMO_JOBS.slice(0, 6).map((j) => (
            <JobCard key={j.id} job={j} variant="view" />
          ))}
        </div>
      </section>
    </>
  );
}
