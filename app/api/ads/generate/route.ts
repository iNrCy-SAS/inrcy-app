import { NextResponse } from "next/server";
import { aiGenerateJSON } from "@/lib/aiGatewayClient";
import { createAiOperationBudget } from "@/lib/aiGatewayPolicy";
import { reserveAiCredits, commitAiCredits, rollbackAiCredits, type AiCreditReservation } from "@/lib/aiUsageQuota";
import { adsBadOriginResponse, adsPilotOnlyResponse, adsRequestOriginAllowed, isAdsChannelUserAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import { enforceRateLimit } from "@/lib/rateLimit";
import { DEFAULT_AI_PREFERRED_ENGINE } from "@/lib/aiEnginePreference";
import {
  buildAdsCopyInput,
  buildAdsCopySystemPrompt,
  generateSuggestedAdsCopyWithRepair,
  parseAdsCopyChannel,
} from "@/lib/adsCopy";

export const maxDuration = 60;

export async function POST(request: Request) {
  const deadlineAt = Date.now() + (maxDuration - 10) * 1_000;
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  // `channel` is the stable channel identifier for the multi-channel wizard.
  // Keep accepting the original { provider: "meta" | "google" } payload.
  const channel = parseAdsCopyChannel(body.channel === undefined ? body.provider : body.channel);
  const brief = String(body.brief || "").trim().slice(0, 1200);
  const brand = String(body.brand || "").trim().slice(0, 120);
  if (!channel || brief.length < 15) return NextResponse.json({ error: "Choisissez un canal et décrivez votre offre en au moins 15 caractères." }, { status: 400 });
  if (!(await isAdsChannelUserAllowed(user.authUserId, user.activeUserId, channel))) return adsPilotOnlyResponse();

  const limited = await enforceRateLimit({ name: "ads_generate", identifier: user.authUserId, limit: 30, window: "1 d" });
  if (limited) return limited;
  let reservation: AiCreditReservation | null = null;
  try {
    const quota = await reserveAiCredits({ supabase: user.supabase, userId: user.activeUserId, action: "ads", credits: 1 });
    if (quota.errorResponse) return quota.errorResponse;
    reservation = quota.reservation;
    const budget = createAiOperationBudget("ads.generate");
    const copy = await generateSuggestedAdsCopyWithRepair(channel, (repairInstruction, attempt) => aiGenerateJSON({
      feature: "ads.generate",
      accountId: user.activeUserId,
      budget,
      engine: DEFAULT_AI_PREFERRED_ENGINE,
      system: buildAdsCopySystemPrompt(channel),
      input: [buildAdsCopyInput(channel, brand, brief), repairInstruction].filter(Boolean).join("\n\n"),
      maxOutputTokens: 1400,
      temperature: 0.6,
      deadlineAt,
      timeoutMs: attempt === 0 ? 28_000 : 17_000,
    }));
    if (!copy) {
      await rollbackAiCredits(reservation);
      return NextResponse.json({ error: "La proposition IA n’est pas exploitable. Réessayez ou rédigez l’annonce manuellement." }, { status: 502 });
    }
    await commitAiCredits(reservation);
    return NextResponse.json({ copy, channel, creditsUsed: 1, requiresReview: true });
  } catch {
    await rollbackAiCredits(reservation);
    return NextResponse.json({ error: "La génération IA n’a pas pu aboutir." }, { status: 502 });
  }
}
