import "server-only";

import { isMetaChannelPilotEnabledForAccount } from "@/lib/metaChannelRolloutServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { type BoosterChannels } from "@/lib/boosterPrompt";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { getAppBubbleAccessMapForUser } from "@/lib/appBubbleAccessServer";
import { isBubbleEnabled, type AppBubbleKey } from "@/lib/bubbleAccess";
import { isOfficialPublicationChannelConnected } from "@/lib/publicationChannelAvailability";
import { ensureSystemManagedInrSearch } from "@/lib/inrSearchProvisioning";
import { getInrSearchPublicStatus } from "@/lib/inrSearchPublic";
import { INR_AGENT_PINTEREST_PUBLISH_MIGRATION_FLAG, INR_AGENT_X_PUBLISH_MIGRATION_FLAG, sanitizeInrAgentAutomationSettings, type InrAgentAutomationSettings, type InrAgentChannel } from "@/lib/inrAgentSettings";
import { inrAgentChannelToBoosterPublishChannel } from "@/lib/inrAgentPublishChannels";
import { type JsonRecord, type EditorialPreparationTarget, type AutomationDbRow } from "@/lib/inrAgentPublicationPreparationTypes";
import { allowedBoosterChannels, cleanText, cleanList, asRecord, normalizeAgentTone, normalizeEditorialPlan } from "@/lib/inrAgentPublicationPreparationPolicy";

function rowToAutomationSettings(
  row: AutomationDbRow | null
): InrAgentAutomationSettings {
  return sanitizeInrAgentAutomationSettings("publish", {
    enabled: row?.enabled ?? undefined,
    frequency: row?.frequency as InrAgentAutomationSettings["frequency"],
    dayOfWeek: row?.day_of_week ?? undefined,
    time: row?.time ?? undefined,
    validationMode:
      row?.validation_mode as InrAgentAutomationSettings["validationMode"],
    allowedChannels:
      row?.allowed_channels as InrAgentAutomationSettings["allowedChannels"],
    allowedThemes:
      row?.allowed_themes as InrAgentAutomationSettings["allowedThemes"],
    useImageBank: row?.use_image_bank ?? undefined,
    imageRequired: row?.image_required ?? undefined,
    recipientScope:
      row?.recipient_scope as InrAgentAutomationSettings["recipientScope"],
    sourceStrategy:
      row?.source_strategy as InrAgentAutomationSettings["sourceStrategy"],
    lastPreparedAt: row?.last_prepared_at ?? null,
    lastExecutedAt: row?.last_executed_at ?? null,
    nextRunAt: row?.next_run_at ?? null,
    metadata: row?.metadata ?? {},
  });
}

export async function loadEditorialPreparationTarget(args: {
  userId: string;
  isCron: boolean;
  body: JsonRecord | null;
}): Promise<EditorialPreparationTarget | null> {
  const targetActionId = cleanText(args.body?.targetActionId, 120);
  const triggeredBy = cleanText(args.body?.triggeredBy, 120);
  if (!targetActionId) return null;
  if (!args.isCron || triggeredBy !== "inr_agent_editorial_plan") {
    throw new Error("editorial_preparation_not_authorized");
  }

  const { data, error } = await supabaseAdmin
    .from("inr_agent_actions")
    .select("id,status,payload,metadata")
    .eq("id", targetActionId)
    .eq("user_id", args.userId)
    .eq("automation_key", "publish")
    .maybeSingle();
  if (error) throw error;
  const row = asRecord(data);
  const payload = asRecord(row.payload);
  const metadata = asRecord(row.metadata);
  const plan = normalizeEditorialPlan(payload.editorialPlan);
  if (
    !row.id ||
    row.status !== "executing" ||
    metadata.editorialPlan !== true ||
    !plan
  ) {
    throw new Error("editorial_preparation_target_invalid");
  }
  return {
    id: String(row.id),
    payload,
    metadata,
    plan,
  };
}

