import "server-only";

import { lookup } from "node:dns/promises";
import net from "node:net";

import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { getGmbToken } from "@/lib/googleBusiness";
import { getGmbReviewTargetFromRow, gmbListReviews } from "@/lib/googleBusinessReviews";
import { getLinkedInAccessToken } from "@/lib/linkedinOAuth";
import { buildMetaGraphUrl } from "@/lib/metaGraphApi";
import {
  extractFacebookUserTokens,
  listAccessibleFacebookPagesFromTokens,
} from "@/lib/metaBusinessAssets";
import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import {
  fetchPinterestUserAccount,
  getPinterestAccessToken,
  pinterestApiGet,
} from "@/lib/pinterestOAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchTiktokUserInfo, refreshTiktokAccessToken } from "@/lib/tiktokOAuth";
import { asRecord, asString } from "@/lib/tsSafe";
import type { BusinessDnaBudgetSource } from "@/lib/businessDnaSourceBudget";
import {
  areAllBusinessDnaRequestsRejected,
  canCollectBusinessDnaSource,
  findBusinessDnaReconnectRejectedReason,
  isBusinessDnaReconnectError,
  pickBusinessDnaRejectedReason,
  shouldBusinessDnaSourceReconnect,
} from "@/lib/businessDnaChannelAnalysisErrors";
import {
  fetchYoutubeMineChannel,
  getYoutubeShortsOAuthClientId,
  getYoutubeShortsOAuthClientSecret,
  refreshYoutubeShortsAccessToken,
} from "@/lib/youtubeShortsOAuth";
import {
  BUSINESS_DNA_MAX_WEBSITE_PAGES,
  BUSINESS_DNA_MAX_WEBSITE_SOURCE_CHARS,
  buildBalancedBusinessDnaWebsiteContent,
} from "@/lib/businessDnaWebsiteBudget";

type JsonRecord = Record<string, unknown>;

type IntegrationRow = {
  id?: string | null;
  provider?: string | null;
  source?: string | null;
  product?: string | null;
  status?: string | null;
  resource_id?: string | null;
  resource_label?: string | null;
  display_name?: string | null;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
  expires_at?: string | null;
  meta?: unknown;
  updated_at?: string | null;
  created_at?: string | null;
};

export type BusinessDnaSourceStatus =
  | "analyzed"
  | "not_connected"
  | "needs_reconnect"
  | "failed";

export type BusinessDnaSourceResult = BusinessDnaBudgetSource & {
  key: string;
  label: string;
  status: BusinessDnaSourceStatus;
  url: string | null;
  itemCount: number;
  contentChars: number;
  message: string | null;
  /** Données compactes envoyées à l'IA. Cette propriété ne doit jamais revenir au navigateur. */
  content: string;
};

export type BusinessDnaSourcePublicResult = Omit<BusinessDnaSourceResult, "content">;

const MAX_HTTP_BODY_BYTES = 1_000_000;
const MAX_SOURCE_CHARS = BUSINESS_DNA_MAX_WEBSITE_SOURCE_CHARS;
const API_TIMEOUT_MS = 14_000;
const MAX_SOURCE_COLLECTION_MS = 30_000;

function clampText(value: unknown, maxLength = MAX_SOURCE_CHARS) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function isExpired(value: unknown, skewSeconds = 90) {
  const expiresAt = asString(value);
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= Date.now() + skewSeconds * 1_000;
}

function latestIntegration(
  rows: IntegrationRow[],
  provider: string,
  source: string,
  product: string,
) {
  return rows
    .filter((row) => row.provider === provider && row.source === source && row.product === product)
    .sort((left, right) => {
      const leftTime = Date.parse(String(left.updated_at || left.created_at || 0)) || 0;
      const rightTime = Date.parse(String(right.updated_at || right.created_at || 0)) || 0;
      return rightTime - leftTime;
    })[0] || null;
}

function normalizeExternalFailure(error: unknown) {
  const message = String(error instanceof Error ? error.message : error || "").toLowerCase();
  if (/401|403|unauthorized|forbidden|access token|oauth|permission|scope|expired|invalid_grant/.test(message)) {
    return "L’autorisation de ce canal doit être actualisée.";
  }
  if (/timeout|timed out|abort|econn|enotfound|network|fetch failed/.test(message)) {
    return "Ce canal ne répond pas pour le moment.";
  }
  return "Certaines informations de ce canal n’ont pas pu être lues.";
}

function publicResult(source: BusinessDnaSourceResult): BusinessDnaSourcePublicResult {
  const { content: _content, ...visible } = source;
  return visible;
}

