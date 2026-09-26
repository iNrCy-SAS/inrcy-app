import "server-only";

import { listMetaPages, metaAdsJson } from "@/lib/adsServer";
import { metaFeedTargeting, metaLinkCreativeStory } from "@/lib/adsMetaPlacement";
import type { AdsCampaignInput } from "@/lib/adsValidation";
import { verifyMediaLibraryContentToken } from "@/lib/mediaLibraryContentUrl";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Meta's campaign → ad set → creative → ad hierarchy is created paused.
 * The campaign is activated last so no delivery can start before all IDs are
 * durably recorded by the caller.
 * https://www.postman.com/meta/facebook-marketing-api/documentation/9jo4f5y/mapi-onboarding
 */
export type MetaAdsPublishStage =
  | "campaign_created"
  | "adset_created"
  | "creative_created"
  | "ad_created"
  | "demo_paused"
  | "ad_activated"
  | "adset_activated"
  | "active"
  | "needs_review";

export type MetaAdsPublishProgress = {
  provider: "meta";
  adAccountId: string;
  instagramUserId?: string;
  campaignId?: string;
  adSetId?: string;
  creativeId?: string;
  adId?: string;
  stage: MetaAdsPublishStage;
};

export type PersistMetaAdsProgress = (resources: Record<string, unknown>) => Promise<void>;

