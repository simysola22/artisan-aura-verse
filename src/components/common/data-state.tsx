import { cn } from "@/lib/utils";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export function LoadingState({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground",
        className,
      )}
    >
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/60 py-16 px-6 text-center",
        className,
      )}
    >
      <div className="rounded-full bg-muted p-3 text-muted-foreground">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 py-12 px-6 text-center",
        className,
      )}
    >
      <div className="rounded-full bg-destructive/10 p-3 text-destructive">
        <AlertCircle className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}

interface DataStateBoundaryProps {
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  loadingLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  onRetry?: () => void;
  children: ReactNode;
}

export function DataStateBoundary({
  loading,
  error,
  empty,
  loadingLabel,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  onRetry,
  children,
}: DataStateBoundaryProps) {
  if (loading) return <LoadingState label={loadingLabel} />;
  if (error)
    return (
      <ErrorState
        description={error instanceof Error ? error.message : "Please try again in a moment."}
        action={
          onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Try again
            </button>
          ) : null
        }
      />
    );
  if (empty) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return <>{children}</>;
}
