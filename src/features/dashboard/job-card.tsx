import { Banknote, Clock, MapPin, Tag } from "lucide-react";
import { GlassCard } from "@/components/glass/glass";
import type { DemoJob } from "./demo-data";

interface JobCardProps {
  job: DemoJob;
  /** Show "Apply" CTA (provider view) vs "View Job" (employer view). */
  variant?: "apply" | "view";
}

export function JobCard({ job, variant = "view" }: JobCardProps) {
  return (
    <GlassCard className="flex flex-col gap-3 p-5">
      {/* Title + employer */}
      <div>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{job.title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{job.employerName}</p>
      </div>

      {/* Meta chips */}
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground">
          <Tag className="h-3 w-3" />
          {job.category}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {job.location}
        </span>
      </div>

      {/* Budget + posted time */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <Banknote className="h-3.5 w-3.5 text-success" />
          {job.budgetDisplay}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {job.postedAt}
        </span>
      </div>

      {/* Action */}
      <div className="mt-auto pt-1">
        <button
          type="button"
          disabled
          title="Connect to real data to enable this action"
          className="w-full rounded-lg gradient-primary px-3 py-2 text-xs font-semibold text-primary-foreground opacity-60"
        >
          {variant === "apply" ? "Apply Now" : "View Job"}
        </button>
      </div>
    </GlassCard>
  );
}
