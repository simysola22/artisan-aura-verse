import { Link, useRouterState } from "@tanstack/react-router";
import { Home, LayoutDashboard, MessageSquare, Search, ShieldCheck, User } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GlassNav } from "@/components/glass/glass";
import { ThemeToggle } from "@/features/theme/theme-toggle";
import { useAuth } from "@/features/auth/auth-context";

const primary = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/search", label: "Discover", icon: Search },
  { to: "/messages", label: "Messages", icon: MessageSquare },
  { to: "/verification", label: "Verification", icon: ShieldCheck },
] as const;

export function PublicShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { status, user, logout } = useAuth();
  const authed = status === "authed";

  return (
    <div className="relative min-h-dvh bg-background bg-aurora">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {/* Top nav — desktop / tablet */}
      <div className="sticky top-0 z-40 hidden px-4 pt-4 md:block">
        <GlassNav className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2">
          <Link to="/" className="mr-4 flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-lg gradient-primary text-primary-foreground shadow-crimson">
              <Home className="h-4 w-4" />
            </span>
            <span>Kraftly</span>
          </Link>
          <div className="flex items-center gap-1">
            {authed
              ? primary.map((item) => {
                  const active = pathname.startsWith(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                        active && "bg-accent text-accent-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })
              : (
                  [
                    { to: "/for-employers", label: "For hirers" },
                    { to: "/for-providers", label: "For providers" },
                    { to: "/how-it-works", label: "How it works" },
                  ] as const
                ).map((l) => (
                  <Link
                    key={l.to}
                    to={l.to}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    {l.label}
                  </Link>
                ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {authed ? (
              <>
                <Link
                  to="/account"
                  className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent"
                >
                  <User className="h-4 w-4" />
                  {user?.displayName}
                </Link>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link to="/auth/login" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent">
                  Sign in
                </Link>
                <Link
                  to="/auth/register"
                  className="rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson hover:opacity-95"
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </GlassNav>
      </div>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between px-4 py-3 md:hidden">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg gradient-primary text-primary-foreground">
            <Home className="h-4 w-4" />
          </span>
          Kraftly
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {!authed ? (
            <Link
              to="/auth/login"
              className="rounded-lg glass-surface px-3 py-2 text-sm font-medium"
            >
              Sign in
            </Link>
          ) : null}
        </div>
      </div>

      <main id="main" className="mx-auto w-full max-w-7xl px-4 pb-28 pt-4 md:pt-8">
        {children}
      </main>

      {/* Mobile bottom tabs — deliberate mobile UX, not a shrunk desktop nav */}
      {authed ? (
        <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 md:hidden">
          <GlassNav className="mx-auto grid max-w-lg grid-cols-4 gap-1 p-1">
            {primary.map((item) => {
              const active = pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-label={item.label}
                  className={cn(
                    "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[11px] font-medium text-muted-foreground",
                    active && "bg-accent text-accent-foreground",
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </Link>
              );
            })}
          </GlassNav>
        </div>
      ) : null}
    </div>
  );
}
