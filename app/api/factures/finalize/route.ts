import { finalizeCommercialDocumentRequest } from "@/lib/commercialDocumentFinalization";
import { withApi } from "@/lib/observability/withApi";

export const POST = withApi((request: Request) => finalizeCommercialDocumentRequest(request, "facture"), { route: "/api/factures/finalize" });
