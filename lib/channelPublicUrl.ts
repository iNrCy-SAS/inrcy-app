export const EDITABLE_CHANNEL_PUBLIC_URL_CHANNELS = [
  "site_inrcy",
  "site_web",
  "gmb",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube_shorts",
  "pinterest",
  "x",
] as const;

export type EditableChannelPublicUrlChannel =
  (typeof EDITABLE_CHANNEL_PUBLIC_URL_CHANNELS)[number];

export type LinkedinPublicUrlTarget = "profile" | "organization";

export type ChannelPublicUrlErrorCode =
  | "required"
  | "invalid_url"
  | "invalid_protocol"
  | "credentials_not_allowed"
  | "wrong_host";

export type NormalizedChannelPublicUrl =
  | { ok: true; url: string; comparisonKey: string }
  | { ok: false; code: ChannelPublicUrlErrorCode };

function stripWww(hostname: string) {
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function isHostOrSubdomain(hostname: string, domain: string) {
  const host = stripWww(hostname);
  const expected = stripWww(domain);
  return host === expected || host.endsWith(`.${expected}`);
}

function decodedPathSegments(pathname: string) {
  try {
    return decodeURIComponent(pathname)
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.toLowerCase());
  } catch {
    return null;
  }
}

function isGoogleMapsDestination(parsed: URL) {
  const { hostname, pathname, searchParams } = parsed;
  const host = stripWww(hostname);
  const segments = decodedPathSegments(pathname);
  if (!segments) return false;
  if (host === "g.page" || host === "maps.app.goo.gl") return segments.length > 0;
  if (host === "goo.gl") return segments[0] === "maps" && segments.length > 1;

  const labels = host.split(".");
  const googleIndex = labels.lastIndexOf("google");
  if (googleIndex < 0 || googleIndex > 1) return false;
  const prefix = labels.slice(0, googleIndex);
  if (prefix.length > 0 && prefix[0] !== "maps") return false;
  const suffix = labels.slice(googleIndex + 1);
  const looksLikeGoogleCountryDomain =
    suffix.length === 1
      ? /^(?:[a-z]{2}|com|cat)$/i.test(suffix[0] || "")
      : suffix.length === 2
        ? /^(?:com|co)$/i.test(suffix[0] || "") && /^[a-z]{2}$/i.test(suffix[1] || "")
        : false;
  if (!looksLikeGoogleCountryDomain) return false;

  const hasPlaceQuery = ["cid", "q", "query", "place_id", "destination"]
    .some((key) => Boolean(searchParams.get(key)?.trim()));
  if (prefix[0] === "maps") return segments.length > 0 || hasPlaceQuery;
  return segments[0] === "maps" && (segments.length > 1 || hasPlaceQuery);
}

function isPinterestHost(hostname: string) {
  const host = stripWww(hostname);
  if (isHostOrSubdomain(host, "pinterest.com")) return true;
  const labels = host.split(".");
  if (labels[0] !== "pinterest") return false;
  const suffix = labels.slice(1);
  return suffix.length === 1
    ? /^(?:[a-z]{2}|com)$/i.test(suffix[0] || "")
    : suffix.length === 2
      ? /^(?:com|co)$/i.test(suffix[0] || "") && /^[a-z]{2}$/i.test(suffix[1] || "")
      : false;
}

const FACEBOOK_NON_PROFILE_PATHS = new Set([
  "about", "ads", "business", "events", "gaming", "groups", "help", "login",
  "marketplace", "messages", "photo", "photos", "reel", "reels", "settings",
  "share", "sharer", "stories", "videos", "watch",
]);

const INSTAGRAM_NON_PROFILE_PATHS = new Set([
  "about", "accounts", "developer", "direct", "explore", "p", "reel", "reels",
  "stories", "web",
]);

const PINTEREST_NON_PROFILE_PATHS = new Set([
  "business", "ideas", "login", "pin", "search", "settings", "today",
]);

const X_NON_PROFILE_PATHS = new Set([
  "compose", "explore", "hashtag", "home", "i", "intent", "login", "messages",
  "search", "settings", "share", "signup",
]);

const YOUTUBE_NON_CHANNEL_PATHS = new Set([
  "account", "embed", "feed", "gaming", "kids", "live", "movies", "music",
  "oembed", "playlist", "premium", "redirect", "results", "shorts", "signin",
  "upload", "watch",
]);

const YOUTUBE_CHANNEL_TABS = new Set([
  "about", "channels", "community", "featured", "playlists", "shorts", "streams", "videos",
]);

