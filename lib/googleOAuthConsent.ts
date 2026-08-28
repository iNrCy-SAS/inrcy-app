export const GOOGLE_OAUTH_PERMISSION_ERROR_CODE = "google_permissions_incomplete";

export const GOOGLE_OAUTH_PERMISSION_MESSAGE =
  "Autorisations Google incomplètes. Recommencez la connexion et cochez toutes les cases d’autorisation demandées par Google.";

export const GOOGLE_USERINFO_EMAIL_SCOPE =
  "https://www.googleapis.com/auth/userinfo.email";

export function parseGrantedGoogleScopes(rawScopes: unknown): Set<string> {
  const value = String(rawScopes ?? "").trim();
  if (!value) return new Set();
  return new Set(value.split(/\s+/).map((scope) => scope.trim()).filter(Boolean));
}

export function findExplicitlyMissingGoogleScopes(
  rawGrantedScopes: unknown,
  requiredScopes: readonly string[],
): string[] {
  const raw = String(rawGrantedScopes ?? "").trim();

  // OAuth 2.0 allows the token response to omit `scope` when the granted set
  // is identical to the requested one. A non-empty value is authoritative and
  // exposes granular-consent omissions made on Google's screen.
  if (!raw) return [];

  const granted = parseGrantedGoogleScopes(raw);
  return requiredScopes.filter((scope) => !granted.has(scope));
}
