import type { SupabaseClient } from "@supabase/supabase-js";
import { selectSiteWebFeedArticles, siteWebArticlePublicationId } from "../siteWebPublications.ts";

const ARTICLE_COLUMNS = "id,created_at,title,content,cta,images,site_url,external_url,media_type,video_url,video_path,video_mime,video_size,video_duration_seconds,video_thumbnail_url,media_metadata";
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function loadSiteWebWidgetArticles(supabase: SupabaseClient, userId: string, limit: number) {
  const { data: config, error: configError } = await supabase.from("pro_tools_configs")
    .select("settings").eq("user_id", userId).maybeSingle();
  if (configError) throw configError;
  const primaryUrl = String(asRecord(asRecord(asRecord(config).settings).site_web).url || "");
  const articles: Record<string, unknown>[] = [];
  const batchSize = Math.max(40, limit * 2);
  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await supabase.from("site_articles").select(ARTICLE_COLUMNS)
      .eq("user_id", userId).eq("source", "site_web")
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + batchSize - 1);
    if (error) throw error;
    const page = (data || []) as Record<string, unknown>[];
    articles.push(...page);
    if (page.length < batchSize || selectSiteWebFeedArticles(articles, primaryUrl, limit).length >= limit) break;
  }
  // A paired primary article can be older than the first page's secondary variant.
  const parentIds = selectSiteWebFeedArticles(articles, primaryUrl, limit).map(siteWebArticlePublicationId).filter(Boolean);
  if (parentIds.length) {
    const { data, error } = await supabase.from("site_articles").select(ARTICLE_COLUMNS)
      .eq("user_id", userId).eq("source", "site_web").in("media_metadata->>publication_id", parentIds)
      .order("created_at", { ascending: false }).order("id", { ascending: false });
    if (error) throw error;
    const seen = new Set(articles.map((article) => String(article.id)));
    articles.push(...((data || []) as Record<string, unknown>[]).filter((article) => !seen.has(String(article.id))));
  }
  return selectSiteWebFeedArticles(articles, primaryUrl, limit);
}
