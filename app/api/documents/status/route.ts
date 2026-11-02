import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { getActiveSubscriptionAccountIds } from "@/lib/accountSubscriptionAccess";
import { commercialIdempotencyKey } from "@/lib/commercialMutationIdempotency";
import { COMMERCIAL_UUID } from "@/lib/commercialDocumentDraft";
import { commercialDocumentRow as row } from "@/lib/commercialDocumentValidation";
import { withApi } from "@/lib/observability/withApi";

const error = (message: string, status: number, code: string) => NextResponse.json({ error: message, code }, { status });

/** The native manual accounting status only. Never allocates a number or collects a payment. */
async function updateStatus(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Origine non autorisée.", 403, "origin_not_allowed");
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  if (await getDashboardEditionForAccountId(auth.activeUserId) !== "founder" || !(await getActiveSubscriptionAccountIds([auth.activeUserId])).has(auth.activeUserId)) return error("Accès actif à la gestion commerciale requis.", 403, "accounting_access_required");
  let documentId: string, expectedUpdatedAt: string, key: string;
  try {
    key = commercialIdempotencyKey(request) || "";
    const input = row(await request.json());
    if (!key || Object.keys(input).sort().join(",") !== "documentId,expectedUpdatedAt,status" || input.status !== "paye" ||
      typeof input.documentId !== "string" || !COMMERCIAL_UUID.test(input.documentId) ||
      typeof input.expectedUpdatedAt !== "string" || input.expectedUpdatedAt.length > 40 || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) throw new Error();
    documentId = input.documentId; expectedUpdatedAt = input.expectedUpdatedAt;
  } catch { return error("Référence, version ou statut invalide.", 400, "document_status_invalid"); }
  const inputHash = createHash("sha256").update(JSON.stringify({ documentId, expectedUpdatedAt, status: "paye" })).digest("hex");
  const keyHash = createHash("sha256").update(`${auth.activeUserId}:${auth.authUserId}:${key}`).digest("hex");
  const read = () => auth.supabase.from("doc_saves").select("id,user_id,type,payload,updated_at").eq("id", documentId).eq("user_id", auth.activeUserId).eq("type", "facture").maybeSingle();
  const sameOperation = (payload: Record<string, unknown>) => {
    const receipt = row(payload.assistantLastStatus);
    return receipt.keyHash === keyHash && receipt.inputHash === inputHash && payload.status === "paye";
  };
  const success = (payload: Record<string, unknown>, updatedAt: unknown, unchanged: boolean) => NextResponse.json({
    ok: true, id: documentId, kind: "facture", status: "marked_paid", documentStatus: "paye", updatedAt, unchanged,
    number: typeof payload.number === "string" ? payload.number : "", isFinalized: payload.isFinalized === true,
    paymentCollected: false, sent: false,
    message: "Statut payé enregistré manuellement. Aucun encaissement bancaire, numéro officiel, finalisation ou envoi effectué.",
  });
  const previous = await read(), document = row(previous.data), payload = row(document.payload);
  if (previous.error) return error("La facture ne peut pas être vérifiée.", 503, "document_unavailable");
  if (!previous.data || payload.isTemplate === true) return error("Facture introuvable.", 404, "document_not_found");
  if (sameOperation(payload)) return success(payload, document.updated_at, true);
  if (row(payload.assistantLastStatus).keyHash === keyHash || document.updated_at !== expectedUpdatedAt) return error("La facture a changé. Relisez sa version actuelle.", 409, "document_version_conflict");
  if (payload.status === "paye") return success(payload, document.updated_at, true);
  if (request.signal.aborted) return error("Demande interrompue.", 409, "request_interrupted");
  const now = new Date().toISOString();
  const next = { ...payload, status: "paye", assistantLastStatus: { keyHash, inputHash } };
  const updated = await auth.supabase.from("doc_saves").update({ payload: next, updated_at: now })
    .eq("id", documentId).eq("user_id", auth.activeUserId).eq("type", "facture").eq("updated_at", expectedUpdatedAt).select("id").maybeSingle();
  if (updated.error) return error("Le changement de statut ne peut pas être confirmé. Relisez la facture.", 503, "document_status_unconfirmed");
  const checked = await read(), saved = row(checked.data), savedPayload = row(saved.payload);
  if (checked.error) return error("Le statut enregistré ne peut pas être vérifié.", 503, "document_status_unconfirmed");
  if (!updated.data && !sameOperation(savedPayload)) return error("La facture a changé. Relisez sa version.", 409, "document_version_conflict");
  if (!sameOperation(savedPayload)) return error("Le statut enregistré ne peut pas être confirmé.", 503, "document_status_unconfirmed");
  return success(savedPayload, saved.updated_at, !updated.data);
}

export const POST = withApi(updateStatus, { route: "/api/documents/status" });
