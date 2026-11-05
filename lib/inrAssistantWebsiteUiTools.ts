import "server-only";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { requireUser } from "./requireUser";
import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";
import { INR_ASSISTANT_WEBSITE_UI_COMMANDS, inrAssistantWebsiteUiCommandAvailable, isInrAssistantWebsiteUiRequest, parseInrAssistantWebsiteUiCommand } from "./inrAssistantWebsiteUiCommands.ts";
export async function prepareInrAssistantWebsiteUiAction(input: { command: string; instructionQuote: string; patch?: Record<string, unknown> | null; documentId?: string | null; documentKind?: string | null }, options: { accountId: string; currentUserMessage: string; clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean }) {
  if (!INR_ASSISTANT_WEBSITE_UI_COMMANDS.includes(input.command as never)) return null;
  const screen = options.clientContext?.screen, patch = input.patch ?? {};
  if (input.documentId || input.documentKind || Object.entries(patch).some(([key, value]) => value != null && key !== "format")) return { ok: false, status: "needs_details", message: "Indiquez uniquement le format HTML ou React/Next du widget, ou conservez le format affiché." };
  const command = parseInrAssistantWebsiteUiCommand({ command: input.command, selection: screen?.selection, revision: screen?.revision, format: patch.format ?? null });
  if (!command || !screen?.availableCommands?.includes(command.command) || !inrAssistantWebsiteUiCommandAvailable(command.command, screen.pathname, screen.selection?.kind, screen.panel)) return { ok: false, status: "needs_screen", message: "Ouvrez les réglages du widget dans le canal Site Web. Générez son code avant de l’afficher ou le copier." };
  if (!input.instructionQuote || !inrAssistantMaskQuotedText(options.currentUserMessage).includes(input.instructionQuote) || !isInrAssistantWebsiteUiRequest(options.currentUserMessage, command.command, command.format) || !isInrAssistantWebsiteUiRequest(input.instructionQuote, command.command, command.format)) return { ok: false, status: "needs_instruction", message: "Demandez explicitement de générer, afficher ou copier le code du widget." };
  if (options.canStartWork?.() === false) return { ok: false, status: "blocked", message: "Cette action n’est plus disponible." };
  const auth = await requireUser(); if (auth.errorResponse || auth.activeUserId !== options.accountId) return { ok: false, status: "blocked", message: "Le compte actif a changé." };
  return { ok: true, status: "ui_action_requested", uiCommand: command, nextAction: { label: "Site Web", href: "/dashboard?panel=site_web" }, message: "Le navigateur doit confirmer cette action sur le code du widget. L’installation sur votre site externe reste à effectuer." };
}
