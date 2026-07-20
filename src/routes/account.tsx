import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard } from "@/components/glass/glass";
import { useAuth } from "@/features/auth/auth-context";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Account — Kraftly" }] }),
  component: AccountPage,
});

function AccountPage() {
  const { user, logout } = useAuth();
  return (
    <PublicShell>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Account</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <GlassCard className="p-6">
          <h2 className="text-base font-semibold">Profile</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Name</dt><dd>{user?.displayName ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Email</dt><dd>{user?.email ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Role</dt><dd className="capitalize">{user?.role ?? "—"}</dd></div>
          </dl>
        </GlassCard>
        <GlassCard className="p-6">
          <h2 className="text-base font-semibold">Session</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign out on this device. Full session management arrives with the backend.
          </p>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-4 rounded-lg border border-input px-4 py-2 text-sm hover:bg-accent"
          >
            Sign out
          </button>
        </GlassCard>
      </div>
    </PublicShell>
  );
}