export function getPublicBusinessDnaSourceResults(sources: BusinessDnaSourceResult[]) {
  return sources.map(publicResult);
}

function isPrivateOrReservedIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateOrReservedIp(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const version = net.isIP(normalized);
  if (version === 4) return isPrivateOrReservedIpv4(normalized);
  if (version !== 6) return true;
  if (normalized === "::" || normalized === "::1") return true;
  if (/^(?:fc|fd|fe8|fe9|fea|feb)/.test(normalized)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1];
  return mapped ? isPrivateOrReservedIpv4(mapped) : false;
}

async function assertPublicWebsiteUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Adresse de site invalide.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Adresse de site non autorisée.");
  }
  if (url.username || url.password) throw new Error("Adresse de site non autorisée.");
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new Error("Port de site non autorisé.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".invalid")
  ) {
    throw new Error("Adresse de site non autorisée.");
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) throw new Error("Adresse de site non autorisée.");
  } else {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateOrReservedIp(address))) {
      throw new Error("Adresse de site non autorisée.");
    }
  }
  url.hash = "";
  return url;
}

async function readLimitedResponseBody(response: Response, maxBytes = MAX_HTTP_BODY_BYTES) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("Réponse distante trop volumineuse.");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Réponse distante trop volumineuse.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

async function fetchPublicWebsitePage(input: URL) {
  let current = input;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    current = await assertPublicWebsiteUrl(current.toString());
    const response = await fetch(current.toString(), {
      redirect: "manual",
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7",
        "User-Agent": "iNrCy-Business-DNA/1.0 (+https://inrcy.com)",
      },
      signal: AbortSignal.timeout(9_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === 3) throw new Error("Redirection de site invalide.");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`Site HTTP ${response.status}`);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new Error("Le site n’a pas renvoyé une page lisible.");
    }
    return { url: current, html: await readLimitedResponseBody(response) };
  }
  throw new Error("Le site n’a pas pu être lu.");
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    quot: "\"",
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    rsquo: "’",
    laquo: "«",
    raquo: "»",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(point) && point > 0 ? String.fromCodePoint(point) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function extractMetaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html)?.[1];
    if (match) return decodeHtmlEntities(match);
  }
  return "";
}

function websitePageToText(html: string) {
  const title = decodeHtmlEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "")
    .replace(/<[^>]+>/g, " ");
  const description = extractMetaContent(html, "description") || extractMetaContent(html, "og:description");
  const jsonLd = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
    .map((match) => clampText(match[1], 4_000))
    .filter(Boolean)
    .slice(0, 4)
    .join("\n");
  const body = decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|p|div|section|article|main|header|footer|h[1-6]|li|tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
  return clampText([title, description, jsonLd, body].filter(Boolean).join("\n"), 14_000);
}

function discoverUsefulWebsiteLinks(html: string, pageUrl: URL) {
  const keywords = /(a-propos|about|qui-sommes|entreprise|services?|prestations?|expertise|solutions?|offres?|contact|tarifs?|realisations?|portfolio)/i;
  const candidates = new Map<string, number>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>/gi)) {
    try {
      const candidate = new URL(decodeHtmlEntities(match[1]), pageUrl);
      if (candidate.origin !== pageUrl.origin || !/^https?:$/.test(candidate.protocol)) continue;
      candidate.hash = "";
      candidate.search = "";
      if (candidate.pathname === pageUrl.pathname || !keywords.test(candidate.pathname)) continue;
      const score = /services?|prestations?|offres?|expertise|solutions?/i.test(candidate.pathname) ? 2 : 1;
      candidates.set(candidate.toString(), Math.max(score, candidates.get(candidate.toString()) || 0));
    } catch {}
  }
  return [...candidates.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].length - right[0].length)
    .slice(0, BUSINESS_DNA_MAX_WEBSITE_PAGES - 1)
    .map(([url]) => url);
}

async function collectWebsite(url: string) {
  const rootUrl = await assertPublicWebsiteUrl(url);
  const root = await fetchPublicWebsitePage(rootUrl);
  const documents = [{ url: root.url.toString(), text: websitePageToText(root.html) }];
  const usefulLinks = discoverUsefulWebsiteLinks(root.html, root.url);
  const additional = await Promise.allSettled(
    usefulLinks.map(async (link) => {
      const page = await fetchPublicWebsitePage(new URL(link));
      return { url: page.url.toString(), text: websitePageToText(page.html) };
    }),
  );
  for (const result of additional) {
    if (result.status === "fulfilled" && result.value.text) documents.push(result.value);
  }
  const content = buildBalancedBusinessDnaWebsiteContent(
    documents,
    BUSINESS_DNA_MAX_WEBSITE_SOURCE_CHARS,
  );
  if (!content) throw new Error("Le site ne contient aucun texte exploitable.");
  return { content, itemCount: documents.length, finalUrl: root.url.toString() };
}

