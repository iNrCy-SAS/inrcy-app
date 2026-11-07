import { createHash } from "node:crypto";
import { AI_MEDIA_SOUNDTRACKS, type AiMediaSoundtrackDefinition, type AiMediaSoundtrackSelectionOptions } from "./aiMediaSoundtrackDefinitions.ts";
export * from "./aiMediaSoundtrackDefinitions.ts";
function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

export function selectAiMediaSoundtrack(
  prompt: string,
  options: AiMediaSoundtrackSelectionOptions = {},
): AiMediaSoundtrackDefinition {
  const haystack = normalize(prompt);
  const scored = AI_MEDIA_SOUNDTRACKS.map((track) => ({
    track,
    score: track.moods.reduce(
      (total, mood) => total + (haystack.includes(normalize(mood)) ? 1 : 0),
      0,
    ),
  }));
  const excludedIds = new Set(
    (options.excludedIds || []).map((value) => String(value || "").trim()),
  );
  const available = scored.filter(({ track }) => !excludedIds.has(track.id));
  const semanticallyMatched = available.filter(({ score }) => score > 0);
  const initialPool = semanticallyMatched.length
    ? semanticallyMatched
    : available.length
      ? available
      : scored;
  const bestScore = Math.max(...initialPool.map(({ score }) => score));
  // Conserver les pistes les plus proches du sujet, sans figer le résultat sur
  // l'unique meilleur score. Le catalogue contient plusieurs variantes par
  // famille créative afin que cette fenêtre reste cohérente et réellement variée.
  const candidates = initialPool
    .filter(({ score }) => bestScore === 0 || score >= Math.max(1, bestScore - 1))
    .map(({ track }) => track);
  const digest = createHash("sha256")
    .update(`${prompt || "inrcy"}\u0000${options.selectionKey || prompt || "inrcy"}`)
    .digest();
  return candidates[digest.readUInt32BE(0) % candidates.length];
}
