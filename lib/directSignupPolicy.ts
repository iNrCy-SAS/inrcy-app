export const DIRECT_SIGNUP_METADATA_KEY = "inrcy_direct_signup_v1";
export const DIRECT_SIGNUP_ACTIVATION_PATH = "/activer-mon-compte";

export type DirectSignupMetadata = { version: 1; entry: "basique"; created_at: string };
export type DirectSignupSubscription = {
  status?: string | null; stripe_subscription_id?: string | null;
  plan?: string | null; billing_cycle?: string | null;
};

/** Server-written app metadata only; campaign parameters cannot grant access. */
export function getDirectSignupMetadata(value: unknown): DirectSignupMetadata | null {
  if (!value || typeof value !== "object") return null;
  const marker = (value as Record<string, unknown>)[DIRECT_SIGNUP_METADATA_KEY];
  if (!marker || typeof marker !== "object") return null;
  const candidate = marker as Partial<DirectSignupMetadata>;
  return candidate.version === 1 && candidate.entry === "basique"
    && typeof candidate.created_at === "string" && Number.isFinite(Date.parse(candidate.created_at))
    ? candidate as DirectSignupMetadata : null;
}

/** A Checkout URL, browser return, or trial state is never payment proof. */
export function isDirectSignupPaid(subscription: DirectSignupSubscription | null | undefined): boolean {
  return subscription?.status?.trim().toLowerCase() === "active"
    && Boolean(subscription.stripe_subscription_id?.trim());
}

export function directSignupNeedsActivation(appMetadata: unknown, subscription: DirectSignupSubscription | null | undefined): boolean {
  return Boolean(getDirectSignupMetadata(appMetadata)) && !isDirectSignupPaid(subscription);
}