async function fetchJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const raw = await readLimitedResponseBody(response, 2_000_000);
  let payload: unknown = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const record = asRecord(payload);
    const error = asRecord(record.error);
    const providerMessage = asString(error.message) || asString(record.message);
    throw new Error(providerMessage ? `HTTP ${response.status}: ${providerMessage}` : `HTTP ${response.status}`);
  }
  return payload;
}

function compactJson(value: unknown, maxLength = MAX_SOURCE_CHARS) {
  return clampText(JSON.stringify(value), maxLength);
}

function compactPublicLocation(value: unknown) {
  const location = asRecord(value);
  return {
    addressLines: Array.isArray(location.addressLines)
      ? location.addressLines.map((line) => clampText(line, 180)).filter(Boolean).slice(0, 3)
      : [],
    locality: asString(location.locality),
    administrativeArea: asString(location.administrativeArea),
    postalCode: asString(location.postalCode),
    regionCode: asString(location.regionCode),
  };
}

function compactGoogleBusinessDetails(value: unknown, fallbackTitle: string | null) {
  const details = asRecord(value);
  const categories = asRecord(details.categories);
  const primaryCategory = asRecord(categories.primaryCategory);
  const additionalCategories = Array.isArray(categories.additionalCategories)
    ? categories.additionalCategories
    : [];
  const profile = asRecord(details.profile);
  return {
    title: asString(details.title) || fallbackTitle,
    address: compactPublicLocation(details.storefrontAddress),
    website: asString(details.websiteUri),
    phoneNumbers: details.phoneNumbers,
    primaryCategory: asString(primaryCategory.displayName),
    additionalCategories: additionalCategories
      .map((category) => asString(asRecord(category).displayName))
      .filter(Boolean)
      .slice(0, 12),
    description: clampText(profile.description, 2_000),
    regularHours: details.regularHours,
    specialHours: details.specialHours,
    serviceArea: details.serviceArea,
    serviceItems: Array.isArray(details.serviceItems) ? details.serviceItems.slice(0, 30) : [],
  };
}

async function collectGoogleBusiness(supabase: unknown, userId: string) {
  const token = await getGmbToken({ supabase, userId });
  if (!token?.accessToken) throw new Error("Autorisation Google Business indisponible.");
  const target = getGmbReviewTargetFromRow(token.row);
  if (!target.accountName || !target.locationName) {
    throw new Error("Établissement Google Business non sélectionné.");
  }

  const locationUrl = new URL(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${target.locationName}`,
  );
  locationUrl.searchParams.set(
    "readMask",
    "name,title,storefrontAddress,websiteUri,phoneNumbers,categories,regularHours,specialHours,serviceArea,profile,openInfo,serviceItems",
  );

  const fetchDetails = async () => {
    try {
      return await fetchJson(locationUrl.toString(), {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });
    } catch {
      // Certains comptes Google n'exposent pas encore serviceItems ou les
      // horaires spéciaux. Le socle reste analysable avec un masque plus large.
      locationUrl.searchParams.set(
        "readMask",
        "title,storefrontAddress,websiteUri,phoneNumbers,categories,regularHours,serviceArea,profile",
      );
      return fetchJson(locationUrl.toString(), {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });
    }
  };

  const [detailsResult, reviewsResult, postsResult] = await Promise.allSettled([
    fetchDetails(),
    gmbListReviews(token.accessToken, target.accountName, target.locationName, { pageSize: 30 }),
    fetchJson(
      `https://mybusiness.googleapis.com/v4/${target.accountName}/${target.locationName}/localPosts?pageSize=20`,
      { headers: { Authorization: `Bearer ${token.accessToken}` } },
    ),
  ]);

  const reconnectFailure = findBusinessDnaReconnectRejectedReason(
    detailsResult,
    reviewsResult,
    postsResult,
  );
  if (reconnectFailure) throw reconnectFailure;

  if (areAllBusinessDnaRequestsRejected(detailsResult, reviewsResult, postsResult)) {
    throw pickBusinessDnaRejectedReason(detailsResult, reviewsResult, postsResult);
  }

  const details = compactGoogleBusinessDetails(
    detailsResult.status === "fulfilled" ? detailsResult.value : {},
    target.locationTitle,
  );
  const reviews = reviewsResult.status === "fulfilled"
    ? {
        averageRating: reviewsResult.value.averageRating,
        totalReviewCount: reviewsResult.value.totalReviewCount,
        reviews: reviewsResult.value.reviews
          .filter((review) => review.comment)
          .slice(0, 24)
          .map((review) => ({ rating: review.starRating, comment: review.comment.slice(0, 900) })),
      }
    : null;
  const postsRecord = postsResult.status === "fulfilled" ? asRecord(postsResult.value) : {};
  const localPosts = Array.isArray(postsRecord.localPosts)
    ? postsRecord.localPosts.slice(0, 20).map((post) => {
        const record = asRecord(post);
        return {
          summary: clampText(record.summary, 1_500),
          topicType: asString(record.topicType),
          createTime: asString(record.createTime),
        };
      })
    : [];

  return {
    content: compactJson({ details, reviews, localPosts }),
    itemCount: 1 + (reviews?.reviews.length || 0) + localPosts.length,
  };
}

