import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { computeInertiaSnapshot } from "@/lib/loyalty/inertia";
import { getIsoWeekId, getIsoWeekStart } from "@/lib/weeklyGoals";

export type InertiaActionKey =
  | "account_open"
  | "profile_complete"
  | "activity_complete"
  | "connect_channel"
  | "create_actu"
  | "weekly_feature_use"
  | "weekly_propulser_use"
  | "weekly_fideliser_use"
  | "monthly_seniority";

export type WeeklyMissionActionKey = Extract<
  InertiaActionKey,
  "create_actu" | "weekly_feature_use" | "weekly_propulser_use" | "weekly_fideliser_use"
>;

const MULTIPLIED_ACTION_KEYS = new Set<InertiaActionKey>([
  "create_actu",
  "weekly_feature_use",
  "weekly_propulser_use",
  "weekly_fideliser_use",
]);

const PROPULSER_CAMPAIGNS = new Set([
  "propulser:valorize",
  "propulser:review_mail",
  "propulser:promo_mail",
  // compat ancien historique : ces actions appartenaient à Booster avant la refonte
  "booster:valorize",
  "booster:review_mail",
  "booster:promo_mail",
]);

const FIDELISER_CAMPAIGNS = new Set([
  "fideliser:newsletter_mail",
  "fideliser:thanks_mail",
  "fideliser:satisfaction_mail",
]);

const WEEKLY_CAMPAIGN_FOLDERS: Record<string, { tool: "propulser" | "fideliser"; type: string }> = {
  propulsions: { tool: "propulser", type: "" },
  recoltes: { tool: "propulser", type: "review_mail" },
  offres: { tool: "propulser", type: "promo_mail" },
  fidelisations: { tool: "fideliser", type: "" },
  informations: { tool: "fideliser", type: "newsletter_mail" },
  suivis: { tool: "fideliser", type: "thanks_mail" },
  enquetes: { tool: "fideliser", type: "satisfaction_mail" },
};

type AwardResult = {
  ok: boolean;
  skipped?: boolean;
  amount?: number;
  balance?: number | null;
  updatedAt?: string | null;
  error?: string;
};

type CampaignLike = {
  trackKind?: string | null;
  trackType?: string | null;
  folder?: string | null;
};

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function getWeeklyMissionForCampaign(campaign: CampaignLike): "propulser" | "fideliser" | null {
  const kind = normalize(campaign.trackKind);
  const type = normalize(campaign.trackType);
  const folder = normalize(campaign.folder);

  if (kind && type) {
    const signature = `${kind}:${type}`;
    if (PROPULSER_CAMPAIGNS.has(signature)) return "propulser";
    if (FIDELISER_CAMPAIGNS.has(signature)) return "fideliser";
  }

  if (kind === "propulser") return "propulser";
  if (kind === "fideliser") return "fideliser";

  const folderMatch = WEEKLY_CAMPAIGN_FOLDERS[folder];
  if (!folderMatch) return null;

  if (!kind && !type) return folderMatch.tool;
  if (!folderMatch.type) return folderMatch.tool;
  if (type && folderMatch.type === type) return folderMatch.tool;
  if (!type && folderMatch.tool) return folderMatch.tool;

  return null;
}

export function isWeeklyFeatureCampaign(campaign: CampaignLike) {
  return getWeeklyMissionForCampaign(campaign) !== null;
}

async function getTurboMultiplier(userId: string) {
  try {
    const states = await getChannelConnectionStates(supabaseAdmin, userId);
    const snapshot = computeInertiaSnapshot({
      site_inrcy: states.site_inrcy.connected && states.site_inrcy.statsConnected,
      site_web: states.site_web.connected && states.site_web.statsConnected,
      gmb: states.gmb.connected && !states.gmb.requiresUpdate,
      facebook: states.facebook.connected && !states.facebook.requiresUpdate,
      instagram: states.instagram.connected && !states.instagram.requiresUpdate,
      linkedin: states.linkedin.connected && !states.linkedin.requiresUpdate,
      tiktok: states.tiktok.connected && !states.tiktok.requiresUpdate,
      youtube_shorts: states.youtube_shorts.connected && !states.youtube_shorts.requiresUpdate,
    }, { maxMultiplier: 7 });
    return snapshot.multiplier;
  } catch {
    return 1;
  }
}

