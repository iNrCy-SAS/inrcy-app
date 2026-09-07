import { NextResponse } from "next/server";

import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import {
  fetchPinterestUserAccount,
  getPinterestAccessToken,
} from "@/lib/pinterestOAuth";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T) {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServer();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData?.user;
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Non authentifié." }, { status: 401 });
    }

    const activeUserId = await resolveActiveInrcyAccountId(supabase, user.id);
    const states = await getChannelConnectionStates(supabase, activeUserId);

    let pinterestLabel = "";
    let pinterestUrl = "";
    if (states.pinterest.connected && !states.pinterest.requiresUpdate) {
      const accessToken = await getPinterestAccessToken(activeUserId, request.url).catch(() => "");
      if (accessToken) {
        const account = await withTimeout(
          fetchPinterestUserAccount(accessToken).catch(() => null),
          4_000,
          null,
        );
        pinterestLabel = clean(account?.displayName || account?.username);
        pinterestUrl = clean(account?.profileUrl);
      }
    }

    const instagramUsername = clean(states.instagram.username).replace(/^@+/, "");
    const tiktokUsername = clean(states.tiktok.username).replace(/^@+/, "");
    const xUsername = clean(states.x.username).replace(/^@+/, "");

    return NextResponse.json({
      ok: true,
      identities: {
        site_inrcy: states.site_inrcy.connected ? clean(states.site_inrcy.url) : "",
        site_web: states.site_web.connected ? clean(states.site_web.url) : "",
        gmb: states.gmb.connected ? clean(states.gmb.resource_label) : "",
        facebook: states.facebook.connected ? clean(states.facebook.resource_label) : "",
        instagram: states.instagram.connected && instagramUsername ? `@${instagramUsername}` : "",
        linkedin: states.linkedin.connected ? clean(states.linkedin.organization_name || states.linkedin.display_name) : "",
        tiktok: states.tiktok.connected && tiktokUsername ? `@${tiktokUsername}` : "",
        youtube_shorts: states.youtube_shorts.connected ? clean(states.youtube_shorts.channel_name) : "",
        pinterest: states.pinterest.connected ? pinterestLabel : "",
        x: states.x.connected ? (xUsername ? `@${xUsername}` : clean(states.x.display_name)) : "",
      },
      urls: {
        site_inrcy: clean(states.site_inrcy.url),
        site_web: clean(states.site_web.url),
        gmb: clean(states.gmb.url),
        facebook: clean(states.facebook.page_url),
        instagram: clean(states.instagram.profile_url),
        linkedin: clean(states.linkedin.organization_id ? states.linkedin.organization_url : states.linkedin.profile_url),
        tiktok: clean(states.tiktok.profile_url),
        youtube_shorts: clean(states.youtube_shorts.channel_url),
        pinterest: pinterestUrl,
        x: clean(states.x.profile_url),
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Identités des canaux indisponibles." },
      { status: 400 },
    );
  }
}
