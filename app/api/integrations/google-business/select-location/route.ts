import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { asRecord } from "@/lib/tsSafe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { clearAllToolCaches } from "@/lib/statsCache";

import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { getGmbToken } from "@/lib/googleBusiness";
import { listAllGoogleBusinessAccounts, listAllGoogleBusinessLocations } from "@/lib/googleBusinessLocations";
import { clearGmbSelectionMeta, clearGmbSelectionSettings } from "@/lib/googleBusinessSelectionPolicy";

function selectionChanged() {
  return NextResponse.json({ error: "La connexion ou la fiche sélectionnée a changé. Actualisez la liste des établissements avant de choisir votre fiche.", code: "gmb_selection_changed" }, { status: 409 });
}

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
    if (!/^accounts\/[a-zA-Z0-9_-]+$/.test(accountName) || !/^locations\/[a-zA-Z0-9_-]+$/.test(locationName)) {
      return NextResponse.json({ error: "Établissement Google Business incomplet." }, { status: 400 });
    }

    const token = await getGmbToken({ supabase, userId });
    if (!token?.accessToken) return NextResponse.json({ error: "Reconnectez votre compte Google Business." }, { status: 401 });
    const snapshot = token.row;
    if (!snapshot?.id || snapshot.user_id !== userId || snapshot.provider !== "google" || snapshot.source !== "gmb" || snapshot.product !== "gmb"
      || !["connected", "account_connected"].includes(snapshot.status)) return selectionChanged();
    const accounts = await listAllGoogleBusinessAccounts(token.accessToken);
    if (!accounts.some(account => account.name === accountName)) return NextResponse.json({ error: "Ce compte Google Business n’est pas accessible." }, { status: 403 });
    const locations = await listAllGoogleBusinessLocations(token.accessToken, accountName);
    const selected = locations.find(location => location.name === locationName);
    if (!selected) return NextResponse.json({ error: "Cet établissement n’est pas accessible dans ce compte Google Business. Actualisez la liste." }, { status: 409 });
    // Closed establishments remain selectable; their status never authorizes guessing another target.
    const locationTitle = selected.title || null;
    const gmbUrl = selected.mapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([locationTitle || locationName, selected.addressLabel].filter(Boolean).join(" "))}`;

    const { data: existingIntegration, error: existingError } = await supabaseAdmin
      .from("integrations")
      .select("id,meta")
      .eq("id", snapshot.id)
      .eq("user_id", userId)
      .eq("provider", "google")
      .eq("source", "gmb")
      .eq("product", "gmb")
      .maybeSingle();

    if (existingError) return jsonUserFacingError(existingError, { status: 500 });
    if (!existingIntegration?.id) return selectionChanged();

    let update = supabaseAdmin
      .from("integrations")
      .update({
        resource_id: locationName,
        resource_label: locationTitle,
        page_url: gmbUrl,
        meta: withCurrentConnectionVersion("channel:gmb", {
          ...clearGmbSelectionMeta(existingIntegration.meta, accountName),
          url: gmbUrl,
        }),
        status: "connected",
        updated_at: new Date().toISOString(),
      })
      .eq("id", snapshot.id)
      .eq("user_id", userId)
      .eq("provider", "google")
      .eq("source", "gmb")
      .eq("product", "gmb");
    // Google validated this exact credential/selection snapshot. An OAuth
    // callback, refresh, disconnect or newer choice must win over this request.
    for (const field of ["status", "email_address", "access_token_enc", "refresh_token_enc", "expires_at", "resource_id", "resource_label"] as const) {
      update = snapshot[field] == null ? update.is(field, null) : update.eq(field, snapshot[field]);
    }
    update = snapshot.meta == null ? update.is("meta", null) : update.eq("meta", JSON.stringify(snapshot.meta));
    const { data: updatedIntegration, error: upErr } = await update.select("id,status,resource_id,resource_label,meta").maybeSingle();

    if (upErr) return jsonUserFacingError(upErr, { status: 500 });
    if (!updatedIntegration?.id || updatedIntegration.resource_id !== locationName || updatedIntegration.status !== "connected") {
      return selectionChanged();
    }

    // Mirror to pro_tools_configs for UI
    try {
      const { data: scRow, error: mirrorReadError } = await supabaseAdmin.from("pro_tools_configs").select("settings").eq("user_id", userId).maybeSingle();
      if (mirrorReadError) throw new Error("mirror_read_failed");
      const scRec = asRecord(scRow);
      const current = asRecord(scRec["settings"]);
      const currentGmb = asRecord(current["gmb"]);
      const merged = {
        ...current,
        gmb: { ...clearGmbSelectionSettings(currentGmb, accountName), connected: true, configured: true, accountName, locationName, locationTitle, resource_id: locationName, resource_label: locationTitle, url: gmbUrl },
      };
      if (scRow) {
        const mirror = supabaseAdmin.from("pro_tools_configs").update({ settings: merged }).eq("user_id", userId);
        await (scRow.settings == null ? mirror.is("settings", null) : mirror.eq("settings", JSON.stringify(scRow.settings)));
      } else {
        await supabaseAdmin.from("pro_tools_configs").insert({ user_id: userId, settings: merged });
      }
    } catch {
      // non-fatal
    }

    await clearAllToolCaches(supabase, userId);

    return NextResponse.json({ ok: true, url: gmbUrl });
  } catch (e: unknown) {
    return jsonUserFacingError(e, { status: 500 });
  }
}
