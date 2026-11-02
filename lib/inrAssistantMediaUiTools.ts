import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "./requireUser";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { isInrAssistantMediaUiCommandAvailable, isInrAssistantMediaUiCommandName, parseInrAssistantMediaUiCommand } from "./inrAssistantMediaUiCommands.ts";

export async function prepareInrAssistantMediaUiAction(input: { command: string; instructionQuote: string; patch?: Record<string, unknown> | null; documentId?: string | null; documentKind?: string | null }, options: {
  accountId: string; currentUserMessage: string; supabase?: Pick<SupabaseClient, "from">;
  clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean;
  isRequest: (text: string, command: "select_video_source" | "save_video_retouch" | "optimize_media") => boolean;
}) {
  if (!isInrAssistantMediaUiCommandName(input.command)) return null;
  const screen = options.clientContext?.screen, patch = input.patch || {};
  const allowed = input.command === "select_video_source" ? ["mediaId"] : input.command === "optimize_media" ? ["targetBytes"] : [];
  if (input.documentId || input.documentKind || Object.entries(patch).some(([key, value]) => value != null && !allowed.includes(key))) return { ok: false, status: "needs_details", message: "Les paramètres ne correspondent pas à cette action média." };
  const command = parseInrAssistantMediaUiCommand({ command: input.command, selection: screen?.selection, revision: screen?.revision,
    ...(patch.mediaId != null ? { mediaId: patch.mediaId } : {}), ...(patch.targetBytes != null ? { targetBytes: patch.targetBytes } : {}) });
  if (!command || !screen?.availableCommands?.includes(command.command) || !isInrAssistantMediaUiCommandAvailable(command.command, screen.pathname, screen.selection?.kind)) return { ok: false, status: "needs_details", message: "Ouvrez le retoucheur vidéo ou le média à optimiser. L’action nécessite cet écran exact et sa révision courante." };
  if (options.canStartWork?.() === false || !input.instructionQuote?.trim() || !options.currentUserMessage.includes(input.instructionQuote)
    || !options.isRequest(input.instructionQuote, input.command) || !options.isRequest(options.currentUserMessage, input.command)) return { ok: false, status: "needs_instruction", message: "Demandez explicitement cette action média. Aucun fichier n’a été modifié." };
  const auth = await requireUser();
  if (auth.errorResponse || auth.activeUserId !== options.accountId) return { ok: false, status: "blocked", message: "Le compte actif doit être vérifié." };
  if (command.command !== "save_video_retouch") {
    if (!options.supabase) return { ok: false, status: "unavailable", message: "Le média doit être vérifié dans le compte actif." };
    const mediaId = command.command === "select_video_source" ? command.mediaId : command.selection.id;
    const { data, error } = await options.supabase.from("pro_media_library").select("id,user_id,media_type,is_active,upload_status,source").eq("user_id", options.accountId).eq("id", mediaId).maybeSingle();
    if (error || !data || data.id !== mediaId || data.user_id !== options.accountId || data.is_active === false || data.upload_status !== "uploaded"
      || data.source === "ai_media_generation_draft" || !(command.command === "select_video_source" ? data.media_type === "video" : ["image", "video"].includes(data.media_type))) return { ok: false, status: "not_found", message: "Ce média prêt à l’emploi n’est pas accessible dans le compte actif." };
  }
  return { ok: true, status: "ui_action_requested", uiCommand: command, message: command.command === "select_video_source"
    ? "Sélection de la vidéo vérifiée demandée au retoucheur ouvert. Les autres réglages restent conservés."
    : command.command === "save_video_retouch" ? "Enregistrement d’une copie de la retouche demandé. Le navigateur vérifiera le nouvel élément natif avant de signaler la réussite ; l’original reste conservé."
    : "Optimisation native demandée pour ce média. Une copie distincte sera vérifiée ; l’original restera conservé." };
}
