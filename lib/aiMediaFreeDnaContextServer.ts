import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedAiGenerationProfile } from "./aiGenerationProfile.ts";
import { buildAiMediaFreeDnaContext } from "./aiMediaFreeDnaContext.ts";
import { AiMediaRequestValidationError } from "./aiMediaGenerationContracts.ts";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** No provider tokens, mailboxes, customer data or other accounts enter this projection. */
export async function loadAiMediaFreeDnaContext(args: {
  supabase: Pick<SupabaseClient, "from">;
  accountId: string;
  profile: NormalizedAiGenerationProfile;
  publicProfile: Record<string, unknown> | null;
  business: Record<string, unknown> | null;
  prompt: string;
}) {
  const [configResult, integrationResult] = await Promise.all([
    args.supabase.from("pro_tools_configs").select([
      "website:settings->site_web->>url", "facebook:settings->facebook->>url", "instagram:settings->instagram->>url",
      "threads:settings->threads->>url", "linkedin:settings->linkedin->>profileUrl", "linkedin_company:settings->linkedin->>orgUrl",
      "linkedin_url:settings->linkedin->>url", "x:settings->x->>profileUrl", "x_url:settings->x->>url",
      "tiktok:settings->tiktok->>profileUrl", "pinterest:settings->pinterest->>publicProfileUrl",
      "youtube:settings->youtube_shorts->>channelUrl", "service_details:settings->inrSearch->serviceDescriptions",
    ].join(",")).eq("user_id", args.accountId).maybeSingle(),
    args.supabase.from("integrations").select([
      "source", "product", "resource_id", "resource_label", "profile_url:meta->>profile_url",
      "page_url:meta->>page_url", "org_url:meta->>org_url", "channel_url:meta->>channel_url", "url:meta->>url",
    ].join(",")).eq("user_id", args.accountId).order("updated_at", { ascending: false }).limit(40),
  ]);
  // Do not silently omit a requested telephone or website after a failed read.
  if (configResult.error || integrationResult.error) throw new AiMediaRequestValidationError("Les informations de votre entreprise n’ont pas pu être chargées. Réessayez dans un instant pour utiliser votre ADN.");
  const config = record(configResult.data);
  const links: Record<string, unknown> = {
    site_web: config.website,
    facebook: config.facebook, instagram: config.instagram, threads: config.threads,
    linkedin: config.linkedin_company || config.linkedin || config.linkedin_url,
    x: config.x || config.x_url, tiktok: config.tiktok, pinterest: config.pinterest, youtube: config.youtube,
  };
  for (const value of Array.isArray(integrationResult.data) ? integrationResult.data : []) {
    const row = record(value);
    const source = String(row.source || "");
    const key = source === "youtube_shorts" ? "youtube" : source === "gmb" ? "google_business" : source;
    if (!["facebook", "instagram", "threads", "linkedin", "x", "tiktok", "pinterest", "youtube", "google_business"].includes(key)) continue;
    const candidate = row.org_url || row.page_url || row.profile_url || row.channel_url || row.url;
    if (!links[key] && candidate) links[key] = candidate;
    if (!links[key] && key === "facebook" && /^\d+$/.test(String(row.resource_id || ""))) links[key] = `https://www.facebook.com/${row.resource_id}`;
  }
  return buildAiMediaFreeDnaContext({
    profile: args.profile, publicProfile: args.publicProfile, publicLinks: links, prompt: args.prompt,
    serviceDetails: { ...record(args.business?.service_descriptions), ...record(args.business?.services_descriptions), ...record(config.service_details) },
  });
}
