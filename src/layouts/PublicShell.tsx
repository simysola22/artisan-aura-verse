import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Briefcase, CreditCard, Home, LayoutDashboard, Loader2, MessageSquare, Search, ShieldCheck, User } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GlassNav } from "@/components/glass/glass";
import { ThemeToggle } from "@/features/theme/theme-toggle";
import { useAuth } from "@/features/auth/auth-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const primary = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/search", label: "Discover", icon: Search },
  { to: "/messages", label: "Messages", icon: MessageSquare },
  { to: "/verification", label: "Verification", icon: ShieldCheck },
] as const;

function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const initials = (user?.displayName ?? "")
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

  async function handleSignOut() {
    await logout();
    void navigate({ to: "/", replace: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full gradient-primary text-sm font-semibold text-primary-foreground shadow-crimson ring-offset-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Account menu"
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold leading-tight">
              {user?.displayName || "My Account"}
            </span>
            {user?.email ? (
              <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            ) : null}
            <span className="mt-0.5 text-[11px] capitalize text-primary">
              {user?.role ?? ""}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account" className="cursor-pointer">
            <User className="mr-2 h-4 w-4" />
            My Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/billing" className="cursor-pointer">
            <CreditCard className="mr-2 h-4 w-4" />
            Billing & Plans
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => void handleSignOut()}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { status, user, logout } = useAuth();
  const navigate = useNavigate();
  const authed = status === "authed";
  const loading = status === "loading";

  async function handleSignOut() {
    await logout();
    void navigate({ to: "/", replace: true });
  }

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
            <span>PMP</span>
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
              : !loading && (
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
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : authed ? (
              <AccountMenu />
            ) : (
              <>
                <Link
                  to="/auth/login"
                  className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent"
                >
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
      <div className="sticky top-0 z-40 flex items-center justify-between glass-surface-strong px-4 py-3 md:hidden">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-xl gradient-primary text-primary-foreground shadow-crimson">
            <Home className="h-4 w-4" />
          </span>
          PMP
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : authed ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full gradient-primary text-sm font-semibold text-primary-foreground shadow-crimson"
                  aria-label="Account menu"
                >
                  {(user?.displayName ?? "")
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase() || "?"}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">{user?.displayName || "My Account"}</span>
                    {user?.email ? (
                      <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                    ) : null}
                    <span className="mt-0.5 text-[11px] capitalize text-primary">{user?.role ?? ""}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/account" className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    My Account
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/billing" className="cursor-pointer">
                    <CreditCard className="mr-2 h-4 w-4" />
                    Billing & Plans
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => void handleSignOut()}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link
              to="/auth/login"
              className="rounded-xl glass-surface px-3 py-2 text-sm font-medium"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>

      <main id="main" className="mx-auto w-full max-w-7xl px-4 pb-32 pt-4 md:pt-8">
        {children}
      </main>

      {/* Mobile bottom tabs — deliberate mobile UX, not a shrunk desktop nav */}
      {authed ? (
        <div
          className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 md:hidden"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <GlassNav className="mx-auto grid max-w-lg grid-cols-4 gap-1 p-1.5">
            {primary.map((item) => {
              const active = pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-label={item.label}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium text-muted-foreground transition-colors",
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
