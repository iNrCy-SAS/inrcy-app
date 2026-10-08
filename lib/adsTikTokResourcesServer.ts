import "server-only";
import { decryptToken } from "./oauthCrypto.ts";
import { readTikTokAdsIntegration, TikTokAdsConnectionError, type TikTokAdsIntegration } from "./adsTikTokServer.ts";
import { TIKTOK_ADS_API_BASE, parseTikTokAdvertiserIds, tikTokAdsAccessTokenIsFresh, tikTokAdsAccountCanAssociate } from "./adsTikTokPolicy.ts";
import { parseTikTokAdsIdentities, parseTikTokAdsResourceAccount, type TikTokAdsIdentity, type TikTokAdsResources, type TikTokAdsResourceBlocker, TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT, parseTikTokAdsTrafficRegions, normalizeTikTokAdsGeoQueries, normalizeTikTokAdsLocationIds, resolveTikTokAdsGeoQueries, tikTokAdsResourcesConsentKey, type TikTokAdsGeoTarget, type TikTokAdsGeography, type TikTokAdsTrafficPreparation } from "./adsTikTokResources.ts";

export type TikTokAdsResourceDependencies = {
  readIntegration: (userId: string) => Promise<TikTokAdsIntegration | null>;
  decrypt: (ciphertext: string) => string;
  fetchImpl: typeof fetch;
  appId: string;
  secret: string;
  now: () => number;
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const context = (row: TikTokAdsIntegration) => JSON.stringify([row.id, row.status, row.resource_id, row.access_token_enc, row.refresh_token_enc, row.expires_at, record(row.meta).token_lifecycle]);

/** Strict GET-only transport; neither OAuth refresh nor provider writes are used by this preparation endpoint. */
async function readApi(path: "oauth2/advertiser/get" | "advertiser/info" | "identity/get" | "tool/region", params: URLSearchParams, accessToken: string, deps: TikTokAdsResourceDependencies) {
  let response: Response;
  try {
    response = await deps.fetchImpl(`${TIKTOK_ADS_API_BASE}/${path}/?${params}`, {
      method: "GET", headers: { "Access-Token": accessToken, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new TikTokAdsConnectionError("TikTok Ads est momentanément indisponible.", "provider_unavailable"); }
  const payload = record(await response.json().catch(() => null));
  if (!response.ok || payload.code !== 0) {
    if (response.status === 401) throw new TikTokAdsConnectionError("Réautorisez la connexion TikTok Ads.", "needs_reconnect", 409);
    if (response.status === 403) throw new TikTokAdsConnectionError("L’application ou le compte TikTok Ads n’autorise pas cette lecture.", "ads_access_denied", 403);
    if (response.status === 429) throw new TikTokAdsConnectionError("TikTok Ads limite temporairement les lectures. Réessayez plus tard.", "provider_rate_limit", 503);
    throw new TikTokAdsConnectionError("TikTok Ads n’a pas confirmé la lecture des ressources.", "provider_unavailable");
  }
  return payload;
}

type TikTokAdsReadOnlyContext = {
  selectedAccountId: string; account: TikTokAdsResources["account"]; now: () => number;
  appId: string; integrationFingerprint: string;
  read: (path: "identity/get" | "tool/region", params: URLSearchParams) => Promise<Record<string, unknown>>;
  assertCurrent: () => Promise<void>;
};
/** An owned fresh snapshot and a GET-only closure; access tokens remain inside the server module. */
async function openTikTokAdsReadOnlyContext(userId: string, expectedAccountId?: string, dependencies?: TikTokAdsResourceDependencies): Promise<TikTokAdsReadOnlyContext> {
  const deps: TikTokAdsResourceDependencies = dependencies || { readIntegration: readTikTokAdsIntegration, decrypt: decryptToken, fetchImpl: fetch,
    appId: process.env.TIKTOK_ADS_APP_ID || "", secret: process.env.TIKTOK_ADS_SECRET || "", now: Date.now };
  if (!deps.appId || !deps.secret) throw new TikTokAdsConnectionError("Configurez l’application TikTok API for Business dédiée à iNr’ADS.", "configuration_missing");
  const initial = await deps.readIntegration(userId);
  if (!initial || initial.status !== "connected" || !initial.access_token_enc) throw new TikTokAdsConnectionError("Connectez TikTok Ads avant de vérifier ses ressources.", "not_connected", 409);
  const accountId = initial.resource_id || "";
  if (!/^\d{5,30}$/.test(accountId)) throw new TikTokAdsConnectionError("Associez un compte annonceur TikTok Ads avant de vérifier les ressources.", "account_required", 409);
  if (expectedAccountId && expectedAccountId !== accountId) throw new TikTokAdsConnectionError("Le compte TikTok Ads associé a changé.", "account_mismatch", 409);
  const longLived = record(initial.meta).token_lifecycle === "long_lived" && !initial.expires_at && !initial.refresh_token_enc;
  if (!longLived && !tikTokAdsAccessTokenIsFresh(initial.expires_at, deps.now())) throw new TikTokAdsConnectionError("Actualisez la connexion TikTok Ads avant ce contrôle en lecture seule.", "needs_reconnect", 409);
  let accessToken: string;
  try { accessToken = deps.decrypt(initial.access_token_enc); } catch { throw new TikTokAdsConnectionError("Réautorisez la connexion TikTok Ads.", "needs_reconnect", 409); }
  if (!accessToken) throw new TikTokAdsConnectionError("Réautorisez la connexion TikTok Ads.", "needs_reconnect", 409);
  async function requireSameContext() {
    const current = await deps.readIntegration(userId);
    if (!current || context(current) !== context(initial!)) throw new TikTokAdsConnectionError("La connexion ou le compte TikTok Ads a changé pendant la vérification.", "account_mismatch", 409);
  }

  const authorized = await readApi("oauth2/advertiser/get", new URLSearchParams({ app_id: deps.appId, secret: deps.secret }), accessToken, deps);
  await requireSameContext();
  if (!parseTikTokAdvertiserIds(authorized).includes(accountId)) throw new TikTokAdsConnectionError("Ce compte n’est plus autorisé pour l’application TikTok Ads.", "account_not_accessible", 403);
  const nativeAccount = await readApi("advertiser/info", new URLSearchParams({ advertiser_ids: JSON.stringify([accountId]) }), accessToken, deps);
  await requireSameContext();
  const account = parseTikTokAdsResourceAccount(nativeAccount, accountId);
  if (!account || !tikTokAdsAccountCanAssociate(account)) throw new TikTokAdsConnectionError("Le compte TikTok Ads EUR n’est pas actif ou accessible.", "account_not_active", 409);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(context(initial)));
  const integrationFingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { selectedAccountId: accountId, account, appId: deps.appId, integrationFingerprint, now: deps.now, assertCurrent: requireSameContext,
    read: async (path, params) => {
      await requireSameContext();
      const payload = await readApi(path, params, accessToken, deps);
      await requireSameContext();
      return payload;
    } };
}

async function readResourcesInContext(ctx: TikTokAdsReadOnlyContext): Promise<TikTokAdsResources> {
  const accountId = ctx.selectedAccountId, account = ctx.account;

  let identities: TikTokAdsIdentity[] = [], identityRead: TikTokAdsResources["identityRead"] = { status: "verified" };
  try {
    const byId = new Map<string, TikTokAdsIdentity>();
    for (let page = 1; page <= 10; page++) {
      // Omitting identity_type requests all identities; no identity is created.
      const payload = await ctx.read("identity/get", new URLSearchParams({ advertiser_id: accountId, page: String(page), page_size: "100" }));
      const rows = parseTikTokAdsIdentities(payload);
      if (!rows) throw new TikTokAdsConnectionError("La réponse des identités TikTok Ads doit être revérifiée.", "identity_response_invalid");
      rows.forEach((identity) => byId.set(`${identity.type}:${identity.id}:${identity.authorizedBusinessCenterId || ""}`, identity));
      const pageInfo = record(record(payload.data).page_info), totalPages = Number(pageInfo.total_page);
      const more = Number.isSafeInteger(totalPages) && totalPages > page ? true : rows.length >= 100 && !Number.isSafeInteger(totalPages);
      if (!more) break;
      if (page === 10) throw new TikTokAdsConnectionError("Les identités TikTok Ads dépassent la limite de lecture du contrôle.", "identity_read_limit");
    }
    identities = [...byId.values()];
  } catch (error) {
    if (!(error instanceof TikTokAdsConnectionError) || ["needs_reconnect", "account_mismatch"].includes(error.code)) throw error;
    identityRead = { status: "unavailable", code: error.code };
  }
  await ctx.assertCurrent();
  const blockers: TikTokAdsResourceBlocker[] = ["campaign_write_unverified", "active_publication_disabled"];
  if (identityRead.status !== "verified") blockers.push("identity_read_unavailable");
  else if (!identities.length) blockers.push("identity_required");
  if (!account.timezone) blockers.push("account_timezone_unverified");
  return { selectedAccountId: accountId, account, identities, identityRead,
    readiness: { advertiserRead: true, campaignWrite: "unverified", publicationReady: false, blockers }, publicationEnabled: false, verifiedAt: new Date(ctx.now()).toISOString() };
}

/** Reuses the established Ads integration; no secret or credential is projected to the client. */
export async function readTikTokAdsResources(userId: string, expectedAccountId?: string, dependencies?: TikTokAdsResourceDependencies): Promise<TikTokAdsResources> {
  return readResourcesInContext(await openTikTokAdsReadOnlyContext(userId, expectedAccountId, dependencies));
}

async function readTrafficRegionsInContext(ctx: TikTokAdsReadOnlyContext): Promise<TikTokAdsGeoTarget[]> {
  const payload = await ctx.read("tool/region", new URLSearchParams({ advertiser_id: ctx.selectedAccountId,
    placements: JSON.stringify(TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT.placements), objective_type: TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT.objectiveType,
    level_range: TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT.levelRange, language: TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT.language }));
  const targets = parseTikTokAdsTrafficRegions(payload);
  if (!targets) throw new TikTokAdsConnectionError("TikTok Ads n’a pas confirmé le catalogue géographique natif de ce compte et de ce placement.", "geography_response_invalid");
  return targets;
}

function projectGeography(ctx: TikTokAdsReadOnlyContext, targets: TikTokAdsGeoTarget[], queries: string[]): TikTokAdsGeography {
  const resolutions = resolveTikTokAdsGeoQueries(targets, queries);
  const resolvedTargets = [...new Map(resolutions.flatMap((resolution) => resolution.target ? [[resolution.target.id, resolution.target] as const] : [])).values()];
  const options = queries.length ? [...new Map(resolutions.flatMap((resolution) => resolution.candidates.map((target) => [target.id, target] as const))).values()]
    : targets.filter((target) => target.level === "COUNTRY").sort((a, b) => a.name.localeCompare(b.name));
  return { selectedAccountId: ctx.selectedAccountId, context: TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT, resolutions, resolvedTargets,
    unresolvedQueries: resolutions.filter((resolution) => !resolution.target).map((resolution) => resolution.query), options,
    publicationEnabled: false, verifiedAt: new Date(ctx.now()).toISOString() };
}

/** The same full native catalogue is scoped to one advertiser, Traffic and TikTok placement. */
export async function readTikTokAdsGeography(userId: string, input: { accountId?: string; queries: unknown }, dependencies?: TikTokAdsResourceDependencies): Promise<TikTokAdsGeography> {
  const queries = normalizeTikTokAdsGeoQueries(input.queries);
  if (!queries) throw new TikTokAdsConnectionError("Indiquez au maximum 20 libellés géographiques précis.", "invalid_geography_queries", 400);
  const ctx = await openTikTokAdsReadOnlyContext(userId, input.accountId, dependencies);
  const targets = await readTrafficRegionsInContext(ctx);
  await ctx.assertCurrent();
  return projectGeography(ctx, targets, queries);
}

/** Preparation evidence only. No account GET proves writes, minimum EUR budget or API time basis. */
export async function checkTikTokAdsTrafficPreparation(userId: string, input: { accountId?: string; identity?: Pick<TikTokAdsIdentity, "id" | "type" | "authorizedBusinessCenterId"> | null; locationIds: unknown }, dependencies?: TikTokAdsResourceDependencies): Promise<TikTokAdsTrafficPreparation> {
  const locationIds = normalizeTikTokAdsLocationIds(input.locationIds);
  if (!locationIds) throw new TikTokAdsConnectionError("Les identifiants des zones TikTok Ads doivent être natifs et vérifiables.", "invalid_location_ids", 400);
  const ctx = await openTikTokAdsReadOnlyContext(userId, input.accountId, dependencies);
  const resources = await readResourcesInContext(ctx), targets = await readTrafficRegionsInContext(ctx);
  const requested = input.identity;
  const selectedIdentity = requested ? resources.identities.find((identity) => identity.id === requested.id && identity.type === requested.type
    && (identity.authorizedBusinessCenterId || "") === (requested.authorizedBusinessCenterId || "")) || null : null;
  const verifiedLocations = locationIds.flatMap((locationId) => { const found = targets.find((target) => target.id === locationId); return found ? [found] : []; });
  const selectionBlockers: string[] = [];
  if (!selectedIdentity) selectionBlockers.push(requested ? "identity_not_authorized" : "identity_required");
  if (!locationIds.length) selectionBlockers.push("location_required");
  else if (verifiedLocations.length !== locationIds.length) selectionBlockers.push("location_not_available");
  if (!resources.account.timezone) selectionBlockers.push("account_timezone_unverified");
  const resourcesKey = tikTokAdsResourcesConsentKey(resources);
  if (!resourcesKey) throw new TikTokAdsConnectionError("Le contexte TikTok Ads doit être revérifié.", "account_mismatch", 409);
  await ctx.assertCurrent();
  return { ready: false, publicationEnabled: false, preparationReady: !selectionBlockers.length,
    selectedAccountId: ctx.selectedAccountId, selectedIdentity, verifiedLocations, verifiedLocationCount: verifiedLocations.length,
    resourcesKey, context: TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT,
    capabilities: { nativeWriteAccess: "unverified", manualTrafficV13: "unverified", videoUpload: "unverified", imageUpload: "unverified", mediaRead: "unverified", objectRead: "unverified",
      minimumLifetimeBudgetEuros: null, budgetCalendar: null, scheduleTimeBasis: null, scheduleOffsetMinutes: null },
    blockers: [...new Set([...resources.readiness.blockers, ...selectionBlockers, "manual_traffic_v13_unverified", "budget_minimum_unverified", "schedule_time_basis_unverified",
      "video_upload_unverified", "image_upload_unverified", "media_read_unverified", "object_read_unverified", "cta_options_unverified", "non_spark_identity_type_unverified"])],
    verifiedAt: new Date(ctx.now()).toISOString() };
}

/** Server-only compound snapshot. The fingerprint binds capability evidence to the exact encrypted
 * integration snapshot, without exposing credentials. Every provider operation here is GET-only.
 */
export async function readTikTokTrafficCampaignContext(userId: string, expectedAccountId: string, dependencies?: TikTokAdsResourceDependencies) {
  const ctx = await openTikTokAdsReadOnlyContext(userId, expectedAccountId, dependencies);
  const resources = await readResourcesInContext(ctx), locations = await readTrafficRegionsInContext(ctx);
  await ctx.assertCurrent();
  return { resources, locations, scope: { appId: ctx.appId, advertiserId: ctx.selectedAccountId, integrationFingerprint: ctx.integrationFingerprint, context: TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT },
    now: ctx.now, assertCurrent: ctx.assertCurrent };
}
