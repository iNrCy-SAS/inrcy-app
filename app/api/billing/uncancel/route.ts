import { NextResponse } from "next/server";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";

import { requireUser } from "@/lib/requireUser";
import {
  restoreSubscriptionRenewalForUser,
  SubscriptionCancellationError,
} from "@/lib/scheduleSubscriptionCancellation";

/**
 * Annule une résiliation programmée, qu'elle utilise cancel_at (mensuel avec
 * mois de préavis) ou cancel_at_period_end (annuel).
 * La DB est ensuite remise à jour (pour un UI immédiat) — le webhook Stripe fera foi ensuite.
 */
export async function POST() {
  try {
    const { user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    await restoreSubscriptionRenewalForUser(user.id);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if (e instanceof SubscriptionCancellationError) {
      return NextResponse.json(
        { error: e.message, code: e.code, provider: e.provider },
        { status: e.code === "NO_ACTIVE_SUBSCRIPTION" ? 400 : 409 },
      );
    }
    const msg = getSimpleFrenchErrorMessage(e, "Le service est momentanément indisponible. Merci de réessayer dans quelques minutes.");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
