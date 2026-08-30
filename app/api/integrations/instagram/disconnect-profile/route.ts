import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { clearAllToolCaches } from "@/lib/statsCache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { withCurrentConnectionVersion } from "@/lib/connectionVersions";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function POST() {
  const supabase = await createSupabaseServer();
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  const user = authData?.user;
  if (authErr || !user) return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  const activeUserId = await resolveActiveInrcyAccountId(supabase, user.id);

  const { data: row, error: readError } = await supabaseAdmin
    .from("integrations")
    .select("id,meta")
    .eq("user_id", activeUserId)
    .eq("provider", "instagram")
    .eq("source", "instagram")
    .eq("product", "instagram")
    .maybeSingle();

  if (readError) {
    return jsonUserFacingError(readError, {
      status: 500,
      fallback: "Impossible de charger la connexion Instagram.",
    });
  }

  const currentMeta = asRecord(asRecord(row)["meta"]);

  if (row?.id) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("integrations")
      .update({
        status: "account_connected",
        resource_id: null,
        resource_label: null,
        meta: withCurrentConnectionVersion("channel:instagram", {
          ...currentMeta,
          picked: "none",
          page_id: null,
          page_name: null,
          page_source: null,
          business_name: null,
        }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("user_id", activeUserId)
      .select("id,status,resource_id")
      .single();

    if (updateError) {
      return jsonUserFacingError(updateError, {
        status: 500,
        fallback: "Impossible de déconnecter le profil Instagram.",
      });
    }
    if (updated.status !== "account_connected" || updated.resource_id !== null) {
      return NextResponse.json({ error: "Le profil Instagram n’a pas été déconnecté. Réessayez." }, { status: 500 });
    }
  }

  try {
    const { data } = await supabaseAdmin.from("pro_tools_configs").select("settings").eq("user_id", activeUserId).maybeSingle();
    const current = asRecord(asRecord(data)["settings"]);
    await supabaseAdmin.from("pro_tools_configs").upsert({
      user_id: activeUserId,
      settings: {
        ...current,
        instagram: {
          ...asRecord(current.instagram),
          accountConnected: true,
          connected: false,
          username: null,
          url: null,
          pageId: null,
          igId: null,
        },
      },
    }, { onConflict: "user_id" });
  } catch {}

  await clearAllToolCaches(supabase, activeUserId);
  return NextResponse.json({ ok: true });
}
