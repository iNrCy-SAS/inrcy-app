const REQUIRED = [
  "X_ADS_API_KEY",
  "X_ADS_API_SECRET",
  "X_ADS_REDIRECT_URI",
  "NEXT_PUBLIC_APP_URL",
  "INRCY_CREDENTIALS_SECRET",
];

const PUBLIC_CREDENTIALS = [
  "NEXT_PUBLIC_X_ADS_API_KEY",
  "NEXT_PUBLIC_X_ADS_API_SECRET",
  "NEXT_PUBLIC_X_ADS_ACCESS_TOKEN",
  "NEXT_PUBLIC_X_ADS_ACCESS_TOKEN_SECRET",
];

export const X_ADS_EXPECTED_API_VERSION = "12";

function value(env, key) {
  return String(env[key] || "").trim();
}

export function validateXAdsEnv(env) {
  const errors = [];

  // Public credential leaks must be reported even when the server-side
  // configuration is incomplete. Do not let an early missing-variable return
  // hide the most urgent failure mode.
  for (const publicCredential of PUBLIC_CREDENTIALS) {
    if (value(env, publicCredential)) {
      errors.push(`Identifiant Ads exposé au navigateur interdit: ${publicCredential}`);
    }
  }

  const missing = REQUIRED.filter((key) => !value(env, key));
  for (const key of missing) errors.push(`Variable manquante: ${key}`);
  if (missing.length) return { ok: false, errors };

  let appUrl;
  let redirect;
  try {
    appUrl = new URL(value(env, "NEXT_PUBLIC_APP_URL"));
    redirect = new URL(value(env, "X_ADS_REDIRECT_URI"));
  } catch {
    return { ok: false, errors: ["NEXT_PUBLIC_APP_URL ou X_ADS_REDIRECT_URI n'est pas valide."] };
  }

  const localApp = ["localhost", "127.0.0.1"].includes(appUrl.hostname);
  if (!localApp && (appUrl.protocol !== "https:" || redirect.protocol !== "https:")) {
    errors.push("L'application et le callback X Ads doivent utiliser HTTPS en production.");
  }
  if (localApp && redirect.protocol !== "http:" && redirect.protocol !== "https:") {
    errors.push("Le callback X Ads local doit utiliser HTTP ou HTTPS.");
  }
  if (redirect.pathname !== "/api/ads/x/callback") {
    errors.push("Chemin callback incorrect. Attendu: /api/ads/x/callback");
  }
  if (redirect.search || redirect.hash || redirect.username || redirect.password) {
    errors.push("Le callback X Ads ne doit contenir ni identifiants, ni query string, ni fragment.");
  }
  if (redirect.origin !== appUrl.origin) {
    errors.push("Le callback X Ads doit partager l'origine de NEXT_PUBLIC_APP_URL.");
  }

  const organicRedirect = value(env, "X_REDIRECT_URI");
  if (organicRedirect && organicRedirect === redirect.toString()) {
    errors.push("Les callbacks X organique et X Ads doivent être distincts.");
  }

  const version = value(env, "X_ADS_API_VERSION") || X_ADS_EXPECTED_API_VERSION;
  if (version !== X_ADS_EXPECTED_API_VERSION) {
    errors.push(`X_ADS_API_VERSION doit valoir ${X_ADS_EXPECTED_API_VERSION}, version courante ciblée et testée.`);
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

  return {
    ok: errors.length === 0,
    errors,
    details: { appOrigin: appUrl.origin, redirectPath: redirect.pathname, version },
  };
}
