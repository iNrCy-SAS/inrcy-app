import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";
export const INR_ASSISTANT_WEBSITE_UI_COMMANDS = ["generate_website_widget_code", "show_website_widget_code", "copy_website_widget_code"] as const;
export type InrAssistantWebsiteUiCommand = { command: typeof INR_ASSISTANT_WEBSITE_UI_COMMANDS[number]; selection: { kind: "channel"; id: "site_web" }; revision: string; format: "html" | "react_next" | null };
export function parseInrAssistantWebsiteUiCommand(value: unknown): InrAssistantWebsiteUiCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>, selection = input.selection as Record<string, unknown> | undefined;
  if (Object.keys(input).some(key => !["command", "selection", "revision", "format"].includes(key)) || !INR_ASSISTANT_WEBSITE_UI_COMMANDS.includes(input.command as never) || !selection || Object.keys(selection).length !== 2 || selection.kind !== "channel" || selection.id !== "site_web" || typeof input.revision !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.revision) || !["html", "react_next", null].includes(input.format as never)) return null;
  return { command: input.command as InrAssistantWebsiteUiCommand["command"], selection: { kind: "channel", id: "site_web" }, revision: input.revision, format: input.format as InrAssistantWebsiteUiCommand["format"] };
}
export function isInrAssistantWebsiteUiRequest(message: string, command: string, format: "html" | "react_next" | null = null) {
  const text = inrAssistantMaskQuotedText(message).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (/\b(?:comment|pourquoi|explique|si|quand|lorsque|apres|avant|demain|plus tard)\b|\bne\b.{0,60}\bpas\b|\b(?:genere|cree|copie|affiche|montre|enregistre)\s+pas\b|\bn[’'](?:enregistre|affiche)\b|\b(?:dans)\s+(?:\d+|un|une|deux|trois)\s*(?:minute|heure|jour)\b/.test(text) || !/\bwidget\b/.test(text)) return false;
  if (format === "react_next" && !/\b(?:react|next)\b/.test(text) || format === "html" && !/\bhtml\b/.test(text)) return false;
  return command === "generate_website_widget_code" ? /\b(?:genere|generer|cree|creer|regenere|regenerer|enregistre|enregistrer)\b/.test(text) : command === "copy_website_widget_code" ? /\b(?:copie|copier)\b/.test(text) : command === "show_website_widget_code" && /\b(?:affiche|afficher|montre|montrer)\b/.test(text);
}
export function inrAssistantWebsiteUiCommandAvailable(command: unknown, pathname: unknown, kind: unknown, panel?: unknown) { return INR_ASSISTANT_WEBSITE_UI_COMMANDS.includes(command as never) && kind === "channel" && pathname === "/dashboard" && panel === "site_web"; }
