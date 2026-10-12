import type { SupabaseClient } from "@supabase/supabase-js";
import { siteWebArticleIdsFromPayload, siteWebArticlePublicationId } from "../siteWebPublications.ts";

type Article = Record<string, unknown>;

export async function loadSiteWebPublicationArticles(supabase: SupabaseClient, userId: string, publicationId: string, rawPayload: unknown): Promise<Article[]> {
  const knownIds = siteWebArticleIdsFromPayload(rawPayload);
  const columns = "id,site_url,external_url,media_metadata";
  const [byParent, byIds] = await Promise.all([
    supabase.from("site_articles").select(columns).eq("user_id", userId).eq("source", "site_web")
      .eq("media_metadata->>publication_id", publicationId),
    knownIds.length ? supabase.from("site_articles").select(columns).eq("user_id", userId).eq("source", "site_web").in("id", knownIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (byParent.error) throw byParent.error;
  if (byIds.error) throw byIds.error;
  const articles = [...(byParent.data || []), ...(byIds.data || [])] as Article[];
  // Metadata is the account/parent authority; client-supplied external IDs never enter it.
  return Array.from(new Map(articles.filter((article) => siteWebArticlePublicationId(article) === publicationId)
    .map((article) => [String(article.id), article])).values());
}

export async function updateSiteWebPublicationArticles(supabase: SupabaseClient, args: {
  userId: string; publicationId: string; patch: Article;
}) {
  const { data, error } = await supabase.from("site_articles").update(args.patch)
    .eq("user_id", args.userId).eq("source", "site_web").eq("media_metadata->>publication_id", args.publicationId)
    .select("id,site_url,external_url");
  if (error) throw error;
  if (!(data || []).length) throw new Error("Article du site introuvable.");
  return data || [];
}

export async function deleteSiteWebPublicationArticles(supabase: SupabaseClient, args: {
  userId: string; publicationId: string;
}) {
  const { data, error } = await supabase.from("site_articles").delete()
    .eq("user_id", args.userId).eq("source", "site_web").eq("media_metadata->>publication_id", args.publicationId)
    .select("id");
  if (error) throw error;
  return data || [];
}
