import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { SignUp } from "@clerk/clerk-react";
import { AuthShell } from "@/layouts/AuthShell";
import { useAuth } from "@/features/auth/auth-context";
import { storePendingRegistration } from "@/features/auth/pending-registration";
import { Briefcase, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { USE_MOCK_API } from "@/api/client";

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

// ─── Real mode: role picker → Clerk SignUp ────────────────────────────────────

function ClerkRegisterPage() {
  const [role, setRole] = useState<"employer" | "provider">("employer");
  const [step, setStep] = useState<"role" | "signup">("role");

  function handleContinue() {
    // Store the selected role so the auth context can provision the PMP identity
    // after Clerk's sign-up flow completes and the Clerk session becomes active.
    storePendingRegistration({ accountType: role });
    setStep("signup");
  }

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
          {/* Compact role reminder with change option */}
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
            <SignUp
              afterSignUpUrl="/dashboard"
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
  const { register } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<"employer" | "provider">("employer");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
  if (USE_MOCK_API) return <MockRegisterPage />;
  return <ClerkRegisterPage />;
}