export async function awardInertiaActionForUser(args: {
  userId: string;
  actionKey: InertiaActionKey;
  baseAmount: number;
  sourceId: string;
  label: string;
  meta?: Record<string, unknown>;
}): Promise<AwardResult> {
  const userId = String(args.userId || "").trim();
  const actionKey = String(args.actionKey || "").trim() as InertiaActionKey;
  const sourceId = String(args.sourceId || "").trim();
  const baseAmount = Number(args.baseAmount || 0);

  if (!userId || !actionKey || !sourceId || !Number.isFinite(baseAmount) || baseAmount <= 0) {
    return { ok: false, skipped: true, error: "award_invalid_args" };
  }

  const turbo = MULTIPLIED_ACTION_KEYS.has(actionKey) ? await getTurboMultiplier(userId) : 1;
  const amount = MULTIPLIED_ACTION_KEYS.has(actionKey) ? Math.round(baseAmount * turbo) : baseAmount;
  const updatedAt = new Date().toISOString();

  // Écriture atomique : deux requêtes concurrentes sur la même mission ne
  // provoquent plus de 23505/409. La contrainte unique existante choisit une
  // seule gagnante et l'autre est ignorée proprement par Postgres.
  const insertRes = await supabaseAdmin
    .from("loyalty_ledger")
    .upsert(
      {
        user_id: userId,
        action_key: actionKey,
        source_id: sourceId,
        amount,
        label: args.label,
        meta: {
          ...(args.meta || {}),
          turbo_multiplier: turbo,
          base_amount: baseAmount,
        },
      },
      {
        onConflict: "user_id,action_key,source_id",
        ignoreDuplicates: true,
      },
    )
    .select("id,amount");

  if (insertRes.error) {
    return { ok: false, skipped: true, error: insertRes.error.message };
  }

  // `ignoreDuplicates` renvoie zéro ligne pour la requête concurrente perdante.
  const insertedLedger = insertRes.data?.[0];
  if (!insertedLedger?.id) {
    return { ok: true, skipped: true };
  }

  const balanceRes = await supabaseAdmin
    .from("loyalty_balance")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();

  if (!balanceRes.error && balanceRes.data) {
    const current = Number((balanceRes.data as { balance?: number | null }).balance ?? 0);
    const next = (Number.isFinite(current) ? current : 0) + amount;
    const updateRes = await supabaseAdmin
      .from("loyalty_balance")
      .update({ balance: next })
      .eq("user_id", userId);

    if (updateRes.error) return { ok: false, skipped: true, amount, error: updateRes.error.message };
    return { ok: true, amount, balance: next, updatedAt };
  }

  const createBalanceRes = await supabaseAdmin
    .from("loyalty_balance")
    .upsert(
      { user_id: userId, balance: amount },
      { onConflict: "user_id", ignoreDuplicates: true },
    )
    .select("balance");

  if (createBalanceRes.error) {
    return { ok: false, skipped: true, amount, error: createBalanceRes.error.message };
  }

  if (createBalanceRes.data?.[0]) {
    return { ok: true, amount, balance: amount, updatedAt };
  }

  // Une autre récompense vient de créer le solde : on l'incrémente sans
  // déclencher de violation unique visible dans les logs.
  const retryBalanceRes = await supabaseAdmin
    .from("loyalty_balance")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  if (retryBalanceRes.error || !retryBalanceRes.data) {
    return {
      ok: false,
      skipped: true,
      amount,
      error: retryBalanceRes.error?.message || "loyalty_balance_missing",
    };
  }

  const current = Number(
    (retryBalanceRes.data as { balance?: number | null }).balance ?? 0,
  );
  const next = (Number.isFinite(current) ? current : 0) + amount;
  const retryUpdateRes = await supabaseAdmin
    .from("loyalty_balance")
    .update({ balance: next })
    .eq("user_id", userId);

  if (retryUpdateRes.error) {
    return { ok: false, skipped: true, amount, error: retryUpdateRes.error.message };
  }

  return { ok: true, amount, balance: next, updatedAt };
}

