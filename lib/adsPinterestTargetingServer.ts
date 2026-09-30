import "server-only";

import { pinterestGeographyOptions, type PinterestGeographyOption } from "./adsPinterestLocations";
import { pinterestAdsAccessToken, PinterestAdsConnectionError, type PinterestAdsIntegration } from "./adsPinterestServer";

type CachedCatalog = { expiresAt: number; options: PinterestGeographyOption[] };
const catalogs = new Map<string, CachedCatalog>();
const CATALOG_TTL_MS = 5 * 60_000;

async function readCatalog(accessToken: string, accountId: string, type: "LOCATION" | "GEO"): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`https://api.pinterest.com/v5/resources/targeting/${type}?${new URLSearchParams({ ad_account_id: accountId })}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new PinterestAdsConnectionError("La recherche des zones Pinterest est temporairement indisponible. Réessayez dans quelques instants.", "targeting_unavailable");
  }
  if (!response.ok) {
    if (response.status === 401) throw new PinterestAdsConnectionError("Reconnectez Pinterest Ads pour rechercher les zones.", "needs_reconnect", 409);
    if (response.status === 403) throw new PinterestAdsConnectionError("Pinterest n’autorise pas la recherche des zones pour ce compte.", "targeting_access_denied", 403);
    if (response.status === 429) throw new PinterestAdsConnectionError("Pinterest reçoit trop de recherches. Réessayez dans quelques instants.", "targeting_rate_limited", 429);
    throw new PinterestAdsConnectionError("Les zones Pinterest sont momentanément indisponibles.", "targeting_unavailable");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    throw new PinterestAdsConnectionError("Pinterest a renvoyé un catalogue de zones incomplet.", "targeting_response_invalid", 502);
  }
  return payload;
}

/** Caller must freshly verify the connected user's access to the selected account. */
export async function listPinterestAdsGeographyOptions(
  userId: string, accountId: string, integration: PinterestAdsIntegration,
): Promise<PinterestGeographyOption[]> {
  if (!/^\d+$/.test(accountId) || integration.status !== "connected" || integration.resource_id !== accountId) {
    throw new PinterestAdsConnectionError("Choisissez un compte Pinterest Ads connecté avant de rechercher une zone.", "account_not_selected", 409);
  }
  const key = `${userId}:${integration.id}:${accountId}`;
  const cached = catalogs.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.options;
  for (const [cachedKey, entry] of catalogs) {
    if (entry.expiresAt <= Date.now()) catalogs.delete(cachedKey);
  }
  const accessToken = await pinterestAdsAccessToken(userId);
  const [locations, geographies] = await Promise.all([
    readCatalog(accessToken, accountId, "LOCATION"),
    readCatalog(accessToken, accountId, "GEO"),
  ]);
  const options = pinterestGeographyOptions(locations, geographies);
  if (!options.length) throw new PinterestAdsConnectionError("Pinterest n’a fourni aucune zone disponible pour ce compte.", "targeting_response_invalid", 502);
  // Store only public labels and IDs. Tokens and integration records never enter the cache.
  if (catalogs.size >= 100) catalogs.delete(catalogs.keys().next().value!);
  catalogs.set(key, { options, expiresAt: Date.now() + CATALOG_TTL_MS });
  return options;
}
