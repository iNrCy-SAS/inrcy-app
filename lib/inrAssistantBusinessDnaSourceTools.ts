import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import { requireUser } from "./requireUser";
import { AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS, AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES, getAiMemoryReferenceDocumentStorage } from "./aiMemory";
import { assistantActionFingerprint, createAssistantActionPreview, hasAssistantActionApproval, verifyAssistantActionPreview } from "./inrAssistantActionPreview.ts";
import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown) => typeof value === "string" ? value : "";
const object = (properties: Record<string, JSONSchema7>): JSONSchema7 => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const link = { label: "ADN de l’entreprise", href: "/dashboard/adn-entreprise" };
function fields(value: unknown, keys: string[]) { const input = row(value); if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error("Paramètres invalides."); return input; }
const project = (document: Row) => ({ id: str(document.id), name: str(document.name).slice(0, 180), mimeType: str(document.mimeType), size: typeof document.size === "number" ? document.size : null, status: str(document.status), createdAt: str(document.createdAt) });
export function createInrAssistantBusinessDnaSourceTools(options: { request: Request; accountId: string; actorUserId: string; currentUserMessage: string; currentApprovalMessage?: string; canStartWork?: () => boolean; resolvePreview?: (reference: string) => string | null }) {
  const { request, accountId, actorUserId } = options, attempts = new Map<string, Promise<Row>>();
  const fail = (status: string, message: string): Row => ({ ok: false, status, message, nextAction: link });
  const scope = async () => { if (request.signal.aborted || options.canStartWork?.() === false) return false; const auth = await requireUser(); return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId; };
  const documents = async () => {
    if (!await scope()) throw new Error("Compte actif modifié.");
    const response = await (await import("@/app/api/ai-memory/route")).GET(), data = row(await response.json());
    if (!response.ok || data.ok !== true || data.accountId !== accountId) throw new Error("Documents indisponibles.");
    return (Array.isArray(row(data.memory).referenceDocuments) ? row(data.memory).referenceDocuments as unknown[] : []).map(row);
  };
  return {
    readBusinessDnaSources: tool({ strict: true, description: "Lire les sources actuellement disponibles pour l’analyse ADN et les documents privés déjà joints, leurs identifiants, états de lecture et quotas natifs (10 documents, 20Mo par fichier, 50Mo total). N’expose ni chemin Storage, extrait, lien signé ni jeton. Pour une analyse ciblée, utiliser ensuite startBusinessDnaAnalysis.selectedChannels ; les documents joints sont inclus. Pour importer un nouveau fichier, le pro doit le fournir et valider le consentement natif.",
      inputSchema: jsonSchema<Record<string, never>>(object({})), execute: async raw => {
        fields(raw, []);
        try {
          const docs = await documents();
          const response = await (await import("@/app/api/ai-memory/analyze-channels/route")).GET(), data = row(await response.json());
          if (!response.ok || data.ok !== true || data.accountId !== accountId) return fail("unavailable", "Les sources d’analyse ne sont pas disponibles.");
          return { ok: true, status: "read", channels: (Array.isArray(data.channels) ? data.channels : []).map(row).map(source => ({ key: str(source.key), status: str(source.status), analyzable: source.analyzable === true })), documents: docs.map(project), storage: getAiMemoryReferenceDocumentStorage(docs.map(document => ({ size: typeof document.size === "number" ? document.size : null }))), limits: { items: AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS, fileBytes: AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES }, nextAction: link, untrustedContent: true, message: "Les sources disponibles, les documents joints et leurs quotas ont été lus. Aucune analyse ni suppression n’a été lancée." };
        } catch { return fail("unavailable", "Les sources ou documents ADN n’ont pas pu être lus."); }
      } }),
    previewBusinessDnaDocumentRemoval: tool({ strict: true, description: "Préparer la suppression irréversible d’un document privé déjà joint à l’ADN. Demande un ID lu par readBusinessDnaSources et une instruction explicite de suppression actuelle. Présente le nom et l’impact, puis attend une validation référencée. Ne supprime jamais un document d’une autre liste ou un chemin Storage fourni par le modèle.",
      inputSchema: jsonSchema<{ documentId: string; instructionQuote: string }>(object({ documentId: { type: "string", minLength: 1, maxLength: 120 }, instructionQuote: { type: "string", maxLength: 1200 } })), execute: async raw => {
        const input = fields(raw, ["documentId", "instructionQuote"]), quote = str(input.instructionQuote), current = inrAssistantMaskQuotedText(options.currentUserMessage), normalized = current.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
        if (!quote || quote.length > 1200 || !current.includes(quote) || !/\b(?:supprime|supprimer|retire|retirer)\b/.test(quote.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()) || !/\b(?:adn|dna|document)\b/.test(normalized) || /\b(?:comment|pourquoi|explique|si|quand|lorsque|demain|plus tard|ne pas)\b|\bne\b.{0,60}\bpas\b|\b(?:supprime|retire)\s+pas\b|\b(?:dans)\s+(?:\d+|un|une|deux|trois)\s*(?:minute|heure|jour)\b/.test(normalized)) return fail("needs_instruction", "Précisez le document ADN à supprimer dans votre demande actuelle.");
        try {
          const document = (await documents()).find(item => item.id === input.documentId);
          if (!document) return fail("not_found", "Ce document n’est pas présent dans l’ADN de cet établissement.");
          const preview = createAssistantActionPreview({ accountId, actorUserId, kind: "business_dna_document_removal", targetId: str(document.id), fingerprint: assistantActionFingerprint(document), patch: {} });
          return { ok: true, status: "preview_ready", approvalKind: "business_dna_document_removal", document: project(document), ...preview, message: `La suppression du document est préparée et attend votre validation. Vérifiez le document et l’impact, puis dites « Confirme ${preview.reference} ». Aucun document n’a encore été supprimé.`, impact: "Le document et son fichier privé seront retirés de l’ADN. Les informations déjà intégrées dans les rubriques ADN ne seront pas effacées par cette suppression.", nextAction: link, untrustedContent: true };
        } catch { return fail("unavailable", "La suppression du document n’a pas pu être préparée."); }
      } }),
    applyBusinessDnaDocumentRemoval: tool({ strict: true, description: "Supprimer uniquement le document ADN prévisualisé et validé par sa référence IA-. Vérifie signature, compte, expiration et document inchangé. Appelle la suppression atomique native puis relit la liste avant d’annoncer le résultat. Ne relance pas automatiquement une opération incertaine.",
      inputSchema: jsonSchema<{ reference: string; approvalQuote: string }>(object({ reference: { type: "string", pattern: "^IA-[A-F0-9]{12}$" }, approvalQuote: { type: "string", maxLength: 1200 } })), execute: async raw => {
        const input = fields(raw, ["reference", "approvalQuote"]), reference = str(input.reference);
        if (!hasAssistantActionApproval(options.currentApprovalMessage ?? options.currentUserMessage, str(input.approvalQuote), reference)) return fail("needs_confirmation", "Validez explicitement la référence de suppression présentée.");
        const token = options.resolvePreview?.(reference), preview = token && verifyAssistantActionPreview(token, { accountId, actorUserId, kind: "business_dna_document_removal" });
        if (!preview || preview.reference !== reference) return fail("stale_preview", "La préparation a expiré ou ne correspond pas au compte actif.");
        if (!attempts.has(reference)) attempts.set(reference, (async () => {
          const document = (await documents()).find(item => item.id === preview.targetId);
          if (!document) return { ok: true, status: "already_removed", documentId: preview.targetId, nextAction: link, message: "Ce document est déjà absent de la liste ADN relue. Aucune nouvelle suppression n’a été demandée." };
          if (assistantActionFingerprint(document) !== preview.fingerprint) return fail("stale_preview", "Le document a changé depuis la préparation. Relisez sa fiche avant de préparer à nouveau la suppression.");
          if (!await scope()) return fail("blocked", "Le compte actif a changé.");
          const headers = new Headers({ "content-type": "application/json" });
          for (const name of ["cookie", "authorization"]) { const value = request.headers.get(name); if (value) headers.set(name, value); }
          const response = await (await import("@/app/api/ai-memory/documents/route")).DELETE(new Request(new URL("/api/ai-memory/documents", request.url), { method: "DELETE", headers, signal: request.signal, body: JSON.stringify({ id: preview.targetId }) })), data = row(await response.json());
          if (!response.ok || data.ok !== true) return fail("unknown", "La suppression n’est pas confirmée. Consultez les documents ADN avant de réessayer.");
          if ((await documents()).some(item => item.id === preview.targetId)) return fail("saved_unconfirmed", "La relecture ne confirme pas la suppression de ce document.");
          return { ok: true, status: "removed", documentId: preview.targetId, nextAction: link, message: "Le document a été retiré de l’ADN et son absence dans la liste est vérifiée." };
        })().catch(() => fail("unknown", "Le résultat n’a pas pu être confirmé. Vérifiez les documents ADN avant de réessayer.")));
        return attempts.get(reference)!;
      } }),
  };
}
