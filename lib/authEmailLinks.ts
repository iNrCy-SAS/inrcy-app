type SearchParamsReader = {
  get(name: string): string | null;
};

export type AuthEmailLinkParams = {
  tokenHash: string;
  language: string;
  recoveredMalformedQuery: boolean;
};

/**
 * Supabase's custom email templates append token_hash with their own `?`.
 * The redirect target must therefore stay query-free; otherwise a URL such as
 * `?lang=fr?token_hash=...` is produced and URLSearchParams cannot see the
 * token.
 */
export function buildSupabaseEmailRedirectUrl(
  appOrigin: string,
  path: string,
  language?: string | null,
) {
  const origin = `${String(appOrigin || "").replace(/\/+$/, "")}/`;
  const url = new URL(path, origin);
  url.search = "";
  url.hash = "";

  // Keep the selected language in the path, not in the query string. Supabase
  // owns the query string in the email template and appends `?token_hash=...`.
  // A path segment therefore preserves the locale without ever competing with
  // the authentication token delimiter.
  const normalizedLanguage = String(language || "")
    .trim()
    .toLowerCase()
    .match(/^[a-z]{2}(?:-[a-z]{2})?$/)?.[0]
    ?.slice(0, 2);
  if (normalizedLanguage) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/${normalizedLanguage}`;
  }

  return url.toString();
}

/**
 * Keeps already-sent malformed links usable after the redirect fix ships.
 * Historic links put `?token_hash=...` inside the `lang` value because the
 * email template and redirect URL both opened a query string.
 */
export function readAuthEmailLinkParams(searchParams: SearchParamsReader): AuthEmailLinkParams {
  let tokenHash = String(searchParams.get("token_hash") || "").trim();
  let language = String(searchParams.get("lang") || "").trim();
  let recoveredMalformedQuery = false;

  if (!tokenHash) {
    const nestedQueryOffset = language.indexOf("?");
    if (nestedQueryOffset >= 0) {
      const nestedParams = new URLSearchParams(language.slice(nestedQueryOffset + 1));
      const recoveredTokenHash = String(nestedParams.get("token_hash") || "").trim();
      if (recoveredTokenHash) {
        tokenHash = recoveredTokenHash;
        language = language.slice(0, nestedQueryOffset).trim();
        recoveredMalformedQuery = true;
      }
    }
  }

  return { tokenHash, language, recoveredMalformedQuery };
}
