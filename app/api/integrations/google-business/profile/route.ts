import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { getGmbToken } from "@/lib/googleBusiness";
import { getGmbReviewTargetFromRow } from "@/lib/googleBusinessReviews";
import { listAllGoogleBusinessLocations } from "@/lib/googleBusinessLocations";
import { buildGoogleBusinessProfilePatch, editableGoogleBusinessProfile, googleBusinessRecord, stableGoogleBusinessValue } from "@/lib/googleBusinessProfile";
import { enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const readMask = "name,title,phoneNumbers,websiteUri,profile,storefrontAddress,regularHours,specialHours,metadata,openInfo,categories,serviceArea";
const version = (value: unknown) => createHash("sha256").update(stableGoogleBusinessValue(value)).digest("hex");
const failure = (message: string, status = 400) => NextResponse.json({ ok: false, error: message, user_message: message }, { status });

async function context() {
  const current = await getCurrentInrcyAccountScope();
  if (!current) return { response: failure("Connectez-vous à iNrCy.", 401) } as const;
  const token = await getGmbToken({ supabase: current.supabase, userId: current.scope.activeUserId });
  if (!token?.accessToken) return { response: failure("Reconnectez Google Business dans sa bulle.", 401) } as const;
  const target = getGmbReviewTargetFromRow(token.row);
  if (!target.accountName || !target.locationName) return { response: failure("Choisissez un établissement dans la bulle Google Business.", 409) } as const;
  return { current, token, target } as const;
}

async function google(url: URL, accessToken: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const body = googleBusinessRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    const error = new Error(response.status === 404 ? "Cette fiche n’est plus accessible. Actualisez la liste des établissements et choisissez votre fiche." : response.status === 403 ? "Google n’autorise pas cette action sur la fiche sélectionnée. Vérifiez vos droits et sa validation." : "Google n’a pas confirmé l’opération. Actualisez la fiche avant de réessayer.");
    throw error;
  }
  return body;
}

async function snapshot(accessToken: string, locationName: string) {
  const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}`);
  url.searchParams.set("readMask", readMask);
  const data = await google(url, accessToken);
  return { data, profile: editableGoogleBusinessProfile(data) };
}

export async function GET(request: Request) {
  try {
    const ctx = await context();
    if ("response" in ctx) return ctx.response;
    const expected = new URL(request.url).searchParams.get("locationName");
    if (expected && expected !== ctx.target.locationName) return failure("L’établissement sélectionné a changé. Rouvrez sa fiche.", 409);
    const { data, profile } = await snapshot(ctx.token.accessToken, ctx.target.locationName!);
    return NextResponse.json({ ok: true, accountId: ctx.current.scope.activeUserId, accountName: ctx.target.accountName, locationName: ctx.target.locationName, profile, version: version(profile), mapsUri: googleBusinessRecord(data.metadata).mapsUri || null, openStatus: googleBusinessRecord(data.openInfo).status || null });
  } catch (error) { return failure(error instanceof Error ? error.message : "Impossible de lire la fiche Google.", 502); }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await context();
    if ("response" in ctx) return ctx.response;
    const limited = await enforceRateLimit({ name: "google_business_profile_edit", identifier: `${ctx.current.user.id}:${ctx.current.scope.activeUserId}`, limit: 20, window: "10 m" });
    if (limited) return limited;
    const body = googleBusinessRecord(await request.json().catch(() => null));
    if (body.accountId !== ctx.current.scope.activeUserId || body.accountName !== ctx.target.accountName || body.locationName !== ctx.target.locationName) return failure("L’établissement ou le compte actif a changé. Rouvrez la fiche avant d’enregistrer.", 409);
    const locations = await listAllGoogleBusinessLocations(ctx.token.accessToken, ctx.target.accountName!);
    if (!locations.some(location => location.name === ctx.target.locationName)) return failure("Cette fiche n’est plus accessible dans le compte Google sélectionné.", 409);
    const before = await snapshot(ctx.token.accessToken, ctx.target.locationName!);
    if (body.version !== version(before.profile)) return failure("Les informations Google ont changé depuis l’ouverture. Actualisez la fiche pour vérifier les modifications.", 409);
    let patch;
    try { patch = buildGoogleBusinessProfilePatch(before.profile, body.profile); }
    catch (error) { return failure(error instanceof Error ? error.message : "Modification invalide."); }
    if (!patch.updateMask.length) return NextResponse.json({ ok: true, unchanged: true, profile: before.profile, version: version(before.profile) });
    const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${ctx.target.locationName}`);
    url.searchParams.set("updateMask", patch.updateMask.join(","));
    url.searchParams.set("validateOnly", "true");
    const init = { method: "PATCH", body: JSON.stringify({ ...patch.location, name: ctx.target.locationName }) };
    await google(url, ctx.token.accessToken, init);
    // Recheck the application target after validation and before the actual remote write.
    const latest = await context();
    if ("response" in latest || latest.current.scope.activeUserId !== ctx.current.scope.activeUserId || latest.target.locationName !== ctx.target.locationName || latest.target.accountName !== ctx.target.accountName) return failure("La sélection a changé. Aucune modification envoyée.", 409);
    url.searchParams.delete("validateOnly");
    await google(url, latest.token.accessToken, init);
    const { profile } = await snapshot(latest.token.accessToken, ctx.target.locationName!);
    return NextResponse.json({ ok: true, profile, version: version(profile), updatedFields: patch.updateMask, submittedToGoogle: true });
  } catch (error) { return failure(error instanceof Error ? error.message : "Google n’a pas confirmé la modification. Actualisez avant de réessayer.", 502); }
}
