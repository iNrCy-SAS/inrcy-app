import "server-only";
import { requireUser } from "./requireUser";
import { matchesInrAssistantActionClause } from "./inrAssistantActionClause.ts";
import { isInrAssistantBusinessFormUiCommandAvailable, isInrAssistantBusinessFormUiRequest, parseInrAssistantBusinessFormUiCommand } from "./inrAssistantBusinessFormUiCommands.ts";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";

export async function prepareInrAssistantBusinessFormUiAction(input: { command: string; instructionQuote: string; patch?: Record<string, unknown> | null; documentId?: string | null; documentKind?: string | null; recipient?: string | null }, options: {
  accountId: string; actorUserId?: string; currentUserMessage: string; clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean;
}) {
  if (input.command !== "configure_business_form") return null;
  const screen = options.clientContext?.screen, patch = Object.fromEntries(Object.entries(input.patch || {}).filter(([, value]) => value != null));
  const command = parseInrAssistantBusinessFormUiCommand({ command: input.command, selection: screen?.selection, revision: screen?.revision, patch });
  if (!command || input.documentId != null || input.documentKind != null || input.recipient != null || !screen?.availableCommands?.includes("configure_business_form")
    || !isInrAssistantBusinessFormUiCommandAvailable(command.command, screen.pathname, screen.selection?.kind)) return { ok: false, status: "needs_details", message: "Ouvrez le formulaire exact et attendez son chargement avant de demander cette action locale." };
  if (command.patch.businessFormAction === "open_persistent_reset" && command.patch.businessFormTab !== "all" && screen.step !== command.patch.businessFormTab) return { ok: false, status: "needs_details", message: "Affichez d’abord l’onglet ADN exact à réinitialiser. La confirmation ne doit jamais viser un autre onglet que celui affiché." };
  if (options.canStartWork?.() === false || !matchesInrAssistantActionClause(options.currentUserMessage, input.instructionQuote, (message, quote) =>
    isInrAssistantBusinessFormUiRequest(message, command.patch, command.selection.id, screen.step) && isInrAssistantBusinessFormUiRequest(quote, command.patch, command.selection.id, screen.step))) return { ok: false, status: "needs_instruction", message: "Demandez explicitement l’onglet, la réinitialisation ou l’abandon des saisies de ce formulaire. Aucun autre outil ne sera modifié." };
  const auth = await requireUser();
  if (auth.errorResponse || auth.activeUserId !== options.accountId || options.actorUserId && auth.authUserId !== options.actorUserId || options.canStartWork?.() === false) return { ok: false, status: "blocked", message: "Le compte actif doit être vérifié." };
  return { ok: true, status: "ui_action_requested", uiCommand: command, ...(command.patch.businessFormAction === "open_persistent_reset" ? { confirmationRequired: true } : {}),
    message: command.patch.businessFormAction === "open_persistent_reset" ? "Ouverture de la confirmation native définitive demandée. Aucune donnée ni aucun fichier ADN n’est supprimé par cette commande. Le professionnel décide dans le dialogue ; le résultat devra être relu après le retour de l’écran."
      : "Action transmise au formulaire natif. Sa confirmation éventuelle reste personnelle et le résultat attend le rendu vérifié du navigateur ; aucune sauvegarde n’est présumée." };
}
