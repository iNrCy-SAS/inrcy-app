import { finalizeCommercialDocumentRequest } from "@/lib/commercialDocumentFinalization";
import { withApi } from "@/lib/observability/withApi";

export const POST = withApi((request: Request) => finalizeCommercialDocumentRequest(request, "devis"), { route: "/api/devis/finalize" });
