import { NextResponse } from "next/server";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { getGmbToken } from "@/lib/googleBusiness";
import { getGmbReviewTargetFromRow } from "@/lib/googleBusinessReviews";
import { googleBusinessRecord } from "@/lib/googleBusinessProfile";
import { googleBusinessCategoryRegion, searchGoogleBusinessCategories } from "@/lib/googleBusinessCategoryCatalog";
import { enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const failure = (user_message: string, status = 400) => NextResponse.json({ ok: false, user_message }, { status });

export async function GET(request: Request) {
  try {
    const current = await getCurrentInrcyAccountScope();
    if (!current) return failure("Connectez-vous à iNrCy.", 401);
    const params = new URL(request.url).searchParams;
    const token = await getGmbToken({ supabase: current.supabase, userId: current.scope.activeUserId });
    if (!token?.accessToken) return failure("Reconnectez Google Business dans sa bulle.", 401);
    const target = getGmbReviewTargetFromRow(token.row);
    if (!target.accountName || !target.locationName) return failure("Choisissez un établissement dans la bulle Google Business.", 409);
    if (params.get("accountId") !== current.scope.activeUserId || params.get("locationName") !== target.locationName) return failure("L’établissement ou le compte actif a changé. Rouvrez la fiche.", 409);
    const limited = await enforceRateLimit({ name: "google_business_categories", identifier: `${current.user.id}:${current.scope.activeUserId}`, limit: 90, window: "1 m" });
    if (limited) return limited;
    const query = (params.get("q") || "").trim();
    const names = params.getAll("names");
    const languageCode = params.get("languageCode") || "fr";
    if ((!names.length && (query.length < 2 || query.length > 80 || !/^[\p{L}\p{N}][\p{L}\p{N}\s'’&()./-]*$/u.test(query))) || names.length > 10 || names.some(name => !/^(?:categories\/)?gcid:[a-z0-9_]+$/.test(name)) || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(languageCode)) return failure("La recherche d’activité est invalide.");
    const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${target.locationName}`);
    url.searchParams.set("readMask", "name,storefrontAddress,serviceArea");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token.accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return failure("La fiche Google n’est plus accessible. Rouvrez sa gestion avant de rechercher une activité.", 502);
    const location = googleBusinessRecord(await response.json());
    const regionCode = googleBusinessCategoryRegion(location);
    if (!regionCode) return failure("Le pays de cette fiche n’est pas renseigné sur Google. Complétez-le avant de changer ses activités.", 409);
    const result = await searchGoogleBusinessCategories({ accessToken: token.accessToken, regionCode, languageCode, query, pageToken: params.get("pageToken") || "", ...(names.length ? { names } : {}) });
    return NextResponse.json({ ok: true, accountId: current.scope.activeUserId, locationName: target.locationName, regionCode, ...result });
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Impossible de lire les activités Google.", 502);
  }
}
