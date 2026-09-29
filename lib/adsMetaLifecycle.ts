import "server-only";

import { metaAdsJson } from "./adsServer.ts";
import {
  assertMetaAdsResourceHierarchy,
  executeMetaAdsCampaignDelete,
  executeMetaAdsCampaignPause,
  executeMetaAdsCampaignResume,
  executeMetaAdsCampaignUpdate,
  MetaAdsLifecycleError,
  type MetaAdsCampaignChanges,
  type MetaAdsLifecycleInput,
  type MetaAdsLifecycleResources,
  type MetaAdsLifecycleResult,
} from "./adsMetaLifecycleCore.ts";

export { MetaAdsLifecycleError };
export type {
  MetaAdsCampaignChanges,
  MetaAdsLifecycleInput,
  MetaAdsLifecycleResources,
  MetaAdsLifecycleResult,
};

type MetaAdsServerLifecycleInput = Omit<MetaAdsLifecycleInput, "userId">;
type MetaAdsServerUpdateInput = MetaAdsServerLifecycleInput & { changes: MetaAdsCampaignChanges };

export async function readMetaAdsCampaignState(
  userId: string,
  input: MetaAdsServerLifecycleInput,
): Promise<"active" | "paused"> {
  await assertMetaAdsAccountAccess(userId, input.adAccountId, false);
  const snapshot = await assertMetaAdsResourceHierarchy({ userId, ...input }, metaAdsJson);
  if (snapshot.state !== "active" && snapshot.state !== "paused") {
    throw new Error("Meta n’a pas retourné un statut de campagne exploitable.");
  }
  return snapshot.state;
}

async function assertMetaAdsAccountAccess(
  userId: string,
  adAccountId: string,
  requireActive: boolean,
): Promise<void> {
  if (!/^\d{5,25}$/.test(adAccountId)) throw new Error("Le compte publicitaire Meta est invalide.");
  const account = await metaAdsJson(userId, `act_${adAccountId}?fields=id,account_status`);
  if (String(account.id ?? "").replace(/^act_/, "") !== adAccountId) {
    throw new Error("Ce compte publicitaire Meta n’est plus accessible avec la connexion actuelle.");
  }
  if (requireActive && Number(account.account_status) !== 1) {
    throw new Error("Le compte publicitaire Meta n’est pas actif. Vérifiez-le dans Ads Manager.");
  }
}

export async function updateMetaAdsCampaign(
  userId: string,
  input: MetaAdsServerUpdateInput,
): Promise<MetaAdsLifecycleResult> {
  await assertMetaAdsAccountAccess(userId, input.adAccountId, true);
  return executeMetaAdsCampaignUpdate({ userId, ...input }, metaAdsJson);
}

export async function setMetaAdsCampaignPaused(
  userId: string,
  input: MetaAdsServerLifecycleInput & { paused: boolean },
): Promise<MetaAdsLifecycleResult> {
  await assertMetaAdsAccountAccess(userId, input.adAccountId, !input.paused);
  const coreInput = { userId, adAccountId: input.adAccountId, resources: input.resources };
  return input.paused
    ? executeMetaAdsCampaignPause(coreInput, metaAdsJson)
    : executeMetaAdsCampaignResume(coreInput, metaAdsJson);
}

export async function deleteMetaAdsCampaign(
  userId: string,
  input: MetaAdsServerLifecycleInput,
): Promise<MetaAdsLifecycleResult> {
  await assertMetaAdsAccountAccess(userId, input.adAccountId, false);
  return executeMetaAdsCampaignDelete({ userId, ...input }, metaAdsJson);
}
