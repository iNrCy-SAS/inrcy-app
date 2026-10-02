import "server-only";

import type { NextResponse } from "next/server";
import { isAuthorizedCronRequest, getCronUserIdFromRequest } from "@/lib/cronAuth";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { getActiveSubscriptionAccountIds } from "@/lib/accountSubscriptionAccess";

export type InrAgentResolvedRequest = {
  supabase: any;
  user: { id: string; email?: string | null };
  userId: string;
  authUserId: string;
  body: Record<string, unknown> | null;
  isCron: boolean;
  errorResponse: NextResponse | null;
};

function asBodyRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function resolveInrAgentActionRequest(request: Request): Promise<InrAgentResolvedRequest> {
  const body = asBodyRecord(await request.json().catch(() => null));
  const cronUserId = isAuthorizedCronRequest(request) ? getCronUserIdFromRequest(request, body) : "";

  if (cronUserId) {
    let subscriptionErrorResponse: NextResponse | null = null;
    try {
      const activeAccountIds = await getActiveSubscriptionAccountIds([cronUserId]);
      if (!activeAccountIds.has(cronUserId)) {
        subscriptionErrorResponse = jsonUserFacingError(
          "Période d’essai expirée ou abonnement inactif.",
          { status: 403, code: "subscription_inactive" },
        );
      }
    } catch {
      subscriptionErrorResponse = jsonUserFacingError(
        "Vérification de l’abonnement indisponible.",
        { status: 503, code: "subscription_check_unavailable" },
      );
    }
    return {
      supabase: supabaseAdmin,
      user: { id: cronUserId },
      userId: cronUserId,
      authUserId: cronUserId,
      body,
      isCron: true,
      errorResponse: subscriptionErrorResponse,
    };
  }

  if (isAuthorizedCronRequest(request)) {
    return {
      supabase: null,
      user: { id: "" },
      userId: "",
      authUserId: "",
      body,
      isCron: true,
      errorResponse: jsonUserFacingError("Utilisateur iNr’Agent invalide pour le cron.", { status: 400, code: "invalid_cron_user" }),
    };
  }

  const { supabase, user, authUserId, activeUserId, errorResponse } = await requireUser();
  return {
    supabase,
    user,
    userId: activeUserId || "",
    authUserId: authUserId || user?.id || "",
    body,
    isCron: false,
    errorResponse,
  };
}
