import { isMetaChannelPilotEnabledForAccount, isMetaChannelPilotEnabledForActorAndAccount } from "@/lib/metaChannelRolloutServer";
import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { isAuthorizedCronRequest, getCronUserIdFromRequest } from "@/lib/cronAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readInrBadgeStats } from "@/lib/inrBadgeAnalytics";
import { captureApiException } from "@/lib/observability/sentry";
import { withApi } from "@/lib/observability/withApi";

async function inrStatsBadgeHandler(req: Request) {
  try {
    const cronUserId = isAuthorizedCronRequest(req) ? getCronUserIdFromRequest(req) : "";
    const supabase = cronUserId ? supabaseAdmin : await createSupabaseServer();
    let userId = cronUserId;

    if (!userId) {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
      }
      userId = await resolveActiveInrcyAccountId(supabase, user.id);
    }

    const metaPilotEnabled = await (cronUserId ? isMetaChannelPilotEnabledForAccount(supabase, userId) : isMetaChannelPilotEnabledForActorAndAccount(supabase, userId));
    const stats = await readInrBadgeStats(supabase, userId, { metaPilotEnabled });
    return NextResponse.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    captureApiException(req, error, {
      area: "inrstats",
      operation: "GET /api/inrstats/inrbadge",
      statusCode: 500,
    });
    return jsonUserFacingError(error, { status: 500 });
  }
}

export const GET = withApi(inrStatsBadgeHandler, { route: "/api/inrstats/inrbadge" });
