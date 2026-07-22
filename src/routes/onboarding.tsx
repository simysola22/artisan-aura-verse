/**
 * Onboarding — new authenticated users who have not yet created a profile
 * are redirected here to complete their initial setup.
 *
 * Flow:
 *   1. Auth guard — anonymous → /auth/login
 *   2. Profile check — if profile already exists → /dashboard (no re-onboarding)
 *   3. Role-specific form:
 *      - Provider: headline, about, location, skills, availability, rate
 *      - Employer: displayName, org name, industry, description, location, website
 *   4. On submit → create profile → navigate to /dashboard
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard } from "@/components/glass/glass";
import { useAuth } from "@/features/auth/auth-context";
import { providersApi, employersApi } from "@/api";
import type { CreateProviderProfileInput } from "@/api/providers";
import type { CreateEmployerProfileInput } from "@/api/employers";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Welcome to PMP — Set up your profile" }] }),
  component: OnboardingPage,
});

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition-colors";

const labelCls = "block text-sm font-medium mb-1";

// ─── Provider onboarding form ─────────────────────────────────────────────────

interface ProviderFormState {
  headline: string;
  about: string;
  location: string;
  serviceArea: string;
  availability: "available" | "limited" | "unavailable";
  hourlyRate: string;
  currency: string;
  skillsRaw: string; // comma-separated
}

function ProviderOnboardingForm({
  providerKind,
  onSuccess,
}: {
  providerKind: "artisan" | "professional";
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<ProviderFormState>({
    headline: "",
    about: "",
    location: "",
    serviceArea: "",
    availability: "available",
    hourlyRate: "",
    currency: "NGN",
    skillsRaw: "",
  });

  const setField = (field: keyof ProviderFormState, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const mutation = useMutation({
    mutationFn: () => {
      const input: CreateProviderProfileInput = {
        kind: providerKind,
        headline: form.headline || undefined,
        about: form.about || undefined,
        location: form.location || undefined,
        serviceArea: form.serviceArea || undefined,
        availability: form.availability,
        hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : undefined,
        currency: form.currency || undefined,
        isPublic: true,
      };
      return providersApi.createProfile(input);
    },
    onSuccess,
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="space-y-5"
    >
      <div>
        <label className={labelCls}>Professional headline *</label>
        <input
          required
          value={form.headline}
          onChange={(e) => setField("headline", e.target.value)}
          placeholder={
            providerKind === "artisan"
              ? "e.g. Licensed Electrician · Solar & Wiring Specialist"
              : "e.g. Senior Full-Stack Developer"
          }
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>About / Bio</label>
        <textarea
          rows={4}
          value={form.about}
          onChange={(e) => setField("about", e.target.value)}
          placeholder="Describe your experience, specialties, and what you bring to the table…"
          className={inputCls}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Location *</label>
          <input
            required
            value={form.location}
            onChange={(e) => setField("location", e.target.value)}
            placeholder="City, Country"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Service area</label>
          <input
            value={form.serviceArea}
            onChange={(e) => setField("serviceArea", e.target.value)}
            placeholder="Where you serve clients"
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Availability</label>
          <select
            value={form.availability}
            onChange={(e) =>
              setField("availability", e.target.value as ProviderFormState["availability"])
            }
            className={inputCls}
          >
            <option value="available">Available</option>
            <option value="limited">Limited availability</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Hourly rate</label>
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              value={form.hourlyRate}
              onChange={(e) => setField("hourlyRate", e.target.value)}
              placeholder="0"
              className={inputCls}
            />
            <input
              value={form.currency}
              onChange={(e) => setField("currency", e.target.value)}
              placeholder="NGN"
              className={`w-20 shrink-0 rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30`}
            />
          </div>
        </div>
      </div>

      {mutation.isError && (
        <p className="text-sm text-destructive">
          {mutation.error instanceof Error ? mutation.error.message : "Failed to save profile. Please try again."}
        </p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending}
        className="w-full rounded-lg gradient-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-crimson transition-opacity hover:opacity-95 disabled:opacity-60"
      >
        {mutation.isPending ? (
          <span className="inline-flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Setting up your profile…
          </span>
        ) : (
          "Complete setup"
        )}
      </button>
    </form>
  );
}

// ─── Employer onboarding form ─────────────────────────────────────────────────

interface EmployerFormState {
  displayName: string;
  organizationName: string;
  industry: string;
  description: string;
  location: string;
  websiteUrl: string;
  employerType: "individual" | "organization";
}

function EmployerOnboardingForm({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState<EmployerFormState>({
    displayName: "",
    organizationName: "",
    industry: "",
    description: "",
    location: "",
    websiteUrl: "",
    employerType: "individual",
  });

  const setField = (field: keyof EmployerFormState, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const mutation = useMutation({
    mutationFn: () => {
      const input: CreateEmployerProfileInput = {
        employerType: form.employerType,
        displayName: form.displayName || undefined,
        organizationName: form.organizationName || undefined,
        industry: form.industry || undefined,
        description: form.description || undefined,
        location: form.location || undefined,
        websiteUrl: form.websiteUrl || undefined,
        isPublic: true,
      };
      return employersApi.createProfile(input);
    },
    onSuccess,
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="space-y-5"
    >
      <div>
        <label className={labelCls}>Account type</label>
        <select
          value={form.employerType}
          onChange={(e) =>
            setField("employerType", e.target.value as EmployerFormState["employerType"])
          }
          className={inputCls}
        >
          <option value="individual">Individual / Homeowner</option>
          <option value="organization">Company / Organization</option>
        </select>
      </div>

      <div>
        <label className={labelCls}>Your name *</label>
        <input
          required
          value={form.displayName}
          onChange={(e) => setField("displayName", e.target.value)}
          placeholder="Your public name"
          className={inputCls}
        />
      </div>

      {form.employerType === "organization" && (
        <div>
          <label className={labelCls}>Company / Organization name</label>
          <input
            value={form.organizationName}
            onChange={(e) => setField("organizationName", e.target.value)}
            placeholder="Company or business name"
            className={inputCls}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Industry / Sector</label>
          <input
            value={form.industry}
            onChange={(e) => setField("industry", e.target.value)}
            placeholder="e.g. Construction, Technology"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Location *</label>
          <input
            required
            value={form.location}
            onChange={(e) => setField("location", e.target.value)}
            placeholder="City, Country"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>About your company / hiring needs</label>
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => setField("description", e.target.value)}
          placeholder="Tell providers about your company and the kind of work you typically need done…"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Website</label>
        <input
          type="url"
          value={form.websiteUrl}
          onChange={(e) => setField("websiteUrl", e.target.value)}
          placeholder="https://…"
          className={inputCls}
        />
      </div>

      {mutation.isError && (
        <p className="text-sm text-destructive">
          {mutation.error instanceof Error ? mutation.error.message : "Failed to save profile. Please try again."}
        </p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending}
        className="w-full rounded-lg gradient-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-crimson transition-opacity hover:opacity-95 disabled:opacity-60"
      >
        {mutation.isPending ? (
          <span className="inline-flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Setting up your profile…
          </span>
        ) : (
          "Complete setup"
        )}
      </button>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function OnboardingPage() {
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const [done, setDone] = useState(false);

  // Auth guard
  useEffect(() => {
    if (status === "anon") {
      void navigate({ to: "/auth/login", replace: true });
    }
  }, [status, navigate]);

  // Ops users don't need onboarding — send straight to dashboard
  useEffect(() => {
    if (status === "authed" && user?.role === "ops") {
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [status, user, navigate]);

  // Check if profile already exists — if so, skip onboarding
  const profileCheck = useQuery({
    queryKey: ["onboarding-profile-check", user?.role],
    queryFn: async () => {
      if (!user) return null;
      if (user.role === "provider") {
        return providersApi.getOwnProfile().catch((e) => {
          if ((e as { status?: number }).status === 404) return null;
          throw e;
        });
      }
      if (user.role === "employer") {
        return employersApi.getProfile().catch((e) => {
          if ((e as { status?: number }).status === 404) return null;
          throw e;
        });
      }
      return null;
    },
    enabled: status === "authed" && !!user && user.role !== "ops",
    retry: false,
  });

  // Already has a profile — redirect to dashboard
  useEffect(() => {
    if (profileCheck.isSuccess && profileCheck.data !== null) {
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [profileCheck.isSuccess, profileCheck.data, navigate]);

  const handleSuccess = () => {
    setDone(true);
    setTimeout(() => {
      void navigate({ to: "/dashboard", replace: true });
    }, 1500);
  };

  if (status === "loading" || status === "syncing" || profileCheck.isLoading) {
    return (
      <PublicShell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </PublicShell>
    );
  }

  if (status === "anon") return null;

  if (done) {
    return (
      <PublicShell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
          <CheckCircle2 className="h-12 w-12 text-primary" />
          <p className="text-lg font-semibold">Profile created!</p>
          <p className="text-sm text-muted-foreground">Taking you to your dashboard…</p>
        </div>
      </PublicShell>
    );
  }

  const isProvider = user?.role === "provider";
  const providerKind = isProvider
    ? ((user as { kind?: string }).kind as "artisan" | "professional") ?? "artisan"
    : "artisan";

  return (
    <PublicShell>
      <div className="mx-auto max-w-xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-4">
            <Sparkles className="h-4 w-4" />
            Welcome to PMP
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Set up your {isProvider ? "provider" : "employer"} profile
          </h1>
          <p className="mt-2 text-muted-foreground">
            {isProvider
              ? "Help employers find and trust you. You can add more details later."
              : "Tell providers about yourself so they can respond to your jobs."}
          </p>
        </div>

        <GlassCard className="p-6 sm:p-8">
          {isProvider ? (
            <ProviderOnboardingForm providerKind={providerKind} onSuccess={handleSuccess} />
          ) : (
            <EmployerOnboardingForm onSuccess={handleSuccess} />
          )}
        </GlassCard>
      </div>
    </PublicShell>
  );
}
