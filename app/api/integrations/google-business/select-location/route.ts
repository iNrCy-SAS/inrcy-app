import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { asRecord } from "@/lib/tsSafe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { clearAllToolCaches } from "@/lib/statsCache";

import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServer();
    const { data: auth, error } = await supabase.auth.getUser();
    if (error || !auth?.user) return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });

    const userId = await resolveActiveInrcyAccountId(supabase, auth.user.id);
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Données invalides." }, { status: 400 });

    const accountName = String(body.accountName || "").trim(); // "accounts/123"
    const locationName = String(body.locationName || "").trim(); // "locations/456"
    const locationTitle = String(body.locationTitle || "").trim() || null;

    // Best-effort public link for the selected location.
    // We use a Google Maps search link (reliable, no extra API calls, works even without Place IDs).
    const gmbUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationTitle || locationName)}`;

    if (!accountName || !locationName) {
      return NextResponse.json({ error: "Établissement Google Business incomplet." }, { status: 400 });
    }

    const { data: existingIntegration, error: existingError } = await supabaseAdmin
      .from("integrations")
      .select("id,meta")
      .eq("user_id", userId)
      .eq("provider", "google")
      .eq("source", "gmb")
      .eq("product", "gmb")
      .maybeSingle();

    if (existingError) return jsonUserFacingError(existingError, { status: 500 });
    if (!existingIntegration?.id) {
      return NextResponse.json(
        { error: "Le compte Google Business doit être reconnecté avant de choisir l’établissement." },
        { status: 409 },
      );
    }

    const { data: updatedIntegration, error: upErr } = await supabaseAdmin
      .from("integrations")
      .update({
        resource_id: locationName,
        resource_label: locationTitle,
        meta: withCurrentConnectionVersion("channel:gmb", {
          ...asRecord(existingIntegration.meta),
          account: accountName,
        }),
        status: "connected",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingIntegration.id)
      .eq("user_id", userId)
      .select("id,status,resource_id,resource_label,meta")
      .single();

    if (upErr) return jsonUserFacingError(upErr, { status: 500 });
    if (!updatedIntegration?.id || updatedIntegration.resource_id !== locationName || updatedIntegration.status !== "connected") {
      return NextResponse.json({ error: "L’établissement n’a pas pu être confirmé." }, { status: 409 });
    }

    // Mirror to pro_tools_configs for UI
    try {
      const { data: scRow } = await supabaseAdmin.from("pro_tools_configs").select("settings").eq("user_id", userId).maybeSingle();
      const scRec = asRecord(scRow);
      const current = asRecord(scRec["settings"]);
      const currentGmb = asRecord(current["gmb"]);
      const merged = {
        ...current,
        gmb: { ...currentGmb, connected: true, configured: true, accountName, locationName, locationTitle, resource_id: locationName, resource_label: locationTitle, url: gmbUrl },
      };
      await supabaseAdmin.from("pro_tools_configs").upsert({ user_id: userId, settings: merged }, { onConflict: "user_id" });
    } catch {
      // non-fatal
    }

    await clearAllToolCaches(supabase, userId);

    return NextResponse.json({ ok: true, url: gmbUrl });
  } catch (e: unknown) {
    return jsonUserFacingError(e, { status: 500 });
  }
}
