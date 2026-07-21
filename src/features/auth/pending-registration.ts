/**
 * sessionStorage helpers for the two-step Clerk registration flow.
 *
 * The register page stores the selected accountType (and optionally displayName
 * and providerKind) before handing control to Clerk's <SignUp> component.
 * After Clerk's sign-up completes and the session becomes active, the auth
 * context reads these values to call POST /v1/auth/sync.
 */

export const PENDING_ACCOUNT_TYPE_KEY = "pmp.pending_account_type";
export const PENDING_DISPLAY_NAME_KEY = "pmp.pending_display_name";
export const PENDING_PROVIDER_KIND_KEY = "pmp.pending_provider_kind";

/**
 * Store pending registration data so the auth context can provision the PMP
 * identity after Clerk's sign-up flow completes.
 */
export function storePendingRegistration(opts: {
  accountType: "employer" | "provider";
  displayName?: string;
  providerKind?: "artisan" | "professional";
}): void {
  sessionStorage.setItem(PENDING_ACCOUNT_TYPE_KEY, opts.accountType);
  if (opts.displayName) sessionStorage.setItem(PENDING_DISPLAY_NAME_KEY, opts.displayName);
  if (opts.providerKind) sessionStorage.setItem(PENDING_PROVIDER_KIND_KEY, opts.providerKind);
}
