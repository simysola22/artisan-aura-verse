import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Plus, Trash2, CheckCircle } from "lucide-react";
import { PublicShell } from "@/layouts/PublicShell";
import { GlassCard } from "@/components/glass/glass";
import { useAuth } from "@/features/auth/auth-context";
import { providersApi, employersApi } from "@/api";
import type { UpdateProviderProfileInput } from "@/api/providers";
import type { UpdateEmployerProfileInput } from "@/api/employers";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Account — PMP" }] }),
  component: AccountPage,
});

// ─── Small helpers ────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-50";
const selectCls =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

// ─── Provider profile editor ──────────────────────────────────────────────────

function ProviderProfileEditor() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["own-provider-profile"],
    queryFn: async () => {
      const res = await providersApi.getOwnProfile();
      return res.profile;
    },
  });

  const [form, setForm] = useState<UpdateProviderProfileInput>({});
  const [saved, setSaved] = useState(false);

  // Seed form once data arrives
  useEffect(() => {
    if (q.data) {
      setForm({
        headline: q.data.headline ?? "",
        about: q.data.about ?? "",
        location: q.data.location ?? "",
        serviceArea: q.data.serviceArea ?? "",
        availability: q.data.availability ?? "available",
        hourlyRate: q.data.hourlyRate ?? undefined,
        currency: q.data.currency ?? "NGN",
        yearsOfExperience: q.data.yearsOfExperience ?? undefined,
        isPublic: q.data.isPublic ?? true,
      });
    }
  }, [q.data]);

  const update = useMutation({
    mutationFn: (input: UpdateProviderProfileInput) => providersApi.updateProfile(input),
    onSuccess: (data) => {
      // Update cache directly from the response so the UI reflects the saved
      // state immediately, then also invalidate to ensure freshness.
      qc.setQueryData(["own-provider-profile"], data.profile);
      qc.invalidateQueries({ queryKey: ["own-provider-profile"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  // ── Experience mutations ───────────────────────────────────────────────────
  const [expForm, setExpForm] = useState({
    role: "",
    organization: "",
    startDate: "",
    endDate: "",
    description: "",
  });
  const addExp = useMutation({
    mutationFn: () =>
      providersApi.addExperience({
        role: expForm.role,
        organization: expForm.organization,
        startDate: expForm.startDate,
        endDate: expForm.endDate || undefined,
        description: expForm.description || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["own-provider-profile"] });
      setExpForm({ role: "", organization: "", startDate: "", endDate: "", description: "" });
    },
  });
  const removeExp = useMutation({
    mutationFn: (id: string) => providersApi.deleteExperience(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["own-provider-profile"] }),
  });

  // ── Certification mutations ────────────────────────────────────────────────
  const [certForm, setCertForm] = useState({
    name: "",
    issuer: "",
    issuedAt: "",
    evidenceUrl: "",
  });
  const addCert = useMutation({
    mutationFn: () =>
      providersApi.addCertification({
        name: certForm.name,
        issuer: certForm.issuer,
        issuedAt: certForm.issuedAt,
        evidenceUrl: certForm.evidenceUrl || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["own-provider-profile"] });
      setCertForm({ name: "", issuer: "", issuedAt: "", evidenceUrl: "" });
    },
  });
  const removeCert = useMutation({
    mutationFn: (id: string) => providersApi.deleteCertification(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["own-provider-profile"] }),
  });

  // ── Portfolio mutations ────────────────────────────────────────────────────
  const [portForm, setPortForm] = useState({ title: "", description: "", mediaUrl: "" });
  const addPort = useMutation({
    mutationFn: () =>
      providersApi.addPortfolioItem({
        title: portForm.title,
        mediaUrl: portForm.mediaUrl,
        description: portForm.description || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["own-provider-profile"] });
      setPortForm({ title: "", description: "", mediaUrl: "" });
    },
  });
  const removePort = useMutation({
    mutationFn: (id: string) => providersApi.deletePortfolioItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["own-provider-profile"] }),
  });

  if (q.isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (q.error) {
    return (
      <p className="text-sm text-destructive">
        Failed to load profile.{" "}
        <button onClick={() => q.refetch()} className="underline">
          Retry
        </button>
      </p>
    );
  }

  function patch<K extends keyof UpdateProviderProfileInput>(
    key: K,
    val: UpdateProviderProfileInput[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  return (
    <div className="space-y-6">
      {/* ── Basic info ── */}
      <GlassCard className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Profile</h2>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle className="h-3.5 w-3.5" /> Saved
            </span>
          )}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Headline">
            <input
              className={inputCls}
              value={(form.headline as string) ?? ""}
              onChange={(e) => patch("headline", e.target.value)}
              placeholder="e.g. Senior Full-Stack Developer"
            />
          </Field>
          <Field label="Location">
            <input
              className={inputCls}
              value={(form.location as string) ?? ""}
              onChange={(e) => patch("location", e.target.value)}
              placeholder="City, Country"
            />
          </Field>
          <Field label="Service area">
            <input
              className={inputCls}
              value={(form.serviceArea as string) ?? ""}
              onChange={(e) => patch("serviceArea", e.target.value)}
              placeholder="Where you serve clients"
            />
          </Field>
          <Field label="Availability">
            <select
              className={selectCls}
              value={form.availability ?? "available"}
              onChange={(e) =>
                patch("availability", e.target.value as "available" | "limited" | "unavailable")
              }
            >
              <option value="available">Available</option>
              <option value="limited">Limited</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </Field>
          <Field label="Hourly rate">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={form.hourlyRate ?? ""}
              onChange={(e) => patch("hourlyRate", e.target.value ? Number(e.target.value) : undefined)}
              placeholder="0"
            />
          </Field>
          <Field label="Currency">
            <input
              className={inputCls}
              value={(form.currency as string) ?? "NGN"}
              onChange={(e) => patch("currency", e.target.value)}
              placeholder="NGN"
            />
          </Field>
          <Field label="Years of experience">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={form.yearsOfExperience ?? ""}
              onChange={(e) =>
                patch("yearsOfExperience", e.target.value ? Number(e.target.value) : undefined)
              }
              placeholder="0"
            />
          </Field>
          <Field label="Visibility">
            <select
              className={selectCls}
              value={form.isPublic ? "public" : "private"}
              onChange={(e) => patch("isPublic", e.target.value === "public")}
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="About">
              <textarea
                rows={4}
                className={inputCls}
                value={(form.about as string) ?? ""}
                onChange={(e) => patch("about", e.target.value)}
                placeholder="Tell clients about yourself…"
              />
            </Field>
          </div>
        </div>
        <button
          onClick={() => {
            // Convert empty strings to null so the backend z.string().min(1)
            // validator accepts the payload (it allows null | undefined but not "").
            const payload: UpdateProviderProfileInput = {
              ...form,
              headline: form.headline === "" ? null : form.headline,
              about: form.about === "" ? null : form.about,
              location: form.location === "" ? null : form.location,
              serviceArea: form.serviceArea === "" ? null : form.serviceArea,
              // currency must be 3 chars; omit if cleared rather than send ""
              currency: form.currency === "" ? undefined : form.currency,
            };
            update.mutate(payload);
          }}
          disabled={update.isPending}
          className="mt-4 inline-flex items-center gap-2 rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson disabled:opacity-60"
        >
          {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save changes
        </button>
        {update.isError && (
          <p className="mt-2 text-xs text-destructive">Failed to save. Please try again.</p>
        )}
      </GlassCard>

      {/* ── Experience ── */}
      <GlassCard className="p-6">
        <h2 className="text-base font-semibold">Experience</h2>
        {(q.data?.experience ?? []).length > 0 && (
          <ul className="mt-3 space-y-2">
            {q.data!.experience!.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 border-l-2 border-primary/40 pl-3">
                <div>
                  <div className="text-sm font-medium">{e.role}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.organization} · {new Date(e.startDate).getFullYear()}
                    {e.endDate ? `–${new Date(e.endDate).getFullYear()}` : " – present"}
                  </div>
                </div>
                <button
                  onClick={() => e.id && removeExp.mutate(e.id)}
                  disabled={removeExp.isPending}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                  aria-label="Remove experience"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Role">
            <input className={inputCls} value={expForm.role} onChange={(e) => setExpForm((f) => ({ ...f, role: e.target.value }))} placeholder="e.g. Software Engineer" />
          </Field>
          <Field label="Organization">
            <input className={inputCls} value={expForm.organization} onChange={(e) => setExpForm((f) => ({ ...f, organization: e.target.value }))} placeholder="Company or client" />
          </Field>
          <Field label="Start date">
            <input type="date" className={inputCls} value={expForm.startDate} onChange={(e) => setExpForm((f) => ({ ...f, startDate: e.target.value }))} />
          </Field>
          <Field label="End date (leave blank if current)">
            <input type="date" className={inputCls} value={expForm.endDate} onChange={(e) => setExpForm((f) => ({ ...f, endDate: e.target.value }))} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <textarea rows={2} className={inputCls} value={expForm.description} onChange={(e) => setExpForm((f) => ({ ...f, description: e.target.value }))} placeholder="What you did…" />
            </Field>
          </div>
        </div>
        <button
          onClick={() => addExp.mutate()}
          disabled={!expForm.role || !expForm.organization || !expForm.startDate || addExp.isPending}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add experience
        </button>
      </GlassCard>

      {/* ── Certifications ── */}
      <GlassCard className="p-6">
        <h2 className="text-base font-semibold">Certifications</h2>
        {(q.data?.certifications ?? []).length > 0 && (
          <ul className="mt-3 space-y-2">
            {q.data!.certifications!.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.issuer} · {new Date(c.issuedAt).getFullYear()}</div>
                </div>
                <button
                  onClick={() => c.id && removeCert.mutate(c.id)}
                  disabled={removeCert.isPending}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                  aria-label="Remove certification"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Certificate name">
            <input className={inputCls} value={certForm.name} onChange={(e) => setCertForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. AWS Certified Developer" />
          </Field>
          <Field label="Issuer">
            <input className={inputCls} value={certForm.issuer} onChange={(e) => setCertForm((f) => ({ ...f, issuer: e.target.value }))} placeholder="e.g. Amazon" />
          </Field>
          <Field label="Issued date">
            <input type="date" className={inputCls} value={certForm.issuedAt} onChange={(e) => setCertForm((f) => ({ ...f, issuedAt: e.target.value }))} />
          </Field>
          <Field label="Evidence URL (optional)">
            <input type="url" className={inputCls} value={certForm.evidenceUrl} onChange={(e) => setCertForm((f) => ({ ...f, evidenceUrl: e.target.value }))} placeholder="https://…" />
          </Field>
        </div>
        <button
          onClick={() => addCert.mutate()}
          disabled={!certForm.name || !certForm.issuer || !certForm.issuedAt || addCert.isPending}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add certification
        </button>
      </GlassCard>

      {/* ── Portfolio ── */}
      <GlassCard className="p-6">
        <h2 className="text-base font-semibold">Portfolio</h2>
        {(q.data?.portfolio ?? []).length > 0 && (
          <ul className="mt-3 space-y-2">
            {q.data!.portfolio!.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{p.title}</div>
                  {p.description && <div className="text-xs text-muted-foreground">{p.description}</div>}
                </div>
                <button
                  onClick={() => p.id && removePort.mutate(p.id)}
                  disabled={removePort.isPending}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                  aria-label="Remove portfolio item"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            <input className={inputCls} value={portForm.title} onChange={(e) => setPortForm((f) => ({ ...f, title: e.target.value }))} placeholder="Project name" />
          </Field>
          <Field label="Media URL">
            <input type="url" className={inputCls} value={portForm.mediaUrl} onChange={(e) => setPortForm((f) => ({ ...f, mediaUrl: e.target.value }))} placeholder="https://…" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description (optional)">
              <input className={inputCls} value={portForm.description} onChange={(e) => setPortForm((f) => ({ ...f, description: e.target.value }))} placeholder="Brief description" />
            </Field>
          </div>
        </div>
        <button
          onClick={() => addPort.mutate()}
          disabled={!portForm.title || !portForm.mediaUrl || addPort.isPending}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add portfolio item
        </button>
      </GlassCard>
    </div>
  );
}

// ─── Employer profile editor ──────────────────────────────────────────────────

function EmployerProfileEditor() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["own-employer-profile"],
    queryFn: async () => {
      const res = await employersApi.getProfile();
      return res.profile;
    },
  });

  const [form, setForm] = useState<UpdateEmployerProfileInput>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (q.data) {
      setForm({
        employerType: q.data.employerType ?? undefined,
        displayName: q.data.displayName ?? "",
        organizationName: q.data.organizationName ?? "",
        industry: q.data.industry ?? "",
        description: q.data.description ?? "",
        location: q.data.location ?? "",
        websiteUrl: q.data.websiteUrl ?? "",
        isPublic: q.data.isPublic ?? true,
      });
    }
  }, [q.data]);

  const update = useMutation({
    mutationFn: (input: UpdateEmployerProfileInput) => employersApi.updateProfile(input),
    onSuccess: (data) => {
      qc.setQueryData(["own-employer-profile"], data.profile);
      qc.invalidateQueries({ queryKey: ["own-employer-profile"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (q.isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (q.error) {
    return (
      <p className="text-sm text-destructive">
        Failed to load profile.{" "}
        <button onClick={() => q.refetch()} className="underline">
          Retry
        </button>
      </p>
    );
  }

  function patch<K extends keyof UpdateEmployerProfileInput>(
    key: K,
    val: UpdateEmployerProfileInput[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  return (
    <GlassCard className="p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Company Profile</h2>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircle className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Account type">
          <select
            className={selectCls}
            value={form.employerType ?? ""}
            onChange={(e) =>
              patch("employerType", (e.target.value || undefined) as "individual" | "organization" | undefined)
            }
          >
            <option value="">— Select —</option>
            <option value="individual">Individual</option>
            <option value="organization">Organization</option>
          </select>
        </Field>
        <Field label="Display name">
          <input
            className={inputCls}
            value={(form.displayName as string) ?? ""}
            onChange={(e) => patch("displayName", e.target.value)}
            placeholder="Your public name"
          />
        </Field>
        <Field label="Organization name">
          <input
            className={inputCls}
            value={(form.organizationName as string) ?? ""}
            onChange={(e) => patch("organizationName", e.target.value)}
            placeholder="Company or business name"
          />
        </Field>
        <Field label="Industry">
          <input
            className={inputCls}
            value={(form.industry as string) ?? ""}
            onChange={(e) => patch("industry", e.target.value)}
            placeholder="e.g. Technology"
          />
        </Field>
        <Field label="Location">
          <input
            className={inputCls}
            value={(form.location as string) ?? ""}
            onChange={(e) => patch("location", e.target.value)}
            placeholder="City, Country"
          />
        </Field>
        <Field label="Website">
          <input
            type="url"
            className={inputCls}
            value={(form.websiteUrl as string) ?? ""}
            onChange={(e) => patch("websiteUrl", e.target.value)}
            placeholder="https://…"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <textarea
              rows={4}
              className={inputCls}
              value={(form.description as string) ?? ""}
              onChange={(e) => patch("description", e.target.value)}
              placeholder="Tell providers about your company…"
            />
          </Field>
        </div>
        <Field label="Visibility">
          <select
            className={selectCls}
            value={form.isPublic ? "public" : "private"}
            onChange={(e) => patch("isPublic", e.target.value === "public")}
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </Field>
      </div>
      <button
        onClick={() => {
          // Convert empty strings to null so the backend z.string().min(1)
          // validator accepts the payload (it allows null | undefined but not "").
          const payload: UpdateEmployerProfileInput = {
            ...form,
            displayName: form.displayName === "" ? null : form.displayName,
            organizationName: form.organizationName === "" ? null : form.organizationName,
            industry: form.industry === "" ? null : form.industry,
            description: form.description === "" ? null : form.description,
            location: form.location === "" ? null : form.location,
            websiteUrl: form.websiteUrl === "" ? null : form.websiteUrl,
          };
          update.mutate(payload);
        }}
        disabled={update.isPending}
        className="mt-4 inline-flex items-center gap-2 rounded-lg gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-crimson disabled:opacity-60"
      >
        {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save changes
      </button>
      {update.isError && (
        <p className="mt-2 text-xs text-destructive">Failed to save. Please try again.</p>
      )}
    </GlassCard>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function AccountPage() {
  const { user, status, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "anon") {
      void navigate({ to: "/auth/login", replace: true });
    }
  }, [status, navigate]);

  if (status === "loading" || status === "syncing") {
    return (
      <PublicShell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </PublicShell>
    );
  }

  if (status === "anon") return null;

  return (
    <PublicShell>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Account</h1>

      {/* ── Identity card ── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-6">
          <GlassCard className="p-6">
            <h2 className="text-base font-semibold">Identity</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Name</dt>
                <dd>{user?.displayName ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="truncate max-w-[160px]">{user?.email ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Role</dt>
                <dd className="capitalize">{user?.role ?? "—"}</dd>
              </div>
            </dl>
          </GlassCard>

          <GlassCard className="p-6">
            <h2 className="text-base font-semibold">Session</h2>
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-3 rounded-lg border border-input px-4 py-2 text-sm hover:bg-accent"
            >
              Sign out
            </button>
          </GlassCard>
        </aside>

        {/* ── Profile editor (role-specific) ── */}
        <div>
          {user?.role === "provider" ? (
            <ProviderProfileEditor />
          ) : user?.role === "employer" ? (
            <EmployerProfileEditor />
          ) : (
            <GlassCard className="p-6">
              <p className="text-sm text-muted-foreground">Profile editing is not available for your account type.</p>
            </GlassCard>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
