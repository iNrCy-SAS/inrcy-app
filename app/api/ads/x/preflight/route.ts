import { NextResponse } from "next/server";
import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import { XAdsConnectionError } from "@/lib/adsXServer";
import { checkXAdsCampaignPreparation } from "@/lib/adsXResourcesServer";
import { normalizeXAdsNativeSelections, xAdsResourceId } from "@/lib/adsXResources";
import { parseAdsCampaignInput } from "@/lib/adsValidation";
import { enforceRateLimit } from "@/lib/rateLimit";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) { const known = error instanceof XAdsConnectionError ? error : null; return json({ ready: false, publicationEnabled: false, error: known?.message || "Le contrôle X Ads est momentanément indisponible.", code: known?.code || "provider_unavailable" }, known?.status || 503); }
async function access() {
  const result = await requirePremiumAdsUser("x"); if (!result.user || result.errorResponse) return result;
  const limited = await enforceRateLimit({ name: "ads_x_preflight", identifier: result.user.activeUserId, limit: 30, fallbackLimit: 15, window: "5 m", code: "x_preflight_rate_limit" });
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return { user: null, errorResponse: limited }; } return result;
}
/** Both methods only read native resources. POST accepts the full draft for accurate readiness. */
export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await access(); if (!user || errorResponse) return errorResponse;
  const raw = await request.text(); if (raw.length > 65_536) return json({ error: "Le brouillon X est trop volumineux." }, 400);
  let body: unknown; try { body = JSON.parse(raw); } catch { return json({ error: "Brouillon X invalide." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "draft")) return json({ error: "Contrôle X invalide." }, 400);
  const parsed = parseAdsCampaignInput((body as { draft: unknown }).draft, { purpose: "draft" });
  if (!parsed.draft || parsed.draft.provider !== "x") return json({ error: parsed.error || "Le canal du brouillon doit être X." }, 400);
  try { return json(await checkXAdsCampaignPreparation(user.activeUserId, { accountId: parsed.draft.adAccountId, draft: parsed.draft, selections: parsed.draft.xNativeSelections })); } catch (error) { return failure(error); }
}
export async function GET(request: Request) {
  const { user, errorResponse } = await access(); if (!user || errorResponse) return errorResponse;
  const params = new URL(request.url).searchParams, accountId = params.get("accountId") || undefined, raw = params.get("selections");
  let selections = null;
  if (raw) { if (raw.length > 16_384) return json({ error: "Sélections X invalides." }, 400); try { const checked = normalizeXAdsNativeSelections(JSON.parse(raw)); if (checked.error) return json({ error: checked.error }, 400); selections = checked.selections; } catch { return json({ error: "Sélections X invalides." }, 400); } }
  if (accountId && !xAdsResourceId(accountId)) return json({ error: "Compte X invalide." }, 400);
  try { return json(await checkXAdsCampaignPreparation(user.activeUserId, { accountId, selections })); } catch (error) { return failure(error); }
}
