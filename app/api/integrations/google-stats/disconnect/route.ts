import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { clearAllToolCaches } from "@/lib/statsCache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { revokeGoogleTokensBestEffort, shouldRevokeGoogleTokensForDisconnect } from "@/lib/googleOAuthRevoke";
import { syncSitePresenceIntegrations } from '@/lib/sitePresenceSync';
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

function stripGoogleProduct(settingsNode: unknown, product: string) {
  const next = { ...asRecord(settingsNode) };
  if (product === "ga4") delete next.ga4;
  if (product === "gsc") delete next.gsc;
  return next;
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServer();
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) return NextResponse.json({ error: "Votre session a expiré. Merci de vous reconnecter." }, { status: 401 });

  const userId = await resolveActiveInrcyAccountId(supabase, authData.user.id);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const source = typeof body.source === "string" ? body.source : "";
  const product = typeof body.product === "string" ? body.product : "";
  if (source !== "site_web" || !["ga4", "gsc"].includes(product)) return NextResponse.json({ error: "Source ou produit invalide." }, { status: 400 });

  const { data: revokeRows } = await supabaseAdmin
    .from("integrations")
    .select("id,access_token_enc,refresh_token_enc,provider_account_id,email_address")
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("source", source)
    .eq("product", product);

  const googleStatsRows = (revokeRows || []) as RevokeRow[];
  const canRevokeGoogleAuth = await shouldRevokeGoogleTokensForDisconnect({
    userId,
    rows: googleStatsRows,
    context: `google_stats_disconnect:${source}:${product}`,
  });

  if (canRevokeGoogleAuth) {
    await revokeGoogleTokensBestEffort(googleStatsRows.map((row: RevokeRow) => ({
      integrationId: String(row?.id || ""),
      accessTokenEnc: row?.access_token_enc || null,
      refreshTokenEnc: row?.refresh_token_enc || null,
      context: `google_stats_disconnect:${source}:${product}`,
    })));
  }

  const { error: integrationUpdateError } = await supabaseAdmin
    .from("integrations")
    .update({
      status: "disconnected",
      access_token_enc: null,
      refresh_token_enc: null,
      expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("source", source)
    .eq("product", product);

  if (integrationUpdateError) {
    return NextResponse.json(
      { error: "Impossible de déconnecter l'intégration Google." },
      { status: 500 }
    );
  }

  try {
    if (source === "site_web") {
      const { data } = await supabaseAdmin.from("pro_tools_configs").select("settings").eq("user_id", userId).maybeSingle();
      const current = asRecord(asRecord(data)["settings"]);
      const siteWeb = asRecord(current.site_web);
      const nextSiteWeb = stripGoogleProduct(siteWeb, product);
      const { error: siteWebUpdateError } = await supabaseAdmin
        .from("pro_tools_configs")
        .upsert({ user_id: userId, settings: { ...current, site_web: nextSiteWeb } }, { onConflict: "user_id" });
      if (siteWebUpdateError) {
        return NextResponse.json(
          { error: "La déconnexion Google a été partiellement appliquée côté site web." },
          { status: 500 }
        );
      }
    }
  } catch {
    return NextResponse.json(
      { error: "Une erreur est survenue lors du nettoyage de la configuration du site." },
      { status: 500 }
    );
  }

  await syncSitePresenceIntegrations(userId);
  await clearAllToolCaches(supabase, userId);
  return NextResponse.json({ ok: true });
}
