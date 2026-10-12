import { handleMetaDirectOAuthCallback } from "@/lib/metaDirectOAuth";

export async function GET(request: Request) {
  return handleMetaDirectOAuthCallback(request, "instagram");
}