export async function awardWeeklyFeatureUseForCampaign(args: CampaignLike & {
  userId: string;
  campaignId?: string | null;
  sentCount?: number | null;
}) {
  const missionTool = getWeeklyMissionForCampaign(args);
  if (!args.userId || Number(args.sentCount || 0) <= 0 || !missionTool) {
    return { ok: true, skipped: true } satisfies AwardResult;
  }

  const actionKey: WeeklyMissionActionKey = missionTool === "propulser" ? "weekly_propulser_use" : "weekly_fideliser_use";

  return awardInertiaActionForUser({
    userId: args.userId,
    actionKey,
    baseAmount: 10,
    sourceId: `week-${getIsoWeekId()}`,
    label: missionTool === "propulser" ? "Action Propulser" : "Action Fidéliser",
    meta: {
      origin: "mail_campaign",
      mission_tool: missionTool,
      campaign_id: args.campaignId || null,
      track_kind: args.trackKind || null,
      track_type: args.trackType || null,
      folder: args.folder || null,
      sent_count: Number(args.sentCount || 0),
    },
  });
}

export async function repairWeeklyMissionAwardsForUser(
  userId: string,
  options: { includePremiumMissions?: boolean } = {},
) {
  const weekStartIso = getIsoWeekStart().toISOString();
  const results: AwardResult[] = [];
  const includePremiumMissions = options.includePremiumMissions !== false;

  try {
    const { data: publishEvents } = await supabaseAdmin
      .from("app_events")
      .select("id")
      .eq("user_id", userId)
      .eq("module", "booster")
      .eq("type", "publish")
      .gte("created_at", weekStartIso)
      .limit(1);

    if ((publishEvents || []).length > 0) {
      results.push(await awardInertiaActionForUser({
        userId,
        actionKey: "create_actu",
        baseAmount: 10,
        sourceId: `week-${getIsoWeekId()}`,
        label: "Actu créée",
        meta: { origin: "weekly_mission_repair" },
      }));
    }
  } catch {
    // Réparation best-effort : ne jamais bloquer l'affichage.
  }

  if (!includePremiumMissions) return results;

  try {
    const { data: propulserEvents } = await supabaseAdmin
      .from("app_events")
      .select("id")
      .eq("user_id", userId)
      .eq("module", "propulser")
      .eq("type", "valorize")
      .gte("created_at", weekStartIso)
      .limit(1);

    if ((propulserEvents || []).length > 0) {
      results.push(await awardInertiaActionForUser({
        userId,
        actionKey: "weekly_propulser_use",
        baseAmount: 10,
        sourceId: `week-${getIsoWeekId()}`,
        label: "Action Propulser",
        meta: { origin: "weekly_mission_repair", mission_tool: "propulser", type: "valorize" },
      }));
    }
  } catch {
    // Réparation best-effort : ne jamais bloquer l'affichage.
  }

  try {
    const { data: campaigns } = await supabaseAdmin
      .from("mail_campaigns")
      .select("id,track_kind,track_type,folder,sent_count")
      .eq("user_id", userId)
      .gte("created_at", weekStartIso)
      .gt("sent_count", 0)
      .order("created_at", { ascending: false })
      .limit(20);

    const eligiblePropulser = (campaigns || []).find((campaign: any) => getWeeklyMissionForCampaign({
      trackKind: campaign.track_kind,
      trackType: campaign.track_type,
      folder: campaign.folder,
    }) === "propulser");

    const eligibleFideliser = (campaigns || []).find((campaign: any) => getWeeklyMissionForCampaign({
      trackKind: campaign.track_kind,
      trackType: campaign.track_type,
      folder: campaign.folder,
    }) === "fideliser");

    for (const eligible of [eligiblePropulser, eligibleFideliser].filter(Boolean) as any[]) {
      results.push(await awardWeeklyFeatureUseForCampaign({
        userId,
        campaignId: eligible.id,
        trackKind: eligible.track_kind,
        trackType: eligible.track_type,
        folder: eligible.folder,
        sentCount: eligible.sent_count,
      }));
    }
  } catch {
    // Réparation best-effort : ne jamais bloquer l'affichage.
  }

  return results;
}
