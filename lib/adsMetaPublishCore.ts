import {
  metaAssetFeedSpec,
  metaCreativeIdentity,
  type MetaAdsPlacement,
} from "./adsMetaPlacement.ts";

export type MetaAdsPublishStage =
  | "preparing"
  | "feed_image_uploaded"
  | "story_reel_image_uploaded"
  | "campaign_created"
  | "adset_created"
  | "creative_created"
  | "ad_created"
  | "demo_paused"
  | "ad_activated"
  | "adset_activated"
  | "active"
  | "needs_review";

export type MetaAdsImageResource = {
  id: string;
  hash: string;
};

export type MetaAdsPublishProgress = {
  provider: "meta";
  adAccountId: string;
  instagramUserId?: string;
  imageAssets?: {
    feed?: MetaAdsImageResource;
    storyReel?: MetaAdsImageResource;
  };
  campaignId?: string;
  adSetId?: string;
  creativeId?: string;
  adId?: string;
  stage: MetaAdsPublishStage;
};

export type PersistMetaAdsProgress = (resources: Record<string, unknown>) => Promise<void>;

export type MetaAdsGraphJson = (
  userId: string,
  path: string,
  body?: URLSearchParams,
) => Promise<Record<string, unknown>>;

export type MetaAdsGraphPublishInput = {
  userId: string;
  adAccountId: string;
  pageId: string;
  instagramUserId?: string;
  name: string;
  destinationUrl: string;
  primaryText: string;
  headline: string;
  description?: string;
  dailyBudgetCents: number;
  endTime: string;
  placements: MetaAdsPlacement[];
  targeting: Record<string, unknown>;
  urlTags: string;
  feedImageBytes?: string;
  storyReelImageBytes?: string;
  activate: boolean;
};

export class MetaAdsPublishError extends Error {
  readonly progress: MetaAdsPublishProgress;
  readonly campaignMayBeActive: boolean;

  constructor(message: string, progress: MetaAdsPublishProgress, campaignMayBeActive: boolean) {
    super(message);
    this.name = "MetaAdsPublishError";
    this.progress = progress;
    this.campaignMayBeActive = campaignMayBeActive;
  }
}