export type MetaAdsPublishOptions = {
  /** A review demonstration must never activate provider resources. */
  activate?: boolean;
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

function requiredMetaId(response: Record<string, unknown>, resource: string): string {
  const id = String(response.id ?? "");
  if (!/^\d+$/.test(id)) throw new Error(`Meta n’a pas confirmé la création ${resource}.`);
  return id;
}

function requireMetaSuccess(response: Record<string, unknown>, resource: string): void {
  if (response.success !== true) throw new Error(`Meta n’a pas confirmé l’activation ${resource}.`);
}

function safeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function mediaLibraryIdFromPrivateUrl(value: string): string | null {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/")) return null;
  try {
    const url = new URL(raw, "https://inrcy-media.local");
    if (url.origin !== "https://inrcy-media.local") return null;
    const match = url.pathname.match(/^\/api\/media-library\/items\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/content$/i);
    const id = match?.[1] || "";
    const token = url.searchParams.get("token") || "";
    return id && verifyMediaLibraryContentToken(id, token) ? id : null;
  } catch {
    return null;
  }
}

/**
 * iNrCy keeps library objects private. Meta cannot use the app-relative
 * preview URL because its crawler has no iNrCy session, so resolve it here to
 * a short-lived Storage URL just before the creative is created.
 */
async function resolveMetaImageUrl(userId: string, imageUrl: string): Promise<string> {
  if (safeHttpsUrl(imageUrl)) return imageUrl;

  const mediaId = mediaLibraryIdFromPrivateUrl(imageUrl);
  if (!mediaId) {
    throw new Error("Le visuel Meta doit être une URL HTTPS ou un média valide de votre médiathèque iNrCy.");
  }

  const { data: media, error } = await supabaseAdmin
    .from("pro_media_library")
    .select("bucket_name,storage_path,media_type,is_active")
    .eq("id", mediaId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !media || media.is_active === false) {
    throw new Error("Le média sélectionné n’est plus disponible dans votre médiathèque iNrCy.");
  }
  if (media.media_type !== "image") {
    throw new Error("Le connecteur Meta actuellement disponible attend une image. Choisissez une image dans iNr’Studio ou votre médiathèque.");
  }

  const publicUrl = await createSafeStorageSignedUrl(
    String(media.bucket_name || "inrcy-pro-media"),
    String(media.storage_path || ""),
    60 * 60,
  );
  if (!publicUrl || !safeHttpsUrl(publicUrl)) {
    throw new Error("Le média iNrCy ne peut pas être préparé pour Meta pour le moment. Réessayez dans quelques instants.");
  }
  return publicUrl;
}

/** Meta accepts an ISO-8601 offset; 23:59 Paris time also handles CET/CEST. */
function parisEndTime(endDate: string): string {
  const reference = new Date(`${endDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(reference.getTime()) || reference.toISOString().slice(0, 10) !== endDate) {
    throw new Error("La date de fin Meta est invalide.");
  }
  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    timeZoneName: "shortOffset",
  }).formatToParts(reference).find((part) => part.type === "timeZoneName")?.value;
  const offset = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetName ?? "");
  if (!offset) throw new Error("Impossible de déterminer le fuseau horaire de la campagne Meta.");
  const endTime = `${endDate}T23:59:59${offset[1]}${offset[2].padStart(2, "0")}:${offset[3] ?? "00"}`;
  const daysUntilEnd = (Date.parse(endTime) - Date.now()) / 86_400_000;
  if (daysUntilEnd < 1 || daysUntilEnd > 90) {
    throw new Error("La fin de campagne Meta doit être comprise entre demain et dans 90 jours.");
  }
  return endTime;
}

function form(fields: Record<string, string>): URLSearchParams {
  return new URLSearchParams(fields);
}

export async function publishMetaAdsCampaign(
  userId: string,
  draft: AdsCampaignInput & { noSpecialCategoryConfirmed?: boolean },
  persistProgress: PersistMetaAdsProgress,
  options: MetaAdsPublishOptions = {},
): Promise<Record<string, unknown>> {
  if (draft.provider !== "meta") throw new Error("Ce brouillon n’est pas une campagne Meta Ads.");
  if (typeof persistProgress !== "function") {
    throw new Error("La journalisation des identifiants Meta est obligatoire avant publication.");
  }
  if (draft.noSpecialCategoryConfirmed !== true) {
    throw new Error("Confirmez que cette campagne ne relève pas d’une catégorie publicitaire spéciale Meta.");
  }
  if (!/^\d{5,25}$/.test(draft.adAccountId) || !/^\d{5,30}$/.test(draft.pageId)) {
    throw new Error("Le compte publicitaire ou la Page Meta est invalide.");
  }
  if (draft.accountCurrency !== "EUR") throw new Error("Seuls les comptes Meta en EUR sont pris en charge.");
  if (!safeHttpsUrl(draft.destinationUrl)) {
    throw new Error("Le lien de destination Meta doit être une URL HTTPS publique.");
  }
  const metaImageUrl = await resolveMetaImageUrl(userId, draft.imageUrl);
  if (draft.name.trim().length < 3 || draft.primaryText.trim().length < 10) {
    throw new Error("Le nom ou le texte de la campagne Meta est trop court.");
  }
  const dailyBudgetCents = Math.round(draft.dailyBudgetEuros * 100);
  if (!Number.isFinite(dailyBudgetCents) || Math.abs(dailyBudgetCents - draft.dailyBudgetEuros * 100) > 0.000001 || dailyBudgetCents < 500 || dailyBudgetCents > 50_000) {
    throw new Error("Le budget Meta doit être compris entre 5 et 500 € par jour.");
  }
  const endTime = parisEndTime(draft.endDate);
  const accountPath = `act_${draft.adAccountId}`;
  const shouldActivate = options.activate !== false;

  // Check the same token used for creation can access the chosen EUR account
  // and Page. Meta still validates the Page's advertising rights at creation.
  const account = await metaAdsJson(userId, `${accountPath}?fields=id,currency,account_status`);
  if (String(account.id ?? "").replace(/^act_/, "") !== draft.adAccountId) {
    throw new Error("Ce compte publicitaire Meta n’est pas accessible avec la connexion actuelle.");
  }
  if (account.currency !== "EUR") throw new Error("Le compte publicitaire Meta doit être en EUR.");
  if (Number(account.account_status) !== 1) {
    throw new Error("Le compte publicitaire Meta n’est pas actif. Vérifiez-le dans Ads Manager.");
  }
  const pages = await listMetaPages(userId);
  const page = pages.find((item) => item.id === draft.pageId);
  if (!page) {
    throw new Error("Cette Page Facebook n’est pas autorisée par la connexion Meta Ads.");
  }
  const instagramUserId = page.instagramUserId;
  if (!instagramUserId) {
    throw new Error("Associez un compte Instagram professionnel à cette Page Facebook dans Meta Business Suite, puis actualisez la configuration iNr’ADS.");
  }
  // A linked Page alone does not prove that this ad account may advertise
  // with the Instagram identity. Check the account edge before any creation.
  const instagramAccounts = await metaAdsJson(userId, `${accountPath}/connected_instagram_accounts?fields=id&limit=100`);
  if (!(Array.isArray(instagramAccounts.data) ? instagramAccounts.data : []).some((item) =>
    String((item as Record<string, unknown>).id || "") === instagramUserId
  )) {
    throw new Error("Le compte Instagram lié à cette Page n’est pas autorisé sur le compte publicitaire Meta sélectionné. Vérifiez son association dans Meta Business Suite, puis actualisez iNr’ADS.");
  }

  let progress: MetaAdsPublishProgress = {
    provider: "meta",
    adAccountId: draft.adAccountId,
    instagramUserId,
    stage: "campaign_created",
  };
  let campaignActivationAttempted = false;

  const save = async (next: MetaAdsPublishProgress): Promise<void> => {
    await persistProgress({ ...next });
    progress = next;
  };

  try {
    const campaign = await metaAdsJson(userId, `${accountPath}/campaigns`, form({
      name: draft.name,
      objective: "OUTCOME_TRAFFIC",
      buying_type: "AUCTION",
      special_ad_categories: "[]",
      is_adset_budget_sharing_enabled: "false",
      status: "PAUSED",
    }));
    progress = { ...progress, campaignId: requiredMetaId(campaign, "de la campagne"), stage: "campaign_created" };
    await save(progress);

    const adSet = await metaAdsJson(userId, `${accountPath}/adsets`, form({
      name: `${draft.name} · France`,
      campaign_id: progress.campaignId!,
      optimization_goal: "LINK_CLICKS",
      billing_event: "IMPRESSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      destination_type: "WEBSITE",
      daily_budget: String(dailyBudgetCents),
      end_time: endTime,
      targeting: JSON.stringify(metaFeedTargeting()),
      status: "PAUSED",
    }));
    progress = { ...progress, adSetId: requiredMetaId(adSet, "de l’ensemble publicitaire"), stage: "adset_created" };
    await save(progress);

    const creative = await metaAdsJson(userId, `${accountPath}/adcreatives`, form({
      name: `${draft.name} · Visuel`,
      object_story_spec: JSON.stringify(metaLinkCreativeStory({
        pageId: draft.pageId,
        instagramUserId,
        destinationUrl: draft.destinationUrl,
        primaryText: draft.primaryText,
        imageUrl: metaImageUrl,
      })),
    }));
    progress = { ...progress, creativeId: requiredMetaId(creative, "du visuel"), stage: "creative_created" };
    await save(progress);

    const ad = await metaAdsJson(userId, `${accountPath}/ads`, form({
      name: `${draft.name} · Annonce`,
      adset_id: progress.adSetId!,
      creative: JSON.stringify({ creative_id: progress.creativeId }),
      status: "PAUSED",
    }));
    progress = { ...progress, adId: requiredMetaId(ad, "de l’annonce"), stage: "ad_created" };
    await save(progress);

    // Used only by the explicit review/demo mode. All remote objects were
    // created with PAUSED status above, and no activation request is made.
    if (!shouldActivate) {
      await save({ ...progress, stage: "demo_paused" });
      return { ...progress, stage: "demo_paused" };
    }

    // Child objects may become ACTIVE while their paused parent still prevents
    // any delivery. The campaign is the final, spend-enabling switch.
    requireMetaSuccess(await metaAdsJson(userId, progress.adId!, form({ status: "ACTIVE" })), "de l’annonce");
    await save({ ...progress, stage: "ad_activated" });

    requireMetaSuccess(await metaAdsJson(userId, progress.adSetId!, form({ status: "ACTIVE" })), "de l’ensemble publicitaire");
    await save({ ...progress, stage: "adset_activated" });

    campaignActivationAttempted = true;
    requireMetaSuccess(await metaAdsJson(userId, progress.campaignId!, form({ status: "ACTIVE" })), "de la campagne");
    await save({ ...progress, stage: "active" });
    return progress;
  } catch (error) {
    // An ambiguous final activation response or failed persistence must not
    // leave an untracked campaign spending money if a pause is still possible.
    let campaignMayBeActive = false;
    if (campaignActivationAttempted && progress.campaignId) {
      try {
        requireMetaSuccess(await metaAdsJson(userId, progress.campaignId, form({ status: "PAUSED" })), "de la mise en pause de secours");
      } catch {
        campaignMayBeActive = true;
      }
    }
    const failedProgress: MetaAdsPublishProgress = { ...progress, stage: "needs_review" };
    try {
      await persistProgress({ ...failedProgress });
    } catch {
      // Keep the provider IDs on the thrown error for manual reconciliation.
    }
    const reason = error instanceof Error ? error.message : "Échec de publication Meta Ads.";
    const safety = campaignMayBeActive
      ? "La campagne pourrait être active : vérifiez-la immédiatement dans Meta Ads Manager."
      : "La campagne reste en pause dans Meta Ads Manager.";
    throw new MetaAdsPublishError(`${reason} ${safety}`, failedProgress, campaignMayBeActive);
  }
}
