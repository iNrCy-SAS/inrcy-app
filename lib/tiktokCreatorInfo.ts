import { asRecord, asString } from "./tsSafe.ts";

const CREATOR_INFO_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";
const MAX_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 8_000;

export class TikTokCreatorInfoError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, retryable: boolean) {
    super(`TikTok creator info unavailable (${status}, ${code})`);
    this.name = "TikTokCreatorInfoError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

/** Read-only query: retry transient provider failures, never publishing or permissions. */
export async function queryTikTokCreatorInfo(
  accessToken: string,
  options: {
    fetchImpl?: typeof fetch;
    sleep?: (milliseconds: number) => Promise<void>;
    timeoutMs?: number;
  } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(CREATOR_INFO_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
      const payload: unknown = await response.json().catch(() => null);
      const record = asRecord(payload);
      const code = asString(asRecord(record.error).code) || "";
      if (!response.ok || (code && code !== "ok")) {
        throw new TikTokCreatorInfoError(
          response.status,
          code || "provider_http_error",
          response.status >= 500,
        );
      }
      // Never invent stale or default privacy permissions when the provider fails.
      if (!record.data || typeof record.data !== "object" || Array.isArray(record.data)) {
        throw new TikTokCreatorInfoError(502, "invalid_response", true);
      }
      return asRecord(record.data);
    } catch (error) {
      const failure = error instanceof TikTokCreatorInfoError
        ? error
        : new TikTokCreatorInfoError(503, "provider_network_error", true);
      if (!failure.retryable || attempt + 1 >= MAX_ATTEMPTS) throw failure;
      await sleep(500);
    }
  }
  throw new TikTokCreatorInfoError(503, "provider_unavailable", true);
}

export function tiktokCreatorInfoFailureResponse(error: TikTokCreatorInfoError) {
  if (error.status === 401) {
    return { status: 401, code: "TIKTOK_RECONNECT_REQUIRED", message: "Reconnecte TikTok dans Canaux avant de publier.", retryAfter: null };
  }
  if (error.status === 429) {
    return { status: 429, code: "TIKTOK_RATE_LIMITED", message: "TikTok reçoit trop de demandes. Réessaie dans une minute.", retryAfter: "60" };
  }
  if (error.retryable) {
    return { status: 503, code: "TIKTOK_TEMPORARILY_UNAVAILABLE", message: "TikTok est temporairement indisponible. Réessaie dans quelques instants.", retryAfter: "30" };
  }
  return { status: 409, code: "TIKTOK_CREATOR_INFO_REJECTED", message: "TikTok ne permet pas la publication pour ce compte actuellement.", retryAfter: null };
}
