/** Explicit spelling/sound equivalence, used only by local speech comparison. */
export type AiMediaPronunciationAlias = {
  spelling: string;
  pronunciation: string;
};

const GENERIC_SUBJECTS = new Set([
  "marque", "nom", "mot", "sigle", "produit", "entreprise", "societe",
  "il", "elle", "ils", "elles", "cela", "ceci", "ca", "on", "la", "le", "qui", "que", "ce", "celle", "celui",
]);

function comparisonKey(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Read only an explicitly named pronunciation. A quoted title or the phrase
 * "la marque se prononce" cannot invent the spelling to compare with.
 */
export function extractAiMediaPronunciationAliases(prompt: string): AiMediaPronunciationAlias[] {
  const name = String.raw`[«“"]?[ \t]*(?<spelling>[\p{L}\p{N}][\p{L}\p{N}'’._-]{0,63})[ \t]*[»”"]?`;
  const sound = String.raw`(?:«(?<angle>[^»\r\n]{1,80})»|“(?<curly>[^”\r\n]{1,80})”|"(?<straight>[^"\r\n]{1,80})")`;
  const patterns = [
    new RegExp(String.raw`(?<![\p{L}\p{N}])${name}[ \t]+se[ \t]+prononce[ \t]*[:=]?[ \t]*${sound}`, "giu"),
    new RegExp(String.raw`\bprononciation[ \t]+(?:de[ \t]+|d['’])${name}[ \t]*[:=][ \t]*${sound}`, "giu"),
  ];
  const candidates = new Map<string, AiMediaPronunciationAlias>();
  const conflicts = new Set<string>();
  for (const pattern of patterns) {
    for (const match of prompt.matchAll(pattern)) {
      const spelling = match.groups!.spelling.trim();
      const pronunciation = (match.groups!.angle ?? match.groups!.curly ?? match.groups!.straight).trim().replace(/[ \t]+/g, " ");
      const key = comparisonKey(spelling);
      // Keep this a short sound guide, never a whole quoted paragraph.
      if (GENERIC_SUBJECTS.has(key) || pronunciation.split(/\s+/u).length > 8 ||
        !/^[\p{L}\p{M}\p{N} '’-]+$/u.test(pronunciation) ||
        !/[\p{L}]/u.test(spelling) || !/[\p{L}]/u.test(pronunciation)) continue;
      const previous = candidates.get(key);
      if (previous && comparisonKey(previous.pronunciation) !== comparisonKey(pronunciation)) conflicts.add(key);
      else candidates.set(key, { spelling, pronunciation });
    }
  }
  return [...candidates].filter(([key]) => !conflicts.has(key)).map(([, alias]) => alias);
}
