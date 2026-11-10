import type { ModelMessage } from "ai";

/** Keep every call/result pair and every distinct guide, without resending
 * identical guide prose each time a model consults the same expert. */
export function compactInrAssistantGuideContext(messages: ModelMessage[], options: { maxGuideCharacters?: number } = {}): ModelMessage[] {
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
        if (options.maxGuideCharacters && guide.content.length > options.maxGuideCharacters) return {
          ...guide, truncated: true,
          content: guide.content.slice(0, options.maxGuideCharacters) + `\n[Extrait du guide ${guide.id} ; le contenu intégral n’est pas reproduit dans ce contexte borné.]`,
        };
        return guide;
      }) } } };
    }) };
  });
}

/** Fit public guide prose to the next real step's remaining input budget.
 * Native business values, instructions and all call/result identities stay exact.
 * An oversized business result must remain an explicit limit, never be silently
 * replaced by a made-up summary that could authorize a different action. */
export function fitInrAssistantGuideContext(messages: ModelMessage[], maximumBytes: number, measure: (value: unknown) => number): ModelMessage[] {
  for (const maximum of [2_400, 1_200, 600, 240]) {
    const compacted = compactInrAssistantGuideContext(messages, { maxGuideCharacters: maximum });
    if (measure(compacted) <= maximumBytes || maximum === 240) return compacted;
  }
  return messages;
}
