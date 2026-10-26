import "server-only";

import { requireUser } from "@/lib/requireUser";
import { getActiveSubscriptionAccountIds } from "@/lib/accountSubscriptionAccess";

export type InrAssistantMediaAccess =
  | { allowed: true; accountId: string; authUserId: string }
  | { allowed: false; code: "auth_required" | "subscription_inactive" | "subscription_check_unavailable"; message: string };

/**
 * New paid work requires an active subscription; conversational billing help
 * and recovery of previously paid media remain available. Resolve ownership
 * through the same canonical account policy as existing background actions.
 */
export async function checkInrAssistantMediaGenerationAccess(): Promise<InrAssistantMediaAccess> {
  try {
    const auth = await requireUser();
    if (auth.errorResponse || !auth.activeUserId || !auth.authUserId) {
      return { allowed: false, code: "auth_required", message: "Votre session doit être rétablie avant de créer un média. Reconnectez-vous puis réessayez." };
    }
    const active = await getActiveSubscriptionAccountIds([auth.activeUserId]);
    if (!active.has(auth.activeUserId)) {
      return { allowed: false, code: "subscription_inactive", message: "La création de médias nécessite un abonnement actif ou un essai en cours. Je peux vous aider à consulter ou réactiver votre abonnement." };
    }
    return { allowed: true, accountId: auth.activeUserId, authUserId: auth.authUserId };
  } catch {
    return { allowed: false, code: "subscription_check_unavailable", message: "Je ne peux pas vérifier votre abonnement pour le moment. La création du média est suspendue ; je peux toujours vous guider dans votre compte." };
  }
}
