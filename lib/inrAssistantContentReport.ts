import { inrAssistantClauseIsAdvice, inrAssistantRequestClauses, inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";

export type InrAssistantContentReportHint = { revision: string };
export type InrAssistantContentReportCommand = { command: "submit_content_report"; selection: { kind: "account_document"; id: "content_report" }; revision: string };
export type InrAssistantContentReportScope = { accountId: string; actorUserId: string; pathname: string };
type Registration = InrAssistantContentReportScope & { revision: string; open: boolean; attempted: boolean; status: "idle" | "sending" | "sent" | "error"; submit: (stillCurrent: () => boolean) => Promise<boolean> };
const REVISION = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseInrAssistantContentReportHint(value: unknown): InrAssistantContentReportHint | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 1 && typeof row.revision === "string" && REVISION.test(row.revision) ? { revision: row.revision } : undefined;
}
export function parseInrAssistantContentReportCommand(value: unknown): InrAssistantContentReportCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>, selection = row.selection as Record<string, unknown> | undefined;
  if (Object.keys(row).some(key => !["command", "selection", "revision"].includes(key)) || row.command !== "submit_content_report" || !selection || Array.isArray(selection) || Object.keys(selection).length !== 2 || selection.kind !== "account_document" || selection.id !== "content_report" || !parseInrAssistantContentReportHint({ revision: row.revision })) return null;
  return { command: "submit_content_report", selection: { kind: "account_document", id: "content_report" }, revision: String(row.revision) };
}
export function isInrAssistantContentReportSubmitRequest(message: string): boolean {
  if (/\b(?:si|quand|lorsque|if|when|avant|before|apres|after|demain|tomorrow|later|plus tard|prochain\w*|next|condition\w*|une fois)\b|\bdans\s+\d+\s+(?:minutes?|heures?|jours?)\b/.test(inrAssistantUnquotedRequest(message))) return false;
  return inrAssistantRequestClauses(message).some(clause => {
    if (inrAssistantClauseIsAdvice(clause) || /\b(?:si|quand|lorsque|if|when|avant|before|ne|pas|jamais|not|never|comment|how)\b/.test(clause)) return false;
    return /^(?:(?:s'il te plait|s'il vous plait|merci de)\s+|(?:peux|pouvez|pourrais|pourriez)[ -](?:tu|vous)\s+(?:me\s+|nous\s+)?)?(?:envoie|envoyez|envoyer|transmets|transmettez|transmettre|soumets|soumettez|soumettre|send|submit)\s+(?:(?:ce|le|mon|notre|this|the|my)\s+)?(?:signalement|rapport de contenu|content report|report)\b/.test(clause);
  });
}
const registrations = new Map<string, Registration>();
const attempted = new Map<string, Set<string>>();
const observers = new Set<() => void>();
const sameScope = (entry: InrAssistantContentReportScope, scope: InrAssistantContentReportScope) => entry.accountId === scope.accountId && entry.actorUserId === scope.actorUserId && entry.pathname === scope.pathname;
export function registerInrAssistantContentReport(key: string, entry: Registration | null) {
  if (entry) registrations.set(key, entry); else { registrations.delete(key); attempted.delete(key); }
  observers.forEach(notify => notify());
}
export function getInrAssistantContentReportHint(scope: InrAssistantContentReportScope): InrAssistantContentReportHint | undefined {
  const entries = [...registrations.entries()].filter(([, entry]) => sameScope(entry, scope) && entry.open);
  if (entries.length !== 1) return undefined;
  const [key, entry] = entries[0];
  return entry.status === "idle" && !entry.attempted && !attempted.get(key)?.has(entry.revision) ? { revision: entry.revision } : undefined;
}
/** One native submission per mounted draft. No automatic retry after an
 * uncertain response; no private report fields leave the browser in a hint. */
export async function runInrAssistantContentReportCommand(command: InrAssistantContentReportCommand, scope: InrAssistantContentReportScope, stillCurrent: () => boolean): Promise<boolean> {
  if (!parseInrAssistantContentReportCommand(command) || !stillCurrent()) return false;
  const entries = [...registrations.entries()].filter(([, entry]) => sameScope(entry, scope) && entry.open);
  if (entries.length !== 1) return false;
  const [key, entry] = entries[0];
  if (entry.revision !== command.revision || entry.status !== "idle" || entry.attempted || attempted.get(key)?.has(command.revision)) return false;
  const revisions = attempted.get(key) ?? new Set<string>(); revisions.add(command.revision); attempted.set(key, revisions);
  const valid = () => { const current = registrations.get(key); return stillCurrent() && !!current && sameScope(current, scope) && current.open && current.revision === command.revision; };
  try {
    if (!valid()) return false;
    const submitted = await new Promise<boolean>(resolve => {
      let finished = false;
      const finish = (result: boolean) => { if (finished) return; finished = true; clearTimeout(timer); clearInterval(interval); resolve(result); };
      const timer = setTimeout(() => finish(false), 10000), interval = setInterval(() => { if (!valid()) finish(false); }, 50);
      void entry.submit(valid).then(finish, () => finish(false));
    });
    if (!submitted || !valid()) return false;
    return await new Promise<boolean>(resolve => {
      let finished = false;
      const finish = (result: boolean) => { if (finished) return; finished = true; clearTimeout(timer); clearInterval(interval); observers.delete(check); resolve(result); };
      const check = () => { if (!valid()) return finish(false); const current = registrations.get(key); if (current?.status === "sent") finish(true); else if (current?.status === "error") finish(false); };
      const timer = setTimeout(() => finish(false), 5000), interval = setInterval(check, 50);
      observers.add(check); check();
    });
  } catch { return false; }
}
