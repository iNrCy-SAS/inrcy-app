import { tikTokAdsAuthorizeUrl, tikTokAdsCallbackUrl } from "../lib/adsTikTokPolicy.ts";

/** Pure audit: values, credentials and generated authorization links are never returned. */
export function validateTikTokAdsEnv(env) {
  const value = (name) => String(env[name] || "").trim();
  const errors = [], warnings = [];
  const required = ["NEXT_PUBLIC_APP_URL", "TIKTOK_ADS_APP_ID", "TIKTOK_ADS_SECRET",
    "TIKTOK_ADS_AUTHORIZATION_URL", "TIKTOK_ADS_REDIRECT_URI", "INRCY_CREDENTIALS_SECRET"];
  for (const name of required) if (!value(name)) errors.push("Variable manquante : " + name);
  for (const name of ["NEXT_PUBLIC_TIKTOK_ADS_SECRET", "NEXT_PUBLIC_TIKTOK_ADS_ACCESS_TOKEN",
    "NEXT_PUBLIC_INRCY_CREDENTIALS_SECRET"]) {
    if (value(name)) errors.push("Secret exposé au navigateur interdit : " + name);
  }
  let appOrigin = "";
  try {
    const app = new URL(value("NEXT_PUBLIC_APP_URL"));
    if ((app.protocol !== "https:" && !(app.protocol === "http:" && app.hostname === "localhost"))
      || app.username || app.password || app.search || app.hash || app.pathname !== "/") {
      errors.push("NEXT_PUBLIC_APP_URL doit être une origine HTTPS valide (HTTP localhost permis en développement).");
    } else appOrigin = app.origin;
  } catch {
    if (value("NEXT_PUBLIC_APP_URL")) errors.push("NEXT_PUBLIC_APP_URL invalide.");
  }
  const callback = tikTokAdsCallbackUrl(value("TIKTOK_ADS_REDIRECT_URI"), appOrigin || undefined);
  if (value("TIKTOK_ADS_REDIRECT_URI") && (!callback || !appOrigin)) {
    errors.push("Le callback TikTok Ads dédié doit partager l’origine de NEXT_PUBLIC_APP_URL, sans query ni fragment.");
  }
  const binding = { appId: value("TIKTOK_ADS_APP_ID"), redirectUri: value("TIKTOK_ADS_REDIRECT_URI") };
  if (value("TIKTOK_ADS_AUTHORIZATION_URL") && !tikTokAdsAuthorizeUrl(value("TIKTOK_ADS_AUTHORIZATION_URL"), "environment-check", binding)) {
    errors.push("L’URL d’autorisation officielle doit contenir un seul app_id et un seul callback correspondant exactement aux variables TikTok Ads.");
  }
  if (value("TIKTOK_ADS_APP_ID") && !/^\d{5,30}$/.test(binding.appId)) errors.push("TIKTOK_ADS_APP_ID doit être l’identifiant numérique délivré par TikTok.");
  if (value("INRCY_CREDENTIALS_SECRET") && Buffer.from(value("INRCY_CREDENTIALS_SECRET"), "base64").length !== 32) {
    errors.push("INRCY_CREDENTIALS_SECRET doit décoder exactement 32 octets en base64.");
  }
  if (value("TIKTOK_REDIRECT_URI") && value("TIKTOK_REDIRECT_URI") === binding.redirectUri) {
    errors.push("Les callbacks TikTok organique et TikTok Ads doivent être distincts.");
  }
  warnings.push("La validation locale ne prouve pas l’approbation de l’application ni l’accès annonceur. La publication TikTok Ads reste désactivée.");
  return { ok: errors.length === 0, errors, warnings,
    details: { appOrigin, redirectPath: callback?.pathname || "", publicationEnabled: false } };
}
