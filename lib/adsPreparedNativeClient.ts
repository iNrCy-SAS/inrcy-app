import type { AdsCampaignInput } from "./adsValidation.ts";
import { TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT, type TikTokAdsResources } from "./adsTikTokResources.ts";
import type { TikTokAdsNativeSelections } from "./adsTikTokNativeSelections.ts";
import { xAdsTrackedDestination, type XAdsNativeSelections, type XAdsResources } from "./adsXResources.ts";

export type PreparedNativeCheck = {
  ready: boolean; publicationEnabled: false; targetStatus: "DISABLE" | "PAUSED";
  pausedCreationEnabled: boolean; preparationReady: boolean;
  selectedAccountId: string; verifiedLocationCount: number;
  resourcesKey: string; consentKey: string; blockers: string[];
  preparationKey?: string;
  draftFingerprint?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function ownedPreparedVideoId(url: string): string | null {
  const match = /^\/api\/media-library\/items\/([0-9a-f-]{36})\/content$/.exec(url);
  return match && uuid.test(match[1]) ? match[1] : null;
}
export function automaticTikTokNativeSelections(resources: TikTokAdsResources, current?: TikTokAdsNativeSelections): TikTokAdsNativeSelections {
  const previous = current?.advertiserId === resources.selectedAccountId ? current : undefined;
  const matches = resources.identities.filter((identity) => previous?.identity?.id === identity.id && previous.identity.type === identity.type
    && previous.identity.authorizedBusinessCenterId === identity.authorizedBusinessCenterId);
  const chosen = matches[0] || (resources.identities.length === 1 ? resources.identities[0] : null);
  return { schemaVersion: 1, advertiserId: resources.selectedAccountId, context: structuredClone(TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT),
    identity: chosen ? { id: chosen.id, type: chosen.type, ...(chosen.authorizedBusinessCenterId ? { authorizedBusinessCenterId: chosen.authorizedBusinessCenterId } : {}) } : null,
    locationIds: previous?.locationIds || [], callToAction: previous?.callToAction || "LEARN_MORE", thumbnailMediaId: previous?.thumbnailMediaId || null,
    isAiGenerated: previous?.isAiGenerated ?? null };
}
export function automaticXNativeSelections(resources: XAdsResources, current?: XAdsNativeSelections): XAdsNativeSelections {
  const previous = current?.accountId === resources.selectedAccountId ? current : undefined;
  const funds = resources.fundingInstruments.filter((item) => item.currency === "EUR" && item.ableToFund && !item.deleted && !item.cancelled);
  const users = resources.promotableUsers.filter((item) => item.type === "FULL");
  return { schemaVersion: 1, accountId: resources.selectedAccountId,
    context: { objective: "ENGAGEMENTS", format: "text", targetingMode: "broad", placements: "ALL_ON_TWITTER" },
    fundingInstrumentId: funds.some((item) => item.id === previous?.fundingInstrumentId) ? previous!.fundingInstrumentId : funds.length === 1 ? funds[0].id : null,
    promotableUserId: users.some((item) => item.id === previous?.promotableUserId) ? previous!.promotableUserId : users.length === 1 ? users[0].id : null,
    postId: previous?.postId && resources.posts.some((item) => item.id === previous.postId) ? previous.postId : null,
    geoTargets: previous?.geoTargets || [] };
}
export function preparedNativeCheck(value: unknown, provider: "tiktok" | "x", accountId: string): PreparedNativeCheck {
  if (!value || typeof value !== "object") throw new Error("La vérification du compte n’a pas été confirmée.");
  const row = value as Record<string, unknown>;
  if (row.selectedAccountId !== accountId || row.publicationEnabled !== false || row.targetStatus !== (provider === "tiktok" ? "DISABLE" : "PAUSED")
    || typeof row.ready !== "boolean" || typeof row.preparationReady !== "boolean"
    || typeof (row.pausedCreationEnabled ?? row.pausedCreationReady) !== "boolean"
    || typeof row.resourcesKey !== "string" || typeof (row.consentKey ?? row.preparationKey) !== "string"
    || !Array.isArray(row.blockers) || row.blockers.some((item) => typeof item !== "string")
    || !Number.isInteger(row.verifiedLocationCount)) throw new Error("La connexion ou le parcours natif a changé. Revérifiez la proposition.");
  return { ...row, consentKey: row.consentKey ?? row.preparationKey,
    pausedCreationEnabled: row.pausedCreationEnabled ?? row.pausedCreationReady } as PreparedNativeCheck;
}
export type PreparedNativeTransport = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
/** Native writes occur only after fresh checks of the exact reviewed, saved draft. No active launch or automatic retry. */
export async function createReviewedPausedCampaign(args: {
  draft: AdsCampaignInput; savedId?: string; checked: PreparedNativeCheck; assertUnchanged: () => void;
}, transport: PreparedNativeTransport): Promise<{ id: string; campaign: Record<string, unknown> }> {
  const { draft, checked, assertUnchanged } = args;
  if (draft.provider !== "x" && draft.provider !== "tiktok" || !checked.ready || !checked.pausedCreationEnabled) throw new Error("La création native en pause n’est pas encore disponible.");
  const json = (value: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), cache: "no-store" });
  assertUnchanged();
  const fresh = preparedNativeCheck(await transport(`/api/ads/${draft.provider}/preflight`, json({ draft })), draft.provider, draft.adAccountId);
  if (!fresh.ready || !fresh.pausedCreationEnabled || fresh.consentKey !== checked.consentKey || fresh.resourcesKey !== checked.resourcesKey) throw new Error("Les ressources ou les droits ont changé. Relisez la dernière page avant de valider.");
  assertUnchanged();
  const saved = await transport("/api/ads/campaigns", json({ ...draft, ...(args.savedId ? { id: args.savedId } : {}) }));
  const campaign = saved.campaign as Record<string, unknown> | undefined, id = campaign?.id;
  if (typeof id !== "string" || !uuid.test(id)) throw new Error("Le brouillon n’a pas été enregistré. Aucune création native n’a été demandée.");
  assertUnchanged();
  const snapshot = preparedNativeCheck(await transport(`/api/ads/campaigns/${id}/preflight?mode=paused`, { cache: "no-store" }), draft.provider, draft.adAccountId);
  if (!snapshot.ready || !snapshot.pausedCreationEnabled || snapshot.preparationKey !== fresh.consentKey || snapshot.resourcesKey !== fresh.resourcesKey
    || typeof snapshot.draftFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(snapshot.draftFingerprint)) throw new Error("La campagne enregistrée doit être revérifiée. Aucune création native n’a été demandée.");
  assertUnchanged();
  const published = await transport(`/api/ads/campaigns/${id}/publish`, json({ mode: "paused", confirmation: "CREER_CAMPAGNE_EN_PAUSE",
    nativeConsentKey: snapshot.consentKey, expectedDraftFingerprint: snapshot.draftFingerprint }));
  const created = published.campaign as Record<string, unknown> | undefined;
  if (!created || created.id !== id || created.status !== "paused") throw new Error("La création native doit être contrôlée dans le suivi. Ne relancez pas la demande automatiquement.");
  return { id, campaign: created };
}

