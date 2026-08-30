import { NextResponse } from "next/server";

import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { clearAllToolCaches } from "@/lib/statsCache";
import { tryDecryptToken } from "@/lib/oauthCrypto";
import { buildTiktokSettingsPatch } from "@/lib/tiktokSettings";
import { readTiktokSettings, saveTiktokSettings } from "@/lib/tiktokRouteStorage";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";

async function revokeTiktokToken(token: string) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return;

  await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      token,
    }).toString(),
    cache: "no-store",
  }).catch(() => null);
}

export async function POST() {
  const { supabase, user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const { data: integration } = await supabaseAdmin
    .from("integrations")
    .select("access_token_enc")
    .eq("user_id", activeUserId)
    .eq("provider", "tiktok")
    .eq("source", "tiktok")
    .eq("product", "tiktok")
    .maybeSingle();

  const token = tryDecryptToken(integration?.access_token_enc);
  if (token) await revokeTiktokToken(token);

  const { error: deleteError } = await supabaseAdmin
    .from("integrations")
    .delete()
    .eq("user_id", activeUserId)
    .eq("provider", "tiktok")
    .eq("source", "tiktok")
    .eq("product", "tiktok");
  if (deleteError) {
    return jsonUserFacingError(deleteError, {
      status: 500,
      fallback: "Impossible de déconnecter TikTok.",
    });
  }

  const { data: remaining, error: verifyError } = await supabaseAdmin
    .from("integrations")
    .select("id")
    .eq("user_id", activeUserId)
    .eq("provider", "tiktok")
    .eq("source", "tiktok")
    .eq("product", "tiktok")
    .limit(1);
  if (verifyError) return jsonUserFacingError(verifyError, { status: 500 });
  if (remaining?.length) {
    return NextResponse.json({ error: "TikTok n’a pas été déconnecté. Réessayez." }, { status: 500 });
  }

  const { root, tiktok: current } = await readTiktokSettings(supabaseAdmin, activeUserId);
  const next = buildTiktokSettingsPatch(current, {
    connected: false,
    accountConnected: false,
    username: "",
    displayName: "",
    profileUrl: "",
    avatarUrl: "",
    openId: "",
    scopes: "",
    expiresAt: null,
    mode: "oauth",
    stats: {
      followerCount: null,
      followingCount: null,
      likesCount: null,
      videoCount: null,
    },
  });

  await saveTiktokSettings(supabaseAdmin, activeUserId, root, next);
  await clearAllToolCaches(supabase, activeUserId);
  return NextResponse.json({ ok: true, tiktok: next });
}
