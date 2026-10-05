import {
  SIGNUP_TRIAL_COMPLETED_APP_METADATA_KEY,
  verifySignupRecoveryProof,
  type RecoveryClaim,
} from "./signupRecoveryProof.ts";

export type InterruptedInviteUser = {
  id: string;
  email?: string | null;
  invited_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

export type InterruptedInviteRecoveryDependencies<TUser extends InterruptedInviteUser> = {
  getAuthUser(userId: string): Promise<TUser | null>;
  hasSubscription(userId: string): Promise<boolean>;
  ensurePrincipal(user: TUser): Promise<void>;
  ensureBubbleDefaults(userId: string): Promise<void>;
  ensureProfile(user: TUser, claim: RecoveryClaim): Promise<void>;
  ensureBusinessLanguage(userId: string, user: TUser): Promise<void>;
  ensureNotificationPreferences(userId: string): Promise<void>;
  seedWelcomeNotifications(userId: string): Promise<void>;
  ensureMissingTrial(userId: string, email: string, claim: RecoveryClaim): Promise<void>;
  markCompleted(userId: string): Promise<void>;
  onExistingSubscriptionMarkerFailure?(userId: string, error: unknown): void;
};

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** The signed public signup snapshot authorizes recovery, not user_metadata alone. */
export function getInterruptedPublicSignupClaim(
  user: InterruptedInviteUser | null,
  verifiedUserId: string,
  verifiedEmail: string | null,
  secret: string,
  nowMs = Date.now(),
): RecoveryClaim | null {
  if (!user || user.id !== verifiedUserId || !user.invited_at) return null;
  const email = normalizeEmail(user.email);
  if (!email || email !== normalizeEmail(verifiedEmail)) return null;

  const claim = verifySignupRecoveryProof(user.user_metadata, secret, nowMs);
  if (!claim || normalizeEmail(claim.snapshot.email) !== email) return null;
  return claim;
}

/**
 * Existing completion markers cannot produce another trial even if the
 * subscription row disappeared. A retried insert uses the original signed
 * trial window, so it cannot extend access after a partial failure.
 */
export async function recoverInterruptedPublicInviteSignup<TUser extends InterruptedInviteUser>(
  verifiedUserId: string,
  verifiedEmail: string | null,
  secret: string,
  dependencies: InterruptedInviteRecoveryDependencies<TUser>,
  nowMs = Date.now(),
): Promise<"already_claimed" | "already_provisioned" | "ineligible" | "recovered"> {
  const user = await dependencies.getAuthUser(verifiedUserId);
  const claim = getInterruptedPublicSignupClaim(user, verifiedUserId, verifiedEmail, secret, nowMs);
  if (!user || !claim) return "ineligible";

  if (user.app_metadata?.[SIGNUP_TRIAL_COMPLETED_APP_METADATA_KEY]) return "already_claimed";
  if (await dependencies.hasSubscription(user.id)) {
    try {
      await dependencies.markCompleted(user.id);
    } catch (error) {
      dependencies.onExistingSubscriptionMarkerFailure?.(user.id, error);
    }
    return "already_provisioned";
  }

  await dependencies.ensurePrincipal(user);
  await dependencies.ensureBubbleDefaults(user.id);
  await dependencies.ensureProfile(user, claim);
  await dependencies.ensureBusinessLanguage(user.id, user);
  await dependencies.ensureNotificationPreferences(user.id);
  await dependencies.seedWelcomeNotifications(user.id);
  await dependencies.ensureMissingTrial(user.id, normalizeEmail(user.email), claim);
  await dependencies.markCompleted(user.id);

  return "recovered";
}
