import { startMetaDirectOAuth } from "@/lib/metaDirectOAuth";

export async function GET(request: Request) {
  return startMetaDirectOAuth(request, "threads");
}
