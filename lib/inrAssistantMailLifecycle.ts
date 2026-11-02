export const INR_ASSISTANT_MAIL_LIFECYCLE = ["save_mail_draft", "send_mail_draft", "open_mail_schedule"] as const;
export type InrAssistantMailLifecycleName = typeof INR_ASSISTANT_MAIL_LIFECYCLE[number];
export type InrAssistantMailLifecycleCommand = { command: InrAssistantMailLifecycleName; selection: { kind: "mail"; id: string }; revision: string };
export type InrAssistantMailExecution = { isCurrent: () => boolean; started: () => void; accepted: (kind: "saved" | "accepted" | "queued", id?: string) => void };
export function parseInrAssistantMailLifecycle(value: unknown): InrAssistantMailLifecycleCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>, selection = row.selection as Record<string, unknown> | undefined;
  if (!INR_ASSISTANT_MAIL_LIFECYCLE.includes(row.command as InrAssistantMailLifecycleName) || selection?.kind !== "mail" ||
    typeof selection.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(selection.id) || typeof row.revision !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.revision)) return null;
  return { command: row.command as InrAssistantMailLifecycleName, selection: { kind: "mail", id: selection.id }, revision: row.revision };
}
export function isInrAssistantMailLifecycleRequest(message: string, command?: string): boolean {
  const text = message.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (/\b(?:ne|pas|sans|jamais|si|quand|lorsque|imagine|suppose|comment|pourquoi)\b|\bn['’]/.test(text) || !/\b(?:mail|email|courriel|message|brouillon|composeur)\b/.test(text)) return false;
  const requests = {
    save_mail_draft: /\b(?:enregistre|enregistrer|sauvegarde|sauvegarder)\b/.test(text) && /\b(?:brouillon|composeur|ce|cet|affiche|ouvert)\b/.test(text),
    send_mail_draft: /\b(?:envoie|envoyer|expedie|expedier)\b/.test(text) && /\b(?:ce|cet|affiche|ouvert|brouillon|composeur)\b/.test(text),
    open_mail_schedule: /\b(?:programme|programmer|planifie|planifier|programmation)\b/.test(text) && /\b(?:ce|cet|affiche|ouvert|brouillon|composeur)\b/.test(text),
  };
  return command ? requests[command as InrAssistantMailLifecycleName] === true : Object.values(requests).some(Boolean);
}
