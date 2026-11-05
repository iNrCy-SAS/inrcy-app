import "server-only";
import { requireUser } from "./requireUser";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { isInrAssistantStatsUiCommandAvailable, isInrAssistantStatsUiCommandText, parseInrAssistantStatsUiCommand } from "./inrAssistantStatsUiCommands.ts";

export async function prepareInrAssistantStatsUiAction(input: { command: string; instructionQuote: string; patch?: Record<string, unknown> | null; documentId?: string | null; documentKind?: string | null; recipient?: string | null }, options: {
  accountId: string; currentUserMessage: string; clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean;
}) {
  if (input.command !== "configure_stats_view") return null;
  const screen = options.clientContext?.screen;
  if (input.documentId != null || input.documentKind != null || input.recipient != null) return { ok: false, status: "needs_details", code: "stats_view_unrelated_target", message: "La sélection d’une vue iNr’Stats ne prend ni document ni destinataire. Laissez documentId, documentKind et recipient à null." };
  if (!screen || !screen.availableCommands?.includes("configure_stats_view") || !isInrAssistantStatsUiCommandAvailable(input.command, screen.pathname, screen.selection?.kind)
    || !parseInrAssistantStatsUiCommand({ command: input.command, selection: screen.selection, revision: screen.revision, patch: { panel: "all" } })) return { ok: false, status: "needs_details", code: "stats_view_context_unavailable", message: "La vue iNr’Stats active et sa révision ne sont pas disponibles. Ouvrez iNr’Stats ou attendez la fin de son chargement avant de sélectionner sa vue." };
  if (!input.patch || typeof input.patch !== "object" || Array.isArray(input.patch)) return { ok: false, status: "needs_details", code: "stats_view_invalid_patch", message: "Précisez au moins un réglage iNr’Stats dans patch : panel, evolutionView, metric ou channel. Pour la vue Évolution, utilisez panel=\"evolution\"." };
  const patch = Object.fromEntries(Object.entries(input.patch || {}).filter(([, value]) => value != null));
  const command = parseInrAssistantStatsUiCommand({ command: input.command, selection: screen?.selection, revision: screen?.revision, patch });
  if (!command) return { ok: false, status: "needs_details", code: "stats_view_invalid_patch", message: "Réglages iNr’Stats invalides : seuls panel (all, evolution ou canal), evolutionView (measured/index), metric (visibility/clicks) et channel (all ou canal Stats) sont acceptés. Laissez les réglages non demandés à null ; aucun changes ni réglage de publication." };
  const text = options.currentUserMessage.replace(/```[\s\S]*?(?:```|$)|`[^`]*`|«[^»]*»|“[^”]*”|"[^"]*"|^>.*$/gm, " ");
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (options.canStartWork?.() === false || !input.instructionQuote?.trim() || !text.includes(input.instructionQuote)
    || !isInrAssistantStatsUiCommandText(normalize(input.instructionQuote)) || !isInrAssistantStatsUiCommandText(normalize(text))) return { ok: false, status: "needs_instruction", message: "Demandez explicitement la vue ou les filtres iNr’Stats à afficher maintenant." };
  const auth = await requireUser();
  if (auth.errorResponse || auth.activeUserId !== options.accountId) return { ok: false, status: "blocked", message: "L’établissement actif doit être vérifié." };
  return { ok: true, status: "ui_action_requested", uiCommand: command, message: "La sélection a été transmise à iNr’Stats. La réussite sera confirmée après application réelle de la vue et des filtres dans l’écran." };
}
