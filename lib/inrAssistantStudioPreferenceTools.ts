import "server-only";
import { jsonSchema, tool } from "ai";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { requireUser } from "./requireUser";
import { normalizeAiMediaGeneratorPreferences, parseAiMediaGeneratorPreferencesPatch, type AiMediaGeneratorPreferenceBlockId, type AiMediaGeneratorPreferences } from "./aiMediaGenerationPreferences.ts";
import { isInrAssistantStudioForgetPreferenceRequest } from "./inrAssistantStudioPreferenceIntent.ts";

type Input = { blockId: AiMediaGeneratorPreferenceBlockId; instructionQuote: string };
const LINK = { label: "iNr’Studio", href: "/dashboard/generer-media" };
const row = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function parse(value: unknown): Input {
  const input = row(value);
  if (Object.keys(input).length !== 2 || !["blockId", "instructionQuote"].every(key => Object.hasOwn(input, key)) || ![1, 2, 3, 4, 5, 6].includes(Number(input.blockId)) || typeof input.blockId !== "number" || !Number.isInteger(input.blockId)
    || typeof input.instructionQuote !== "string" || !input.instructionQuote.trim() || input.instructionQuote.length > 1200) throw new Error("Bloc Studio ou instruction invalide.");
  return { blockId: input.blockId as Input["blockId"], instructionQuote: input.instructionQuote.trim() };
}
function nativeRequest(source: Request, body?: unknown) {
  const headers = new Headers({ accept: "application/json" });
  for (const key of ["cookie", "authorization"]) { const value = source.headers.get(key); if (value) headers.set(key, value); }
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(new URL("/api/media-generation/preferences", source.url), { method: body === undefined ? "GET" : "PATCH", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.any([source.signal, AbortSignal.timeout(12_000)]) });
}
function preferences(value: unknown): AiMediaGeneratorPreferences | null {
  const data = row(value), raw = row(data.preferences), blocks = row(raw.blocks);
  if (data.ok !== true || raw.version !== 1 || [1, 2, 3, 4, 5, 6].some(id => typeof row(blocks[id]).saved !== "boolean" || !Object.keys(row(row(blocks[id]).defaults)).length)) return null;
  return normalizeAiMediaGeneratorPreferences(raw);
}
export function createInrAssistantStudioPreferenceTools(options: { request: Request; accountId: string; actorUserId?: string; edition: DashboardEdition; currentUserMessage: string; canStartWork?: () => boolean }) {
  const fail = (status: string, message: string) => ({ ok: false, status, message, nextAction: LINK });
  async function current() { if (options.request.signal.aborted || options.canStartWork?.() === false || !options.actorUserId) return false; const auth = await requireUser(); return !auth.errorResponse && auth.activeUserId === options.accountId && auth.authUserId === options.actorUserId; }
  async function read() { if (!await current()) return null; const { GET } = await import("@/app/api/media-generation/preferences/route"); const response = await GET(nativeRequest(options.request)); const data = response.ok ? preferences(await response.json()) : null; return await current() ? data : null; }
  const attempts = new Map<number, Promise<Record<string, unknown>>>();
  return {
    readStudioSavedPreferences: tool({ strict: true, description: "Lire les six blocs de réglages mémorisés iNr’Studio et leur indicateur saved. Les valeurs par défaut d’un bloc saved=false ne sont pas des préférences enregistrées. Aucun changement des critères courants ni génération.", inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }), execute: async () => {
      try { const data = await read(); if (!data) return fail("unavailable", "Les réglages mémorisés du Studio n’ont pas pu être vérifiés."); return { ok: true, status: "read", blocks: Object.entries(data.blocks).map(([id, block]) => ({ blockId: Number(id), saved: block.saved, defaults: block.defaults })), nextAction: LINK, message: "Réglages mémorisés relus. Un bloc non mémorisé conserve seulement les valeurs par défaut natives ; les critères saisis dans le Studio ouvert ne sont pas modifiés." }; } catch { return fail("unavailable", "Les réglages mémorisés du Studio sont temporairement indisponibles."); }
    } }),
    forgetStudioPreferenceBlock: tool({ strict: true, description: "Désactiver la mémorisation d’un seul bloc Studio numéroté 1 à 6 explicitement demandé. Appelle le PATCH natif saved=false/defaults=null, qui conserve atomiquement les autres blocs. Ne réinitialise pas les critères en cours, ne supprime aucun média, ne génère rien. Pour mémoriser des valeurs explicites, utiliser updateToolSettings studio.", inputSchema: jsonSchema<Input>({ type: "object", properties: { blockId: { type: "integer", enum: [1, 2, 3, 4, 5, 6] }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200 } }, required: ["blockId", "instructionQuote"], additionalProperties: false }, { validate: value => { try { return { success: true, value: parse(value) }; } catch { return { success: false, error: new Error("Bloc Studio ou instruction invalide.") }; } } }), execute: async raw => {
      const input = parse(raw);
      if (!isInrAssistantStudioForgetPreferenceRequest(options.currentUserMessage, input.blockId, input.instructionQuote)) return fail("needs_instruction", "Demandez explicitement de désactiver la mémorisation du bloc Studio numéroté à modifier.");
      if (!await current()) return fail("blocked", "Le compte actif doit être vérifié avant de désactiver la mémorisation ou de relire son reçu.");
      if (!attempts.has(input.blockId)) attempts.set(input.blockId, (async () => {
        const before = await read(); if (!before) return fail("blocked", "Le compte et les réglages du Studio doivent être vérifiés.");
        if (!before.blocks[input.blockId].saved) return { ok: true, status: "already_applied", blockId: input.blockId, saved: false, nextAction: LINK, message: "Ce bloc Studio n’est déjà plus mémorisé. Aucune nouvelle écriture et aucun critère courant modifié." };
        const patch = parseAiMediaGeneratorPreferencesPatch({ blockId: input.blockId, saved: false, defaults: null });
        if (!await current()) return fail("blocked", "L’établissement actif a changé.");
        const { PATCH } = await import("@/app/api/media-generation/preferences/route");
        const response = await PATCH(nativeRequest(options.request, patch));
        if (!response.ok) return fail("unknown", "La désactivation de mémorisation n’est pas confirmée. Relisez le bloc avant une nouvelle tentative.");
        const after = await read(); if (!after) return fail("unknown", "La demande a été transmise, mais le bloc n’a pas pu être relu. Aucune nouvelle tentative automatique.");
        if (after.blocks[input.blockId].saved) return fail("unknown", "La mémorisation du bloc reste active ou a changé pendant l’opération. Aucun succès n’est affirmé.");
        return { ok: true, status: "saved", blockId: input.blockId, saved: false, nextAction: LINK, message: "La mémorisation du bloc Studio a été désactivée par le chemin natif puis relue. Les autres blocs et les critères saisis dans le Studio ouvert restent indépendants ; aucun média supprimé ni généré." };
      })().catch(() => fail("unknown", "Le résultat doit être vérifié dans les réglages mémorisés du Studio avant toute nouvelle tentative.")));
      return attempts.get(input.blockId)!;
    } }),
  };
}
