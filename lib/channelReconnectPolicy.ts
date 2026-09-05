export const OAUTH_PUBLICATION_CHANNELS = [
  "gmb",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube_shorts",
  "pinterest",
] as const;

export type OAuthPublicationChannel =
  (typeof OAUTH_PUBLICATION_CHANNELS)[number];

const OAUTH_CHANNEL_SET = new Set<string>(OAUTH_PUBLICATION_CHANNELS);

const CHANNEL_ALIASES: Record<OAuthPublicationChannel, string[]> = {
  gmb: ["google business", "business profile", "mybusiness", "gmb"],
  facebook: ["facebook", "meta graph", "page access"],
  instagram: ["instagram", "ig user", "ig_user"],
  linkedin: ["linkedin", "restli", "urn li"],
  tiktok: ["tiktok"],
  youtube_shorts: ["youtube", "youtube shorts"],
  pinterest: ["pinterest"],
};

const STRONG_APPLICATION_SESSION_RE =
  /(?:\bauth[_\s-]*session[_\s-]*missing\b|\bmissing[_\s-]*auth[_\s-]*session\b|\bjwt\s+(?:has\s+)?expired\b|\binvalid\s+jwt\b|\bsupabase\b.{0,80}\b(?:auth|session)\b|\b(?:browser|application|inrcy)\s+session\b.{0,80}\b(?:missing|expired|invalid)\b)/i;
const GENERIC_APPLICATION_SESSION_RE =
  /^(?:non\s+authentifiee?|not\s+authenticated|authentication\s+required|unauthenticated)[.!\s]*$/i;
const APPLICATION_SESSION_USER_MESSAGE_RE =
  /(?:\bvotre\s+session\s+a\s+expire\b|\byour\s+session\s+(?:has\s+)?expired\b)/i;

