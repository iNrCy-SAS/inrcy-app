import { NextResponse } from "next/server";

import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readYoutubeShortsSettingsWithOAuth } from "@/lib/youtubeShortsOAuth";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";

export async function GET() {
  const { user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const [{ youtubeShorts, integration }, states] = await Promise.all([
    readYoutubeShortsSettingsWithOAuth(supabaseAdmin, activeUserId),
    getChannelConnectionStates(supabaseAdmin, activeUserId),
  ]);
  const canonical = states.youtube_shorts;
  return NextResponse.json({
    ok: true,
    youtube_shorts: {
      ...youtubeShorts,
      connected: Boolean(canonical.connected && !canonical.requiresUpdate),
      accountConnected: Boolean(canonical.accountConnected),
      requiresUpdate: Boolean(canonical.requiresUpdate),
      connectionStatus: canonical.connection_status,
    },
    integration_status: integration?.status ?? null,
  });
}
