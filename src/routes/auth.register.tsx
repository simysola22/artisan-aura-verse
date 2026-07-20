import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthShell } from "@/layouts/AuthShell";
import { useAuth } from "@/features/auth/auth-context";
import { Briefcase, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth/register")({
  head: () => ({ meta: [{ title: "Create your account — PMP" }] }),
  component: RegisterPage,
});

function RegisterPage() {
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
