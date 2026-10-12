import { META_GRAPH_API_VERSION, buildMetaGraphUrl } from "@/lib/metaGraphApi";

export type InstagramAuthMode = "facebook_login" | "instagram_login";

export function resolveInstagramAuthMode(meta: unknown): InstagramAuthMode {
  return meta && typeof meta === "object" && !Array.isArray(meta)
    && (meta as Record<string, unknown>).auth_mode === "instagram_login"
    ? "instagram_login" : "facebook_login";
}

export function buildInstagramGraphUrl(path: unknown, authMode: InstagramAuthMode = "facebook_login") {
  if (authMode === "facebook_login") return buildMetaGraphUrl(path);
  const normalizedPath = String(path || "").trim().replace(/^\/+/, "");
  const base = `https://graph.instagram.com/${META_GRAPH_API_VERSION}`;
  return normalizedPath ? `${base}/${normalizedPath}` : base;
}

export const INSTAGRAM_DIRECT_SCOPES = [
  "instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_insights",
] as const;
