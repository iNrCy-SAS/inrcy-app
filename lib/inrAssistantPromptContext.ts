import type { ModelMessage } from "ai";

/** Keep every call/result pair and every distinct guide, without resending
 * identical guide prose each time a model consults the same expert. */
export function compactInrAssistantGuideContext(messages: ModelMessage[]): ModelMessage[] {
  const seen = new Set<string>();
  return messages.map(message => {
    if (message.role !== "tool") return message;
    return { ...message, content: message.content.map(part => {
      if (part.type !== "tool-result" || part.toolName !== "readAppGuide" || part.output.type !== "json") return part;
      const value = part.output.value;
      if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.guides)) return part;
      return { ...part, output: { ...part.output, value: { ...value, guides: value.guides.map(guide => {
        if (!guide || typeof guide !== "object" || Array.isArray(guide) || typeof guide.id !== "string" || typeof guide.content !== "string") return guide;
        const key = JSON.stringify([guide.id, guide.content]);
        if (seen.has(key)) return { ...guide, content: `Guide [${guide.id}] déjà fourni dans cet échange : réutiliser son contenu ci-dessus.` };
        seen.add(key);
        return guide;
      }) } } };
    }) };
  });
}