const PROVIDER_TOKEN_FAILURE_RE =
  /(?:\binvalid[_\s-]*grant\b|\binvalid[_\s-]*token\b|\baccess[_\s-]*token[_\s-]*(?:invalid|expired|revoked|unavailable)\b|\b(?:invalid|expired|revoked|missing)\s+(?:oauth\s+)?access\s+token\b|\baccess\s+token\b.{0,80}\b(?:invalid|expired|revoked|missing)\b|\btoken\s+(?:has\s+been\s+|is\s+)?(?:expired|revoked|invalid)\b|\brefresh\s+token\b.{0,80}\b(?:expired|revoked|invalid|missing)\b|\b(?:expired|revoked|invalid)\b.{0,40}\brefresh\s+token\b|\bmissing[_\s-]*(?:or[_\s-]*expired[_\s-]*)?(?:access[_\s-]*)?token\b|\baccess[_\s-]*token[_\s-]*unavailable\b|\btoken[_\s-]*expired\b|\bscope[_\s-]*not[_\s-]*authori[sz]ed\b|\binsufficient\s+authentication\s+scopes?\b|\binvalid\s+authentication\s+credentials?\b|\boauth\b.{0,80}\b(?:invalid|expired|revoked)\b|\b(?:code|error)[\s"':=]*(?:190)\b|\(#?190\))/i;
const PROVIDER_PERMISSION_FAILURE_RE =
  /(?:\bnot\s+authori[sz]ed\b|\bunauthori[sz]ed\b|\bauthori[sz]ation\s+(?:failed|denied|required)\b|\baccess\s+denied\b|\binsufficient\s+(?:permission|scope)s?\b|\bpermission\s+denied\b|\bcaller\s+does\s+not\s+have\s+permission\b)/i;
const PROVIDER_SESSION_FAILURE_RE =
  /(?:\bsession\s+has\s+expired\b|\bauthentication[_\s-]*failed\b)/i;
const STATUS_401_RE =
  /(?:\bhttp\s*401\b|\bstatus[\s"':=]*401\b|\bcode[\s"':=]*401\b|\b401\s+(?:unauthori[sz]ed|authentication|required)\b)/i;
const NON_AUTHENTICATION_RESOURCE_RE =
  /(?:\bimage\s+url\b|\bmedia\s+(?:url|probe|fetch|download)\b|\bsigned\s+url\b|\bstorage\s+(?:url|download)\b|\bsource\s+url\b.{0,40}\b(?:unreachable|forbidden|private)\b)/i;
const EXPLICIT_RECONNECT_ACTION_RE =
  /(?:\b(?:a|à)\s+reconnecter\b|\breconnexion\s+requise\b|\bneeds?\s+to\s+be\s+reconnected\b|\breconnect\s+required\b)/i;

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function stringifyReconnectError(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  if (input instanceof Error) {
    const record = input as Error & Record<string, unknown>;
    return [record.message, record.code, record.status, record.statusCode]
      .filter((value) => value != null && String(value).trim())
      .map(String)
      .join(" ");
  }
  try {
    return JSON.stringify(input);
  } catch {
    return String(input || "");
  }
}

function normalize(value: unknown) {
  return stripDiacritics(String(value || ""))
    .toLowerCase()
    .replace(/[_:./\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasChannelProviderContext(
  channel: OAuthPublicationChannel,
  normalizedRaw: string,
) {
  return CHANNEL_ALIASES[channel].some((alias) =>
    normalizedRaw.includes(normalize(alias)),
  );
}

export function isApplicationSessionAuthenticationError(input: unknown) {
  const raw = normalize(stringifyReconnectError(input));
  if (!raw) return false;
  return (
    STRONG_APPLICATION_SESSION_RE.test(raw) ||
    GENERIC_APPLICATION_SESSION_RE.test(raw)
  );
}

export function isApplicationSessionUserMessage(input: unknown) {
  return APPLICATION_SESSION_USER_MESSAGE_RE.test(normalize(input));
}

export function isProviderAuthenticationFailure(params: {
  channel: OAuthPublicationChannel;
  error: unknown;
  stage?: string | null;
}) {
  const raw = stringifyReconnectError(params.error);
  const normalizedRaw = normalize(raw);
  if (!normalizedRaw) return false;
  if (isApplicationSessionAuthenticationError(raw)) return false;

  if (PROVIDER_TOKEN_FAILURE_RE.test(normalizedRaw)) return true;

  const providerContext = hasChannelProviderContext(
    params.channel,
    normalizedRaw,
  );
  const stage = normalize(params.stage);
  const providerStage = [
    "token",
    "precheck",
    "publish",
    "initialize",
    "finalize",
    "upload",
    "poll",
  ].includes(stage) || stage.includes("provider metrics");
  if (
    PROVIDER_SESSION_FAILURE_RE.test(normalizedRaw) &&
    (providerContext || providerStage)
  ) {
    return true;
  }
  if (
    PROVIDER_PERMISSION_FAILURE_RE.test(normalizedRaw) &&
    (
      providerContext ||
      providerStage ||
      /\b(?:token|oauth|scope|credential)s?\b/i.test(normalizedRaw)
    )
  ) {
    return true;
  }

  if (!STATUS_401_RE.test(normalizedRaw)) return false;
  if (NON_AUTHENTICATION_RESOURCE_RE.test(normalizedRaw)) return false;

  return providerContext || providerStage;
}

function isExplicitReconnectMessageForChannel(
  channel: OAuthPublicationChannel,
  userMessage: unknown,
) {
  const normalizedMessage = normalize(userMessage);
  if (!EXPLICIT_RECONNECT_ACTION_RE.test(normalizedMessage)) return false;
  return CHANNEL_ALIASES[channel].some((alias) =>
    normalizedMessage.includes(normalize(alias)),
  );
}

export function isProviderReconnectRequired(params: {
  channel: string;
  error: unknown;
  userMessage?: string | null;
  stage?: string | null;
}) {
  if (!OAUTH_CHANNEL_SET.has(params.channel)) return false;
  const channel = params.channel as OAuthPublicationChannel;
  const raw = stringifyReconnectError(params.error).trim();

  if (isApplicationSessionAuthenticationError(raw)) return false;
  if (
    !raw &&
    isApplicationSessionUserMessage(params.userMessage)
  ) {
    return false;
  }
  if (
    isProviderAuthenticationFailure({
      channel,
      error: params.error,
      stage: params.stage,
    })
  ) {
    return true;
  }

  // The persisted marker is driven by the raw provider signal. The public
  // message is accepted only when no raw error exists, so a broad or imperfect
  // translation can never poison an otherwise healthy OAuth connection.
  return (
    !raw &&
    isExplicitReconnectMessageForChannel(channel, params.userMessage)
  );
}
