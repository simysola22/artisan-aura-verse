import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

/**
 * Glass surface primitives. Use these instead of ad-hoc `bg-white/10`
 * classes in components. All styling flows through design tokens
 * (`--glass`, `--border-glass`, shadow tokens), so theme swaps carry over.
 */

export function GlassCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "glass-surface rounded-2xl shadow-glass-sm",
        "transition-shadow duration-300",
        className,
      )}
      {...props}
    />
  );
}

export function GlassPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("glass-surface-strong rounded-3xl shadow-glass", className)} {...props} />
  );
}

export function GlassNav({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <nav className={cn("glass-surface-strong rounded-2xl shadow-glass-sm", className)} {...props} />
  );
}
