import { editableGoogleBusinessCategories, googleBusinessRecord, type GoogleBusinessCategory } from "./googleBusinessProfile.ts";

const BASE = "https://mybusinessbusinessinformation.googleapis.com/v1/";
const CATEGORY_NAME = /^(?:categories\/)?gcid:[a-z0-9_]+$/;

export function googleBusinessCategoryRegion(location: unknown): string | null {
  const source = googleBusinessRecord(location);
  const value = googleBusinessRecord(source.storefrontAddress).regionCode || googleBusinessRecord(source.serviceArea).regionCode;
  return typeof value === "string" && /^[A-Z]{2}$/.test(value) ? value : null;
}

export async function searchGoogleBusinessCategories(options: {
  accessToken: string; regionCode: string; languageCode: string; query?: string; pageToken?: string; names?: string[]; fetchImpl?: typeof fetch;
}) {
  const { accessToken, regionCode, languageCode, query = "", pageToken = "", names, fetchImpl = fetch } = options;
  if (!/^[A-Z]{2}$/.test(regionCode) || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(languageCode)) throw new Error("Pays ou langue de recherche invalide.");
  const url = new URL(`${BASE}${names ? "categories:batchGet" : "categories"}`);
  url.searchParams.set("regionCode", regionCode);
  url.searchParams.set("languageCode", languageCode);
  url.searchParams.set("view", "BASIC");
  if (names) {
    if (!names.length || names.length > 10 || names.some(name => !CATEGORY_NAME.test(name))) throw new Error("Identifiant d’activité Google invalide.");
    for (const name of names) url.searchParams.append("names", name);
  } else {
    if (query.length < 2 || query.length > 80 || !/^[\p{L}\p{N}][\p{L}\p{N}\s'’&()./-]*$/u.test(query)) throw new Error("Saisissez au moins deux lettres du début de l’activité.");
    if (pageToken.length > 4096) throw new Error("Page de recherche invalide.");
    url.searchParams.set("filter", `displayName=${query}`);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
  }
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Google n’autorise pas la lecture des activités. Vérifiez la connexion de la fiche." : "La liste Google est indisponible. Réessayez dans un instant.");
  const data = googleBusinessRecord(await response.json());
  if (data.categories !== undefined && !Array.isArray(data.categories)) throw new Error("Google n’a pas renvoyé une liste d’activités valide.");
  const categories: GoogleBusinessCategory[] = editableGoogleBusinessCategories({ additionalCategories: data.categories ?? [] }).additionalCategories;
  if (names && names.some(name => !categories.some(category => category.name === name))) throw new Error("Une activité n’est plus proposée par Google. Relancez la recherche.");
  return { categories, nextPageToken: typeof data.nextPageToken === "string" ? data.nextPageToken : null };
}