function hasExpectedNetworkDestination(
  channel: EditableChannelPublicUrlChannel,
  parsed: URL,
  target?: LinkedinPublicUrlTarget,
) {
  const { hostname } = parsed;
  const segments = decodedPathSegments(parsed.pathname);
  if (!segments) return false;

  // Public social destinations do not run on custom ports. Rejecting them also
  // avoids accepting an unrelated service merely because it shares a hostname.
  if (channel !== "site_inrcy" && channel !== "site_web" && parsed.port) return false;

  switch (channel) {
    case "gmb":
      return isGoogleMapsDestination(parsed);
    case "facebook": {
      if (!["facebook.com", "fb.com", "fb.me"].some((domain) => isHostOrSubdomain(hostname, domain))) {
        return false;
      }
      if (segments[0] === "profile.php") return segments.length === 1 && Boolean(parsed.searchParams.get("id"));
      if (segments[0] === "pages" || segments[0] === "people") return segments.length >= 3;
      return segments.length === 1 && !FACEBOOK_NON_PROFILE_PATHS.has(segments[0] || "");
    }
    case "instagram":
      return isHostOrSubdomain(hostname, "instagram.com") &&
        segments.length === 1 && !INSTAGRAM_NON_PROFILE_PATHS.has(segments[0] || "");
    case "linkedin": {
      if (!isHostOrSubdomain(hostname, "linkedin.com") || segments.length < 2) return false;
      const kind = segments[0] || "";
      const isProfile = (kind === "in" && segments.length === 2) || (kind === "pub" && segments.length >= 2);
      const isOrganization = ["company", "school", "showcase"].includes(kind) && segments.length === 2;
      if (target === "profile") return isProfile;
      if (target === "organization") return isOrganization;
      return isProfile || isOrganization;
    }
    case "tiktok":
      return isHostOrSubdomain(hostname, "tiktok.com") &&
        segments.length === 1 && (segments[0] || "").startsWith("@") && (segments[0] || "").length > 1;
    case "youtube_shorts": {
      if (!isHostOrSubdomain(hostname, "youtube.com")) return false;
      if (segments.length === 1) {
        const segment = segments[0] || "";
        return (segment.startsWith("@") && segment.length > 1) ||
          (Boolean(segment) && !YOUTUBE_NON_CHANNEL_PATHS.has(segment));
      }
      if ((segments[0] || "").startsWith("@")) {
        return segments.length === 2 && YOUTUBE_CHANNEL_TABS.has(segments[1] || "");
      }
      return ["c", "channel", "user"].includes(segments[0] || "") &&
        Boolean(segments[1]) &&
        (segments.length === 2 || (segments.length === 3 && YOUTUBE_CHANNEL_TABS.has(segments[2] || "")));
    }
    case "pinterest":
      return isPinterestHost(hostname) &&
        segments.length === 1 && !PINTEREST_NON_PROFILE_PATHS.has(segments[0] || "");
    case "x":
      return (isHostOrSubdomain(hostname, "x.com") || isHostOrSubdomain(hostname, "twitter.com")) &&
        segments.length === 1 && !X_NON_PROFILE_PATHS.has(segments[0] || "");
    case "site_inrcy":
    case "site_web":
      return true;
  }
}

function parseIpv4(hostname: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const octets = hostname.split(".").map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function isNonPublicIpv4(octets: number[]) {
  const [a, b] = octets;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && octets[2] === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && octets[2] === 2) ||
    (a === 192 && b === 88 && octets[2] === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a >= 224;
}

function parseIpv6(hostname: string) {
  let value = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!value.includes(":")) return null;

  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const ipv4 = parseIpv4(value.slice(lastColon + 1));
    if (!ipv4) return null;
    value = `${value.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (![...left, ...right].every((word) => /^[0-9a-f]{1,4}$/.test(word))) return null;

  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  return [
    ...left.map((word) => Number.parseInt(word, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map((word) => Number.parseInt(word, 16)),
  ];
}

function isNonPublicIpv6(words: number[]) {
  const isUnspecified = words.every((word) => word === 0);
  const isLoopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  const first = words[0] || 0;
  const isIpv4Mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (isIpv4Mapped) {
    const mapped = [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff];
    return isNonPublicIpv4(mapped);
  }

  return isUnspecified ||
    isLoopback ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && words[1] === 0x0db8);
}

function isPublicHostname(input: string) {
  const hostname = input.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
  const ipv4 = parseIpv4(hostname);
  if (ipv4) return !isNonPublicIpv4(ipv4);
  const ipv6 = parseIpv6(hostname);
  if (ipv6) return !isNonPublicIpv6(ipv6);

  if (!hostname.includes(".") || hostname.length > 253) return false;
  if (["localhost", "local", "internal", "lan", "home", "home.arpa", "localdomain", "test", "invalid", "corp"]
    .some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) {
    return false;
  }

  return hostname.split(".").every((label) =>
    Boolean(label) && label.length <= 63 && /^[a-z0-9-]+$/.test(label) && !label.startsWith("-") && !label.endsWith("-"),
  );
}

export function isEditableChannelPublicUrlChannel(
  value: unknown,
): value is EditableChannelPublicUrlChannel {
  return EDITABLE_CHANNEL_PUBLIC_URL_CHANNELS.includes(
    value as EditableChannelPublicUrlChannel,
  );
}

export function normalizeChannelPublicUrl(
  channel: EditableChannelPublicUrlChannel,
  input: unknown,
  target?: LinkedinPublicUrlTarget,
): NormalizedChannelPublicUrl {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { ok: false, code: "required" };

  const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*):/i);
  const looksLikeHostnameWithPort = Boolean(schemeMatch?.[1]?.includes(".")) && /^\d/.test(raw.slice(schemeMatch?.[0].length || 0));
  if (schemeMatch && !looksLikeHostnameWithPort && !/^https?$/i.test(schemeMatch[1] || "")) {
    return { ok: false, code: "invalid_protocol" };
  }

  const candidate = raw.startsWith("//")
    ? `https:${raw}`
    : /^https?:/i.test(raw)
      ? raw
      : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, code: "invalid_url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, code: "invalid_protocol" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, code: "credentials_not_allowed" };
  }
  if (!isPublicHostname(parsed.hostname)) {
    return { ok: false, code: "invalid_url" };
  }
  if (!hasExpectedNetworkDestination(channel, parsed, target)) {
    return { ok: false, code: "wrong_host" };
  }

  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
    parsed.port = "";
  }
  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/");
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.searchParams.sort();

  const url = parsed.toString();
  return { ok: true, url, comparisonKey: url };
}

export function channelPublicUrlsMatch(
  channel: EditableChannelPublicUrlChannel,
  left: unknown,
  right: unknown,
) {
  const a = normalizeChannelPublicUrl(channel, left);
  const b = normalizeChannelPublicUrl(channel, right);
  return a.ok && b.ok && a.comparisonKey === b.comparisonKey;
}
