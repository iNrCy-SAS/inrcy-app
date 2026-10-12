import { metaDirectConnectionStatus } from "@/lib/metaDirectConnectionRoutes";

export async function GET(request: Request) {
  return metaDirectConnectionStatus(request, "threads");
}
