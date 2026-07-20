import type { Provider } from "@/types";
import { Link } from "@tanstack/react-router";
import { BadgeCheck, MapPin, Sparkles, Star } from "lucide-react";
import { GlassCard } from "@/components/glass/glass";

const availabilityLabel: Record<NonNullable<Provider["availability"]>, string> = {
  available: "Available",
  limited: "Limited",
  unavailable: "Unavailable",
};

export function ProviderCard({ provider }: { provider: Provider }) {
  const initials = provider.displayName
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");

  return (
    <Link
      to="/providers/$providerId"
      params={{ providerId: provider.id }}
      className="group block focus-visible:outline-none"
    >
      <GlassCard className="flex h-full flex-col gap-4 p-5 transition-all duration-300 group-hover:shadow-glass group-hover:-translate-y-0.5">
        <div className="flex items-start gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl gradient-primary text-lg font-semibold text-primary-foreground">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-sm font-semibold">{provider.displayName}</h3>
              {provider.verification === "verified" ? (
                <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-label="Verified" />
              ) : null}
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">{provider.headline}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground capitalize">
            {provider.kind}
          </span>
          {provider.skills.slice(0, 3).map((s) => (
            <span
              key={s.id}
              className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {s.name}
            </span>
          ))}
        </div>

        <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            {provider.ratingAverage ? (
              <span className="inline-flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-current text-warning" />
                {provider.ratingAverage.toFixed(1)}
                {provider.ratingCount ? <span>({provider.ratingCount})</span> : null}
              </span>
            ) : null}
            {provider.serviceArea ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {provider.serviceArea}
              </span>
            ) : null}
          </div>
          {provider.availability ? (
            <span className="inline-flex items-center gap-1 text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-success" />
              {availabilityLabel[provider.availability]}
            </span>
          ) : null}
        </div>
      </GlassCard>
    </Link>
  );
}