async function collectFacebook(row: IntegrationRow) {
  const pageId = asString(row.resource_id);
  if (!pageId) throw new Error("Page Facebook non sélectionnée.");
  const decryptedTokens = extractFacebookUserTokens(row.meta, row.access_token_enc)
    .map((token) => tryDecryptToken(token))
    .filter((token): token is string => Boolean(token));
  let accessToken = tryDecryptToken(row.access_token_enc) || "";
  try {
    const pages = await listAccessibleFacebookPagesFromTokens(decryptedTokens);
    const selected = pages.find((page) => page.id === pageId);
    if (selected?.access_token) accessToken = selected.access_token;
  } catch {}
  if (!accessToken) throw new Error("Autorisation Facebook indisponible.");

  const profileQuery = new URLSearchParams({
    fields: "name,about,description,category,website,phone,emails,link,location",
  });
  const postsQuery = new URLSearchParams({
    fields: "message,created_time,permalink_url",
    limit: "15",
  });
  const requestInit = { headers: { Authorization: `Bearer ${accessToken}` } };
  const [profileResult, postsResult] = await Promise.allSettled([
    fetchJson(`${buildMetaGraphUrl(pageId)}?${profileQuery.toString()}`, requestInit),
    fetchJson(`${buildMetaGraphUrl(`${pageId}/posts`)}?${postsQuery.toString()}`, requestInit),
  ]);
  const reconnectFailure = findBusinessDnaReconnectRejectedReason(profileResult, postsResult);
  if (reconnectFailure) throw reconnectFailure;
  if (areAllBusinessDnaRequestsRejected(profileResult, postsResult)) {
    throw pickBusinessDnaRejectedReason(profileResult, postsResult);
  }
  const profile = profileResult.status === "fulfilled" ? asRecord(profileResult.value) : {};
  const postPayload = postsResult.status === "fulfilled" ? asRecord(postsResult.value) : {};
  const posts = Array.isArray(postPayload.data)
    ? postPayload.data.slice(0, 15).map((item) => {
        const post = asRecord(item);
        return {
          message: clampText(post.message, 2_000),
          publishedAt: asString(post.created_time),
          publicUrl: asString(post.permalink_url),
        };
      }).filter((post) => post.message)
    : [];
  const location = asRecord(profile.location);
  const publicProfile = {
    name: asString(profile.name),
    about: clampText(profile.about, 2_000),
    description: clampText(profile.description, 3_000),
    category: asString(profile.category),
    website: asString(profile.website),
    phone: asString(profile.phone),
    emails: Array.isArray(profile.emails) ? profile.emails.slice(0, 4) : [],
    publicUrl: asString(profile.link),
    location: {
      street: asString(location.street),
      city: asString(location.city),
      state: asString(location.state),
      zip: asString(location.zip),
      country: asString(location.country),
    },
  };
  return { content: compactJson({ profile: publicProfile, posts }), itemCount: posts.length + 1 };
}

