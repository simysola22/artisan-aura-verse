/**
 * Public API surface. Feature code MUST import from here (or the individual
 * domain files), never from `./mock/*`. When a real backend is wired in,
 * swap the mock adapter calls for `apiFetch(...)` in each domain file.
 */
export * from "./client";
export * as authApi from "./auth";
export * as providersApi from "./providers";
export * as employersApi from "./employers";
export * as searchApi from "./search";
export * as verificationApi from "./verification";
export * as messagingApi from "./messaging";
export * as usersApi from "./users";
export * as subscriptionsApi from "./subscriptions";
export * as referenceApi from "./reference";
export * as jobsApi from "./jobs";
export * as opsApi from "./ops";
