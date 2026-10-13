import { NextResponse } from "next/server";
import { createAiMediaServerQuote } from "@/lib/aiMediaCreditQuoteServer";
import { getAiMediaQuotaSnapshot, AiMediaGenerationQuotaError } from "@/lib/aiMediaGenerationQuota";
import { presentAiMediaQuotaCounter } from "@/lib/aiMediaQuotaPresentation";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { isAdminUserForAi } from "@/lib/aiUsageQuota";
import { getAiMediaVideoEntitlement } from "@/lib/aiMediaVideoEntitlementServer";
import type { AiMediaCreditsQuoteInput } from "@/lib/aiMediaCreditsPricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: Request) {
  try {
    const current = await getCurrentInrcyAccountScope();
    if (!current) return NextResponse.json({ ok: false, code: "UNAUTHORIZED", error: "Non authentifié." }, { status: 401, headers });
    const raw = await request.text();
    if (raw.length > 8_192) return NextResponse.json({ ok: false, error: "Demande de devis trop longue." }, { status: 413, headers });
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("Devis invalide.");
    const input = body as AiMediaCreditsQuoteInput;
    const { activeUserId, authUserId } = current.scope;
    const edition = await getDashboardEditionForAccountId(activeUserId);
    const [quota, unlimited] = await Promise.all([
      getAiMediaQuotaSnapshot({ accountId: activeUserId, actorAuthUserId: authUserId, edition }),
      isAdminUserForAi(current.supabase, authUserId),
    ]);
    if (!quota.creditsReady) return NextResponse.json({ ok: false, code: "AI_MEDIA_CREDITS_NOT_READY", error: "Le portefeuille de crédits média doit être activé avant la génération." }, { status: 503, headers });
    const quote = createAiMediaServerQuote(activeUserId, input);
    if (input.kind === "video" && !unlimited) {
      const entitlement = await getAiMediaVideoEntitlement({ accountId: activeUserId, edition });
      if ((quote.durationSeconds || 8) > entitlement.maxDurationSeconds) return NextResponse.json({ ok: false, code: "AI_MEDIA_VIDEO_DURATION_NOT_ALLOWED", error: "Cette durée dépasse le plafond de votre établissement." }, { status: 403, headers });
    }
    return NextResponse.json({ ok: true, quote, credits: presentAiMediaQuotaCounter(quota.credits, unlimited), creditsReady: true }, { headers });
  } catch (error) {
    if (error instanceof AiMediaGenerationQuotaError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.httpStatus, headers });
    if (error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError || (error instanceof Error && error.message.startsWith("ai_media_"))) return NextResponse.json({ ok: false, code: "AI_MEDIA_QUOTE_INVALID", error: "Ces paramètres ne sont pas disponibles pour le moteur choisi." }, { status: 400, headers });
    console.error("[ai-media] credit quote unavailable", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, code: "AI_MEDIA_QUOTE_UNAVAILABLE", error: "Le devis est momentanément indisponible." }, { status: 503, headers });
  }
}
