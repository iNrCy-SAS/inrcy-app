import "server-only";
import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { requireUser } from "./requireUser";
import { getDashboardEditionForAccountId } from "./dashboardEditionServer";
import { getActiveSubscriptionAccountIds } from "./accountSubscriptionAccess";
import { matchesInrAssistantActionClause, inrAssistantMaskQuotedText } from "./inrAssistantActionClause.ts";
import { getInrAssistantDocumentPrefillNavigation, parseInrAssistantDocumentPrefill, type InrAssistantDocumentPrefill } from "./inrAssistantDocumentUiCommands.ts";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const row = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").replace(/’/g, "'").toLowerCase();
type FormInput = InrAssistantDocumentPrefill & { reference: string; instructionQuote: string };
export function createInrAssistantDocumentFormTools(options: {
  request: Request; accountId: string; actorUserId: string; supabase: Pick<SupabaseClient, "from">;
  edition: DashboardEdition; currentUserMessage: string; clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean;
}) {
  const live = () => !options.request.signal.aborted && options.canStartWork?.() !== false;
  const allowed = async () => {
    if (!live() || options.edition !== "founder") return false;
    const auth = await requireUser();
    return !auth.errorResponse && auth.activeUserId === options.accountId && auth.authUserId === options.actorUserId &&
      await getDashboardEditionForAccountId(options.accountId) === "founder" && (await getActiveSubscriptionAccountIds([options.accountId])).has(options.accountId);
  };
  const fail = (status: string, message: string) => ({ ok: false, status, message });
  return {
    readCommercialTemplates: tool({ strict: true,
      description: "Lire les modèles réutilisables de devis ou factures du compte. 8 par page ; offset suivant exact. Renvoie IDs et versions réels pour apply_template. Ne crée/modifie/supprime aucun modèle.",
      inputSchema: jsonSchema<{ kind: "quote" | "invoice"; query: string | null; offset: number }>({ type: "object", additionalProperties: false,
        properties: { kind: { type: "string", enum: ["quote", "invoice"] }, query: { type: ["string", "null"], maxLength: 100 }, offset: { type: "integer", minimum: 0, maximum: 200 } }, required: ["kind", "query", "offset"] }),
      execute: async input => {
        if (!await allowed()) return fail("blocked", "L’accès actif à la gestion commerciale doit être vérifié.");
        if (!["quote", "invoice"].includes(input.kind) || !Number.isInteger(input.offset) || input.offset < 0 || input.offset > 200 || input.query !== null && (typeof input.query !== "string" || input.query.length > 100)) return fail("needs_details", "Choisissez le type de modèle et une page bornée.");
        let query = options.supabase.from("doc_saves").select("id,user_id,type,name,updated_at,payload").eq("user_id", options.accountId)
          .eq("type", input.kind === "quote" ? "devis" : "facture").eq("payload->>isTemplate", "true");
        if (input.query?.trim()) query = query.ilike("name", `%${input.query.trim().replace(/[\\%_]/g, "\\$&")}%`);
        const { data, error } = await query.order("updated_at", { ascending: false }).order("id", { ascending: true }).range(input.offset, input.offset + 8);
        if (error || !live()) return fail("unavailable", "Les modèles ne peuvent pas être confirmés.");
        const rows = (data ?? []).filter(item => item.user_id === options.accountId && item.type === (input.kind === "quote" ? "devis" : "facture") && row(item.payload).isTemplate === true);
        return { ok: true, status: "read", kind: input.kind, items: rows.slice(0, 8).map(item => ({ id: item.id, updatedAt: item.updated_at,
          name: text(item.name), templateName: text(row(item.payload).templateName),
          lineCount: Array.isArray(row(item.payload).lines) ? (row(item.payload).lines as unknown[]).length : 0,
        })), nextOffset: rows.length > 8 && input.offset + 8 <= 200 ? input.offset + 8 : null, truncated: rows.length > 8 && input.offset + 8 > 200,
          message: "Modèles enregistrés uniquement. Leur application préremplit un formulaire ; elle ne crée pas de document sauvegardé." };
      },
    }),
    prepareCommercialDocumentForm: tool({ strict: true,
      description: "Préremplir le formulaire natif : convert_quote transforme un devis enregistré en brouillon de facture (kind invoice) ; apply_template applique un modèle lu avec readCommercialTemplates. ID/version/référence exacts. Sauvegarde, finalisation et envoi restent séparés. Attendre l’hydratation acquittée du navigateur.",
      inputSchema: jsonSchema<FormInput>({ type: "object", additionalProperties: false, properties: {
        operation: { type: "string", enum: ["convert_quote", "apply_template"] }, kind: { type: "string", enum: ["quote", "invoice"] },
        sourceId: { type: "string", format: "uuid" }, expectedUpdatedAt: { type: "string", maxLength: 40 },
        reference: { type: "string", minLength: 1, maxLength: 180 }, instructionQuote: { type: "string", minLength: 1, maxLength: 1600 },
      }, required: ["operation", "kind", "sourceId", "expectedUpdatedAt", "reference", "instructionQuote"] }),
      execute: async input => {
        if (!await allowed()) return fail("blocked", "L’accès actif à la gestion commerciale doit être vérifié.");
        const source = parseInrAssistantDocumentPrefill(input);
        if (!source || !text(input.reference) || input.reference.length > 180 || !text(input.instructionQuote) || input.instructionQuote.length > 1600) return fail("needs_details", "Relisez la source et sa version exacte.");
        const direct = matchesInrAssistantActionClause(options.currentUserMessage, input.instructionQuote, (message, quote) => [message, quote].every(value => {
          const intent = normalize(inrAssistantMaskQuotedText(value));
          if (/\b(?:comment|pourquoi|explique\w*|imagine|si|quand|lorsque|demain|later|tomorrow|if|when|why|how)\b|\b(?:ne|pas|jamais|sans|not|never)\b|\bn'|\bapres.{0,35}(?:confirmation|accord)\b/.test(intent)) return false;
          return source.operation === "convert_quote" ? /\b(?:converti\w*|transforme\w*|convert|transform)\b/.test(intent) && /\b(?:devis|quote)\b/.test(intent) && /\b(?:facture|invoice)\b/.test(intent)
            : /\b(?:appliqu\w*|utilis\w*|charg\w*|prerempli\w*|apply|use)\b/.test(intent) && /\b(?:modele|template)\b/.test(intent);
        }));
        if (!direct) return fail("needs_instruction", "Demandez explicitement cette conversion ou l’application du modèle. Rien n’a été modifié.");
        const kind = source.operation === "convert_quote" || source.kind === "quote" ? "devis" : "facture";
        const { data, error } = await options.supabase.from("doc_saves").select("id,user_id,type,name,payload,updated_at").eq("user_id", options.accountId).eq("type", kind).eq("id", source.sourceId).maybeSingle();
        const payload = row(data?.payload);
        if (error || !data || data.id !== source.sourceId || data.user_id !== options.accountId || data.type !== kind || data.updated_at !== source.expectedUpdatedAt ||
          (source.operation === "apply_template" ? payload.isTemplate !== true : payload.isTemplate === true)) return fail("blocked", "Cette source a changé ou n’est pas accessible. Relisez-la.");
        const reference = normalize(input.reference);
        const acceptedReferences = source.operation === "apply_template" ? [data.id, data.name, payload.templateName] : [data.id, payload.number];
        const named = new RegExp(`(?:^|[^a-z0-9])${reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(normalize(input.instructionQuote));
        if (!acceptedReferences.some(value => text(value) && normalize(text(value)) === reference) || !named) return fail("needs_details", "Citez le nom ou numéro exact de la source lue.");
        if (source.operation === "convert_quote" && options.clientContext?.screen?.selection?.id === source.sourceId && options.clientContext.screen.pendingChanges === true) return fail("blocked", "Sauvegardez d’abord les modifications locales du devis à convertir.");
        if (!live()) return fail("blocked", "Le préremplissage a été interrompu.");
        const navigation = getInrAssistantDocumentPrefillNavigation(source)!;
        return { ok: true, status: "navigation_requested", navigation, nextAction: { href: navigation.href, label: navigation.label },
          message: "Préremplissage demandé au formulaire natif. Le navigateur protège les saisies et doit confirmer l’hydratation ; aucune sauvegarde, finalisation ou envoi n’est lancé." };
      },
    }),
  };
}
