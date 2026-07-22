import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard, GlassPanel } from "@/components/glass/glass";
import { billingApi, type Plan, type Subscription } from "@/api/subscriptions";
import { useAuth } from "@/features/auth/auth-context";
import { BadgeCheck, CheckCircle2, CreditCard, Loader2, Settings, Zap } from "lucide-react";

export const Route = createFileRoute("/billing")({
  head: () => ({ meta: [{ title: "Billing & Plans — PMP" }] }),
  component: BillingPage,
});

function formatAmount(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
    }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toLocaleString()}`;
  }
}

function PlanCard({
  plan,
  current,
  onSelect,
  isPending,
}: {
  plan: Plan;
  current: Subscription | null;
  onSelect: (planId: string) => void;
  isPending: boolean;
}) {
  const isActive =
    current?.planId === plan.id && (current.status === "active" || current.status === "trialing");

  return (
    <GlassCard className={`flex flex-col gap-4 p-6 ${isActive ? "ring-2 ring-primary" : ""}`}>
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold">{plan.name}</h3>
          {isActive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <CheckCircle2 className="h-3 w-3" /> Current plan
            </span>
          )}
        </div>
        {plan.description && (
          <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
        )}
      </div>

      <div>
        <span className="text-3xl font-bold">
          {formatAmount(plan.amountMinor, plan.currency)}
        </span>
        <span className="ml-1 text-sm text-muted-foreground">/ {plan.billingInterval}</span>
      </div>

      <button
        onClick={() => onSelect(plan.id)}
        disabled={isPending || isActive}
        className="mt-auto rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson transition-opacity hover:opacity-95 disabled:opacity-50"
      >
        {isPending ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Preparing checkout…
          </span>
        ) : isActive ? (
          "Active"
        ) : (
          "Choose plan"
        )}
      </button>
    </GlassCard>
  );
}

function BillingUnavailable() {
  return (
    <PublicShell>
      <header className="mb-8">
        <div className="flex items-center gap-2 text-sm text-primary font-medium mb-1">
          <Zap className="h-4 w-4" />
          Billing & Plans
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Billing unavailable</h1>
        <p className="mt-2 text-muted-foreground max-w-xl">
          Online payments are not yet enabled for this deployment.
        </p>
      </header>

      <GlassPanel className="flex items-start gap-4 p-6 max-w-lg">
        <Settings className="h-6 w-6 text-muted-foreground shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium">Payment provider not configured</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The <code className="rounded bg-muted px-1 py-0.5 text-xs">PAYSTACK_SECRET_KEY</code>{" "}
            environment variable has not been set on the server. All other PMP features — jobs,
            profiles, messaging, and verification — work normally.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            To enable billing, add the secret key to your backend environment and restart the
            server.
          </p>
        </div>
      </GlassPanel>
    </PublicShell>
  );
}

function BillingPage() {
  const { status } = useAuth();
  const navigate = useNavigate();

  // Auth guard
  useEffect(() => {
    if (status === "anon") {
      void navigate({ to: "/auth/login", replace: true });
    }
  }, [status, navigate]);

  // Check whether the payment provider is configured — no auth required.
  // This query runs immediately so we can gate the rest of the UI without
  // making any payment-related requests that might fail or mislead the user.
  const statusQuery = useQuery({
    queryKey: ["billing-status"],
    queryFn: billingApi.getBillingStatus,
    staleTime: 60_000,
  });

  const plansQuery = useQuery({
    queryKey: ["billing-plans"],
    queryFn: billingApi.listPlans,
    enabled: status === "authed" && statusQuery.data?.paymentsEnabled === true,
  });

  const billingQuery = useQuery({
    queryKey: ["my-billing"],
    queryFn: billingApi.getMyBilling,
    enabled: status === "authed" && statusQuery.data?.paymentsEnabled === true,
    // 404 is expected when user has no billing history — treat as empty
    retry: (count, err) => {
      const httpStatus = (err as { status?: number }).status;
      if (httpStatus === 404) return false;
      return count < 2;
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async (planId: string) => {
      const callbackUrl = `${window.location.origin}/billing`;
      const result = await billingApi.initializeCheckout(planId, callbackUrl);
      return result;
    },
    onSuccess: (data) => {
      window.location.href = data.authorizationUrl;
    },
  });

  if (status === "loading" || status === "syncing") {
    return (
      <PublicShell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </PublicShell>
    );
  }

  if (status === "anon") return null;

  // Show unavailable panel when the backend confirms payments are off.
  // We only show this after the status query settles so we don't flash it
  // during the initial load; while it's loading we fall through to the
  // normal skeleton (plans loading state).
  if (statusQuery.isSuccess && !statusQuery.data.paymentsEnabled) {
    return <BillingUnavailable />;
  }

  const subscription = billingQuery.data?.subscription ?? null;
  const recentPayments = billingQuery.data?.recentPayments ?? [];

  return (
    <PublicShell>
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-2 text-sm text-primary font-medium mb-1">
          <Zap className="h-4 w-4" />
          Billing & Plans
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Choose your plan</h1>
        <p className="mt-2 text-muted-foreground max-w-xl">
          Unlock the full PMP marketplace experience. All plans include access to the core
          features — upgrade for priority placement, more applications, and premium tools.
        </p>
      </header>

      {/* Current subscription status */}
      {subscription && (
        <GlassPanel className="mb-8 p-5">
          <div className="flex items-center gap-3">
            <BadgeCheck className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="text-sm font-medium">
                Active plan: <span className="text-primary">{subscription.planName}</span>
              </p>
              {subscription.currentPeriodEnd && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                  {subscription.status === "trialing" && " · Trial period"}
                </p>
              )}
            </div>
          </div>
        </GlassPanel>
      )}

      {/* Checkout error */}
      {checkoutMutation.isError && (
        <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {checkoutMutation.error instanceof Error
            ? checkoutMutation.error.message
            : "Could not start checkout. Please check that Paystack is configured and try again."}
        </div>
      )}

      {/* Plans */}
      {plansQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading plans…
        </div>
      ) : plansQuery.isError ? (
        <GlassCard className="p-8 text-center text-sm text-muted-foreground">
          <p>Could not load plans. Please check that the backend is running and try again.</p>
          <button
            onClick={() => plansQuery.refetch()}
            className="mt-3 text-primary hover:underline"
          >
            Retry
          </button>
        </GlassCard>
      ) : !plansQuery.data?.length ? (
        <GlassCard className="p-8 text-center text-sm text-muted-foreground">
          <p>No plans are currently available. Check back soon.</p>
        </GlassCard>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {plansQuery.data.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              current={subscription}
              onSelect={(planId) => checkoutMutation.mutate(planId)}
              isPending={checkoutMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Payment history */}
      {recentPayments.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-lg font-semibold tracking-tight flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            Recent payments
          </h2>
          <GlassCard className="overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {recentPayments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-medium">
                      {formatAmount(p.amountMinor, p.currency)}
                    </td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">{p.status}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>
        </section>
      )}
    </PublicShell>
  );
}
