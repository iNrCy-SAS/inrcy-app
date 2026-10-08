import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { TikTokAdsConnectionError } from "@/lib/adsTikTokServer";
import { checkTikTokAdsTrafficPreparation } from "@/lib/adsTikTokResourcesServer";
import { normalizeTikTokAdsLocationIds, parseTikTokAdsIdentities, type TikTokAdsIdentity } from "@/lib/adsTikTokResources";
import { enforceRateLimit } from "@/lib/rateLimit";
import { parseAdsCampaignInput } from "@/lib/adsValidation";
import { checkTikTokAdsCampaignPreparation } from "@/lib/adsTikTokCampaignPreparationServer";
import { TikTokTrafficPublisherError } from "@/lib/adsTikTokPublisherCore";

/** Verifies read-only selections. This route cannot create or enable any advertisement. */
export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("tiktok");
  if (!user || errorResponse) return errorResponse;
  const limited = await enforceRateLimit({ name: "ads_tiktok_preflight", identifier: user.activeUserId, limit: 30, fallbackLimit: 15, window: "5 m", code: "tiktok_preflight_rate_limit" });
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  const params = new URL(request.url).searchParams, accountId = params.get("accountId") || undefined;
  const rawLocations = params.get("locationIds") || "[]", rawIdentity = params.get("identity");
  let locationIds: string[] | null = null, identity: TikTokAdsIdentity | null = null, identityValid = !rawIdentity;
  if (rawLocations.length <= 2048) { try { locationIds = normalizeTikTokAdsLocationIds(JSON.parse(rawLocations)); } catch { /* Invalid JSON is rejected before any provider read. */ } }
  if (rawIdentity && rawIdentity.length <= 1024) {
    try {
      const selected = JSON.parse(rawIdentity);
      if (selected && typeof selected === "object" && !Array.isArray(selected)) {
        const rows = parseTikTokAdsIdentities({ data: { identity_list: [{ identity_id: selected.id, identity_type: selected.type, identity_authorized_bc_id: selected.authorizedBusinessCenterId }] } });
        identity = rows?.[0] || null; identityValid = Boolean(identity);
      }
    } catch { /* Invalid identity is rejected rather than replaced. */ }
  }
  if ((accountId && !/^\d{5,30}$/.test(accountId)) || !locationIds || !identityValid) return NextResponse.json({ error: "Le compte, l’identité ou les zones TikTok Ads sont invalides.", code: "invalid_preparation_selection" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try { return NextResponse.json(await checkTikTokAdsTrafficPreparation(user.activeUserId, { accountId, identity, locationIds }), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const failure = error instanceof TikTokAdsConnectionError ? error : null;
    return NextResponse.json({ error: failure?.message || "Le contrôle TikTok Ads n’a pas pu être effectué.", code: failure?.code || "provider_unavailable" }, { status: failure?.status || 503, headers: { "Cache-Control": "no-store" } });
  }
}

/** POST carries a complete draft for a read-only check; no draft or native object is saved. */
export async function POST(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("tiktok");
  if (!user || errorResponse) return errorResponse;
  const limited = await enforceRateLimit({ name: "ads_tiktok_campaign_preflight", identifier: user.activeUserId, limit: 30, fallbackLimit: 15, window: "5 m", code: "tiktok_preflight_rate_limit" });
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 65_536) throw new Error();
    body = JSON.parse(raw);
  } catch { return NextResponse.json({ error: "Le brouillon TikTok Ads est invalide.", code: "invalid_tiktok_draft" }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  const row = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const parsed = row && Object.keys(row).length === 1 && Object.hasOwn(row, "draft") ? parseAdsCampaignInput(row.draft, { purpose: "draft" }) : { draft: null, error: "Vérifiez le brouillon TikTok Ads." };
  if (!parsed.draft || parsed.draft.provider !== "tiktok") return NextResponse.json({ error: parsed.error || "Ce contrôle est réservé à TikTok Ads.", code: "invalid_tiktok_draft" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try { return NextResponse.json(await checkTikTokAdsCampaignPreparation(user.activeUserId, parsed.draft), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const failure = error instanceof TikTokAdsConnectionError ? error : null;
    const invalid = error instanceof TikTokTrafficPublisherError && error.code === "native_selections_invalid";
    return NextResponse.json({ error: failure?.message || (invalid ? "Complétez les choix natifs TikTok Ads du brouillon." : "Le contrôle TikTok Ads n’a pas pu être effectué."), code: failure?.code || (invalid ? "native_selections_invalid" : "provider_unavailable") }, { status: failure?.status || (invalid ? 400 : 503), headers: { "Cache-Control": "no-store" } });
  }
}
