import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { clearAllToolCaches } from "@/lib/statsCache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { revokeGoogleTokensBestEffort, shouldRevokeGoogleTokensForDisconnect } from "@/lib/googleOAuthRevoke";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";

type RevokeRow = {
  id?: string | null;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
  provider_account_id?: string | null;
  email_address?: string | null;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function POST() {
  const supabase = await createSupabaseServer();
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const userId = await resolveActiveInrcyAccountId(supabase, authData.user.id);

  const { data: revokeRows } = await supabaseAdmin
    .from("integrations")
    .select("id,access_token_enc,refresh_token_enc,provider_account_id,email_address")
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("source", "gmb")
    .eq("product", "gmb");

  const googleBusinessRows = (revokeRows || []) as RevokeRow[];
  const canRevokeGoogleAuth = await shouldRevokeGoogleTokensForDisconnect({
    userId,
    rows: googleBusinessRows,
    context: "google_business_disconnect_account",
  });

  if (canRevokeGoogleAuth) {
    await revokeGoogleTokensBestEffort(googleBusinessRows.map((row: RevokeRow) => ({
      integrationId: String(row?.id || ""),
      accessTokenEnc: row?.access_token_enc || null,
      refreshTokenEnc: row?.refresh_token_enc || null,
      context: "google_business_disconnect_account",
    })));
  }

  const { error } = await supabaseAdmin
    .from("integrations")
    .delete()
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("source", "gmb")
    .eq("product", "gmb");

  if (error) return jsonUserFacingError(error, { status: 500 });

  const { data: remaining, error: verifyError } = await supabaseAdmin
    .from("integrations")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("source", "gmb")
    .eq("product", "gmb")
    .limit(1);
  if (verifyError) return jsonUserFacingError(verifyError, { status: 500 });
  if (remaining?.length) {
    return NextResponse.json({ error: "Google Business n’a pas été déconnecté. Réessayez." }, { status: 500 });
  }
  try {
    const { data } = await supabaseAdmin.from("pro_tools_configs").select("settings").eq("user_id", userId).maybeSingle();
    const current = asRecord(asRecord(data)["settings"]);
    await supabaseAdmin.from("pro_tools_configs").upsert({
      user_id: userId,
      settings: {
        ...current,
        gmb: {
          ...asRecord(current.gmb),
          connected: false,
          accountEmail: null,
          accountDisplayName: null,
          accountName: null,
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
