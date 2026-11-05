import "server-only";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { requireUser } from "./requireUser";
import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";
import { parseInrAssistantBadgeUiCommand, isInrAssistantBadgeQrRequest, inrAssistantBadgeUiCommandAvailable } from "./inrAssistantBadgeUiCommands.ts";

export async function prepareInrAssistantBadgeUiAction(input: { command: string; instructionQuote: string; patch?: Record<string, unknown> | null; documentId?: string | null; documentKind?: string | null }, options: { accountId: string; currentUserMessage: string; clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean }) {
  if (input.command !== "download_badge_qr") return null;
  const screen = options.clientContext?.screen, patch = input.patch ?? {};
  if (input.documentId || input.documentKind || Object.entries(patch).some(([key, value]) => value != null && key !== "format")) return { ok: false, status: "needs_details", message: "Indiquez uniquement le format PNG ou PDF du QR iNr’Badge." };
  const command = parseInrAssistantBadgeUiCommand({ command: input.command, selection: screen?.selection, revision: screen?.revision, format: patch.format });
  if (!command || !screen?.availableCommands?.includes(command.command) || !inrAssistantBadgeUiCommandAvailable(command.command, screen.pathname, screen.selection?.kind, screen.panel) || screen.pendingChanges !== false) return { ok: false, status: "needs_screen", message: "Ouvrez les réglages iNr’Badge et attendez leur chargement avant de télécharger le QR code." };
  if (!input.instructionQuote || !inrAssistantMaskQuotedText(options.currentUserMessage).includes(input.instructionQuote) || !isInrAssistantBadgeQrRequest(options.currentUserMessage, command.format) || !isInrAssistantBadgeQrRequest(input.instructionQuote, command.format)) return { ok: false, status: "needs_instruction", message: "Demandez explicitement le téléchargement du QR code iNr’Badge en PNG ou PDF." };
  if (options.canStartWork?.() === false) return { ok: false, status: "blocked", message: "Cette action n’est plus disponible." };
  const auth = await requireUser();
  if (auth.errorResponse || auth.activeUserId !== options.accountId) return { ok: false, status: "blocked", message: "Le compte actif a changé." };
  return { ok: true, status: "ui_action_requested", uiCommand: command, nextAction: { label: "iNr’Badge", href: "/dashboard?panel=inrbadge" }, message: "Le navigateur doit confirmer le lancement du téléchargement du QR code." };
}
