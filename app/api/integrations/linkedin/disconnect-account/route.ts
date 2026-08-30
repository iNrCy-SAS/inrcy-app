import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { clearAllToolCaches } from "@/lib/statsCache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function POST() {
  const supabase = await createSupabaseServer();
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  const user = authData?.user;
  if (authErr || !user) return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  const activeUserId = await resolveActiveInrcyAccountId(supabase, user.id);

  const { error: deleteError } = await supabaseAdmin
    .from("integrations")
    .delete()
    .eq("user_id", activeUserId)
    .eq("provider", "linkedin");
  if (deleteError) {
    return jsonUserFacingError(deleteError, {
      status: 500,
      fallback: "Impossible de déconnecter LinkedIn.",
    });
  }

  const { data: remaining, error: verifyError } = await supabaseAdmin
    .from("integrations")
    .select("id")
    .eq("user_id", activeUserId)
    .eq("provider", "linkedin")
    .limit(1);
  if (verifyError) return jsonUserFacingError(verifyError, { status: 500 });
  if (remaining?.length) {
    return NextResponse.json({ error: "LinkedIn n’a pas été déconnecté. Réessayez." }, { status: 500 });
  }
  try {
    const { data } = await supabaseAdmin.from("pro_tools_configs").select("settings").eq("user_id", activeUserId).maybeSingle();
    const current = asRecord(asRecord(data)["settings"]);
    await supabaseAdmin.from("pro_tools_configs").upsert({
      user_id: activeUserId,
      settings: {
        ...current,
        linkedin: {
          ...asRecord(current.linkedin),
          accountConnected: false,
          connected: false,
          displayName: null,
          url: null,
          profileUrl: null,
          orgId: "",
          orgName: "",
          orgUrl: "",
          shareToPersonalProfile: false,
        },
      },
    }, { onConflict: "user_id" });
  } catch {}
  await clearAllToolCaches(supabase, activeUserId);
  return NextResponse.json({ ok: true });
}
