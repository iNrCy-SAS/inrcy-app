import { createHash } from "node:crypto";

export type AiMediaSoundtrackDefinition = {
  id: string;
  name: string;
  fileName: string;
  moods: readonly string[];
  license: "inrcy-original-procedural-v1";
};

export const AI_MEDIA_SOUNDTRACKS: readonly AiMediaSoundtrackDefinition[] = [
  { id: "horizon-clair", name: "Horizon clair", fileName: "horizon-clair.wav", moods: ["pro", "entreprise", "clair", "service"], license: "inrcy-original-procedural-v1" },
  { id: "atelier-vivant", name: "Atelier vivant", fileName: "atelier-vivant.wav", moods: ["artisan", "atelier", "chantier", "savoir-faire"], license: "inrcy-original-procedural-v1" },
  { id: "elan-local", name: "Élan local", fileName: "elan-local.wav", moods: ["local", "proximité", "ville", "commerce"], license: "inrcy-original-procedural-v1" },
  { id: "confiance-douce", name: "Confiance douce", fileName: "confiance-douce.wav", moods: ["confiance", "famille", "accompagnement", "serein"], license: "inrcy-original-procedural-v1" },
  { id: "premium-minimal", name: "Premium minimal", fileName: "premium-minimal.wav", moods: ["premium", "luxe", "élégant", "haut de gamme"], license: "inrcy-original-procedural-v1" },
  { id: "energie-sociale", name: "Énergie sociale", fileName: "energie-sociale.wav", moods: ["dynamique", "sport", "énergie", "réseaux"], license: "inrcy-original-procedural-v1" },
  { id: "nature-apaisante", name: "Nature apaisante", fileName: "nature-apaisante.wav", moods: ["nature", "bien-être", "calme", "bio"], license: "inrcy-original-procedural-v1" },
  { id: "innovation-lumineuse", name: "Innovation lumineuse", fileName: "innovation-lumineuse.wav", moods: ["innovation", "digital", "technologie", "moderne"], license: "inrcy-original-procedural-v1" },
  { id: "celebration-legere", name: "Célébration légère", fileName: "celebration-legere.wav", moods: ["fête", "ouverture", "événement", "nouveau"], license: "inrcy-original-procedural-v1" },
  { id: "nocturne-elegant", name: "Nocturne élégant", fileName: "nocturne-elegant.wav", moods: ["soir", "restaurant", "élégant", "ambiance"], license: "inrcy-original-procedural-v1" },
] as const;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

export function selectAiMediaSoundtrack(
  prompt: string,
): AiMediaSoundtrackDefinition {
  const haystack = normalize(prompt);
  const scored = AI_MEDIA_SOUNDTRACKS.map((track) => ({
    track,
    score: track.moods.reduce(
      (total, mood) => total + (haystack.includes(normalize(mood)) ? 1 : 0),
      0,
    ),
  }));
  const bestScore = Math.max(...scored.map(({ score }) => score));
  const candidates =
    bestScore > 0
      ? scored.filter(({ score }) => score === bestScore).map(({ track }) => track)
      : [...AI_MEDIA_SOUNDTRACKS];
  const digest = createHash("sha256").update(prompt || "inrcy").digest();
  return candidates[digest.readUInt32BE(0) % candidates.length];
}
