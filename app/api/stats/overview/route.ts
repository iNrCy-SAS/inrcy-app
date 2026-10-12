import { isMetaChannelPilotEnabledForActorAndAccount, isMetaChannelPilotEnabledForAccount, metaChannelPilotDeniedResponse } from "@/lib/metaChannelRolloutServer";
import { withoutThreadsData } from "@/lib/stats/metaPilotData";
import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildStatsOverview } from "@/lib/stats/buildOverview";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";

export async function GET(request: Request) {
  try {
    const { createSupabaseServer } = await import("@/lib/supabaseServer");

    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(Number(searchParams.get("days") || 28), 7), 90);
    const fresh = searchParams.get("fresh") === "1";
    const includeRaw = (searchParams.get("include") || "").trim();
    const snapshotDate = (searchParams.get("snapshotDate") || "").trim() || null;

    const cronSecret = process.env.VERCEL_CRON_SECRET || process.env.CRON_SECRET || "";
    const suppliedSecret = (searchParams.get("secret") || request.headers.get("x-cron-secret") || "").trim();
    const forcedUserId = (searchParams.get("userId") || "").trim();
    const isCronMode = Boolean(cronSecret && suppliedSecret && suppliedSecret === cronSecret && forcedUserId);

    const supabase = isCronMode ? supabaseAdmin : await createSupabaseServer();
    let userId = forcedUserId;
    if (!isCronMode) {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData?.user) {
        return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
      }
      userId = await resolveActiveInrcyAccountId(supabase, authData.user.id);
    }

    const metaPilotEnabled = await (isCronMode ? isMetaChannelPilotEnabledForAccount(supabase, userId) : isMetaChannelPilotEnabledForActorAndAccount(supabase, userId));
    if (includeRaw === "threads" && !metaPilotEnabled) return metaChannelPilotDeniedResponse();
    const payload = await buildStatsOverview({
      metaPilotEnabled,
      supabase,
      userId,
      days,
      includeRaw,
      fresh,
      snapshotDate,
    });

    return NextResponse.json(payload, {
      headers: fresh
        ? {
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          }
        : undefined,
    });
  } catch (e) {
    return jsonUserFacingError(e, { status: 500 });
  }
}
