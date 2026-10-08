import "server-only";
import { createHash } from "node:crypto";
import { decryptToken } from "./oauthCrypto.ts";
import { signXAdsOAuthRequest } from "./adsXOAuth1.ts";
import { getXAdsCredentials, getXAdsApiVersion, readXAdsIntegration, XAdsConnectionError, type XAdsIntegration } from "./adsXServer.ts";
import { normalizeXAdsAccount, verifyXAdsAccount } from "./adsXPolicy.ts";
import { preparedAdsInstant } from "./adsPreparedCampaignSettings.ts";
import { parseXAdsFundingInstruments, parseXAdsPromotableUsers, parseXAdsPromotablePosts, parseXAdsGeoTargets, normalizeXAdsGeoQueries, normalizeXAdsNativeSelections, xAdsResourceId, xAdsResourcesConsentKey,
  type XAdsResources, type XAdsGeography, type XAdsNativeSelections, type XAdsGeoTarget } from "./adsXResources.ts";
import type { AdsCampaignInput } from "./adsValidation.ts";
import { xAdsPublisherInputFromDraft, xAdsPublisherPostTextValid, validateXAdsPublisherInput, xAdsPausedCreationEnabled, XAdsPublisherError, type XAdsPublisherEvidence } from "./adsXPublisherCore.ts";