async function collectInstagram(row: IntegrationRow) {
  const profileId = asString(row.resource_id);
  const accessToken = tryDecryptToken(row.access_token_enc) || "";
  if (!profileId || !accessToken) throw new Error("Compte Instagram incomplet.");
  const profileQuery = new URLSearchParams({
    fields: "username,name,biography,website",
  });
  const mediaQuery = new URLSearchParams({
    fields: "caption,timestamp,permalink,media_type",
    limit: "18",
  });
  const requestInit = { headers: { Authorization: `Bearer ${accessToken}` } };
  const [profileResult, mediaResult] = await Promise.allSettled([
    fetchJson(`${buildMetaGraphUrl(profileId)}?${profileQuery.toString()}`, requestInit),
    fetchJson(`${buildMetaGraphUrl(`${profileId}/media`)}?${mediaQuery.toString()}`, requestInit),
  ]);
  const reconnectFailure = findBusinessDnaReconnectRejectedReason(profileResult, mediaResult);
  if (reconnectFailure) throw reconnectFailure;
  if (areAllBusinessDnaRequestsRejected(profileResult, mediaResult)) {
    throw pickBusinessDnaRejectedReason(profileResult, mediaResult);
  }
  const profile = profileResult.status === "fulfilled" ? asRecord(profileResult.value) : {};
  const mediaPayload = mediaResult.status === "fulfilled" ? asRecord(mediaResult.value) : {};
  const media = Array.isArray(mediaPayload.data)
    ? mediaPayload.data.slice(0, 18).map((item) => {
        const publication = asRecord(item);
        return {
          caption: clampText(publication.caption, 2_000),
          publishedAt: asString(publication.timestamp),
          publicUrl: asString(publication.permalink),
          mediaType: asString(publication.media_type),
        };
      }).filter((publication) => publication.caption)
    : [];
  return {
    content: compactJson({
      profile: {
        username: asString(profile.username),
        name: asString(profile.name),
        biography: clampText(profile.biography, 2_000),
        website: asString(profile.website),
      },
      media,
    }),
    itemCount: 1 + media.length,
  };
}

async function collectLinkedIn(userId: string) {
  const auth = await getLinkedInAccessToken({ userId });
  if (!auth.accessToken || !auth.row) throw new Error(auth.error || "Autorisation LinkedIn indisponible.");
  const row = asRecord(auth.row);
  const meta = asRecord(row.meta);
  const author = auth.orgUrn || auth.authorUrn;
  const context: JsonRecord = {
    name: asString(row.resource_label) || asString(row.display_name),
    profileUrl: asString(meta.profile_url),
    organizationName: asString(meta.org_name),
    organizationUrl: asString(meta.org_url),
  };

  if (author) {
    try {
      const versionCandidate = String(process.env.LINKEDIN_API_VERSION || "202603");
      const linkedinVersion = /^20\d{4}$/.test(versionCandidate) ? versionCandidate : "202603";
      const query = new URLSearchParams({
        q: "author",
        author,
        count: "20",
        sortBy: "LAST_MODIFIED",
      });
      const posts = await fetchJson(`https://api.linkedin.com/rest/posts?${query.toString()}`, {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "X-Restli-Protocol-Version": "2.0.0",
          "LinkedIn-Version": linkedinVersion,
        },
      });
      const elements = asRecord(posts).elements;
      context.posts = Array.isArray(elements)
        ? elements.slice(0, 20).map((item) => {
            const post = asRecord(item);
            return {
              commentary: clampText(post.commentary, 2_000),
              publishedAt: asString(post.publishedAt) || asString(post.createdAt),
              lastModifiedAt: asString(post.lastModifiedAt),
            };
          }).filter((post) => post.commentary)
        : [];
    } catch (error) {
      if (isBusinessDnaReconnectError(error)) throw error;
      // Certaines autorisations LinkedIn donnent accès au profil mais pas au flux.
    }
  }
  const postElements = context.posts;
  return {
    content: compactJson(context),
    itemCount: 1 + (Array.isArray(postElements) ? postElements.length : 0),
  };
}

async function refreshAndPersistTiktokToken(row: IntegrationRow, userId: string) {
  const refreshToken = tryDecryptToken(row.refresh_token_enc) || "";
  if (!refreshToken) return "";
  const refreshed = await refreshTiktokAccessToken(refreshToken);
  const accessToken = asString(refreshed.access_token) || "";
  if (!accessToken) return "";
  const nextRefreshToken = asString(refreshed.refresh_token) || refreshToken;
  const expiresIn = Number(refreshed.expires_in || 0);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1_000).toISOString()
    : row.expires_at || null;
  if (row.id) {
    await supabaseAdmin.from("integrations").update({
      access_token_enc: encryptToken(accessToken),
      refresh_token_enc: encryptToken(nextRefreshToken),
      expires_at: expiresAt,
      status: "connected",
      updated_at: new Date().toISOString(),
    }).eq("id", row.id).eq("user_id", userId);
  }
  return accessToken;
}