export async function selectConnectedChannels(args: {
  supabase: { from: (table: string) => any };
  userId: string;
  automation: InrAgentAutomationSettings;
}): Promise<BoosterChannels[]> {
  const [states, bubbleAccess, provisioned] = await Promise.all([
    getChannelConnectionStates(args.supabase, args.userId),
    getAppBubbleAccessMapForUser(args.supabase, args.userId),
    ensureSystemManagedInrSearch(args.supabase as any, args.userId),
  ]);
  const metaPilotEnabled = await isMetaChannelPilotEnabledForAccount(args.supabase, args.userId);
  const inrSearchStatus = await getInrSearchPublicStatus(
    provisioned.inrSearch.slug
  );

  const isAllowedBoosterChannel = (
    channel: BoosterChannels | null | undefined
  ): channel is BoosterChannels => {
    return channel != null && allowedBoosterChannels.has(channel);
  };

  const allowedAgentChannels: InrAgentChannel[] = [
    ...args.automation.allowedChannels,
  ];
  if (
    states.pinterest.connected &&
    !states.pinterest.requiresUpdate &&
    !allowedAgentChannels.includes("pinterest") &&
    args.automation.metadata?.[INR_AGENT_PINTEREST_PUBLISH_MIGRATION_FLAG] !==
      true
  ) {
    allowedAgentChannels.push("pinterest");
  }
  if (
    states.x.connected &&
    !states.x.requiresUpdate &&
    !allowedAgentChannels.includes("x") &&
    args.automation.metadata?.[INR_AGENT_X_PUBLISH_MIGRATION_FLAG] !== true
  ) {
    // Même migration ponctuelle que l'écran Réglages : un ancien compte ne
    // doit pas afficher X comme sélectionné puis le perdre à la préparation.
    // Le drapeau passé à true après une sauvegarde respecte ensuite une vraie
    // désélection volontaire du professionnel.
    allowedAgentChannels.push("x");
  }

  const allowedChannels = allowedAgentChannels
    .map((channel) => inrAgentChannelToBoosterPublishChannel(channel))
    .filter(isAllowedBoosterChannel);

  const bubbleKeyByChannel: Record<BoosterChannels, AppBubbleKey> = {
    site_web: "site_web",
    inr_search: "inr_search",
    gmb: "gmb",
    facebook: "facebook",
    instagram: "instagram",
    threads: "threads",
    linkedin: "linkedin",
    tiktok: "tiktok",
    youtube_shorts: "youtube_shorts",
    pinterest: "pinterest",
    x: "x",
  };

  const connected: Record<BoosterChannels, boolean> = {
    site_web: isOfficialPublicationChannelConnected(states.site_web),
    inr_search:
      isOfficialPublicationChannelConnected(states.inr_search) &&
      inrSearchStatus.published,
    gmb: isOfficialPublicationChannelConnected(states.gmb),
    facebook: isOfficialPublicationChannelConnected(states.facebook),
    instagram: (states.instagram.authMode !== "instagram_login" || metaPilotEnabled) && isOfficialPublicationChannelConnected(states.instagram),
    threads: metaPilotEnabled && isOfficialPublicationChannelConnected(states.threads),
    linkedin: isOfficialPublicationChannelConnected(states.linkedin),
    tiktok: isOfficialPublicationChannelConnected(states.tiktok),
    youtube_shorts: isOfficialPublicationChannelConnected(
      states.youtube_shorts
    ),
    pinterest:
      isOfficialPublicationChannelConnected(states.pinterest) &&
      Boolean(states.pinterest.default_board_id),
    x: isOfficialPublicationChannelConnected(states.x),
  };

  const uniqueChannels: BoosterChannels[] = Array.from(
    new Set<BoosterChannels>(allowedChannels)
  );
  return uniqueChannels.filter(
    (channel) =>
      isBubbleEnabled(bubbleAccess, bubbleKeyByChannel[channel]) &&
      connected[channel]
  );
}

export async function loadPublishAutomationSettings(userId: string) {
  const { data } = await supabaseAdmin
    .from("inr_agent_automation_settings")
    .select(
      "enabled, frequency, day_of_week, time, validation_mode, allowed_channels, allowed_themes, use_image_bank, image_required, recipient_scope, source_strategy, last_prepared_at, last_executed_at, next_run_at, metadata"
    )
    .eq("user_id", userId)
    .eq("automation_key", "publish")
    .maybeSingle();

  return rowToAutomationSettings((data as AutomationDbRow | null) ?? null);
}

export async function loadInrAgentTone(userId: string) {
  const { data } = await supabaseAdmin
    .from("inr_agent_settings")
    .select("tone")
    .eq("user_id", userId)
    .maybeSingle();
  return normalizeAgentTone(data?.tone);
}

export async function loadEarlierEditorialAngles(args: {
  userId: string;
  actionId: string;
  scheduledFor: string;
}) {
  const lookupSince = new Date(Date.now() - 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from("inr_agent_actions")
    .select(
      "id,title,preview_text,target_themes,scheduled_for,payload,metadata,status"
    )
    .eq("user_id", args.userId)
    .eq("automation_key", "publish")
    .gte("scheduled_for", lookupSince)
    .lt("scheduled_for", args.scheduledFor)
    .order("scheduled_for", { ascending: true })
    .limit(24);

  return (Array.isArray(data) ? data : [])
    .filter((row) => {
      const metadata = asRecord(row.metadata);
      const plan = asRecord(asRecord(row.payload).editorialPlan);
      return (
        String(row.id || "") !== args.actionId &&
        metadata.editorialPlan === true &&
        String(plan.state || metadata.editorialState || "") === "ready"
      );
    })
    .map((row) => {
      const theme = cleanList(row.target_themes, 1, 50)[0] || "thème libre";
      const angle = cleanText(row.preview_text || row.title, 260);
      return angle ? `- ${theme} : ${angle}` : "";
    })
    .filter(Boolean)
    .slice(-12);
}

export async function resolveMediaGenerationActorAuthUserId(args: {
  accountId: string;
  requestAuthUserId: string;
  isCron: boolean;
}) {
  if (!args.isCron && args.requestAuthUserId) return args.requestAuthUserId;

  const { data } = await supabaseAdmin
    .from("inrcy_account_members")
    .select("auth_user_id,role")
    .eq("account_id", args.accountId)
    .limit(20);
  const rows = Array.isArray(data) ? data : [];
  const owner = rows.find(
    (row) =>
      String(row?.role || "")
        .trim()
        .toLowerCase() === "owner"
  );
  const resolved = String(
    owner?.auth_user_id || rows[0]?.auth_user_id || ""
  ).trim();
  return resolved || args.requestAuthUserId || args.accountId;
}