export function preparedNativeBlockerLabel(code: string): string {
  const labels: Record<string, string> = {
    campaign_store_migration_required: "La mise à jour de la base nécessaire au suivi de ces campagnes doit encore être installée.",
    paused_creation_disabled: "La création en pause reste désactivée dans cet environnement.",
    native_capabilities_unverified: "Les permissions natives de cette application restent à confirmer auprès de TikTok.",
    identity_required: "L’identité publicitaire n’est pas encore disponible ou doit être précisée.",
    identity_not_authorized: "L’identité choisie n’est plus autorisée sur ce compte.",
    location_required: "Les zones doivent être vérifiées dans le catalogue du compte.",
    location_not_available: "Une zone n’est plus disponible sur ce compte.",
    thumbnail_required: "La miniature vidéo doit encore être préparée.",
    aigc_declaration_required: "Confirmez si la vidéo a été générée ou modifiée par l’IA.",
    cta_required: "Le bouton publicitaire doit être précisé.",
    account_timezone_unverified: "Le fuseau horaire du compte n’est pas encore confirmé.",
    budget_minimum_unverified: "Le budget minimum du compte reste à vérifier.",
    schedule_time_basis_unverified: "Le calendrier natif du compte reste à vérifier.",
    funding_instrument_required: "La source de financement n’est pas encore disponible ou doit être précisée.",
    promotable_user_required: "L’identité X autorisée doit encore être précisée.",
    native_selections_invalid: "Les ressources exactes du compte doivent être préparées.",
  };
  if (labels[code]) return labels[code];
  if (/unverified|access|permission|grant|approval|token|capabilit/.test(code)) return "Les droits API requis pour ce parcours ne sont pas encore confirmés.";
  if (/budget|bid/.test(code)) return "Le budget ou l’enchère ne correspond pas encore au parcours natif pris en charge.";
  if (/calendar|schedule|date/.test(code)) return "Le calendrier doit préciser un début et une fin valides pour le compte.";
  if (/media|video|thumbnail/.test(code)) return "Le média ou sa miniature doit être vérifié avant la création.";
  if (/draft|format|objective|target|destination|placement/.test(code)) return "Ce réglage doit être adapté au parcours natif pris en charge.";
  return "Un contrôle du compte ou des ressources reste nécessaire avant la création.";
}

/** The URL becomes visible ad copy before review; never add it during native publication. */
export function preparedXCopyWithDestination(text: string, destination: string, tracking: string): string {
  if (!destination.trim()) return text;
  const link = xAdsTrackedDestination(destination, tracking);
  if (!link.url || text.split(/\s+/u).includes(link.url)) return text;
  return `${text.trim()}\n${link.url}`;
}
export const PREPARED_TIKTOK_CTA_LABELS: Record<string, string> = { LEARN_MORE: "En savoir plus", SIGN_UP: "S’inscrire", SHOP_NOW: "Acheter" };
