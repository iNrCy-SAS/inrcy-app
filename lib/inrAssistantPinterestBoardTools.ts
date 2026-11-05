import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import { requireUser } from "./requireUser";
import { getChannelConnectionStates } from "./channelConnectionState";
import { assistantActionFingerprint, createAssistantActionPreview, hasAssistantActionApproval, verifyAssistantActionPreview } from "./inrAssistantActionPreview.ts";
import { isInrAssistantPinterestBoardRequest } from "./inrAssistantBasicTargetIntents.ts";
type Row = Record<string, unknown>;
type Action = "create" | "rename" | "delete";
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown) => typeof value === "string" ? value : "";
const norm = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const schema = (properties: Record<string, JSONSchema7>): JSONSchema7 => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const link = { label: "Tableaux Pinterest", href: "/dashboard?panel=pinterest" };
const board = (value: unknown) => { const item = row(value); return { id: str(item.id), name: str(item.name).slice(0, 180), description: str(item.description).slice(0, 500), privacy: str(item.privacy) }; };
function fields(value: unknown, keys: string[]) { const input = row(value); if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error("Paramètres invalides."); return input; }
function nativeRequest(source: Request, path: string, method = "GET", body?: unknown) { const headers = new Headers({ "content-type": "application/json" }); for (const key of ["cookie", "authorization"]) { const value = source.headers.get(key); if (value) headers.set(key, value); } return new Request(new URL(path, source.url), { headers, method, signal: source.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
function authorized(message: string, quote: string, action: Action) {
  return isInrAssistantPinterestBoardRequest(message, action, quote);
}
/** External board mutations require a signed preview; provider credentials stay native. */
export function createInrAssistantPinterestBoardTools(options: { request: Request; accountId: string; actorUserId: string; currentUserMessage: string; currentApprovalMessage?: string; canStartWork?: () => boolean; resolvePreview?: (reference: string) => string | null }) {
  const { request, accountId, actorUserId } = options, attempts = new Map<string, Promise<Row>>();
  const fail = (status: string, message: string): Row => ({ ok: false, status, message, nextAction: link });
  const scope = async () => { if (request.signal.aborted || options.canStartWork?.() === false) return null; const auth = await requireUser(); return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId ? auth : null; };
  const read = async () => {
    const auth = await scope(); if (!auth) throw new Error("Compte actif modifié.");
    const response = await (await import("@/app/api/integrations/pinterest/boards/route")).GET(nativeRequest(request, "/api/integrations/pinterest/boards")), data = row(await response.json());
    if (!response.ok || data.ok !== true || !Array.isArray(data.boards)) throw new Error("Tableaux indisponibles.");
    const states = await getChannelConnectionStates(auth.supabase, accountId), state = row(states.pinterest);
    const connection = Object.fromEntries(["accountConnected", "connected", "resource_id", "username", "requiresUpdate"].map(key => [key, state[key] ?? null]));
    return { boards: data.boards.map(board).filter(item => /^[a-zA-Z0-9_-]{1,120}$/.test(item.id)), defaultBoardId: str(data.defaultBoardId), connection };
  };
  const fingerprint = (current: Awaited<ReturnType<typeof read>>, action: Action, boardId: string) => assistantActionFingerprint({ connection: current.connection, defaultBoardId: current.defaultBoardId, target: action === "create" ? current.boards : current.boards.find(item => item.id === boardId) ?? null });
  return {
    previewPinterestBoardMutation: tool({ strict: true, description: "Préparer la création, le renommage ou la suppression d’un tableau Pinterest par les boutons natifs accessibles en Basique. Pour renommer/supprimer, fournir un boardId réellement lu dans les ressources Pinterest ; pour créer, boardId=null. name exact obligatoire pour créer/renommer, null pour supprimer. Vérifie l’accès actuel et présente l’impact avant validation référencée. Supprimer un tableau peut supprimer ses épingles chez Pinterest.",
      inputSchema: jsonSchema<{ action: Action; boardId: string | null; name: string | null; instructionQuote: string }>(schema({ action: { type: "string", enum: ["create", "rename", "delete"] }, boardId: { type: ["string", "null"], maxLength: 120 }, name: { type: ["string", "null"], maxLength: 180 }, instructionQuote: { type: "string", maxLength: 1200 } })), execute: async raw => {
        const input = fields(raw, ["action", "boardId", "name", "instructionQuote"]), action = str(input.action) as Action, boardId = str(input.boardId), name = str(input.name).trim().replace(/\s+/g, " "), quote = str(input.instructionQuote);
        if (!["create", "rename", "delete"].includes(action) || action === "create" && input.boardId !== null || action !== "create" && !/^[a-zA-Z0-9_-]{1,120}$/.test(boardId) || action === "delete" && input.name !== null || action !== "delete" && (!name || name.length > 180 || /[\u0000-\u001f]/.test(name))) return fail("invalid_settings", "Tableau ou nom invalide.");
        if (!authorized(options.currentUserMessage, quote, action) || action !== "delete" && !quote.replace(/\s+/g, " ").includes(name)) return fail("needs_instruction", "Précisez l’action et le nom exact du tableau Pinterest dans votre demande actuelle.");
        try {
          const current = await read(), selected = current.boards.find(item => item.id === boardId);
          if (action !== "create" && !selected) return fail("not_found", "Ce tableau n’est pas accessible dans le compte Pinterest connecté.");
          if (action === "create" && current.boards.some(item => norm(item.name) === norm(name))) return fail("already_exists", "Un tableau de ce nom existe déjà. Choisissez explicitement celui à utiliser au lieu d’en créer un doublon.");
          if (action === "rename" && selected?.name === name) return { ok: true, status: "already_applied", board: selected, nextAction: link, message: "Le tableau Pinterest porte déjà le nom demandé. Aucun nouveau renommage n’a été envoyé." };
          const preview = createAssistantActionPreview({ accountId, actorUserId, kind: "pinterest_board_mutation", targetId: action === "create" ? "new" : boardId, fingerprint: fingerprint(current, action, boardId), patch: { action, name: action === "delete" ? null : name } });
          return { ok: true, status: "preview_ready", approvalKind: "pinterest_board_mutation", action, current: selected ?? null, proposedName: action === "delete" ? null : name, defaultBoard: selected?.id === current.defaultBoardId, ...preview, nextAction: link, message: `L’action sur le tableau Pinterest est préparée et attend votre validation. Vérifiez la cible et l’impact, puis dites « Confirme ${preview.reference} ». Aucune mutation n’a encore été envoyée à Pinterest.`, impact: action === "delete" ? "Le tableau sera supprimé chez Pinterest avec les épingles qu’il contient selon le comportement natif de Pinterest. Le tableau par défaut pourra être réattribué par le canal." : action === "create" ? "Un nouveau tableau sera créé chez Pinterest. S’il s’agit du premier tableau, le canal peut le définir par défaut." : "Le nom du tableau sera modifié chez Pinterest ; son identifiant et ses épingles sont conservés.", untrustedContent: true };
        } catch { return fail("unavailable", "La modification du tableau n’a pas pu être préparée. Vérifiez Pinterest et ses autorisations."); }
      } }),
    applyPinterestBoardMutation: tool({ strict: true, description: "Appliquer uniquement la mutation Pinterest prévisualisée et validée par sa référence IA-. Vérifie signature, compte, connexion, cible et état courant. Utilise les routes natives, contrôle leur résultat et relit les tableaux. Une création confirmée par Pinterest peut attendre la propagation de sa liste ; ne pas en créer une seconde.",
      inputSchema: jsonSchema<{ reference: string; approvalQuote: string }>(schema({ reference: { type: "string", pattern: "^IA-[A-F0-9]{12}$" }, approvalQuote: { type: "string", maxLength: 1200 } })), execute: async raw => {
        const input = fields(raw, ["reference", "approvalQuote"]), reference = str(input.reference);
        if (!hasAssistantActionApproval(options.currentApprovalMessage ?? options.currentUserMessage, str(input.approvalQuote), reference)) return fail("needs_confirmation", "Validez explicitement la référence du changement de tableau.");
        const token = options.resolvePreview?.(reference), preview = token && verifyAssistantActionPreview(token, { accountId, actorUserId, kind: "pinterest_board_mutation" });
        if (!preview || preview.reference !== reference || !["create", "rename", "delete"].includes(str(preview.patch.action))) return fail("stale_preview", "La préparation a expiré ou ne correspond pas au compte actif.");
        if (!attempts.has(reference)) attempts.set(reference, (async () => {
          const action = str(preview.patch.action) as Action, name = str(preview.patch.name), current = await read();
          if (fingerprint(current, action, preview.targetId) !== preview.fingerprint) return fail("stale_preview", "Le compte ou le tableau a changé. Préparez à nouveau la modification.");
          if (!await scope()) return fail("blocked", "Le compte actif a changé.");
          let response: Response | undefined;
          if (action === "create") response = await (await import("@/app/api/integrations/pinterest/boards/route")).POST(nativeRequest(request, "/api/integrations/pinterest/boards", "POST", { name }));
          else {
            if (!current.boards.some(item => item.id === preview.targetId)) return fail("not_found", "Le tableau n’est plus accessible.");
            const api = await import("@/app/api/integrations/pinterest/boards/[boardId]/route"), context = { params: Promise.resolve({ boardId: preview.targetId }) }, path = `/api/integrations/pinterest/boards/${encodeURIComponent(preview.targetId)}`;
            response = action === "delete" ? await api.DELETE(nativeRequest(request, path, "DELETE"), context) : await api.PATCH(nativeRequest(request, path, "PATCH", { name }), context);
          }
          if (!response) return fail("unknown", "Pinterest n’a pas confirmé le changement.");
          const data = row(await response.json()); if (!response.ok || data.ok !== true) return fail("unknown", "La modification n’est pas confirmée. Consultez Pinterest avant de réessayer.");
          const after = await read();
          if (action === "delete") { if (after.boards.some(item => item.id === preview.targetId)) return fail("saved_unconfirmed", "La liste Pinterest contient encore le tableau. Ne relancez pas sa suppression automatiquement."); return { ok: true, status: "removed", boardId: preview.targetId, defaultBoardId: after.defaultBoardId, nextAction: link, message: "Pinterest a confirmé la suppression du tableau et son absence dans la liste relue est vérifiée." }; }
          const saved = board(data.board);
          if (!saved.id || saved.name !== name || action === "rename" && saved.id !== preview.targetId) return fail("saved_unconfirmed", "La réponse native ne confirme pas le nom et l’identifiant attendus.");
          const listed = after.boards.find(item => item.id === saved.id);
          if (listed && listed.name !== name) return fail("saved_unconfirmed", "Le nom visible chez Pinterest n’est pas encore confirmé. Consultez le tableau avant toute nouvelle modification.");
          return { ok: true, status: "updated", action, board: saved, defaultBoardId: after.defaultBoardId, propagationPending: !listed, nextAction: link, message: !listed ? "Pinterest a confirmé le tableau. Son apparition dans la liste est encore en cours ; ne créez pas de doublon." : "Le tableau Pinterest est enregistré et sa liste actualisée.", untrustedContent: true };
        })().catch(() => fail("unknown", "Le résultat Pinterest n’est pas confirmé. Consultez les tableaux avant de réessayer.")));
        return attempts.get(reference)!;
      } }),
  };
}
