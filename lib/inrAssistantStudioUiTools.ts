import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { requireUser } from "./requireUser";
import { INR_ASSISTANT_STUDIO_UI_COMMANDS, inrAssistantStudioUiCommandAvailable, isInrAssistantStudioUiRequest, parseInrAssistantStudioUiCommand, type InrAssistantStudioUiCommandName } from "./inrAssistantStudioUiCommands.ts";

export async function prepareInrAssistantStudioUiAction(input: { command: string; instructionQuote: string; patch?: Record<string, unknown> | null; documentId?: string | null; documentKind?: string | null }, options: { accountId: string; currentUserMessage: string; supabase?: Pick<SupabaseClient, "from">; clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean }) {
  if (!INR_ASSISTANT_STUDIO_UI_COMMANDS.includes(input.command as InrAssistantStudioUiCommandName)) return null;
  const screen = options.clientContext?.screen, patch = input.patch || {}, fields: Record<string, unknown> = {};
  if (input.documentId || input.documentKind || Object.entries(patch).some(([key, value]) => value != null && !(input.command === "select_image_source" ? ["mediaId"] : input.command === "configure_image_retouch" || input.command === "configure_media_library" ? ["changes"] : []).includes(key))) return { ok: false, status: "needs_details", message: "Les paramètres ne correspondent pas à cette action image." };
  if (input.command === "configure_image_retouch" || input.command === "configure_media_library") {
    if (!Array.isArray(patch.changes) || !patch.changes.length || patch.changes.length > 8) return { ok: false, status: "needs_details", message: "Précisez les réglages image à modifier." };
    for (const value of patch.changes) { const change = value as Record<string, unknown>; if (!change || typeof change !== "object" || Object.keys(change).length !== 2 || typeof change.field !== "string" || Object.hasOwn(fields, change.field) || typeof change.valueJson !== "string" || change.valueJson.length > 18000) return { ok: false, status: "needs_details", message: "Réglages image invalides." }; try { fields[change.field] = JSON.parse(change.valueJson); } catch { return { ok: false, status: "needs_details", message: "Valeur image invalide." }; } }
  }
  const command = parseInrAssistantStudioUiCommand({ command: input.command, selection: screen?.selection, revision: screen?.revision, ...(input.command === "select_image_source" ? { mediaId: patch.mediaId } : input.command === "configure_image_retouch" || input.command === "configure_media_library" ? { patch: fields } : {}) });
  if (!command || !screen?.availableCommands?.includes(command.command) || !inrAssistantStudioUiCommandAvailable(command.command, screen.pathname, screen.selection?.kind)) return { ok: false, status: "needs_details", message: input.command === "configure_media_library" ? "Ouvrez la médiathèque dans iNrCy. L’action exige cette bibliothèque et sa révision courante." : "Ouvrez la retouche image dans iNr’Studio. L’action exige cet éditeur et sa révision courante." };
  if (options.canStartWork?.() === false || !input.instructionQuote?.trim() || !options.currentUserMessage.includes(input.instructionQuote) || !isInrAssistantStudioUiRequest(input.instructionQuote, input.command) || !isInrAssistantStudioUiRequest(options.currentUserMessage, input.command)) return { ok: false, status: "needs_instruction", message: "Demandez explicitement cette action image." };
  const auth = await requireUser(); if (auth.errorResponse || auth.activeUserId !== options.accountId) return { ok: false, status: "blocked", message: "Le compte actif doit être vérifié." };
  if (command.command === "select_image_source") {
    if (!options.supabase) return { ok: false, status: "unavailable", message: "L’image doit être vérifiée." };
    const { data, error } = await options.supabase.from("pro_media_library").select("id,user_id,media_type,is_active,upload_status,source").eq("user_id", options.accountId).eq("id", command.mediaId).maybeSingle();
    if (error || !data || data.id !== command.mediaId || data.user_id !== options.accountId || data.media_type !== "image" || data.is_active === false || data.upload_status !== "uploaded" || data.source === "ai_media_generation_draft") return { ok: false, status: "not_found", message: "Cette image prête à l’emploi n’est pas accessible dans le compte actif." };
  }
  return { ok: true, status: "ui_action_requested", uiCommand: command, message: command.command === "configure_media_library" ? "Réglage de la médiathèque demandé ; attendre la confirmation du navigateur." : command.command === "save_image_retouch" ? "Enregistrement natif d’une copie demandé ; le reçu de la nouvelle image sera vérifié." : "Réglage demandé au retoucheur image courant ; attendre sa confirmation." };
}
