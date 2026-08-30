import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { clearAllToolCaches } from "@/lib/statsCache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { withCurrentConnectionVersion } from "@/lib/connectionVersions";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function POST() {
  const supabase = await createSupabaseServer();
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const userId = await resolveActiveInrcyAccountId(supabase, authData.user.id);
  const { data: currentIntegration, error: readError } = await supabaseAdmin
    .from("integrations")
    .select("id,meta")
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("source", "gmb")
    .eq("product", "gmb")
    .maybeSingle();

  if (readError) return jsonUserFacingError(readError, { status: 500 });

  if (currentIntegration?.id) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("integrations")
      .update({
        status: "account_connected",
        resource_id: null,
        resource_label: null,
        page_url: null,
        meta: withCurrentConnectionVersion("channel:gmb", {
          ...asRecord(currentIntegration.meta),
          url: null,
        }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentIntegration.id)
      .eq("user_id", userId)
      .select("id,status,resource_id")
      .single();

    if (updateError) return jsonUserFacingError(updateError, { status: 500 });
    if (updated.status !== "account_connected" || updated.resource_id !== null) {
      return NextResponse.json({ error: "L’établissement Google n’a pas été déconnecté. Réessayez." }, { status: 500 });
    }
  }

  try {
    const { data } = await supabaseAdmin.from("pro_tools_configs").select("settings").eq("user_id", userId).maybeSingle();
    const current = asRecord(asRecord(data)["settings"]);
    const currentGmb = asRecord(current["gmb"]);
    await supabaseAdmin.from("pro_tools_configs").upsert({
      user_id: userId,
      settings: {
        ...current,
        gmb: {
          ...currentGmb,
          connected: true,
          configured: false,
          resource_id: null,
          resource_label: null,
          locationName: null,
          locationTitle: null,
          url: null,
        },
      },
    }, { onConflict: "user_id" });
  } catch {}

  await clearAllToolCaches(supabase, userId);
  return NextResponse.json({ ok: true });
}
