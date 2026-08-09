import "server-only";

import { log } from "@/lib/observability/logger";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  FACEBOOK_RECONNECT_USER_MESSAGE,
  GOOGLE_BUSINESS_RECONNECT_USER_MESSAGE,
  INSTAGRAM_RECONNECT_USER_MESSAGE,
  LINKEDIN_RECONNECT_USER_MESSAGE,
  getSimpleFrenchErrorMessage,
} from "@/lib/userFacingErrors";
import {
  ensureFrenchPublicationErrorMessage,
  getProviderPublicationErrorMessage,
} from "@/lib/publicationErrorFrench";
import {
  isApplicationSessionAuthenticationError,
  isProviderReconnectRequired,
} from "@/lib/channelReconnectPolicy";

export type PublishDiagnosticChannel = "facebook" | "instagram" | "linkedin" | "gmb" | "inrcy_site" | "site_web" | "inr_search" | "tiktok" | "youtube_shorts" | "pinterest";

const CHANNEL_LABELS: Record<PublishDiagnosticChannel, string> = {
  inrcy_site: "Site iNrCy",
  site_web: "Site web",
  inr_search: "iNr’Search",
  gmb: "Google Business",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube_shorts: "YouTube",
  pinterest: "Pinterest",
};

const CHANNEL_FALLBACKS: Record<PublishDiagnosticChannel, string> = {
  inrcy_site: "Le site iNrCy n'a pas pu publier. Merci de réessayer.",
  site_web: "Le site web n'a pas pu publier. Merci de réessayer.",
  inr_search: "La page iNr’Search n’a pas pu être mise à jour. Merci de réessayer.",
  gmb: "Google Business n'a pas pu publier. Merci de réessayer.",
  facebook: "Facebook n'a pas pu publier. Merci de réessayer.",
  instagram: "Instagram n'a pas pu publier. Merci de réessayer.",
  linkedin: "LinkedIn n'a pas pu publier. Merci de réessayer.",
  tiktok: "TikTok n'a pas pu publier. Merci de réessayer.",
  youtube_shorts: "YouTube n'a pas pu publier. Merci de réessayer.",
  pinterest: "Pinterest n'a pas pu publier. Merci de réessayer.",
};

const CHANNEL_RECONNECTS: Partial<Record<PublishDiagnosticChannel, string>> = {
  gmb: GOOGLE_BUSINESS_RECONNECT_USER_MESSAGE,
  facebook: FACEBOOK_RECONNECT_USER_MESSAGE,
  instagram: INSTAGRAM_RECONNECT_USER_MESSAGE,
  linkedin: LINKEDIN_RECONNECT_USER_MESSAGE,
  tiktok: "TikTok à reconnecter. Rendez-vous dans Canaux.",
  youtube_shorts: "YouTube à reconnecter. Rendez-vous dans Canaux.",
  pinterest: "Pinterest à reconnecter. Rendez-vous dans Canaux.",
};

function stringifyError(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof Error) return input.message || String(input);
  try {
    return JSON.stringify(input);
  } catch {
    return String(input || "");
  }
}

const RECONNECT_INTEGRATION_KEYS: Partial<Record<PublishDiagnosticChannel, { provider: string; source: string; product: string }>> = {
  gmb: { provider: "google", source: "gmb", product: "gmb" },
  facebook: { provider: "facebook", source: "facebook", product: "facebook" },
  instagram: { provider: "instagram", source: "instagram", product: "instagram" },
  linkedin: { provider: "linkedin", source: "linkedin", product: "linkedin" },
  tiktok: { provider: "tiktok", source: "tiktok", product: "tiktok" },
  youtube_shorts: { provider: "youtube", source: "youtube_shorts", product: "youtube_shorts" },
  pinterest: { provider: "pinterest", source: "pinterest", product: "pinterest" },
};

export function isPublishReconnectRequiredError(
  channel: PublishDiagnosticChannel,
  error: unknown,
  userMessage?: string | null,
  stage?: string | null,
): boolean {
  return isProviderReconnectRequired({
    channel,
    error,
    userMessage,
    stage,
  });
}

