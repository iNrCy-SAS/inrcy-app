import { isMetaChannelPilotEnabledForActorAndAccount } from "@/lib/metaChannelRolloutServer";
import { withoutThreadsData } from "@/lib/stats/metaPilotData";
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServer();
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const activeUserId = await resolveActiveInrcyAccountId(supabase, authData.user.id);

  const metaPilotEnabled = await isMetaChannelPilotEnabledForActorAndAccount(supabase, activeUserId);
  const states = await getChannelConnectionStates(supabase, activeUserId, undefined, { metaPilotEnabled });
  return NextResponse.json(withoutThreadsData(states, metaPilotEnabled));
}
