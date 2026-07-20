import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AuthShell } from "@/layouts/AuthShell";
import { useAuth } from "@/features/auth/auth-context";

export const Route = createFileRoute("/auth/recover")({
  head: () => ({ meta: [{ title: "Recover access — PMP" }] }),
  component: RecoverPage,
});

function RecoverPage() {
  const { recover } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await recover(email);
    setSent(true);
  }

  return (
    <AuthShell
      title="Recover access"
      subtitle="We'll email you a secure link to reset your password."
      footer={
        <Link to="/auth/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <p className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm">
          If an account exists for <b>{email}</b>, a recovery email is on its way.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <label htmlFor="email" className="block text-sm font-medium">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
          <button
            type="submit"
            className="w-full rounded-lg gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-crimson hover:opacity-95"
          >
            Send recovery email
          </button>
        </form>
      )}
    </AuthShell>
  );
}