export async function markPublishChannelReconnectRequired(params: {
  channel: PublishDiagnosticChannel;
  userId: string;
  error?: unknown;
  userMessage?: string | null;
  stage?: string | null;
  attemptStartedAt?: string | null;
}) {
  const key = RECONNECT_INTEGRATION_KEYS[params.channel];
  if (!key || !params.userId) return false;
  if (!isPublishReconnectRequiredError(params.channel, params.error, params.userMessage, params.stage)) return false;

  const { data, error: readError } = await supabaseAdmin
    .from("integrations")
    .select("id,meta")
    .eq("user_id", params.userId)
    .eq("provider", key.provider)
    .eq("source", key.source)
    .eq("product", key.product)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (readError || !data?.id) return false;
  const currentMeta = data.meta && typeof data.meta === "object" && !Array.isArray(data.meta)
    ? data.meta as Record<string, unknown>
    : {};
  const attemptStartedAtMs = Date.parse(String(params.attemptStartedAt || ""));
  const latestConnectionAtMs = Date.parse(
    String(currentMeta.connection_version_updated_at || ""),
  );
  if (
    Number.isFinite(attemptStartedAtMs) &&
    Number.isFinite(latestConnectionAtMs) &&
    latestConnectionAtMs > attemptStartedAtMs
  ) {
    // The user completed a newer OAuth connection while this publication was
    // running. A late failure from the old token must never poison the new one.
    return false;
  }
  const now = new Date().toISOString();
  const { error: updateError } = await supabaseAdmin
    .from("integrations")
    .update({
      meta: {
        ...currentMeta,
        needs_reconnect: true,
        needs_reconnect_at: now,
        needs_reconnect_channel: params.channel,
        needs_reconnect_reason: "provider_authentication_failed",
        needs_reconnect_stage: params.stage || null,
      },
    })
    .eq("id", data.id)
    .eq("user_id", params.userId);

  return !updateError;
}

function sanitizeDiagnostics(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") {
    const redacted = value
      .replace(/([?&](?:access_token|token|refresh_token|signature|sig)=)[^&\s]+/gi, "$1[redacted]")
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]");
    return redacted.length > 1500 ? `${redacted.slice(0, 1500)}…` : redacted;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => sanitizeDiagnostics(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/(token|secret|password|cookie|authorization|access_token|refresh_token)/i.test(key)) continue;
    out[key] = sanitizeDiagnostics(child, depth + 1);
  }
  return out;
}

export function getPublishChannelUserMessage(
  channel: PublishDiagnosticChannel,
  error: unknown,
  fallback?: string,
): string {
  const raw = stringifyError(error).trim();
  const label = CHANNEL_LABELS[channel] || channel;
  const fallbackMessage = fallback || CHANNEL_FALLBACKS[channel] || "La publication n'a pas pu aboutir.";
  // The route has already resolved the active account. A missing application
  // session here is an internal execution-context problem, not proof that the
  // provider connection has expired.
  if (isApplicationSessionAuthenticationError(raw)) return fallbackMessage;

  const providerMessage = getProviderPublicationErrorMessage(channel, raw);
  const message = providerMessage || getSimpleFrenchErrorMessage(`${label} ${raw}`, fallbackMessage);

  // Si l'erreur brute indique clairement une connexion/tokens invalides mais que le mapper
  // global est passé à côté, on garde un message court et actionnable.
  const lower = raw.toLowerCase();
  if (
    channel === "pinterest" &&
    (lower.includes("pin_edit") ||
      (lower.includes("restricted feature") && lower.includes("edit")))
  ) {
    return "Pinterest n’autorise pas encore la modification directe de cette épingle pour l’accès actuel.";
  }
  const reconnectMessage = CHANNEL_RECONNECTS[channel];
  if (
    reconnectMessage
    && /(authorization|autorisation|authorisation|unauthorized|unauthorised|not authorized|permission|scope|access token|oauth|token expired|expired token|invalid_grant|refresh token|session has expired|\(#?(10|190|200)\)|\b401\b)/i.test(lower)
  ) {
    return reconnectMessage;
  }

  return ensureFrenchPublicationErrorMessage(message, fallbackMessage);
}

export function logPublishChannelFailure(params: {
  route: string;
  channel: PublishDiagnosticChannel;
  userId?: string | null;
  publicationId?: string | null;
  error: unknown;
  userMessage?: string | null;
  diagnostics?: unknown;
  stage?: string;
}) {
  const rawError = stringifyError(params.error).slice(0, 1000);
  log.warn("channel_publish_failed", {
    route: params.route,
    channel: params.channel,
    user_id: params.userId || undefined,
    publication_id: params.publicationId || undefined,
    stage: params.stage || undefined,
    error: rawError,
    user_message: params.userMessage || undefined,
    diagnostics: params.diagnostics ? sanitizeDiagnostics(params.diagnostics) : undefined,
  });
}
