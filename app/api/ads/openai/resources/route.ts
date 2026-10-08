import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { readOpenaiAdsDeliveryResources } from "@/lib/adsOpenaiServer";
import { OpenaiAdsPublishError } from "@/lib/adsOpenaiConnector";
import { enforceRateLimit } from "@/lib/rateLimit";
const headers = { "Cache-Control": "no-store" };
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("openai");
  if (errorResponse || !user) return errorResponse;
  const limited = await enforceRateLimit({ name: "ads_openai_resources", identifier: user.activeUserId, limit: 30, fallbackLimit: 15, window: "5 m", code: "openai_ads_resources_rate_limit" });
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") || "").trim();
  const accountId = (params.get("accountId") || "").trim();
  let queries: unknown = [];
  try { if (params.has("queries")) queries = JSON.parse(params.get("queries") || ""); } catch { queries = null; }
  if ((query && (query.length < 2 || query.length > 120 || /[\r\n\u0000-\u001f]/.test(query))) || (accountId && !/^adacct_[A-Za-z0-9_-]{1,100}$/.test(accountId)) || !Array.isArray(queries) || queries.length > 30 || queries.some((item) => typeof item !== "string" || item.trim().length < 2 || item.trim().length > 120 || /[\r\n\u0000-\u001f]/.test(item))) return NextResponse.json({ error: "Le compte ou la recherche ChatGPT Ads est invalide." }, { status: 400, headers });
  try { return NextResponse.json(await readOpenaiAdsDeliveryResources(user.activeUserId, query, accountId || undefined, queries as string[]), { headers }); }
  catch (error) {
    const known = error instanceof OpenaiAdsPublishError ? error : null;
    return NextResponse.json({ error: known?.message || "Les paramètres ChatGPT Ads n’ont pas pu être vérifiés.", code: known?.code || "openai_resources_unavailable" }, { status: known?.httpStatus === 401 || known?.httpStatus === 403 ? 409 : 503, headers });
  }
}
