import { parseInrAssistantMailAttachments, type InrAssistantMailAttachment } from "./inrAssistantMailAttachments.ts";
/** Local compose fields only. Sending and scheduling use their native flows. */
export type InrAssistantMailPatch = { recipient?: string; subject?: string; bodyText?: string; attachments?: InrAssistantMailAttachment[] };
export type InrAssistantMailCommand = { command: "configure_mail_draft"; selection: { kind: "mail"; id: string }; revision: string; patch: InrAssistantMailPatch };

export function parseInrAssistantMailPatch(value: unknown): InrAssistantMailPatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(([, item]) => item !== null && item !== undefined);
  if (!entries.length || entries.some(([key, item]) => key === "attachments" ? !parseInrAssistantMailAttachments(item) : typeof item !== "string" ||
    (key === "recipient" ? item.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(item) :
      key === "subject" ? item.length > 220 || /[\r\n\u0000]/.test(item) :
        key === "bodyText" ? item.length > 6000 || /\u0000/.test(item) : true))) return null;
  return Object.fromEntries(entries) as InrAssistantMailPatch;
}

/** Addresses must come from the current instruction, never from a model guess. */
export function inrAssistantMailRecipientRequested(message: string, recipient: string | undefined): boolean {
  return !recipient || (message.match(/[^\s@,;<>"«»]+@[^\s@,;<>"«»]+\.[^\s@,;<>"«»]+/g) ?? [])
    .some(value => value.replace(/[.!?]+$/, "").toLowerCase() === recipient.toLowerCase());
}
