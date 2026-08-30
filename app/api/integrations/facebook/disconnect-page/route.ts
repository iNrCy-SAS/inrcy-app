import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { clearAllToolCaches } from "@/lib/statsCache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { asRecord } from "@/lib/tsSafe";
import { withCurrentConnectionVersion } from "@/lib/connectionVersions";

export async function POST() {
  const supabase = await createSupabaseServer();
  const { data: authData, error } = await supabase.auth.getUser();
  const user = authData?.user;
  if (error || !user) return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  const activeUserId = await resolveActiveInrcyAccountId(supabase, user.id);

  const { data: currentIntegration, error: readError } = await supabaseAdmin
    .from("integrations")
    .select("id,meta")
    .eq("user_id", activeUserId)
    .eq("provider", "facebook")
    .eq("source", "facebook")
    .eq("product", "facebook")
    .maybeSingle();

  if (readError) {
    return NextResponse.json(
      { error: getSimpleFrenchErrorMessage(readError, "Impossible de charger la connexion Facebook.") },
      { status: 500 },
    );
  }

  if (currentIntegration?.id) {
    const { data: updated, error: updErr } = await supabaseAdmin
      .from("integrations")
      .update({
        status: "account_connected",
        resource_id: null,
        resource_label: null,
        meta: withCurrentConnectionVersion("channel:facebook", {
          ...asRecord(currentIntegration.meta),
          selected: false,
          page_url: null,
          page_source: null,
          page_business_id: null,
          page_business_name: null,
        }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentIntegration.id)
      .eq("user_id", activeUserId)
      .select("id,status,resource_id")
      .single();

    if (updErr) {
      return NextResponse.json(
        { error: getSimpleFrenchErrorMessage(updErr, "Impossible de déconnecter la page Facebook.") },
        { status: 500 },
      );
    }
    if (updated.status !== "account_connected" || updated.resource_id !== null) {
      return NextResponse.json({ error: "La page Facebook n’a pas été déconnectée. Réessayez." }, { status: 500 });
    }
  }

  try {
    const { data } = await supabaseAdmin
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", activeUserId)
      .maybeSingle();
    const current = asRecord(asRecord(data)["settings"]);
    await supabaseAdmin.from("pro_tools_configs").upsert({
      user_id: activeUserId,
      settings: {
        ...current,
        facebook: {
          ...asRecord(current.facebook),
          pageConnected: false,
          pageId: null,
          pageName: null,
          url: null,
        },
      },
    }, { onConflict: "user_id" });
  } catch {}

  await clearAllToolCaches(supabase, activeUserId);
  return NextResponse.json({ ok: true });
}
