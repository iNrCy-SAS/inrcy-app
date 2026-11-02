import type { ModelMessage } from "ai";

/** Compact only SDK-verified schema rejections. No executor ran for these IDs.
 * Keep the call/result pair, but avoid repeating malformed JSON (and SDK's
 * duplicate rendering of it) to every fallback. Successful facts are untouched. */
export function compactInrAssistantRejectedToolContext(messages: ModelMessage[], rejectedToolCallIds: ReadonlySet<string>): ModelMessage[] {
  if (!rejectedToolCallIds.size) return messages;
  const calls = new Map<string, { toolName: string; count: number }>();
  const errors = new Map<string, { toolName: string; count: number; rejected: boolean }>();
  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content) if (part.type === "tool-call" && rejectedToolCallIds.has(part.toolCallId)) {
        calls.set(part.toolCallId, { toolName: part.toolName, count: (calls.get(part.toolCallId)?.count ?? 0) + 1 });
      }
    } else if (message.role === "tool") {
      for (const part of message.content) if (part.type === "tool-result" && rejectedToolCallIds.has(part.toolCallId)) {
        errors.set(part.toolCallId, { toolName: part.toolName, count: (errors.get(part.toolCallId)?.count ?? 0) + 1, rejected: part.output.type === "error-text" });
      }
    }
  }
  const verified = new Set([...calls].filter(([id, call]) => call.count === 1 && errors.get(id)?.count === 1 && errors.get(id)?.rejected && errors.get(id)?.toolName === call.toolName).map(([id]) => id));
  return messages.map(message => {
    if (message.role === "assistant" && Array.isArray(message.content)) return { ...message, content: message.content.map(part =>
      part.type === "tool-call" && verified.has(part.toolCallId) ? { ...part, input: {} } : part) };
    if (message.role === "tool") return { ...message, content: message.content.map(part =>
      part.type === "tool-result" && verified.has(part.toolCallId) ? { ...part, output: { type: "error-text" as const, value: "Arguments rejetés par la validation du schéma AVANT toute exécution. Le contenu invalide a été retiré de ce contexte. Reprendre la demande actuelle avec le schéma exact et les faits vérifiés ; ne pas inventer de champ obligatoire ni répéter une autre action déjà réussie." } } : part) };
    return message;
  });
}
