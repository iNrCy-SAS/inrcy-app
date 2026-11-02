import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { GENERAL_PREFERENCE_COLUMNS, parseGeneralPreferencesPatch, projectGeneralPreferences } from "@/lib/generalPreferences";

const SELECT = "client_language,timezone,date_format,currency";
const fail = (status: number) => NextResponse.json({ ok: false, error: "Impossible de confirmer les préférences générales." }, { status });
export async function GET() {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  const { data, error } = await auth.supabase.from("business_profiles").select(SELECT).eq("user_id", auth.activeUserId).maybeSingle();
  if (error) return fail(503);
  return NextResponse.json({ ok: true, accountId: auth.activeUserId, preferences: projectGeneralPreferences(data), source: data ? "saved" : "defaults" }, { headers: { "Cache-Control": "no-store" } });
}
export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  let patch;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["accountId", "actorUserId", "preferences"].includes(key))) return fail(400);
    if (body.accountId !== auth.activeUserId || body.actorUserId !== undefined && body.actorUserId !== auth.authUserId) return fail(409);
    patch = parseGeneralPreferencesPatch(body.preferences);
  } catch { return fail(400); }
  // Only supplied columns are updated; omitted preferences/profile fields survive.
  const values = Object.fromEntries(Object.entries(patch).map(([key, value]) => [GENERAL_PREFERENCE_COLUMNS[key as keyof typeof GENERAL_PREFERENCE_COLUMNS], value]));
  const { data, error } = await auth.supabase.from("business_profiles").upsert({ user_id: auth.activeUserId, ...values, updated_at: new Date().toISOString() }, { onConflict: "user_id" }).select(SELECT).single();
  if (error) return fail(503);
  const { invalidateBoosterGenerationContext } = await import("@/lib/boosterGenerationContext");
  await invalidateBoosterGenerationContext(auth.activeUserId, "professional").catch(() => undefined);
  return NextResponse.json({ ok: true, accountId: auth.activeUserId, preferences: projectGeneralPreferences(data), source: "saved" }, { headers: { "Cache-Control": "no-store" } });
}
