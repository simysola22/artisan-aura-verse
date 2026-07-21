import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { LifeBuoy, Users, ShieldCheck, Flag, Gauge, Cog, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/features/theme/theme-toggle";
import { useAuth } from "@/features/auth/auth-context";

const items = [
  { to: "/ops", label: "Overview", icon: Gauge },
  { to: "/ops/verification", label: "Verification queue", icon: ShieldCheck },
  { to: "/ops/moderation", label: "Moderation", icon: Flag },
  { to: "/ops/support", label: "Support", icon: LifeBuoy },
  { to: "/ops/users", label: "Users", icon: Users },
] as const;

/**
 * Private operations shell.
 *
 * Frontend auth guard: redirects unauthenticated users and non-ops accounts
 * to the home page before rendering the shell.
 * Backend authorization is still authoritative — every ops API call is
 * permission-gated server-side regardless of what the frontend renders.
 */
export function OpsShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { status, user } = useAuth();
  const navigate = useNavigate();

  // Redirect non-ops users once auth state is resolved.
  useEffect(() => {
    if (status === "loading") return;
    if (status === "anon" || user?.role !== "ops") {
      void navigate({ to: "/" });
    }
  }, [status, user, navigate]);

  // Show a spinner while auth is loading or while redirecting.
  if (status === "loading" || status === "anon" || user?.role !== "ops") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh grid-cols-1 bg-background md:grid-cols-[260px_1fr]">
      <aside className="hidden border-r border-border/60 bg-sidebar text-sidebar-foreground md:flex md:flex-col">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="grid h-8 w-8 place-items-center rounded-lg gradient-primary text-primary-foreground">
            <Cog className="h-4 w-4" />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">PMP Ops</span>
            <span className="text-xs text-muted-foreground">Internal only</span>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {items.map((i) => {
            const active = pathname === i.to || (i.to !== "/ops" && pathname.startsWith(i.to));
            return (
              <Link
                key={i.to}
                to={i.to}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
              >
                <i.icon className="h-4 w-4" />
                {i.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-4 text-xs text-muted-foreground">
          Authorization is enforced by the backend.
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border/60 px-4 md:px-6">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
              Internal
            </span>
            <span className="text-sm text-muted-foreground">Operations console</span>
          </div>
          <ThemeToggle />
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