async function collectTiktok(row: IntegrationRow, userId: string) {
  let accessToken = tryDecryptToken(row.access_token_enc) || "";
  if (!accessToken || isExpired(row.expires_at)) {
    accessToken = await refreshAndPersistTiktokToken(row, userId);
  }
  if (!accessToken) throw new Error("Autorisation TikTok indisponible.");
  const rawUser = await fetchTiktokUserInfo(accessToken);
  const user = {
    username: asString(rawUser.username),
    displayName: asString(rawUser.display_name),
    biography: clampText(rawUser.bio_description, 2_000),
    publicUrl: asString(rawUser.profile_deep_link),
    verified: Boolean(rawUser.is_verified),
    followers: rawUser.follower_count,
    likes: rawUser.likes_count,
    videoCount: rawUser.video_count,
  };
  let videos: unknown = {};
  try {
    videos = await fetchJson(
      "https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,duration,create_time,share_url",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ max_count: 20 }),
      },
    );
  } catch (error) {
    if (isBusinessDnaReconnectError(error)) throw error;
  }
  const rawVideoItems = asRecord(asRecord(videos).data).videos;
  const videoItems = Array.isArray(rawVideoItems)
    ? rawVideoItems.slice(0, 20).map((item) => {
        const video = asRecord(item);
        return {
          title: clampText(video.title, 500),
          description: clampText(video.video_description, 2_000),
          publishedAt: video.create_time,
          publicUrl: asString(video.share_url),
        };
      }).filter((video) => video.title || video.description)
    : [];
  return {
    content: compactJson({ user, videos: videoItems }),
    itemCount: 1 + videoItems.length,
  };
}

async function refreshAndPersistYoutubeToken(row: IntegrationRow, userId: string) {
  const refreshToken = tryDecryptToken(row.refresh_token_enc) || "";
  if (!refreshToken || !getYoutubeShortsOAuthClientId() || !getYoutubeShortsOAuthClientSecret()) return "";
  const refreshed = await refreshYoutubeShortsAccessToken(refreshToken);
  const accessToken = asString(refreshed.access_token) || "";
  if (!accessToken) return "";
  const expiresIn = Number(refreshed.expires_in || 0);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1_000).toISOString()
    : row.expires_at || null;
  if (row.id) {
    await supabaseAdmin.from("integrations").update({
      access_token_enc: encryptToken(accessToken),
      expires_at: expiresAt,
      status: "connected",
      updated_at: new Date().toISOString(),
    }).eq("id", row.id).eq("user_id", userId);
  }
  return accessToken;
}

