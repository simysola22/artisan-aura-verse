import { BadgeCheck, Clock, MapPin, Star } from "lucide-react";
import { GlassCard } from "@/components/glass/glass";
import type { DemoTalent } from "./demo-data";

const verificationLabel: Record<DemoTalent["verificationStatus"], string> = {
  verified: "Verified",
  in_review: "In review",
  unverified: "Unverified",
};

export function TalentCard({ talent }: { talent: DemoTalent }) {
  const initials = talent.displayName
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <GlassCard className="flex flex-col gap-4 p-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl gradient-primary text-lg font-semibold text-primary-foreground select-none">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold">{talent.displayName}</h3>
            {talent.verificationStatus === "verified" && (
              <BadgeCheck
                className="h-4 w-4 shrink-0 text-primary"
                aria-label="Verified provider"
              />
            )}
          </div>
          <p className="text-sm text-muted-foreground">{talent.category}</p>
        </div>
        <span
          className={[
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
            talent.verificationStatus === "verified"
              ? "bg-success/15 text-success"
              : talent.verificationStatus === "in_review"
                ? "bg-warning/15 text-warning"
                : "bg-muted text-muted-foreground",
          ].join(" ")}
        >
          {verificationLabel[talent.verificationStatus]}
        </span>
      </div>

      {/* Skills */}
      <div className="flex flex-wrap gap-1.5">
        {talent.skills.map((s) => (
          <span
            key={s}
            className="rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground"
          >
            {s}
          </span>
        ))}
      </div>

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" />
          {talent.location}
        </span>
        {talent.ratingAverage !== null ? (
          <span className="inline-flex items-center gap-1">
            <Star className="h-3.5 w-3.5 fill-current text-warning" />
            {talent.ratingAverage.toFixed(1)}
            {talent.ratingCount > 0 && <span>({talent.ratingCount})</span>}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {talent.yearsExperience}yr exp
        </span>
      </div>

      {/* Actions */}
      <div className="mt-auto flex gap-2">
        <button
          type="button"
          disabled
          title="Connect to real data to enable this action"
          className="flex-1 rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:pointer-events-none disabled:opacity-60"
        >
          View Profile
        </button>
        <button
          type="button"
          disabled
          title="Connect to real data to enable this action"
          className="flex-1 rounded-lg gradient-primary px-3 py-2 text-xs font-semibold text-primary-foreground opacity-60"
        >
          Contact
        </button>
      </div>
    </GlassCard>
  );
}
