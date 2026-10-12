import { getLocalizedErrorMessage } from "@/lib/userFacingErrors";
import { looksLikeEnglishErrorMessage } from "@/lib/publicationErrorFrench";

export type MetaOAuthCallbackProvider = "instagram" | "threads";
type Query = { get(name: string): string | null };

/** Read callback feedback separately from connection state and transient status-fetch errors. */
export function getMetaOAuthCallbackNotice(query: Query, provider: MetaOAuthCallbackProvider, language: string, fallback: string): string | null {
  if (query.get("panel") !== provider || (query.get("linked") && query.get("linked") !== provider)) return null;
  if (provider === "instagram" && query.get("ig_login") !== "direct") return null;
  if (query.get("ok") === "1" || (!query.get("error") && !query.get("message"))) return null;
  const message = query.get("message")?.trim() || "";
  // Callback queries are untrusted. Credentials, URLs, markup and raw dumps are never panel copy.
  if (!message || message.length > 500 || /https?:\/\/|[<>{}]|\bBearer\s|\b[a-f0-9]{32,}\b|[a-z0-9_\/-]{48,}|\b(?:RPC|SQL|SQLSTATE|PostgREST|Supabase|stack|trace|TypeError|ReferenceError|JWT|OAuth|token)\b|(?:code|state|token|access_token|client_secret|refresh_token|password)\s*[:=]/i.test(message)) return fallback;
  if (looksLikeEnglishErrorMessage(message)) return getLocalizedErrorMessage(message, language, fallback).slice(0, 300);
  return message.replace(/\s+/g, " ").slice(0, 300);
}