async function collectYoutube(row: IntegrationRow, userId: string) {
  let accessToken = tryDecryptToken(row.access_token_enc) || "";
  if (!accessToken || isExpired(row.expires_at)) {
    accessToken = await refreshAndPersistYoutubeToken(row, userId);
  }
  if (!accessToken) throw new Error("Autorisation YouTube indisponible.");

  const channel = await fetchYoutubeMineChannel(accessToken);
  let videos: unknown = {};
  if (channel?.channelId) {
    try {
      videos = await fetchJson(`https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
        part: "snippet",
        channelId: channel.channelId,
        type: "video",
        order: "date",
        maxResults: "20",
        fields: "items(id/videoId,snippet(title,description,publishedAt))",
      }).toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (error) {
      if (isBusinessDnaReconnectError(error)) throw error;
    }
  }
  const rawVideoItems = asRecord(videos).items;
  const videoItems = Array.isArray(rawVideoItems)
    ? rawVideoItems.slice(0, 20).map((item) => {
        const snippet = asRecord(asRecord(item).snippet);
        return {
          title: clampText(snippet.title, 500),
          description: clampText(snippet.description, 2_000),
          publishedAt: asString(snippet.publishedAt),
        };
      }).filter((video) => video.title || video.description)
    : [];
  return {
    content: compactJson({
      channel: {
        title: channel?.channelTitle,
        handle: channel?.channelHandle,
        publicUrl: channel?.channelUrl,
        stats: channel?.stats,
      },
      videos: videoItems,
    }),
    itemCount: 1 + videoItems.length,
  };
}

async function collectPinterest(userId: string) {
  const accessToken = await getPinterestAccessToken(userId);
  if (!accessToken) throw new Error("Autorisation Pinterest indisponible.");
  const [accountResult, boardsResult, pinsResult] = await Promise.allSettled([
    fetchPinterestUserAccount(accessToken),
    pinterestApiGet<unknown>("/boards?page_size=30", accessToken),
    pinterestApiGet<unknown>("/pins?page_size=25", accessToken),
  ]);
  const reconnectFailure = findBusinessDnaReconnectRejectedReason(
    accountResult,
    boardsResult,
    pinsResult,
  );
  if (reconnectFailure) throw reconnectFailure;
  if (areAllBusinessDnaRequestsRejected(accountResult, boardsResult, pinsResult)) {
    throw pickBusinessDnaRejectedReason(accountResult, boardsResult, pinsResult);
  }
  const account = accountResult.status === "fulfilled" ? accountResult.value : null;
  const rawBoards = boardsResult.status === "fulfilled"
    ? asRecord(boardsResult.value).items
    : [];
  const publicBoards = Array.isArray(rawBoards)
    ? rawBoards.slice(0, 30).filter((item) => {
        const privacy = asString(asRecord(item).privacy)?.toUpperCase();
        return privacy !== "SECRET" && privacy !== "PROTECTED";
      })
    : [];
  const publicBoardIds = new Set(
    publicBoards.map((item) => asString(asRecord(item).id)).filter(Boolean),
  );
  const boards = publicBoards.map((item) => {
    const board = asRecord(item);
    return {
      name: asString(board.name),
      description: clampText(board.description, 1_500),
      publicUrl: asString(board.url),
      pinCount: board.pin_count,
    };
  });
  const rawPins = pinsResult.status === "fulfilled" ? asRecord(pinsResult.value).items : [];
  const pins = Array.isArray(rawPins)
    ? rawPins.slice(0, 25).filter((item) => {
        const boardId = asString(asRecord(item).board_id);
        return !boardId || publicBoardIds.has(boardId);
      }).map((item) => {
        const pin = asRecord(item);
        return {
          title: clampText(pin.title, 500),
          description: clampText(pin.description, 2_000),
          altText: clampText(pin.alt_text, 1_000),
          publicUrl: asString(pin.link),
        };
      }).filter((pin) => pin.title || pin.description || pin.altText)
    : [];
  return {
    content: compactJson({
      account: account ? {
        username: account.username,
        displayName: account.displayName,
        publicUrl: account.profileUrl,
        website: account.websiteUrl,
        accountType: account.accountType,
      } : null,
      boards,
      pins,
    }),
    itemCount: (account ? 1 : 0) + boards.length + pins.length,
  };
}

function buildInrSearchContent(businessProfile: unknown, proToolsConfig: unknown) {
  const business = asRecord(businessProfile);
  const settings = asRecord(asRecord(proToolsConfig).settings);
  const inrSearch = asRecord(settings.inrSearch);
  return compactJson({
    pageTitle: inrSearch.pageTitle,
    pageDescription: inrSearch.pageDescription,
    categories: inrSearch.categories,
    highlights: inrSearch.highlights,
    description: business.business_description || business.activity_description,
    services: business.services,
    interventionZones: business.intervention_zones,
    strengths: business.strengths,
    customerTypes: business.customer_typologies,
  });
}

async function executeSource(args: {
  key: string;
  label: string;
  connected: boolean;
  oauthProtected?: boolean;
  requiresUpdate?: boolean;
  url?: string | null;
  collect: () => Promise<{ content: string; itemCount: number; finalUrl?: string }>;
}): Promise<BusinessDnaSourceResult> {
  if (!canCollectBusinessDnaSource(args)) {
    return {
      key: args.key,
      label: args.label,
      status: args.requiresUpdate ? "needs_reconnect" : "not_connected",
      url: args.url || null,
      itemCount: 0,
      contentChars: 0,
      message: args.requiresUpdate ? "Reconnectez ce canal pour l’analyser." : null,
      content: "",
    };
  }
  try {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error("Délai maximal de lecture du canal dépassé.")),
        MAX_SOURCE_COLLECTION_MS,
      );
    });
    let result: Awaited<ReturnType<typeof args.collect>>;
    try {
      result = await Promise.race([args.collect(), timeout]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
    const content = clampText(result.content, MAX_SOURCE_CHARS);
    if (!content) throw new Error("Source vide.");
    return {
      key: args.key,
      label: args.label,
      status: "analyzed",
      url: result.finalUrl || args.url || null,
      itemCount: Math.max(1, Math.floor(result.itemCount || 1)),
      contentChars: content.length,
      message: null,
      content,
    };
  } catch (error) {
    const needsReconnect = shouldBusinessDnaSourceReconnect({
      error,
      oauthProtected: Boolean(args.oauthProtected),
      requiresUpdate: args.requiresUpdate,
    });
    return {
      key: args.key,
      label: args.label,
      status: needsReconnect ? "needs_reconnect" : "failed",
      url: args.url || null,
      itemCount: 0,
      contentChars: 0,
      message: needsReconnect
        ? "Reconnectez ce canal pour renouveler son autorisation."
        : normalizeExternalFailure(error),
      content: "",
    };
  }
}

export async function collectBusinessDnaChannelSources(args: {
  supabase: unknown;
  userId: string;
  businessProfile: unknown;
  proToolsConfig: unknown;
}) {
  const [states, integrationsResult] = await Promise.all([
    getChannelConnectionStates(args.supabase, args.userId),
    supabaseAdmin
      .from("integrations")
      .select("id,provider,source,product,status,resource_id,resource_label,display_name,access_token_enc,refresh_token_enc,expires_at,meta,updated_at,created_at")
      .eq("user_id", args.userId),
  ]);
  if (integrationsResult.error) throw integrationsResult.error;
  const rows = (Array.isArray(integrationsResult.data) ? integrationsResult.data : []) as IntegrationRow[];
  const facebookRow = latestIntegration(rows, "facebook", "facebook", "facebook");
  const instagramRow = latestIntegration(rows, "instagram", "instagram", "instagram");
  const tiktokRow = latestIntegration(rows, "tiktok", "tiktok", "tiktok");
  const youtubeRow = latestIntegration(rows, "youtube", "youtube_shorts", "youtube_shorts");

  const sources = await Promise.all([
    executeSource({
      key: "website",
      label: "Site internet",
      connected: Boolean(states.site_web.connected && states.site_web.url),
      url: states.site_web.url,
      collect: async () => collectWebsite(states.site_web.url || ""),
    }),
    executeSource({
      key: "inrcy_site",
      label: "Site iNrCy",
      connected: Boolean(states.site_inrcy.connected && states.site_inrcy.url),
      url: states.site_inrcy.url,
      collect: async () => collectWebsite(states.site_inrcy.url || ""),
    }),
    executeSource({
      key: "google_business",
      label: "Google Business",
      connected: states.gmb.connected,
      oauthProtected: true,
      requiresUpdate: states.gmb.requiresUpdate,
      url: states.gmb.url,
      collect: async () => collectGoogleBusiness(args.supabase, args.userId),
    }),
    executeSource({
      key: "facebook",
      label: "Facebook",
      connected: Boolean(states.facebook.connected && facebookRow),
      oauthProtected: true,
      requiresUpdate: states.facebook.requiresUpdate,
      url: states.facebook.page_url,
      collect: async () => collectFacebook(facebookRow || {}),
    }),
    executeSource({
      key: "instagram",
      label: "Instagram",
      connected: Boolean(states.instagram.connected && instagramRow),
      oauthProtected: true,
      requiresUpdate: states.instagram.requiresUpdate,
      url: states.instagram.profile_url,
      collect: async () => collectInstagram(instagramRow || {}),
    }),
    executeSource({
      key: "linkedin",
      label: "LinkedIn",
      connected: states.linkedin.connected,
      oauthProtected: true,
      requiresUpdate: states.linkedin.requiresUpdate,
      url: states.linkedin.organization_url || states.linkedin.profile_url,
      collect: async () => collectLinkedIn(args.userId),
    }),
    executeSource({
      key: "tiktok",
      label: "TikTok",
      connected: Boolean(states.tiktok.connected && tiktokRow),
      oauthProtected: true,
      requiresUpdate: states.tiktok.requiresUpdate,
      url: states.tiktok.profile_url,
      collect: async () => collectTiktok(tiktokRow || {}, args.userId),
    }),
    executeSource({
      key: "youtube",
      label: "YouTube",
      connected: Boolean(states.youtube_shorts.connected && youtubeRow),
      oauthProtected: true,
      requiresUpdate: states.youtube_shorts.requiresUpdate,
      url: states.youtube_shorts.channel_url,
      collect: async () => collectYoutube(youtubeRow || {}, args.userId),
    }),
    executeSource({
      key: "pinterest",
      label: "Pinterest",
      connected: states.pinterest.connected,
      oauthProtected: true,
      requiresUpdate: states.pinterest.requiresUpdate,
      url: states.pinterest.profile_url,
      collect: async () => collectPinterest(args.userId),
    }),
    executeSource({
      key: "inr_search",
      label: "iNr’Search",
      connected: states.inr_search.connected,
      url: states.inr_search.profile_url,
      collect: async () => ({
        content: buildInrSearchContent(args.businessProfile, args.proToolsConfig),
        itemCount: 1,
      }),
    }),
  ]);

  // Un même site peut être déclaré comme site externe et site iNrCy. On évite
  // de payer deux fois l'analyse du même contenu, sans masquer son état à l'interface.
  const website = sources.find((source) => source.key === "website");
  const inrcySite = sources.find((source) => source.key === "inrcy_site");
  if (
    website?.status === "analyzed" &&
    inrcySite?.status === "analyzed" &&
    website.url &&
    inrcySite.url &&
    website.url.replace(/\/$/, "") === inrcySite.url.replace(/\/$/, "")
  ) {
    inrcySite.content = "";
    inrcySite.contentChars = 0;
    inrcySite.itemCount = 0;
    inrcySite.message = "Ce site a déjà été analysé comme site internet.";
  }

  return sources;
}
