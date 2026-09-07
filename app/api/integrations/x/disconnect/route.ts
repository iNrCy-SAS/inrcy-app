import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { clearAllToolCaches } from "@/lib/statsCache";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { asRecord } from "@/lib/tsSafe";
import { revokeXTokensBestEffort } from "@/lib/xOAuth";

export async function POST() {
  const supabase = await createSupabaseServer();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }
  const userId = await resolveActiveInrcyAccountId(supabase, authData.user.id);
  const { data: integration } = await supabaseAdmin
    .from("integrations")
    .select("id,access_token_enc,refresh_token_enc")
    .eq("user_id", userId)
    .eq("provider", "x")
    .eq("source", "x")
    .eq("product", "x")
    .maybeSingle();
  if (integration) {
    await revokeXTokensBestEffort({
      integrationId: String(integration.id || ""),
      accessTokenEnc: integration.access_token_enc || null,
      refreshTokenEnc: integration.refresh_token_enc || null,
      context: "x_disconnect",
    });
  }
  const { error: deleteError } = await supabaseAdmin
    .from("integrations")
    .delete()
    .eq("user_id", userId)
    .eq("provider", "x")
    .eq("source", "x")
    .eq("product", "x");
  if (deleteError) {
    return jsonUserFacingError(deleteError, {
      status: 500,
      fallback: "Impossible de déconnecter X.",
    });
  }

  const { data: config } = await supabaseAdmin
    .from("pro_tools_configs")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();
  const settings = asRecord(asRecord(config).settings);
  const { error: configError } = await supabaseAdmin.from("pro_tools_configs").upsert(
    {
      user_id: userId,
      settings: {
        ...settings,
        x: {
          ...asRecord(settings.x),
          accountConnected: false,
          connected: false,
          userId: null,
          username: null,
          displayName: null,
          url: null,
          profileUrl: null,
        },
      },
    },
    { onConflict: "user_id" },
  );
  if (configError) {
    return jsonUserFacingError(configError, {
      status: 500,
      fallback: "X a été déconnecté, mais l'affichage local n'a pas pu être actualisé.",
    });
  }
  await clearAllToolCaches(supabase, userId);
  return NextResponse.json({ ok: true });
}
