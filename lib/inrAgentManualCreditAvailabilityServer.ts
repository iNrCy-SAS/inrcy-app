import "server-only";
import { getAiMediaQuotaSnapshot } from "@/lib/aiMediaGenerationQuota";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { isAdminUserForAi } from "@/lib/aiUsageQuota";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadInstantMediaMixState } from "@/lib/inrAgentInstantMediaState";
import { inrAgentManualCreditAvailability, inrAgentManualPublishCreditBudget } from "@/lib/inrAgentManualCreditPolicy";
import { inrAgentChannelToBoosterPublishChannel } from "@/lib/inrAgentPublishChannels";
import type { InrAgentAutomationSettings } from "@/lib/inrAgentSettings";

export async function getInrAgentManualPublishCreditAvailability(args: {
  accountId: string;
  actorAuthUserId: string;
  automation: InrAgentAutomationSettings;
}) {
  const edition = await getDashboardEditionForAccountId(args.accountId);
  const [quota,unlimited,mix] = await Promise.all([
    getAiMediaQuotaSnapshot({accountId:args.accountId,actorAuthUserId:args.actorAuthUserId,edition}),
    isAdminUserForAi(supabaseAdmin,args.actorAuthUserId),
    loadInstantMediaMixState(supabaseAdmin,args.accountId,args.automation.publicationMediaTypes),
  ]);
  const required = inrAgentManualPublishCreditBudget({
    kind:mix.mediaKind,imageCount:mix.imageCount,
    channels:args.automation.allowedChannels.map(inrAgentChannelToBoosterPublishChannel).filter((value): value is NonNullable<typeof value> => Boolean(value)),
  });
  return inrAgentManualCreditAvailability({ready:quota.creditsReady,unlimited,remaining:quota.credits.remaining,required});
}
