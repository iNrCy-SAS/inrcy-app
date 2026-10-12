import "server-only";

import { NextResponse } from "next/server";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { isMetaChannelPilotEnabledForActorAndAccount, metaChannelPilotDeniedResponse } from "@/lib/metaChannelRolloutServer";
import { META_DIRECT_CHANNELS_PUBLIC_ENABLED } from "@/lib/metaChannelRollout";
import { getMetaDirectOAuthConfig } from "@/lib/metaDirectOAuth";
import { clearAllToolCaches } from "@/lib/statsCache";
import type { MetaDirectProvider } from "@/lib/metaDirectTokens";

export async function metaDirectConnectionStatus(request: Request, provider: MetaDirectProvider) {
  const current = await getCurrentInrcyAccountScope();
  if (!current) return NextResponse.json({ connected: false, accountConnected: false }, { status: 401 });
  const accountId = current.scope.activeUserId;
  if (!await isMetaChannelPilotEnabledForActorAndAccount(supabaseAdmin, accountId)) return metaChannelPilotDeniedResponse();
  const states = await getChannelConnectionStates(current.supabase, accountId, undefined, { metaPilotEnabled: true });
  const state = provider === "instagram" ? states.instagram : states.threads;
  return NextResponse.json({ ...state, configured: getMetaDirectOAuthConfig(provider, request.url).configured, adminPilot: !META_DIRECT_CHANNELS_PUBLIC_ENABLED });
}

export async function disconnectMetaDirectConnection(request: Request, provider: MetaDirectProvider) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Origine non autorisée." }, { status: 403 });
  const current = await getCurrentInrcyAccountScope();
  if (!current) return NextResponse.json({ error: "Votre session a expiré. Reconnectez-vous." }, { status: 401 });
  const accountId = current.scope.activeUserId;
  if (!await isMetaChannelPilotEnabledForActorAndAccount(supabaseAdmin, accountId)) return metaChannelPilotDeniedResponse();
  const { error } = await supabaseAdmin.rpc("disconnect_meta_direct_connection", {
    p_account_id: accountId, p_channel: provider, p_admin_pilot: !META_DIRECT_CHANNELS_PUBLIC_ENABLED,
  });
  if (error) return NextResponse.json({ error: "La déconnexion n’a pas pu être enregistrée. Réessayez." }, { status: 503 });
  // The database has already bumped the cache epoch in the same transaction.
  try { await clearAllToolCaches(current.supabase, accountId); } catch {}
  return NextResponse.json({ ok: true });
}
