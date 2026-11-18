export type MetaGraphErrorDescriptor = {
  message?: unknown;
  type?: unknown;
  code?: unknown;
  subcode?: unknown;
  httpStatus?: unknown;
};

export type MetaPublicationRestriction = {
  channel: "facebook" | "instagram";
  code: "facebook_identity_confirmation_required" | "instagram_account_restricted";
  retryable: false;
};

/** Classify provider action requirements without returning provider text or data. */
export function classifyMetaPublicationRestriction(value: unknown, channelHint?: string): MetaPublicationRestriction | null {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  // A successful fallback may retain failed attempt diagnostics. It remains a success.
  if (root.ok === true) return null;
  const hint = String(channelHint || root.channel || "").split(":")[0].toLowerCase();
  const result = (channel: "facebook" | "instagram"): MetaPublicationRestriction => ({
    channel, code: channel === "facebook" ? "facebook_identity_confirmation_required" : "instagram_account_restricted", retryable: false,
  });
  const queue: Array<{ value: unknown; depth: number; channel: string }> = [{ value, depth: 0, channel: hint }];
  const seen = new Set<object>();
  const keys = ["error", "message", "raw_error", "diagnostics", "createResponse", "publishResponse", "statusResponse", "statusChecks", "childStatusChecks", "checks", "raw", "response", "data", "details", "cause", "providerError", "provider_error", "error_user_msg", "error_user_title", "childCreateResponses", "childFailures", "placements", "classic", "reel", "story", "result"];
  for (let index = 0; index < queue.length && index < 80; index += 1) {
    const candidate = queue[index];
    if (candidate.depth > 8) continue;
    const allowed = (channel: "facebook" | "instagram") => !candidate.channel || candidate.channel === channel;
    if (typeof candidate.value === "string") {
      const text = candidate.value.slice(0, 12_000).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
      if (allowed("facebook") && (text === "facebook_identity_confirmation_required" ||
        /confirmez (?:votre |l[’']?)?identit[ée].{0,100}(?:publier|publication).{0,80}page/.test(text) ||
        /confirm (?:your )?identity.{0,100}(?:publish|post).{0,80}page/.test(text))) return result("facebook");
      if (allowed("instagram") && text === "instagram_account_restricted") return result("instagram");
      if (candidate.channel === "instagram" && /^(?:user access is restricted|the instagram account is restricted|user is restricted)[.!]?$/.test(text)) return result("instagram");
      const trimmed = candidate.value.trim();
      if (trimmed.length <= 12_000 && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
        try { queue.push({ value: JSON.parse(trimmed), depth: candidate.depth + 1, channel: candidate.channel }); } catch { /* Provider text is not necessarily JSON. */ }
      }
      continue;
    }
    if (!candidate.value || typeof candidate.value !== "object" || seen.has(candidate.value)) continue;
    seen.add(candidate.value);
    if (Array.isArray(candidate.value)) {
      for (const item of candidate.value.slice(0, 10)) queue.push({ value: item, depth: candidate.depth + 1, channel: candidate.channel });
      continue;
    }
    const record = candidate.value as Record<string, unknown>;
    if (record.ok === true) continue;
    const owner = String(record.channel || candidate.channel).split(":")[0].toLowerCase();
    if (candidate.channel && owner && candidate.channel !== owner) continue;
    if ((!owner || owner === "instagram") && finiteNumber(record.code ?? record.metaCode) === 25 &&
      finiteNumber(record.error_subcode ?? record.subcode ?? record.metaSubcode) === 2207050) return result("instagram");
    if (record.code === "facebook_identity_confirmation_required" && (!owner || owner === "facebook")) return result("facebook");
    if (record.code === "instagram_account_restricted" && (!owner || owner === "instagram")) return result("instagram");
    for (const key of keys) if (Object.prototype.hasOwnProperty.call(record, key)) queue.push({ value: record[key], depth: candidate.depth + 1, channel: owner });
  }
  return null;
}

/** Keep each placement's restriction local to that attempt, never an account flag. */
export function normalizeMetaPublicationRestrictionResult(value: unknown, channel?: string): Record<string, unknown> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const placements = record.placements && typeof record.placements === "object" && !Array.isArray(record.placements)
    ? record.placements as Record<string, unknown> : null;
  if (placements) return { ...record, placements: Object.fromEntries(Object.entries(placements)
    .map(([placement, result]) => [placement, normalizeMetaPublicationRestrictionResult(result, channel || String(record.channel || ""))])) };
  const restriction = classifyMetaPublicationRestriction(record, channel);
  return restriction ? { ...record, ok: false, status: "failed", code: restriction.code, retryable: false,
    pending: false, processing: false, ...(record.warning_kind === "pending" ? { warning_kind: null } : {}) } : record;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizedText(error: MetaGraphErrorDescriptor): string {
  return [error.message, error.type]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Meta uses OAuthException for several non-authentication failures too.
 * In particular, code 4 / subcode 2207051 is an application/activity limit:
 * reconnecting the account cannot fix it and must never be suggested.
 */
export function isMetaRateLimitError(
  error: MetaGraphErrorDescriptor,
): boolean {
  const code = finiteNumber(error.code);
  const subcode = finiteNumber(error.subcode);
  const httpStatus = finiteNumber(error.httpStatus);
  const text = normalizedText(error);

  return (
    httpStatus === 429 ||
    [4, 17, 32, 613].includes(code || 0) ||
    subcode === 2207051 ||
    /application request limit|user request limit|rate[ -]?limit|too many requests|quota/.test(
      text,
    )
  );
}

export function isMetaAuthorizationError(
  error: MetaGraphErrorDescriptor,
): boolean {
  if (isMetaRateLimitError(error)) return false;

  const code = finiteNumber(error.code);
  const httpStatus = finiteNumber(error.httpStatus);
  const text = normalizedText(error);

  return (
    httpStatus === 401 ||
    [10, 190, 200].includes(code || 0) ||
    /access token|not authori[sz]ed|authori[sz]ation|permission|session.*expired|token.*expired|invalid.*token/.test(
      text,
    )
  );
}
