const REQUIRED = [
  "LINKEDIN_ADS_CLIENT_ID",
  "LINKEDIN_ADS_CLIENT_SECRET",
  "LINKEDIN_ADS_REDIRECT_URI",
  "NEXT_PUBLIC_APP_URL",
  "INRCY_CREDENTIALS_SECRET",
];

const PUBLIC_SECRETS = [
  "NEXT_PUBLIC_LINKEDIN_ADS_CLIENT_SECRET",
  "NEXT_PUBLIC_INRCY_CREDENTIALS_SECRET",
];

export const LINKEDIN_ADS_EXPECTED_API_VERSION = "202609";
export const LINKEDIN_ADS_READ_SCOPE = "r_ads";
export const LINKEDIN_ADS_MANAGE_SCOPES = [
  "rw_ads",
  "r_ads_reporting",
  "r_organization_admin",
  "w_organization_social",
];

function value(env, key) {
  return String(env[key] || "").trim();
}

export function validateLinkedInAdsEnv(env) {
  const errors = [];
  const warnings = [];
  const missing = REQUIRED.filter((key) => !value(env, key));
  for (const key of missing) errors.push(`Variable manquante: ${key}`);
  if (missing.length) return { ok: false, errors, warnings };

  let appUrl;
  let redirect;
  try {
    appUrl = new URL(value(env, "NEXT_PUBLIC_APP_URL"));
    redirect = new URL(value(env, "LINKEDIN_ADS_REDIRECT_URI"));
  } catch {
    return { ok: false, errors: ["NEXT_PUBLIC_APP_URL ou LINKEDIN_ADS_REDIRECT_URI n'est pas valide."], warnings };
  }

  const loopbacks = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const localApp = loopbacks.has(appUrl.hostname);
  if (!localApp && (appUrl.protocol !== "https:" || redirect.protocol !== "https:")) {
    errors.push("L'application et le callback LinkedIn Ads doivent utiliser HTTPS en production.");
  }
  if (localApp && (!["http:", "https:"].includes(appUrl.protocol)
    || !["http:", "https:"].includes(redirect.protocol))) {
    errors.push("Les URLs LinkedIn Ads locales doivent utiliser HTTP ou HTTPS.");
  }
  if (redirect.pathname !== "/api/ads/linkedin/callback") {
    errors.push("Chemin callback incorrect. Attendu: /api/ads/linkedin/callback");
  }
  if (redirect.search || redirect.hash || redirect.username || redirect.password) {
    errors.push("Le callback LinkedIn Ads ne doit contenir ni identifiants, ni query string, ni fragment.");
  }
  if (redirect.origin !== appUrl.origin) {
    errors.push("Le callback LinkedIn Ads doit partager l'origine de NEXT_PUBLIC_APP_URL.");
  }

  const organicRedirect = value(env, "LINKEDIN_REDIRECT_URI");
  if (organicRedirect && organicRedirect === redirect.toString()) {
    errors.push("Les callbacks LinkedIn organique et LinkedIn Ads doivent être distincts.");
  }

  const version = value(env, "LINKEDIN_ADS_API_VERSION") || LINKEDIN_ADS_EXPECTED_API_VERSION;
  if (!/^20\d{4}$/.test(version)) {
    errors.push("LINKEDIN_ADS_API_VERSION doit utiliser le format YYYYMM.");
  } else if (version !== LINKEDIN_ADS_EXPECTED_API_VERSION) {
    warnings.push(`Version ${version} configurée ; le code et les tests ciblent ${LINKEDIN_ADS_EXPECTED_API_VERSION}.`);
  }

  for (const publicSecret of PUBLIC_SECRETS) {
    if (value(env, publicSecret)) errors.push(`Secret exposé au navigateur interdit: ${publicSecret}`);
  }

  let encryptionKeyBytes = 0;
  try {
    encryptionKeyBytes = Buffer.from(value(env, "INRCY_CREDENTIALS_SECRET"), "base64").length;
  } catch {
    encryptionKeyBytes = 0;
  }
  if (encryptionKeyBytes !== 32) {
    errors.push("INRCY_CREDENTIALS_SECRET doit décoder exactement 32 octets en base64.");
  }

  const sameApp = Boolean(value(env, "LINKEDIN_CLIENT_ID"))
    && value(env, "LINKEDIN_CLIENT_ID") === value(env, "LINKEDIN_ADS_CLIENT_ID");
  if (sameApp) {
    warnings.push("La même app LinkedIn est déclarée pour l'organique et Ads. Une app dédiée réduit le périmètre des scopes et des revues.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    details: {
      appOrigin: appUrl.origin,
      redirectPath: redirect.pathname,
      version,
      readScope: LINKEDIN_ADS_READ_SCOPE,
      manageScopes: [...LINKEDIN_ADS_MANAGE_SCOPES],
      credentialLabel: sameApp ? "explicit shared LinkedIn app" : "dedicated LinkedIn Ads pair",
    },
  };
}
