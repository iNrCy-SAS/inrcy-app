import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";

export const INR_ASSISTANT_BADGE_UI_COMMANDS = ["download_badge_qr"] as const;
export type InrAssistantBadgeUiCommand = { command: "download_badge_qr"; selection: { kind: "channel"; id: "inrbadge" }; revision: string; format: "png" | "pdf" };
export function parseInrAssistantBadgeUiCommand(value: unknown): InrAssistantBadgeUiCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>, selection = input.selection as Record<string, unknown> | undefined;
  if (Object.keys(input).some(key => !["command", "selection", "revision", "format"].includes(key)) || input.command !== "download_badge_qr" || !selection || Object.keys(selection).length !== 2 || selection.kind !== "channel" || selection.id !== "inrbadge" || typeof input.revision !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.revision) || !["png", "pdf"].includes(String(input.format))) return null;
  return { command: "download_badge_qr", selection: { kind: "channel", id: "inrbadge" }, revision: input.revision, format: input.format as "png" | "pdf" };
}
export function isInrAssistantBadgeQrRequest(message: string, format: string) {
  const text = inrAssistantMaskQuotedText(message).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return !/\b(?:comment|pourquoi|explique|si|quand|lorsque|apres|avant|demain|plus tard)\b|\bne\b.{0,60}\bpas\b|\b(?:telecharge|exporte|enregistre)\s+pas\b|\bn[’'](?:exporte|enregistre)\b|\b(?:dans)\s+(?:\d+|un|une|deux|trois)\s*(?:minute|heure|jour)\b/.test(text)
    && /\b(?:telecharge|telecharger|exporte|exporter|enregistre|enregistrer)\b/.test(text) && /\b(?:qr|qrcode|qr.code)\b/.test(text) && /\bbadge\b/.test(text)
    && (format === "pdf" ? /\bpdf\b/.test(text) : format === "png" && /\b(?:png|image)\b/.test(text));
}
export function inrAssistantBadgeUiCommandAvailable(command: unknown, pathname: unknown, kind: unknown, panel?: unknown) {
  return command === "download_badge_qr" && kind === "channel" && ["/dashboard", "/dashboard/settings"].includes(String(pathname)) && panel === "inrbadge";
}
