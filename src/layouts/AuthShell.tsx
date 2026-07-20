import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { GlassPanel } from "@/components/glass/glass";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative grid min-h-dvh place-items-center bg-background bg-aurora px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2 font-semibold">
          <span className="grid h-9 w-9 place-items-center rounded-lg gradient-primary text-primary-foreground shadow-crimson">
            P
          </span>
          <span className="text-lg tracking-tight">Precious Market Place</span>
        </Link>
        <GlassPanel className="p-8">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </GlassPanel>
        {footer ? <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div> : null}
      </div>
    </div>
  );
}
