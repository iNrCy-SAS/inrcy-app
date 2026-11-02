import "server-only";
import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { requireUser } from "./requireUser";
import { getDashboardEditionForAccountId } from "./dashboardEditionServer";
import { getActiveSubscriptionAccountIds } from "./accountSubscriptionAccess";
import { matchesInrAssistantActionClause, inrAssistantMaskQuotedText } from "./inrAssistantActionClause.ts";
import { assistantActionFingerprint, createAssistantActionPreview, hasAssistantActionApproval, verifyAssistantActionPreview } from "./inrAssistantActionPreview.ts";
import { createCommercialTemplateSnapshot } from "./commercialDocumentTemplate.ts";
import { parseInrAssistantDocumentTemplateCommand } from "./inrAssistantDocumentUiCommands.ts";
const row = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").replace(/’/g, "'").toLowerCase();
const text = (value: unknown, max = 180): value is string => typeof value === "string" && !!value.trim() && value.length <= max;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const named = (message: string, name: string) => new RegExp(`(?:^|[^a-z0-9])${normalize(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(normalize(message));
function explicitTemplateName(message: string, name: string) {
  const escaped = normalize(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), input = normalize(message);
  const quotedOrNamed = new RegExp(`\\b(?:modele|template)\\s+(?:(?:nomme|appele|intitule|named|called)\\s+[«"'“‘]?|[«"'“‘])${escaped}(?:[»"'”’]|$|[\\s,.!?;])`).test(input);
  return quotedOrNamed || !/^(?:depuis|de|du|des|ce|cette|a partir|from)\b/.test(normalize(name)) && new RegExp(`\\b(?:modele|template)\\s+${escaped}(?=$|[\\s,.!?;])`).test(input);
}
function direct(message: string, quote: string, operation: "create" | "delete") {
  return matchesInrAssistantActionClause(message, quote, (current, clause) => [current, clause].every(value => {
    const intent = normalize(inrAssistantMaskQuotedText(value));
    return !/\b(?:comment|pourquoi|explique\w*|imagine|si|quand|lorsque|demain|if|when|why|how|ne|pas|jamais|sans|not|never)\b|\bn'|\bapres.{0,35}(?:confirmation|accord)\b/.test(intent) &&
      /\b(?:modele|template)\b/.test(intent) && (operation === "create" ? /\b(?:cree\w*|enregistre\w*|sauvegard\w*|create|save)\b/.test(intent) : /\b(?:supprime\w*|efface\w*|delete|remove)\b/.test(intent));
  }));
}
type Preview = { operation: "create" | "delete"; kind: "quote" | "invoice"; sourceId: string; expectedUpdatedAt: string; reference: string; templateName: string | null; instructionQuote: string };
type Apply = { reference: string; instructionQuote: string };
export function createInrAssistantDocumentTemplateTools(options: {
  request: Request; accountId: string; actorUserId: string; supabase: Pick<SupabaseClient, "from">;
  edition: DashboardEdition; currentUserMessage: string; currentApprovalMessage?: string; clientContext?: InrAssistantClientContext | null;
  resolvePreview?: (reference: string) => string | null; canStartWork?: () => boolean;
}) {
  const { accountId, actorUserId, request } = options, pending = new Map<string, Promise<Record<string, unknown>>>();
  const fail = (status: string, message: string) => ({ ok: false, status, message });
  const live = () => !request.signal.aborted && options.canStartWork?.() !== false;
  const allowed = async () => {
    if (!live() || options.edition !== "founder") return false;
    const auth = await requireUser();
    return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId && await getDashboardEditionForAccountId(accountId) === "founder" && (await getActiveSubscriptionAccountIds([accountId])).has(accountId);
  };
  const read = async (id: string, kind: "quote" | "invoice") => {
    const type = kind === "quote" ? "devis" : "facture";
    const result = await options.supabase.from("doc_saves").select("id,user_id,type,name,payload,updated_at").eq("user_id", accountId).eq("type", type).eq("id", id).maybeSingle();
    return !result.error && result.data?.id === id && result.data.user_id === accountId && result.data.type === type ? result.data : null;
  };
  return {
    prepareCurrentDocumentTemplate: tool({ strict: true,
      description: "Créer un modèle depuis le devis/facture actuellement ouvert, y compris non sauvegardé. Nom explicitement demandé. Ne lit pas les champs locaux ; commande native avec confirmation du professionnel, puis reçu navigateur après sauvegarde du modèle. Ne sauvegarde/finalise pas le document.",
      inputSchema: jsonSchema<{ templateName: string; instructionQuote: string }>({ type: "object", additionalProperties: false, properties: {
        templateName: { type: "string", minLength: 1, maxLength: 120 }, instructionQuote: { type: "string", minLength: 1, maxLength: 1600 },
      }, required: ["templateName", "instructionQuote"] }),
      execute: async input => {
        if (!await allowed()) return fail("blocked", "Vérifiez l’établissement et l’accès commercial actifs.");
        const screen = options.clientContext?.screen, selection = screen?.selection;
        if (!text(input.templateName, 120) || input.templateName !== input.templateName.trim() || !text(input.instructionQuote, 1600) || !explicitTemplateName(input.instructionQuote, input.templateName) || !direct(options.currentUserMessage, input.instructionQuote, "create")) return fail("needs_instruction", "Demandez explicitement de créer ce modèle et donnez son nom.");
        const clause = normalize(input.instructionQuote);
        const selectedKind = selection?.kind === "quote" ? "devis" : selection?.kind === "invoice" ? "facture" : "";
        if (!selectedKind || !new RegExp(`\\b(?:(?:ce|cette) ${selectedKind}|(?:le|la) ${selectedKind} (?:ouvert|ouverte|courant|courante|actuel|actuelle))\\b`).test(clause) || !screen?.availableCommands?.includes("create_document_template") || screen.pathname !== `/dashboard/${selectedKind === "devis" ? "devis" : "factures"}/new`) return fail("needs_details", "Désignez le document actuellement ouvert pour créer le modèle depuis ses champs locaux.");
        const uiCommand = parseInrAssistantDocumentTemplateCommand({ command: "create_document_template", selection, revision: screen.revision, templateName: input.templateName });
        if (!uiCommand || !live()) return fail("blocked", "Le formulaire courant doit être revérifié.");
        return { ok: true, status: "ui_requested", uiCommand, message: "Le navigateur demandera confirmation du nom puis enregistrera le modèle à partir du formulaire exact. Attendez son reçu ; le document lui-même n’est ni sauvegardé ni finalisé." };
      },
    }),
    previewCommercialTemplateAction: tool({ strict: true,
      description: "Aperçu création d’un modèle depuis un document enregistré, ou suppression d’un modèle existant. ID/version/référence exacts lus, nom nouveau explicite pour create ; null pour delete. Aucune écriture avant confirmation IA-….",
      inputSchema: jsonSchema<Preview>({ type: "object", additionalProperties: false, properties: {
        operation: { type: "string", enum: ["create", "delete"] }, kind: { type: "string", enum: ["quote", "invoice"] }, sourceId: { type: "string", format: "uuid" }, expectedUpdatedAt: { type: "string", maxLength: 40 },
        reference: { type: "string", minLength: 1, maxLength: 180 }, templateName: { type: ["string", "null"], maxLength: 120 }, instructionQuote: { type: "string", minLength: 1, maxLength: 1600 },
      }, required: ["operation", "kind", "sourceId", "expectedUpdatedAt", "reference", "templateName", "instructionQuote"] }),
      execute: async input => {
        if (!await allowed()) return fail("blocked", "Accès commercial actif requis.");
        if (!["create", "delete"].includes(input.operation) || !["quote", "invoice"].includes(input.kind) || !uuid.test(input.sourceId) || !text(input.expectedUpdatedAt, 40) || !Number.isFinite(Date.parse(input.expectedUpdatedAt)) || !text(input.reference) || !text(input.instructionQuote, 1600) ||
          !direct(options.currentUserMessage, input.instructionQuote, input.operation) || !named(input.instructionQuote, input.reference) ||
          (input.operation === "create" ? !text(input.templateName, 120) || input.templateName.trim() !== input.templateName || !explicitTemplateName(input.instructionQuote, input.templateName) : input.templateName !== null)) return fail("needs_instruction", "Citez la source exacte et l’opération souhaitée, avec le nom du nouveau modèle pour une création.");
        const document = await read(input.sourceId, input.kind), payload = row(document?.payload);
        if (!document || document.updated_at !== input.expectedUpdatedAt || (input.operation === "delete") !== (payload.isTemplate === true) ||
          ![document.id, ...(input.operation === "delete" ? [document.name, payload.templateName] : [payload.number])].some(value => typeof value === "string" && normalize(value) === normalize(input.reference))) return fail("blocked", "Relisez la source exacte et sa version actuelle.");
        if (options.clientContext?.screen?.selection?.id === input.sourceId && options.clientContext.screen.pendingChanges === true) return fail("blocked", "Le document comporte des modifications locales. Utilisez le formulaire courant ou enregistrez-les explicitement.");
        if (input.operation === "create") {
          try { createCommercialTemplateSnapshot(input.kind, payload, input.templateName!, index => String(index)); }
          catch { return fail("needs_details", "La source doit contenir au moins une prestation valide."); }
        }
        const preview = createAssistantActionPreview({ accountId, actorUserId, kind: "commercial_document", targetId: input.sourceId, fingerprint: assistantActionFingerprint(document),
          patch: { operation: `template_${input.operation}`, kind: input.kind, expectedUpdatedAt: input.expectedUpdatedAt, templateName: input.templateName } });
        return { ok: true, status: "preview_ready", approvalKind: "commercial_document", ...preview,
          proposal: { operation: input.operation, kind: input.kind, sourceId: input.sourceId, sourceReference: input.reference, templateName: input.templateName },
          message: `Vérifiez cet aperçu puis dites « Confirme ${preview.reference} ». Seul le modèle sera ${input.operation === "delete" ? "supprimé" : "créé"} ; aucun document ni envoi ne sera modifié.` };
      },
    }),
    applyCommercialTemplateAction: tool({ strict: true,
      description: "Confirmer un aperçu de création/suppression de modèle IA-… exact. Revalide compte/acteur/source/version. Résultat incertain : relire, sans nouvelle tentative automatique. Aucun document client n’est supprimé.",
      inputSchema: jsonSchema<Apply>({ type: "object", additionalProperties: false, properties: { reference: { type: "string", pattern: "^IA-[A-F0-9]{12}$" }, instructionQuote: { type: "string", minLength: 1, maxLength: 1600 } }, required: ["reference", "instructionQuote"] }),
      execute: async input => {
        if (!/^IA-[A-F0-9]{12}$/.test(input.reference) || !text(input.instructionQuote, 1600)) return fail("needs_instruction", "Confirmez la référence exacte.");
        if (pending.has(input.reference)) return pending.get(input.reference)!;
        const execute = async () => {
          if (!await allowed()) return fail("blocked", "L’accès commercial actif a changé.");
          const message = options.currentApprovalMessage ?? options.currentUserMessage;
          if (!inrAssistantMaskQuotedText(message).includes(input.instructionQuote) || !hasAssistantActionApproval(message, input.instructionQuote, input.reference)) return fail("needs_instruction", "Confirmez explicitement la référence exacte.");
          const approved = verifyAssistantActionPreview(options.resolvePreview?.(input.reference) ?? "", { accountId, actorUserId, kind: "commercial_document" }), patch = row(approved?.patch);
          if (!approved || approved.reference !== input.reference || !["template_create", "template_delete"].includes(String(patch.operation)) || !["quote", "invoice"].includes(String(patch.kind)) || !uuid.test(approved.targetId)) return fail("blocked", "L’aperçu doit être préparé à nouveau.");
          const kind = patch.kind as "quote" | "invoice", document = await read(approved.targetId, kind);
          if (!document || document.updated_at !== patch.expectedUpdatedAt || assistantActionFingerprint(document) !== approved.fingerprint || options.clientContext?.screen?.selection?.id === approved.targetId && options.clientContext.screen.pendingChanges === true) return fail("blocked", "La source a changé. Relisez-la avant de confirmer.");
          if (!await allowed()) return fail("blocked", "Le compte actif a changé.");
          const headers = new Headers({ "content-type": "application/json", "idempotency-key": `assistant_template_${approved.reference}` });
          for (const name of ["cookie", "authorization"]) { const value = request.headers.get(name); if (value) headers.set(name, value); }
          const body = { accountId, kind, sourceId: approved.targetId, expectedUpdatedAt: patch.expectedUpdatedAt,
            ...(patch.operation === "template_create" ? { operation: "create", source: "saved", name: patch.templateName } : { operation: "delete" }) };
          const route = await import("@/app/api/documents/templates/route");
          const response = await route.POST(new Request(new URL("/api/documents/templates", request.url), { method: "POST", headers, signal: request.signal, body: JSON.stringify(body) }));
          const receipt = row(await response.json().catch(() => null)), creating = patch.operation === "template_create";
          if (!response.ok || receipt.ok !== true || receipt.kind !== kind || (creating ? receipt.status !== "created" || receipt.name !== patch.templateName || !uuid.test(String(receipt.id)) : receipt.status !== "deleted" || receipt.id !== approved.targetId || receipt.deleted !== true)) return fail("unknown", "L’opération sur le modèle ne peut pas être confirmée. Relisez les modèles avant toute autre action.");
          return receipt;
        };
        const result = execute().catch(() => fail("unknown", "L’opération sur le modèle ne peut pas être confirmée. Relisez les modèles."));
        pending.set(input.reference, result); return result;
      },
    }),
  };
}
