import { assertPinterestBatchStatus } from "./adsPinterestPublish.ts";

export type PinterestAdsLifecycleResources = {
  campaignId: string;
  adGroupId: string;
  adId: string;
  initialActivationPending?: boolean;
};

export type PinterestAdsLifecycleRequest = (
  path: string,
  method: "GET" | "PATCH",
  body?: unknown,
) => Promise<unknown>;

export type PinterestAdsLifecycleResult = {
  state: "active" | "paused";
  resources: PinterestAdsLifecycleResources;
};

export class PinterestAdsLifecycleError extends Error {
  readonly remoteMayHaveChanged: boolean;
  readonly campaignMayBeActive: boolean;

  constructor(
    message: string,
    remoteMayHaveChanged: boolean,
    campaignMayBeActive: boolean,
  ) {
    super(message);
    this.name = "PinterestAdsLifecycleError";
    this.remoteMayHaveChanged = remoteMayHaveChanged;
    this.campaignMayBeActive = campaignMayBeActive;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function entity(value: unknown): Record<string, unknown> {
  const root = record(value);
  if (root.data && typeof root.data === "object") return record(root.data);
  const items = Array.isArray(root.items) ? root.items : [];
  const first = record(items[0]);
  return Object.keys(record(first.data)).length ? record(first.data) : root;
}

function cleanId(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function resources(value: unknown): PinterestAdsLifecycleResources {
  const source = record(value);
  const parsed = {
    campaignId: cleanId(source.campaignId),
    adGroupId: cleanId(source.adGroupId),
    adId: cleanId(source.adId),
    ...(typeof source.initialActivationPending === "boolean" ? { initialActivationPending: source.initialActivationPending } : {}),
  };
  if (![parsed.campaignId, parsed.adGroupId, parsed.adId].every((id) => /^\d{5,30}$/.test(id))) {
    throw new PinterestAdsLifecycleError(
      "Les identifiants Pinterest enregistrés sont incomplets. Contrôlez la campagne dans Pinterest Ads Manager.",
      false,
      false,
    );
  }
  return parsed;
}

function campaignState(value: unknown): "active" | "paused" {
  const status = String(entity(value).status || "").trim().toUpperCase();
  if (status === "ACTIVE") return "active";
  if (status === "PAUSED") return "paused";
  if (status === "ARCHIVED" || status === "ARCHIVE" || status === "DELETED_DRAFT") {
    throw new PinterestAdsLifecycleError("Cette campagne Pinterest est archivée et ne peut plus être reprise.", false, false);
  }
  throw new PinterestAdsLifecycleError("Pinterest n’a pas retourné un statut de campagne exploitable.", false, false);
}

async function assertHierarchy(
  adAccountId: string,
  value: unknown,
  request: PinterestAdsLifecycleRequest,
): Promise<{ resources: PinterestAdsLifecycleResources; state: "active" | "paused"; adStatus: string; adGroupStatus: string }> {
  if (!/^\d{5,30}$/.test(adAccountId)) {
    throw new PinterestAdsLifecycleError("Le compte Pinterest Ads enregistré est invalide.", false, false);
  }
  const parsed = resources(value);
  const base = `/ad_accounts/${adAccountId}`;
  const [campaignPayload, adGroupPayload, adPayload] = await Promise.all([
    request(`${base}/campaigns/${parsed.campaignId}`, "GET"),
    request(`${base}/ad_groups/${parsed.adGroupId}`, "GET"),
    request(`${base}/ads/${parsed.adId}`, "GET"),
  ]);
  const campaign = entity(campaignPayload);
  const adGroup = entity(adGroupPayload);
  const ad = entity(adPayload);
  if (cleanId(campaign.id) !== parsed.campaignId || cleanId(campaign.ad_account_id) !== adAccountId) {
    throw new PinterestAdsLifecycleError("La campagne Pinterest n’appartient plus au compte annonceur associé.", false, false);
  }
  if (cleanId(adGroup.id) !== parsed.adGroupId || cleanId(adGroup.campaign_id) !== parsed.campaignId) {
    throw new PinterestAdsLifecycleError("Le groupe d’annonces Pinterest ne correspond plus à cette campagne.", false, false);
  }
  if (cleanId(ad.id) !== parsed.adId || cleanId(ad.ad_group_id) !== parsed.adGroupId) {
    throw new PinterestAdsLifecycleError("L’annonce Pinterest ne correspond plus à cette campagne.", false, false);
  }
  return { resources: parsed, state: campaignState(campaign), adStatus: String(ad.status || ""), adGroupStatus: String(adGroup.status || "") };
}

function publicResult(current: { resources: PinterestAdsLifecycleResources; state: "active" | "paused" }, activated = false): PinterestAdsLifecycleResult {
  return {
    state: current.state,
    resources: { ...current.resources, ...(current.resources.initialActivationPending === true && (activated || current.state === "active") ? { initialActivationPending: false } : {}) },
  };
}

export async function readPinterestAdsCampaignState(
  adAccountId: string,
  value: unknown,
  request: PinterestAdsLifecycleRequest,
): Promise<PinterestAdsLifecycleResult> {
  const current = await assertHierarchy(adAccountId, value, request);
  return publicResult(current);
}

export async function pausePinterestAdsCampaign(
  adAccountId: string,
  value: unknown,
  request: PinterestAdsLifecycleRequest,
): Promise<PinterestAdsLifecycleResult> {
  const current = await assertHierarchy(adAccountId, value, request);
  if (current.state === "paused") return publicResult(current);
  let mutationAttempted = false;
  try {
    mutationAttempted = true;
    assertPinterestBatchStatus(await request(`/ad_accounts/${adAccountId}/campaigns`, "PATCH", [
      { id: current.resources.campaignId, status: "PAUSED" },
    ]), current.resources.campaignId, "PAUSED");
    const confirmed = await assertHierarchy(adAccountId, current.resources, request);
    if (confirmed.state !== "paused") throw new Error("Pinterest n’a pas confirmé le statut PAUSED.");
    return publicResult(confirmed, true);
  } catch (error) {
    throw new PinterestAdsLifecycleError(
      `${error instanceof Error ? error.message : "Échec de la mise en pause Pinterest."} Vérifiez le statut dans Pinterest Ads Manager.`,
      mutationAttempted,
      mutationAttempted,
    );
  }
}

export async function resumePinterestAdsCampaign(
  adAccountId: string,
  value: unknown,
  request: PinterestAdsLifecycleRequest,
): Promise<PinterestAdsLifecycleResult> {
  const current = await assertHierarchy(adAccountId, value, request);
  const initialActivation = current.resources.initialActivationPending === true;
  if (initialActivation && (!["ACTIVE", "PAUSED"].includes(current.adStatus) || !["ACTIVE", "PAUSED"].includes(current.adGroupStatus))) {
    throw new PinterestAdsLifecycleError("Un élément de la première activation Pinterest est supprimé ou son statut n’est pas vérifiable.", false, current.state === "active");
  }
  if (current.state === "active") {
    if (initialActivation && (current.adStatus !== "ACTIVE" || current.adGroupStatus !== "ACTIVE")) {
      throw new PinterestAdsLifecycleError("La campagne Pinterest est active mais certains éléments sont en pause. Vérifiez-les dans Ads Manager ; leur pause manuelle est conservée.", false, true);
    }
    return publicResult(current);
  }
  const base = `/ad_accounts/${adAccountId}`;
  let mutationAttempted = false;
  let campaignActivationAttempted = false;
  try {
    // Ordinary campaign resumes preserve manually paused ads/groups. Only the
    // publisher's first-activation marker permits changing child statuses.
    if (initialActivation) {
      if (current.adStatus === "PAUSED") {
        mutationAttempted = true;
        assertPinterestBatchStatus(await request(`${base}/ads`, "PATCH", [
          { id: current.resources.adId, status: "ACTIVE" },
        ]), current.resources.adId, "ACTIVE");
      }
      if (current.adGroupStatus === "PAUSED") {
        mutationAttempted = true;
        assertPinterestBatchStatus(await request(`${base}/ad_groups`, "PATCH", [
          { id: current.resources.adGroupId, status: "ACTIVE" },
        ]), current.resources.adGroupId, "ACTIVE");
      }
      const childrenConfirmed = await assertHierarchy(adAccountId, current.resources, request);
      if (childrenConfirmed.adStatus !== "ACTIVE" || childrenConfirmed.adGroupStatus !== "ACTIVE") {
        throw new Error("Pinterest n’a pas confirmé l’activation des annonces et du groupe. La campagne reste en pause.");
      }
    }
    mutationAttempted = true;
    campaignActivationAttempted = true;
    assertPinterestBatchStatus(await request(`${base}/campaigns`, "PATCH", [
      { id: current.resources.campaignId, status: "ACTIVE" },
    ]), current.resources.campaignId, "ACTIVE");
    const confirmed = await assertHierarchy(adAccountId, current.resources, request);
    if (confirmed.state !== "active") throw new Error("Pinterest n’a pas confirmé le statut ACTIVE.");
    if (initialActivation && (confirmed.adStatus !== "ACTIVE" || confirmed.adGroupStatus !== "ACTIVE")) {
      throw new Error("Un élément Pinterest n’est plus actif. Vérifiez le groupe et l’annonce.");
    }
    return publicResult(confirmed);
  } catch (error) {
    let safetyPauseConfirmed = false;
    if (mutationAttempted) {
      try {
        assertPinterestBatchStatus(await request(`${base}/campaigns`, "PATCH", [
          { id: current.resources.campaignId, status: "PAUSED" },
        ]), current.resources.campaignId, "PAUSED");
        const campaign = entity(await request(`${base}/campaigns/${current.resources.campaignId}`, "GET"));
        safetyPauseConfirmed = cleanId(campaign.id) === current.resources.campaignId
          && cleanId(campaign.ad_account_id) === adAccountId && campaign.status === "PAUSED";
      } catch {
        safetyPauseConfirmed = false;
      }
    }
    throw new PinterestAdsLifecycleError(
      `${error instanceof Error ? error.message : "Échec de la reprise Pinterest."} ${safetyPauseConfirmed
        ? "La campagne a été maintenue en pause par sécurité."
        : "Vérifiez immédiatement son statut dans Pinterest Ads Manager."}`,
      mutationAttempted,
      campaignActivationAttempted && !safetyPauseConfirmed,
    );
  }
}
