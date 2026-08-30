import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { clearAllToolCaches } from "@/lib/statsCache";
import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { asRecord, asString } from "@/lib/tsSafe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { extractFacebookUserTokens, findAccessibleFacebookPage, listAccessibleFacebookPagesFromTokens } from "@/lib/metaBusinessAssets";

import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServer>>;

async function invalidateUserStatsCache(supabase: SupabaseServerClient, userId: string) {
  await clearAllToolCaches(supabase, userId);
}

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServer();
    const { data: auth, error } = await supabase.auth.getUser();
    if (error || !auth?.user) return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });

    const userId = await resolveActiveInrcyAccountId(supabase, auth.user.id);
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Données invalides." }, { status: 400 });
    const bodyRec = asRecord(body);

    const pageId = String(asString(bodyRec["pageId"]) || "").trim();
    if (!pageId) return NextResponse.json({ error: "Page Facebook manquante." }, { status: 400 });

    const { data: existing, error: readErr } = await supabaseAdmin
      .from("integrations")
      .select("id,meta,access_token_enc")
      .eq("user_id", userId)
      .eq("provider", "facebook")
      .eq("source", "facebook")
      .eq("product", "facebook")
      .maybeSingle();

    if (readErr) return jsonUserFacingError(readErr, { status: 500, fallback: "Impossible de charger les pages Facebook." });
    if (!existing) {
      return NextResponse.json(
        { error: "La connexion Facebook doit être relancée." },
        { status: 409 },
      );
    }

    const existingRec = asRecord(existing);
    const integrationId = asString(existingRec["id"]);
    if (!integrationId) {
      return NextResponse.json(
        { error: "La connexion Facebook est incomplète. Relancez-la." },
        { status: 409 },
      );
    }
    const prevMeta = asRecord(existingRec["meta"]);
    const encryptedTokens = extractFacebookUserTokens(prevMeta, asString(existingRec["access_token_enc"]) || null);
    const userTokens = encryptedTokens.map((raw) => tryDecryptToken(raw)).filter((v): v is string => !!v);
    if (!userTokens.length) return NextResponse.json({ error: "La connexion Facebook doit être relancée." }, { status: 400 });

    const pages = await listAccessibleFacebookPagesFromTokens(userTokens);
    const page = findAccessibleFacebookPage(pages, pageId);
    if (!page) return NextResponse.json({ error: "Cette page n'est pas accessible avec le compte connecté." }, { status: 400 });
    if (!page.access_token) return NextResponse.json({ error: "Impossible de récupérer le token de cette page. Vérifiez les autorisations business." }, { status: 400 });

    const pageName = page.name || null;
    const pageUrl = `https://www.facebook.com/${pageId}`;
    const nextMeta = withCurrentConnectionVersion("channel:facebook", {
      ...prevMeta,
      selected: true,
      page_url: pageUrl,
      page_source: page.source,
      page_business_id: page.business_id || null,
      page_business_name: page.business_name || null,
    });

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("integrations")
      .update({
        resource_id: pageId,
        resource_label: pageName,
        access_token_enc: encryptToken(page.access_token),
        expires_at: null,
        status: "connected",
        meta: nextMeta,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId)
      .eq("user_id", userId)
      .select("id,status,resource_id")
      .single();

    if (upErr) return jsonUserFacingError(upErr, { status: 500, fallback: "Impossible d’enregistrer la page Facebook." });
    if (asString(updated?.status) !== "connected" || asString(updated?.resource_id) !== pageId) {
      return NextResponse.json(
        { error: "La page Facebook n’a pas été enregistrée. Réessayez." },
        { status: 500 },
      );
    }

    try {
      const { data: scRow } = await supabaseAdmin.from("pro_tools_configs").select("settings").eq("user_id", userId).maybeSingle();
      const scRec = asRecord(scRow);
      const current = asRecord(scRec["settings"]);
      const currentFb = asRecord(current["facebook"]);
      const merged = {
        ...current,
        facebook: {
          ...currentFb,
          accountConnected: true,
          pageConnected: true,
          pageId,
          pageName,
          url: pageUrl,
        },
      };
      await supabaseAdmin.from("pro_tools_configs").upsert({ user_id: userId, settings: merged }, { onConflict: "user_id" });
    } catch {}

    await invalidateUserStatsCache(supabase, userId);

    return NextResponse.json({ ok: true, pageUrl, pageName, source: page.source, businessName: page.business_name || null });
  } catch (e: unknown) {
    return jsonUserFacingError(e, { status: 500 });
  }
}
