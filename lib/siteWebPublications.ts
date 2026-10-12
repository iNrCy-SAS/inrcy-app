import { canonicalSiteWebChannel } from "./siteWebChannel.ts";
import { normalizeWidgetDomain } from "./widgets/siteWebDomains.ts";

type Row = Record<string, unknown>;
const asRecord = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read every persisted website result before legacy channel keys are folded. */
export function siteWebArticleIdsFromPayload(payload: unknown): string[] {
  const results = asRecord(asRecord(payload).results);
  const ids: string[] = [];
  for (const [channel, value] of Object.entries(results)) {
    if (canonicalSiteWebChannel(channel) !== "site_web") continue;
    const result = asRecord(value);
    for (const candidate of [result.external_id, ...(Array.isArray(result.external_ids) ? result.external_ids : [])]) {
      if (typeof candidate === "string" && uuid.test(candidate.trim())) ids.push(candidate.trim());
    }
  }
  return Array.from(new Set(ids));
}

export function siteWebArticlePublicationId(article: Row): string {
  const value = asRecord(article.media_metadata).publication_id;
  return typeof value === "string" && uuid.test(value.trim()) ? value.trim() : "";
}

export function primarySiteWebArticle<T extends Row>(articles: readonly T[], websiteUrl: string): T | undefined {
  const domain = normalizeWidgetDomain(websiteUrl);
  return articles.find((article) => domain && normalizeWidgetDomain(String(article.site_url || "")) === domain) || articles[0];
}

/** Clear stale video columns when a whole website group is edited as images. */
export function siteWebImageMediaPatch(publicationId: string, metadata: Row) {
  return {
    media_type: "images", video_url: null, video_path: null, video_mime: null,
    video_size: null, video_duration_seconds: null, video_thumbnail_url: null,
    media_metadata: { ...metadata, publication_id: publicationId },
  };
}

/** Keep an unmapped standalone article; fold only proven children of one parent. */
export function selectSiteWebFeedArticles<T extends Row>(articles: readonly T[], websiteUrl: string, limit: number): T[] {
  const groups = new Map<string, T[]>();
  for (const article of articles) {
    const key = siteWebArticlePublicationId(article) || `article:${String(article.id || "")}`;
    const group = groups.get(key) || [];
    group.push(article);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => primarySiteWebArticle(group, websiteUrl)!).slice(0, limit);
}
