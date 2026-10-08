import "server-only";
import { listPinterestAdsAccounts, pinterestAdsAccessToken, PinterestAdsConnectionError, readPinterestAdsIntegration } from "./adsPinterestServer.ts";
import { missingPinterestAdsScopes } from "./adsPinterestPolicy.ts";
import { normalizePinterestAdsResources } from "./adsPinterestResources.ts";

export async function readPinterestAdsResourceJson(accessToken: string, path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`https://api.pinterest.com/v5${path}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30000) });
  } catch { throw new PinterestAdsConnectionError("Pinterest n’a pas permis de vérifier les paramètres de ce compte. Réessayez dans quelques instants.", "resources_unavailable", 503); }
  if (!response.ok) throw new PinterestAdsConnectionError("Pinterest n’autorise pas la lecture des paramètres de ce compte. Vérifiez la connexion puis réessayez.", "resources_unavailable", response.status === 401 || response.status === 403 ? 403 : response.status === 429 ? 429 : 503);
  try { return await response.json(); } catch { throw new PinterestAdsConnectionError("Pinterest a renvoyé une réponse de paramètres invalide.", "resources_invalid", 503); }
}

/** No remote mutation, no targeting cache. Refresh credentials before using the current associated account snapshot. */
export async function readPinterestAdsDeliveryResources(userId: string, expectedAccountId?: string) {
  const initial = await readPinterestAdsIntegration(userId);
  if (!initial || initial.status !== "connected" || !initial.resource_id || expectedAccountId && initial.resource_id !== expectedAccountId) throw new PinterestAdsConnectionError("Connectez et associez le compte Pinterest Ads de cette campagne.", "account_not_selected", 409);
  const accounts = await listPinterestAdsAccounts(userId, initial);
  const current = await readPinterestAdsIntegration(userId);
  if (!current || current.id !== initial.id || current.status !== "connected" || current.resource_id !== initial.resource_id || missingPinterestAdsScopes(current.scopes).length) throw new PinterestAdsConnectionError("Le compte ou les autorisations Pinterest ont changé. Relancez la vérification.", "account_changed", 409);
  const selected = accounts.find((account) => account.id === current.resource_id && account.currency === "EUR" && account.canManageCampaigns === true);
  if (!selected) throw new PinterestAdsConnectionError("Le compte Pinterest Ads EUR n’est plus accessible avec un rôle permettant de gérer les campagnes.", "account_not_accessible", 403);
  const accessToken = await pinterestAdsAccessToken(userId);
  const afterToken = await readPinterestAdsIntegration(userId);
  if (!afterToken || afterToken.id !== current.id || afterToken.status !== "connected" || afterToken.resource_id !== selected.id) throw new PinterestAdsConnectionError("Le compte Pinterest associé a changé. Relancez la vérification.", "account_changed", 409);
  const read = (path: string) => readPinterestAdsResourceJson(accessToken, path);
  const [accountPayload, locationPayload, geoPayload, localePayload] = await Promise.all([
    read(`/ad_accounts/${selected.id}`), ...["LOCATION", "GEO", "LOCALE"].map((type) => read(`/resources/targeting/${type}?ad_account_id=${encodeURIComponent(selected.id)}`)),
  ]);
  const resources = normalizePinterestAdsResources(accountPayload, locationPayload, geoPayload, localePayload, selected.id);
  const final = await readPinterestAdsIntegration(userId);
  if (!final || final.id !== afterToken.id || final.status !== "connected" || final.resource_id !== selected.id) throw new PinterestAdsConnectionError("Le compte Pinterest associé a changé pendant la vérification. Relancez-la.", "account_changed", 409);
  // Tokens and raw responses are server-only; routes must return resources alone.
  return { resources, accessToken, locationPayload, geoPayload, localePayload };
}
