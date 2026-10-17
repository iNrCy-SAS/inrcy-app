import { isMetaChannelPilotEnabledForActorAndAccount } from "@/lib/metaChannelRolloutServer";
import { withoutThreadsData } from "@/lib/stats/metaPilotData";
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { isTransientSupabaseReadError, runTransientPostgrestRead } from "@/lib/supabaseTransientRetry";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServer();
  let auth;
  try {
    auth = await runTransientPostgrestRead<Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]>(async () => {
      const result = await supabase.auth.getUser();
      return { ...result, status: isTransientSupabaseReadError(result.error) ? 503 : 0 };
    });
  } catch (error) {
    if (!isTransientSupabaseReadError(error)) throw error;
    return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503, headers: { "Retry-After": "3", "Cache-Control": "no-store" } });
  }
  const { data: authData, error: authErr } = auth;
  if (isTransientSupabaseReadError(authErr)) {
    return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503, headers: { "Retry-After": "3", "Cache-Control": "no-store" } });
  }
  if (authErr || !authData?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const activeUserId = await resolveActiveInrcyAccountId(supabase, authData.user.id);

  const metaPilotEnabled = await isMetaChannelPilotEnabledForActorAndAccount(supabase, activeUserId);
  const states = await getChannelConnectionStates(supabase, activeUserId, undefined, { metaPilotEnabled });
  return NextResponse.json(withoutThreadsData(states, metaPilotEnabled));
}