export function metaUrlTags(value: string): string {
  const normalized = String(value || "").trim().replace(/^[?&]+/, "");
  if (!normalized) return "";
  if (normalized.length > 500 || /[#\r\n\0]/.test(normalized) || normalized.includes("?")) {
    throw new Error("Les balises de suivi Meta sont invalides.");
  }
  const entries = normalized.split("&");
  if (entries.some((entry) => {
    const separator = entry.indexOf("=");
    if (separator <= 0) return true;
    const key = entry.slice(0, separator);
    if (!key || !/^[A-Za-z0-9_.~-]+$/.test(key)) return true;
    try {
      decodeURIComponent(entry.replace(/\+/g, "%20"));
      return false;
    } catch {
      return true;
    }
  })) {
    throw new Error("Les balises de suivi Meta doivent suivre le format cle=valeur&cle=valeur.");
  }
  return normalized;
}

function form(fields: Record<string, string>): URLSearchParams {
  return new URLSearchParams(fields);
}

function requiredMetaId(response: Record<string, unknown>, resource: string): string {
  const id = String(response.id ?? "");
  if (!/^\d+$/.test(id)) throw new Error(`Meta n’a pas confirmé la création ${resource}.`);
  return id;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredMetaImageResource(
  response: Record<string, unknown>,
  adAccountId: string,
  resource: string,
): MetaAdsImageResource {
  const images = asRecord(response.images);
  const uploaded = Object.values(images).map(asRecord).find((candidate) => candidate.hash);
  const hash = String(uploaded?.hash ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{8,200}$/.test(hash)) {
    throw new Error(`Meta n’a pas confirmé l’import ${resource}.`);
  }
  const returnedId = String(uploaded?.id ?? "").trim();
  // Meta's upload response normally contains only a hash. Its SDK derives the
  // stable image ID as "<ad-account-id>:<hash>"; persist the same identity.
  const id = returnedId || `${adAccountId}:${hash}`;
  if (!/^[a-zA-Z0-9:_-]{8,260}$/.test(id)) {
    throw new Error(`Meta a renvoyé un identifiant invalide pour ${resource}.`);
  }
  return { id, hash };
}

function requireMetaSuccess(response: Record<string, unknown>, resource: string): void {
  if (response.success !== true) throw new Error(`Meta n’a pas confirmé l’activation ${resource}.`);
}

/**
 * Provider-only mutation sequence. Every remote ID/hash is copied into
 * `progress` before persistence, so a failed database write still reaches the
 * recovery error with enough information for reconciliation.
 */
export async function executeMetaAdsGraphPublish(
  input: MetaAdsGraphPublishInput,
  metaAdsJson: MetaAdsGraphJson,
  persistProgress: PersistMetaAdsProgress,
): Promise<Record<string, unknown>> {
  const accountPath = `act_${input.adAccountId}`;
  let progress: MetaAdsPublishProgress = {
    provider: "meta",
    adAccountId: input.adAccountId,
    instagramUserId: input.instagramUserId,
    stage: "preparing",
  };
  let campaignActivationAttempted = false;

  const save = async (next: MetaAdsPublishProgress): Promise<void> => {
    progress = next;
    await persistProgress({ ...next });
  };

  try {
    if (input.feedImageBytes) {
      const uploadedFeed = requiredMetaImageResource(
        await metaAdsJson(input.userId, `${accountPath}/adimages`, form({ bytes: input.feedImageBytes })),
        input.adAccountId,
        "du visuel pour les fils",
      );
      await save({
        ...progress,
        imageAssets: { ...progress.imageAssets, feed: uploadedFeed },
        stage: "feed_image_uploaded",
      });
    }
    if (input.storyReelImageBytes) {
      const uploadedStoryReel = requiredMetaImageResource(
        await metaAdsJson(input.userId, `${accountPath}/adimages`, form({ bytes: input.storyReelImageBytes })),
        input.adAccountId,
        "du visuel vertical pour les Stories et Reels",
      );
      await save({
        ...progress,
        imageAssets: { ...progress.imageAssets, storyReel: uploadedStoryReel },
        stage: "story_reel_image_uploaded",
      });
    }
    if (progress.imageAssets?.feed?.hash &&
        progress.imageAssets.feed.hash === progress.imageAssets.storyReel?.hash) {
      throw new Error("Les placements Meta Feed et Story/Reel doivent utiliser deux images distinctes, sans recadrage implicite.");
    }

    const campaign = await metaAdsJson(input.userId, `${accountPath}/campaigns`, form({
      name: input.name,
      objective: "OUTCOME_TRAFFIC",
      buying_type: "AUCTION",
      special_ad_categories: "[]",
      is_adset_budget_sharing_enabled: "false",
      status: "PAUSED",
    }));
    await save({
      ...progress,
      campaignId: requiredMetaId(campaign, "de la campagne"),
      stage: "campaign_created",
    });

    const adSet = await metaAdsJson(input.userId, `${accountPath}/adsets`, form({
      name: `${input.name} · France`,
      campaign_id: progress.campaignId!,
      optimization_goal: "LINK_CLICKS",
      billing_event: "IMPRESSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      destination_type: "WEBSITE",
      daily_budget: String(input.dailyBudgetCents),
      end_time: input.endTime,
      targeting: JSON.stringify(input.targeting),
      status: "PAUSED",
    }));
    await save({
      ...progress,
      adSetId: requiredMetaId(adSet, "de l’ensemble publicitaire"),
      stage: "adset_created",
    });

    const creative = await metaAdsJson(input.userId, `${accountPath}/adcreatives`, form({
      name: `${input.name} · Visuel`,
      link_url: input.destinationUrl,
      object_story_spec: JSON.stringify(metaCreativeIdentity({
        pageId: input.pageId,
        instagramUserId: input.instagramUserId,
      })),
      asset_feed_spec: JSON.stringify(metaAssetFeedSpec({
        placements: input.placements,
        destinationUrl: input.destinationUrl,
        primaryText: input.primaryText,
        headline: input.headline,
        description: input.description,
        feedImageHash: progress.imageAssets?.feed?.hash,
        storyReelImageHash: progress.imageAssets?.storyReel?.hash,
      })),
      ...(input.urlTags ? { url_tags: input.urlTags } : {}),
    }));
    await save({
      ...progress,
      creativeId: requiredMetaId(creative, "du visuel"),
      stage: "creative_created",
    });

    const ad = await metaAdsJson(input.userId, `${accountPath}/ads`, form({
      name: `${input.name} · Annonce`,
      adset_id: progress.adSetId!,
      creative: JSON.stringify({ creative_id: progress.creativeId }),
      status: "PAUSED",
    }));
    await save({
      ...progress,
      adId: requiredMetaId(ad, "de l’annonce"),
      stage: "ad_created",
    });

    if (!input.activate) {
      await save({ ...progress, stage: "demo_paused" });
      return progress;
    }

    // Children become active while their parent campaign is still paused. The
    // campaign remains the final and only spend-enabling switch.
    requireMetaSuccess(await metaAdsJson(input.userId, progress.adId!, form({ status: "ACTIVE" })), "de l’annonce");
    await save({ ...progress, stage: "ad_activated" });

    requireMetaSuccess(await metaAdsJson(input.userId, progress.adSetId!, form({ status: "ACTIVE" })), "de l’ensemble publicitaire");
    await save({ ...progress, stage: "adset_activated" });

    campaignActivationAttempted = true;
    requireMetaSuccess(await metaAdsJson(input.userId, progress.campaignId!, form({ status: "ACTIVE" })), "de la campagne");
    await save({ ...progress, stage: "active" });
    return progress;
  } catch (error) {
    let campaignMayBeActive = false;
    if (campaignActivationAttempted && progress.campaignId) {
      try {
        requireMetaSuccess(
          await metaAdsJson(input.userId, progress.campaignId, form({ status: "PAUSED" })),
          "de la mise en pause de secours",
        );
      } catch {
        campaignMayBeActive = true;
      }
    }
    const failedProgress: MetaAdsPublishProgress = { ...progress, stage: "needs_review" };
    try {
      progress = failedProgress;
      await persistProgress({ ...failedProgress });
    } catch {
      // The thrown error still carries all remote IDs for the route recovery.
    }
    const reason = error instanceof Error ? error.message : "Échec de publication Meta Ads.";
    const safety = campaignMayBeActive
      ? "La campagne pourrait être active : vérifiez-la immédiatement dans Meta Ads Manager."
      : progress.campaignId
        ? "La campagne reste en pause dans Meta Ads Manager."
        : "Aucune campagne Meta n’a été activée.";
    throw new MetaAdsPublishError(`${reason} ${safety}`, failedProgress, campaignMayBeActive);
  }
}
