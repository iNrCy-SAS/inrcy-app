import { disconnectMetaDirectConnection } from "@/lib/metaDirectConnectionRoutes";

export async function POST(request: Request) {
  return disconnectMetaDirectConnection(request, "threads");
}