export const X_ADS_API_BASE = "https://ads-api.x.com/12";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export type XAdsGrantProof = { standardAccess: "verified" | "unverified"; tokenRegeneratedAfterApproval: "verified" | "unverified"; nativeWriteAccess: "verified" | "unverified" };
export type XAdsResourcesDependencies = {
  readIntegration: (userId: string) => Promise<XAdsIntegration | null>;
  credentials: () => { apiKey: string; apiSecret: string; configured: boolean };
  decrypt: (value: string) => string; fetchImpl: typeof fetch; now: () => number;
  grantProof: (row: XAdsIntegration, apiKey: string, now: number) => XAdsGrantProof;
  /** Trusted server state, set only after validation of a stored checkpoint. */
  resumed?: boolean;
  /** Read-only readiness for the durable native journal schema. */
  readStoreAvailability?: () => Promise<boolean>;
};
/** Server configuration attests approval; account discovery must never infer Standard access. */
export function xAdsServerGrantProof(row: XAdsIntegration, apiKey: string, now: number, environment: Record<string, string | undefined> = process.env): XAdsGrantProof {
  const appHash = createHash("sha256").update(apiKey).digest("hex"), meta = record(row.meta);
  const approval = environment.X_ADS_STANDARD_ACCESS_APPROVED_AT;
  const standard = environment.X_ADS_STANDARD_ACCESS_APPROVED === "true"
    && environment.X_ADS_APPROVED_APP_KEY_SHA256 === appHash && preparedAdsInstant(approval) !== null && Date.parse(approval!) <= now;
  const issued = typeof meta.oauth1a_token_issued_at === "string" ? meta.oauth1a_token_issued_at : "";
  const renewed = standard && meta.oauth1a_app_key_hash === appHash && preparedAdsInstant(issued) !== null
    && Date.parse(issued) > Date.parse(approval!) && Date.parse(issued) <= now;
  return { standardAccess: standard ? "verified" : "unverified", tokenRegeneratedAfterApproval: renewed ? "verified" : "unverified", nativeWriteAccess: renewed ? "verified" : "unverified" };
}
function defaults(): XAdsResourcesDependencies {
  return { readIntegration: readXAdsIntegration, credentials: getXAdsCredentials, decrypt: decryptToken, fetchImpl: fetch, now: Date.now, grantProof: xAdsServerGrantProof,
    readStoreAvailability: async () => (await import("./adsTikTokCampaignStore.ts")).readPreparedAdsStoreAvailability() };
}
const rowKey = (row: XAdsIntegration) => JSON.stringify([row.id, row.status, row.resource_id, row.provider_account_id, row.access_token_enc, row.refresh_token_enc, row.meta]);
export type XAdsReadContext = {
  accountId: string; row: XAdsIntegration; deps: XAdsResourcesDependencies;
  proof: XAdsGrantProof;
  assertStable: () => Promise<void>;
  read: (path: string, params?: URLSearchParams) => Promise<Record<string, unknown>>;
  /** Private transport credentials remain server-only. */
  privateCredentials: { apiKey: string; apiSecret: string; token: string; tokenSecret: string };
};
export async function createXAdsReadContext(userId: string, accountId?: string, dependencies?: Partial<XAdsResourcesDependencies>): Promise<XAdsReadContext> {
  const deps: XAdsResourcesDependencies = { ...defaults(), ...dependencies }, credentials = deps.credentials();
  if (!credentials.configured || !credentials.apiKey || !credentials.apiSecret || (!dependencies?.credentials && getXAdsApiVersion() !== "12")) throw new XAdsConnectionError("Configuration X Ads incomplète.", "configuration_missing", 503);
  const row = await deps.readIntegration(userId);
  if (!row || row.status !== "connected" || !xAdsResourceId(row.resource_id) || !row.access_token_enc || !row.refresh_token_enc) throw new XAdsConnectionError("Connectez et associez un compte X Ads.", "not_connected", 409);
  if (accountId && accountId !== row.resource_id) throw new XAdsConnectionError("Le compte X Ads associé a changé.", "account_mismatch", 409);
  let token = "", tokenSecret = "";
  try { token = deps.decrypt(row.access_token_enc); tokenSecret = deps.decrypt(row.refresh_token_enc); } catch { /* No encrypted or plain credentials in errors. */ }
  if (!token || !tokenSecret) throw new XAdsConnectionError("Reconnectez X Ads.", "token_unavailable", 409);
  const assertStable = async () => { const current = await deps.readIntegration(userId); if (!current || rowKey(current) !== rowKey(row)) throw new XAdsConnectionError("La connexion X Ads a changé. Relancez la vérification.", "integration_changed", 409); };
  const privateCredentials = { apiKey: credentials.apiKey, apiSecret: credentials.apiSecret, token, tokenSecret };
  const read = async (path: string, params = new URLSearchParams()) => {
    if (!/^(?:accounts\/[a-z0-9]+(?:\/[a-z0-9_]+(?:\/[a-z0-9]+)?)?|targeting_criteria\/locations)$/i.test(path)) throw new XAdsConnectionError("Lecture X Ads invalide.", "invalid_resource_path", 400);
    await assertStable();
    const url = `${X_ADS_API_BASE}/${path}${params.size ? `?${params}` : ""}`;
    const { authorization } = signXAdsOAuthRequest({ method: "GET", url, ...privateCredentials });
    let response: Response;
    try { response = await deps.fetchImpl(url, { method: "GET", headers: { Authorization: authorization, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) }); }
    catch { throw new XAdsConnectionError("La lecture X Ads est momentanément indisponible.", "provider_unavailable", 503); }
    const payload = record(await response.json().catch(() => null));
    if (!response.ok || payload.errors || !("data" in payload)) throw new XAdsConnectionError(response.status === 401 ? "Reconnectez X Ads." : "Les ressources X Ads n’ont pas pu être vérifiées.", response.status === 401 ? "needs_reconnect" : "provider_read_failed", response.status === 401 || response.status === 403 ? response.status : 503);
    await assertStable(); return payload;
  };
  return { accountId: row.resource_id, row, deps, proof: deps.grantProof(row, credentials.apiKey, deps.now()), assertStable, read, privateCredentials };
}
async function pages(ctx: XAdsReadContext, path: string, params = new URLSearchParams(), limit = 20): Promise<unknown[]> {
  const items: unknown[] = [], seen = new Set<string>(); let cursor = "";
  for (let page = 0; page < limit; page++) {
    const query = new URLSearchParams(params); query.set("count", "200"); if (cursor) query.set("cursor", cursor);
    const payload = await ctx.read(path, query);
    if (!Array.isArray(payload.data)) throw new XAdsConnectionError("Réponse X Ads incomplète.", "provider_response_invalid", 502);
    items.push(...payload.data);
    if (payload.next_cursor == null || payload.next_cursor === "") return items;
    if (typeof payload.next_cursor !== "string" || seen.has(payload.next_cursor)) throw new XAdsConnectionError("La liste X Ads est incomplète.", "pagination_incomplete", 502);
    cursor = payload.next_cursor; seen.add(cursor);
  }
  throw new XAdsConnectionError("La liste X Ads dépasse la limite de vérification.", "pagination_incomplete", 502);
}
export async function readXAdsResourcesInContext(ctx: XAdsReadContext, postId?: string, skipPosts = false): Promise<XAdsResources> {
  const prefix = `accounts/${ctx.accountId}`;
  const accountPayload = await ctx.read(prefix), rawAccount = record(accountPayload.data), account = normalizeXAdsAccount(rawAccount);
  if (!account || account.id !== ctx.accountId || typeof rawAccount.timezone !== "string") throw new XAdsConnectionError("Compte X Ads non vérifié.", "account_unverified", 403);
  try { new Intl.DateTimeFormat("fr", { timeZone: rawAccount.timezone }); } catch { throw new XAdsConnectionError("Fuseau X Ads non vérifié.", "timezone_unverified", 422); }
  const [fundingRows, access, userRows] = await Promise.all([pages(ctx, `${prefix}/funding_instruments`), ctx.read(`${prefix}/authenticated_user_access`), pages(ctx, `${prefix}/promotable_users`)]);
  const verifiedAccount = verifyXAdsAccount(account, access.data, fundingRows);
  if (record(access.data).user_id !== ctx.row.provider_account_id) throw new XAdsConnectionError("L’identité du jeton X Ads ne correspond plus à la connexion.", "authenticated_user_mismatch", 403);
  if (!verifiedAccount.eligibleToAssociate || verifiedAccount.billingReady !== true) throw new XAdsConnectionError("Le compte X Ads EUR, son rôle et son financement doivent être vérifiés.", "account_not_ready", 403);
  const fundingInstruments = parseXAdsFundingInstruments(fundingRows).filter((item) => item.currency === "EUR" && item.ableToFund && !item.deleted && !item.cancelled);
  const promotableUsers = parseXAdsPromotableUsers(userRows);
  if (promotableUsers.filter((user) => user.type === "FULL").length > 5) throw new XAdsConnectionError("Trop d’identités X Ads à vérifier dans ce parcours.", "promotable_users_incomplete", 422);
  const postRows: unknown[] = [];
  for (const user of skipPosts ? [] : promotableUsers.filter((item) => item.type === "FULL")) {
    const query = new URLSearchParams({ tweet_type: "PUBLISHED", timeline_type: "ALL", user_id: user.userId, trim_user: "false" });
    if (postId) query.set("tweet_ids", postId);
    postRows.push(...await pages(ctx, `${prefix}/tweets`, query, postId ? 1 : 5));
  }
  await ctx.assertStable();
  return { selectedAccountId: ctx.accountId, account: { ...verifiedAccount, timeZone: rawAccount.timezone }, fundingInstruments, promotableUsers,
    posts: [...new Map(parseXAdsPromotablePosts(postRows, promotableUsers).map((post) => [post.id, post])).values()], capabilities: ctx.deps.grantProof(ctx.row, ctx.privateCredentials.apiKey, ctx.deps.now()), publicationEnabled: false, verifiedAt: new Date(ctx.deps.now()).toISOString() };
}
export async function readXAdsResources(userId: string, options: { accountId?: string; postId?: string } = {}, deps?: XAdsResourcesDependencies): Promise<XAdsResources> {
  return readXAdsResourcesInContext(await createXAdsReadContext(userId, options.accountId, deps), options.postId);
}
const labelKey = (label: string) => label.normalize("NFC").trim().toLocaleLowerCase("fr");
export async function readXAdsGeographyInContext(ctx: XAdsReadContext, queries: string[]): Promise<XAdsGeography> {
  if (!normalizeXAdsGeoQueries(queries)) throw new XAdsConnectionError("Zones X Ads invalides.", "invalid_geography_queries", 400);
  const resolutions: XAdsGeography["resolutions"] = [], found = new Map<string, XAdsGeoTarget>();
  for (const query of queries) {
    const options = parseXAdsGeoTargets(await pages(ctx, "targeting_criteria/locations", new URLSearchParams({ q: query }), 5));
    for (const option of options) found.set(option.id, option);
    const exact = options.filter((option) => labelKey(option.name) === labelKey(query));
    resolutions.push({ query, options, autoSelectedTarget: exact.length === 1 ? exact[0] : null });
  }
  return { selectedAccountId: ctx.accountId, resolutions, options: [...found.values()], complete: true, publicationEnabled: false, verifiedAt: new Date(ctx.deps.now()).toISOString() };
}
export async function readXAdsGeography(userId: string, options: { accountId?: string; queries: string[] }, deps?: XAdsResourcesDependencies): Promise<XAdsGeography> {
  const ctx = await createXAdsReadContext(userId, options.accountId, deps);
  await readXAdsResourcesInContext(ctx);
  return readXAdsGeographyInContext(ctx, options.queries);
}
/** Selectors are untrusted; verify every native identity against fresh account-scoped reads. */
export async function verifyXAdsNativeSelections(ctx: XAdsReadContext, selectionsValue: unknown, postText?: string) {
  const normalized = normalizeXAdsNativeSelections(selectionsValue), selections = normalized.selections;
  if (!selections || selections.accountId !== ctx.accountId || !selections.fundingInstrumentId || !selections.promotableUserId || !selections.geoTargets.length
    || selections.postId === null && !xAdsPublisherPostTextValid(postText)) throw new XAdsConnectionError("Complétez les sélections natives X Ads.", "native_selections_incomplete", 422);
  const resources = await readXAdsResourcesInContext(ctx, selections.postId || undefined, selections.postId === null);
  const funding = resources.fundingInstruments.find((item) => item.id === selections.fundingInstrumentId);
  const user = resources.promotableUsers.find((item) => item.id === selections.promotableUserId && item.type === "FULL");
  const post = selections.postId === null ? null : resources.posts.find((item) => item.id === selections.postId && item.userId === user?.userId) || null;
  const canCreatePost = Boolean(user && (ctx.row.provider_account_id === user.userId || resources.account.permissions.includes("TWEET_COMPOSER")));
  if (!funding || !user || selections.postId !== null && !post || selections.postId === null && !canCreatePost) throw new XAdsConnectionError("Le financement, l’identité, le post ou le droit de composition X Ads a changé.", "native_resource_mismatch", 422);
  const geography = await readXAdsGeographyInContext(ctx, selections.geoTargets.map((item) => item.name));
  for (const target of selections.geoTargets) {
    const resolution = geography.resolutions.find((item) => item.query === target.name);
    if (!resolution?.options.some((item) => item.id === target.id && item.name === target.name && item.countryCode === target.countryCode && item.locationType === target.locationType)) throw new XAdsConnectionError("Une zone X Ads ne correspond plus à la sélection vérifiée.", "native_geography_mismatch", 422);
  }
  return { selections, resources, funding, user, post, canCreatePost, geography };
}
export function buildXAdsPublisherEvidence(checked: Awaited<ReturnType<typeof verifyXAdsNativeSelections>>, now: number): XAdsPublisherEvidence {
  return { accountId: checked.resources.selectedAccountId, currency: "EUR", timeZone: checked.resources.account.timeZone,
    accepted: !checked.resources.account.deleted && checked.resources.account.approvalStatus === "ACCEPTED", canManageCampaigns: checked.resources.account.canManageCampaigns === true,
    billingReady: checked.resources.account.billingReady === true, funding: checked.funding, user: checked.user, post: checked.post, canCreatePost: checked.canCreatePost,
    geoTargets: checked.selections.geoTargets, ...checked.resources.capabilities, checkedAt: new Date(now).toISOString(), validUntil: new Date(now + 300_000).toISOString() };
}
export async function checkXAdsCampaignPreparation(userId: string, options: { accountId?: string; selections?: XAdsNativeSelections | null; draft?: AdsCampaignInput } = {}, deps?: Partial<XAdsResourcesDependencies>) {
  const ctx = await createXAdsReadContext(userId, options.accountId, deps);
  const selected = options.selections ?? options.draft?.xNativeSelections;
  let resources = await readXAdsResourcesInContext(ctx, selected?.postId || undefined, selected?.postId === null);
  const blockers: string[] = [];
  if (!await Promise.resolve().then(() => ctx.deps.readStoreAvailability?.() || false).catch(() => false)) blockers.push("campaign_store_migration_required");
  if (!xAdsPausedCreationEnabled()) blockers.push("La création native X Ads est verrouillée dans cet environnement.");
  for (const [key, value] of Object.entries(resources.capabilities)) if (value !== "verified") blockers.push(`${key} : autorisation à vérifier.`);
  let preparationReady = false, verifiedLocationCount = 0;
  if (selected) {
    const checked = await verifyXAdsNativeSelections(ctx, selected, options.draft?.primaryText);
    resources = checked.resources;
    preparationReady = true; verifiedLocationCount = checked.selections.geoTargets.length;
    if (options.draft && (options.draft.provider !== "x" || options.draft.adAccountId !== ctx.accountId || checked.post && options.draft.primaryText !== checked.post.text)) throw new XAdsConnectionError("Le texte ou le compte du brouillon X ne correspond pas au post choisi.", "draft_post_mismatch", 422);
    if (options.draft) {
      try {
        const input = xAdsPublisherInputFromDraft(options.draft, checked.selections, checked.user);
        // Preparation validates the native mapping even before Standard approval is granted.
        validateXAdsPublisherInput(input, buildXAdsPublisherEvidence(checked, ctx.deps.now()), ctx.deps.now(), ctx.deps.resumed === true, { requireGrantProof: false });
      } catch (error) {
        if (!(error instanceof XAdsPublisherError)) throw error;
        preparationReady = false;
        blockers.push(error.code === "post_destination_mismatch"
          ? "Le lien final HTTPS avec ses paramètres UTM doit figurer exactement dans le texte du post X."
          : "Le parcours X actuel exige Engagements, texte seul, audience large, budget quotidien, plafond d’enchère et dates/heures explicites. Aucun lien ou ciblage supplémentaire n’est remplacé automatiquement.");
      }
    } else { preparationReady = false; blockers.push("Vérifiez le brouillon complet avec son budget et son calendrier."); }
  } else blockers.push("Choisissez le financement, le post texte et les zones natives.");
  const resourcesKey = xAdsResourcesConsentKey(resources);
  const preparationKey = createHash("sha256").update(JSON.stringify([options.draft || null, selected || null, resourcesKey])).digest("hex");
  const ready = preparationReady && blockers.length === 0;
  return { ready, publicationEnabled: false, pausedCreationEnabled: xAdsPausedCreationEnabled(), pausedCreationReady: ready, preparationReady, selectedAccountId: ctx.accountId, verifiedLocationCount, resourcesKey, preparationKey, consentKey: preparationKey, targetStatus: "PAUSED" as const, blockers, capabilities: resources.capabilities };
}
