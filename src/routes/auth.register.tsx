import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SignUp } from "@clerk/clerk-react";
import { Briefcase, Loader2, Wrench } from "lucide-react";
import { AuthShell } from "@/layouts/AuthShell";
import { useAuth } from "@/features/auth/auth-context";
import { storePendingRegistration } from "@/features/auth/pending-registration";
import { cn } from "@/lib/utils";
import { CLERK_PUBLISHABLE_KEY } from "@/api/client";
import { appUrl } from "@/lib/app-url";

export const Route = createFileRoute("/auth/register")({
  head: () => ({ meta: [{ title: "Create your account — PMP" }] }),
  component: RegisterPage,
});

const roleOptions = [
  {
    value: "employer" as const,
    label: "I want to hire",
    icon: Briefcase,
    description: "Find and message providers.",
  },
  {
    value: "provider" as const,
    label: "I offer services",
    icon: Wrench,
    description: "Artisan or professional.",
  },
];

// ─── Real mode: role picker → Clerk SignUp ─────────────────────────────────────

function ClerkRegisterPage() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<"employer" | "provider">("employer");
  const [step, setStep] = useState<"role" | "signup">("role");

  // If the user already has a fully authenticated PMP session, send them
  // straight to the workspace — do not let an existing session trigger a
  // new registration flow.
  useEffect(() => {
    if (status === "authed") {
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [status, navigate]);

  function handleContinue() {
    // Write the selected role to localStorage BEFORE Clerk's sign-up flow
    // starts. localStorage survives the full-page OAuth/email-verification
    // redirects that Clerk performs (sessionStorage does not).
    storePendingRegistration({ accountType: role });
    setStep("signup");
  }

  // While Clerk or PMP is resolving a session, show a neutral loading screen.
  // This prevents the sign-up form from flashing to an already-authenticated
  // user and prevents Clerk from auto-completing a signup for an existing session.
  if (status === "loading" || status === "syncing") {
    return (
      <AuthShell title="Setting up your account…" subtitle="Just a moment.">
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AuthShell>
    );
  }

  // Redirect in-flight — render nothing to avoid a flash.
  if (status === "authed") {
    return null;
  }

  // ── Step 2: Clerk SignUp widget ──
  if (step === "signup") {
    return (
      <AuthShell
        title="Create your account"
        subtitle="Complete your details to get started."
        footer={
          <>
            Already have an account?{" "}
            <Link to="/auth/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </>
        }
      >
        <div className="space-y-4">
          {/* Role reminder with change option */}
          <div className="flex items-center gap-2 rounded-lg border border-input bg-accent/40 px-3 py-2 text-sm">
            {role === "employer" ? (
              <Briefcase className="h-4 w-4 shrink-0 text-primary" />
            ) : (
              <Wrench className="h-4 w-4 shrink-0 text-primary" />
            )}
            <span>
              Joining as{" "}
              <span className="font-medium">{role === "employer" ? "hirer" : "provider"}</span>
            </span>
            <button
              type="button"
              onClick={() => setStep("role")}
              className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Change
            </button>
          </div>

          <div className="flex justify-center">
            {/*
              forceRedirectUrl sends the user to /dashboard after Clerk
              completes sign-up (including after Google OAuth and email
              verification redirects). The auth context's loadIdentity()
              then runs on /dashboard: it calls /v1/auth/sync using the
              accountType stored in localStorage above, creating the PMP
              identity with the correct role before the user sees anything.

              Must be an absolute URL — Clerk redirects from accounts.dev
              back to our origin, so a relative path cannot resolve.
            */}
            <SignUp
              forceRedirectUrl={appUrl("/dashboard")}
              routing="hash"
              appearance={{
                elements: {
                  card: "shadow-none bg-transparent p-0",
                  rootBox: "w-full",
                },
              }}
            />
          </div>
        </div>
      </AuthShell>
    );
  }

  // ── Step 1: Role picker ──
  return (
    <AuthShell
      title="Create your account"
      subtitle="It takes a minute. You can complete your profile after."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/auth/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <fieldset>
          <legend className="mb-2 block text-sm font-medium">I'm joining as</legend>
          <div className="grid grid-cols-2 gap-2">
            {roleOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setRole(o.value)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border border-input p-3 text-left transition-colors hover:bg-accent",
                  role === o.value && "border-primary bg-primary/5",
                )}
                aria-pressed={role === o.value}
              >
                <o.icon className={cn("h-4 w-4", role === o.value && "text-primary")} />
                <span className="text-sm font-semibold">{o.label}</span>
                <span className="text-xs text-muted-foreground">{o.description}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          onClick={handleContinue}
          className="w-full rounded-lg gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-crimson transition-opacity hover:opacity-95"
        >
          Continue
        </button>
      </div>
    </AuthShell>
  );
}

// ─── Mock mode: existing email / password / role form ─────────────────────────

function MockRegisterPage() {
  const { register, status } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<"employer" | "provider">("employer");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status === "authed") {
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [status, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await register({ email, password, displayName, role });
      navigate({ to: role === "provider" ? "/verification" : "/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setLoading(false);
    }
  }

  if (status === "loading") {
    return (
      <AuthShell title="Loading…" subtitle="">
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="It takes a minute. You can complete your profile after."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/auth/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <fieldset>
          <legend className="mb-2 block text-sm font-medium">I'm joining as</legend>
          <div className="grid grid-cols-2 gap-2">
            {roleOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setRole(o.value)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border border-input p-3 text-left transition-colors hover:bg-accent",
                  role === o.value && "border-primary bg-primary/5",
                )}
                aria-pressed={role === o.value}
              >
                <o.icon className={cn("h-4 w-4", role === o.value && "text-primary")} />
                <span className="text-sm font-semibold">{o.label}</span>
                <span className="text-xs text-muted-foreground">{o.description}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium">
            Full name
          </label>
          <input
            id="displayName"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
          <p className="mt-1 text-xs text-muted-foreground">At least 8 characters.</p>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-crimson transition-opacity hover:opacity-95 disabled:opacity-60"
        >
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}

function RegisterPage() {
  if (!CLERK_PUBLISHABLE_KEY) return <MockRegisterPage />;
  return <ClerkRegisterPage />;
}
