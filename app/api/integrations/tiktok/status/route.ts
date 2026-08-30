import { NextResponse } from "next/server";

import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readTiktokSettingsWithOAuth } from "@/lib/tiktokRouteStorage";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";

export async function GET() {
  const { user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const [{ tiktok }, states] = await Promise.all([
    readTiktokSettingsWithOAuth(supabaseAdmin, activeUserId),
    getChannelConnectionStates(supabaseAdmin, activeUserId),
  ]);
  const canonical = states.tiktok;
  return NextResponse.json({
    ok: true,
    tiktok: {
      ...tiktok,
      connected: Boolean(canonical.connected && !canonical.requiresUpdate),
      accountConnected: Boolean(canonical.accountConnected),
      requiresUpdate: Boolean(canonical.requiresUpdate),
      connectionStatus: canonical.connection_status,
    },
  });
}
