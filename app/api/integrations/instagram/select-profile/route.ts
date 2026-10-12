import { resolveInstagramAuthMode } from "@/lib/instagramAuthMode";
import { isMetaChannelPilotEnabledForActorAndAccount, metaChannelPilotDeniedResponse } from "@/lib/metaChannelRolloutServer";
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { clearAllToolCaches } from "@/lib/statsCache";
import { tryDecryptToken, encryptToken } from "@/lib/oauthCrypto";
import { asRecord, asString } from "@/lib/tsSafe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { extractFacebookUserTokens, findAccessibleFacebookPage, listAccessibleFacebookPagesFromTokens } from "@/lib/metaBusinessAssets";

import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServer>>;

async function invalidateUserStatsCache(supabase: SupabaseServerClient, userId: string) {
  await clearAllToolCaches(supabase, userId);
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  const activeUserId = await resolveActiveInrcyAccountId(supabase, user.id);

  const body = await req.json().catch(() => null);
  const bodyRec = asRecord(body);
  const pageId = String(bodyRec["pageId"] || "");
  if (!pageId) return NextResponse.json({ error: "Page manquante." }, { status: 400 });

  const { data: rows } = await supabase
    .from("integrations")
    .select("access_token_enc,id,meta")
    .eq("user_id", activeUserId)
    .eq("provider", "instagram")
    .eq("source", "instagram")
    .eq("product", "instagram")
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  const row = (rows?.[0] as unknown) ?? null;
  const rowRec = asRecord(row);
  const metaRec = asRecord(rowRec["meta"]);
  if (resolveInstagramAuthMode(metaRec) === "instagram_login") {
    if (!await isMetaChannelPilotEnabledForActorAndAccount(supabase, activeUserId)) return metaChannelPilotDeniedResponse();
    return NextResponse.json({ error: "Le compte Instagram est déjà connecté directement. Aucun profil Facebook n’est à sélectionner.", code: "instagram_direct_no_facebook_selection" }, { status: 409 });
  }
  const encryptedTokens = extractFacebookUserTokens(metaRec, asString(rowRec["access_token_enc"]) || null);
  const userTokens = encryptedTokens.map((raw) => tryDecryptToken(raw)).filter((v): v is string => !!v);
  if (!userTokens.length) return NextResponse.json({ error: "Compte Instagram non connecté." }, { status: 400 });

  const pages = await listAccessibleFacebookPagesFromTokens(userTokens);
  const page = findAccessibleFacebookPage(pages, pageId);
  if (!page) return NextResponse.json({ error: "Impossible de retrouver cette page Facebook." }, { status: 400 });
  if (!page.access_token) return NextResponse.json({ error: "Impossible de récupérer le token de cette page. Vérifiez les autorisations business." }, { status: 400 });

  const igId = page.instagram_business_account?.id || "";
  const username = page.instagram_business_account?.username || "";
  if (!igId) return NextResponse.json({ error: "Aucun compte Instagram professionnel n'est relié à cette page." }, { status: 400 });

  const { data: updatedRows, error: updateErr } = await supabaseAdmin
    .from("integrations")
    .update({
      status: "connected",
      resource_id: igId,
      resource_label: username || null,
      access_token_enc: encryptToken(page.access_token),
      expires_at: null,
      meta: {
        page_id: pageId,
        page_name: page.name || null,
        page_source: page.source,
        business_name: page.business_name || null,
        page_access_token_enc: encryptToken(page.access_token),
        user_access_token_enc: metaRec["user_access_token_enc"] || rowRec["access_token_enc"],
        standard_user_access_token_enc: metaRec["standard_user_access_token_enc"] || null,
        business_user_access_token_enc: metaRec["business_user_access_token_enc"] || null,
        ...withCurrentConnectionVersion("channel:instagram", {}),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", activeUserId)
    .eq("provider", "instagram")
    .eq("source", "instagram")
    .eq("product", "instagram")
    .select("id,status,resource_id,resource_label");

  if (updateErr) {
    return NextResponse.json({ error: getSimpleFrenchErrorMessage(updateErr, "Impossible d’enregistrer le compte Instagram.") }, { status: 500 });
  }

  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json({ error: "Aucune ligne Instagram mise à jour." }, { status: 500 });
  }

  await invalidateUserStatsCache(supabase, activeUserId);

  const profileUrl = username ? `https://www.instagram.com/${username}/` : null;

  try {
    const { data: scRow } = await supabaseAdmin.from("pro_tools_configs").select("settings").eq("user_id", activeUserId).maybeSingle();
    const scRec = asRecord(scRow);
    const current = asRecord(scRec["settings"]);
    const currentIg = asRecord(current["instagram"]);
    const merged = {
      ...current,
      instagram: {
        ...currentIg,
        accountConnected: true,
        connected: true,
        username: username || null,
        url: profileUrl,
        pageId,
        igId,
      },
    };
    await supabaseAdmin.from("pro_tools_configs").upsert({ user_id: activeUserId, settings: merged }, { onConflict: "user_id" });
  } catch {}

  return NextResponse.json({ ok: true, username: username || null, profileUrl, source: page.source, businessName: page.business_name || null });
}
