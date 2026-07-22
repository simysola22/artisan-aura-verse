import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SignIn } from "@clerk/clerk-react";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/layouts/AuthShell";
import { useAuth } from "@/features/auth/auth-context";
import { CLERK_PUBLISHABLE_KEY } from "@/api/client";

export const Route = createFileRoute("/auth/login")({
  head: () => ({ meta: [{ title: "Sign in — PMP" }] }),
  component: LoginPage,
});

// ─── Real mode: Clerk SignIn embedded in our shell ────────────────────────────

function ClerkLoginPage() {
  const { status } = useAuth();
  const navigate = useNavigate();

  // Already authenticated → go straight to workspace.
  useEffect(() => {
    if (status === "authed") {
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [status, navigate]);

  // Clerk resolving session or PMP syncing — don't flash the sign-in form
  // to a user who is already signed in.
  if (status === "loading" || status === "syncing") {
    return (
      <AuthShell title="Signing you in…" subtitle="Just a moment while we load your account.">
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

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to continue to your workspace."
      footer={
        <>
          New here?{" "}
          <Link to="/auth/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <div className="flex justify-center">
        <SignIn
          forceRedirectUrl="/dashboard"
          routing="hash"
          appearance={{
            elements: {
              card: "shadow-none bg-transparent p-0",
              rootBox: "w-full",
            },
          }}
        />
      </div>
    </AuthShell>
  );
}

// ─── Mock mode: existing email / password form ────────────────────────────────

function MockLoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
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
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate({ to: "/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
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
      title="Welcome back"
      subtitle="Sign in to continue to your workspace."
      footer={
        <>
          New here?{" "}
          <Link to="/auth/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
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
          {loading ? "Signing in…" : "Sign in"}
        </button>
        <div className="text-center text-sm">
          <Link to="/auth/recover" className="text-muted-foreground hover:text-foreground">
            Forgot your password?
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

function LoginPage() {
  if (!CLERK_PUBLISHABLE_KEY) return <MockLoginPage />;
  return <ClerkLoginPage />;
}
