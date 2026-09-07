import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";

export async function GET() {
  const supabase = await createSupabaseServer();
  const { data: authData, error } = await supabase.auth.getUser();
  if (error || !authData?.user) {
    return NextResponse.json(
      {
        connected: false,
        accountConnected: false,
        requiresUpdate: false,
        connection_status: "disconnected",
      },
      { status: 200 },
    );
  }
  const userId = await resolveActiveInrcyAccountId(supabase, authData.user.id);
  const states = await getChannelConnectionStates(supabase, userId);
  return NextResponse.json(states.x);
}
