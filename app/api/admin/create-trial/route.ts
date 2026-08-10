import { NextResponse } from "next/server";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendAdminSubscriptionAlertForUser } from "@/lib/subscriptionAdmin";
import { ensureNotificationPreferences, seedOnboardingNotifications } from "@/lib/notifications";
import { ensureTrialSubscription } from "@/lib/trialSubscription";
import { ensureProfileRow } from "@/lib/ensureProfileRow";
import { requireAdminApi } from "@/lib/adminSecurity";
import { provisionNewAccountBubbleAccess } from "@/lib/appBubbleAccessProvisioning";
import {
  hasKnownInrcyAccountForEmail,
  isExistingAuthUserError,
} from "@/lib/supabaseAuthBusinessErrors";

export const runtime = "nodejs";

/**
 * Admin endpoint to create a trial user + subscription row.
 * V1: admin connecté obligatoire. ADMIN_SECRET reste accepté uniquement comme secours technique serveur.
 */
export async function POST(req: Request) {
  try {
    const secret = process.env.ADMIN_SECRET;
    const got = req.headers.get("x-admin-secret") || "";
    const hasValidSecret = Boolean(secret && got === secret);

    if (!hasValidSecret) {
      const admin = await requireAdminApi();
      if (!admin.ok) return admin.response;
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();

    if (!email) return NextResponse.json({ error: "Email manquant." }, { status: 400 });

    if (await hasKnownInrcyAccountForEmail(email)) {
      return NextResponse.json(
        {
          error:
            "Un compte existe déjà avec cet email. Utilise le renvoi de lien ou “Mot de passe oublié”.",
        },
        { status: 409 },
      );
    }

    const appOrigin = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://app.inrcy.com").replace(/\/$/, "");
    const { data: invite, error: invErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${appOrigin}/auth/finish-invite`,
    });

    if (invErr) {
      if (isExistingAuthUserError(invErr)) {
        return NextResponse.json(
          {
            error:
              "Un compte existe déjà avec cet email. Utilise le renvoi de lien ou “Mot de passe oublié”.",
          },
          { status: 409 },
        );
      }
      throw invErr;
    }

    const userId = invite.user.id;

    // New accounts always start from the canonical Bubble Access defaults.
    await provisionNewAccountBubbleAccess(userId);
    await ensureProfileRow(invite.user);
    await ensureNotificationPreferences(userId);
    await seedOnboardingNotifications(userId);
    const { edition, trialDays, start, end } = await ensureTrialSubscription(userId, email);

    await sendAdminSubscriptionAlertForUser({
      type: "trial_started",
      source: "admin.create-trial",
      userId,
      accountEmail: email,
      profileContactEmail: email,
      plan: "Trial",
      status: "trialing",
      trialStartAt: start.toISOString(),
      trialEndAt: end.toISOString(),
      note: `Invitation envoyée pour un essai de ${trialDays} jours.`,
    }).catch(() => null);

    return NextResponse.json({ ok: true, user_id: userId, app_edition: edition, trial_end_at: end.toISOString() });
  } catch (e: unknown) {
    const msg = getSimpleFrenchErrorMessage(e, "Le service est momentanément indisponible. Merci de réessayer dans quelques minutes.");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
