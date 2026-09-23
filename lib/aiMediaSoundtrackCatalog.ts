import { createHash } from "node:crypto";

export type AiMediaSoundtrackDefinition = {
  id: string;
  name: string;
  moods: readonly string[];
  license: "inrcy-original-procedural-v1";
};

export type AiMediaSoundtrackDuration = 8 | 16 | 24;

export type AiMediaSoundtrackSelectionOptions = {
  /**
   * Entropie propre à la génération (job, publication, etc.). Une même
   * tentative garde ainsi sa piste lors d'une reprise, mais deux créations
   * identiques ne retombent plus systématiquement sur la même musique.
   */
  selectionKey?: string;
  /** Pistes récemment utilisées par l'établissement. */
  excludedIds?: readonly string[];
};

const soundtrack = (
  id: string,
  name: string,
  moods: readonly string[],
): AiMediaSoundtrackDefinition => ({
  id,
  name,
  moods,
  license: "inrcy-original-procedural-v1",
});

export const AI_MEDIA_SOUNDTRACKS: readonly AiMediaSoundtrackDefinition[] = [
  soundtrack("horizon-clair", "Horizon clair", ["pro", "entreprise", "clair", "service"]),
  soundtrack("cap-confiance", "Cap confiance", ["pro", "entreprise", "confiance", "service", "accompagnement"]),
  soundtrack("impact-corporate", "Impact corporate", ["pro", "entreprise", "impact", "business", "expert"]),
  soundtrack("atelier-vivant", "Atelier vivant", ["artisan", "atelier", "chantier", "savoir-faire"]),
  soundtrack("matiere-authentique", "Matière authentique", ["artisan", "atelier", "authentique", "savoir-faire", "fabrication"]),
  soundtrack("marche-local", "Marché local", ["local", "proximité", "commerce", "artisan", "ville"]),
  soundtrack("elan-local", "Élan local", ["local", "proximité", "ville", "commerce"]),
  soundtrack("confiance-douce", "Confiance douce", ["confiance", "famille", "accompagnement", "serein"]),
  soundtrack("douceur-organique", "Douceur organique", ["confiance", "famille", "serein", "calme", "bien-être"]),
  soundtrack("premium-minimal", "Premium minimal", ["premium", "luxe", "élégant", "haut de gamme"]),
  soundtrack("signature-luxe", "Signature luxe", ["premium", "luxe", "élégant", "signature", "haut de gamme"]),
  soundtrack("energie-sociale", "Énergie sociale", ["dynamique", "sport", "énergie", "réseaux"]),
  soundtrack("pulsation-urbaine", "Pulsation urbaine", ["dynamique", "sport", "énergie", "urbain", "réseaux"]),
  soundtrack("lancement-dynamique", "Lancement dynamique", ["dynamique", "lancement", "nouveau", "impact", "énergie"]),
  soundtrack("nature-apaisante", "Nature apaisante", ["nature", "bien-être", "calme", "bio"]),
  soundtrack("respiration-verte", "Respiration verte", ["nature", "bien-être", "calme", "bio", "serein"]),
  soundtrack("innovation-lumineuse", "Innovation lumineuse", ["innovation", "digital", "technologie", "moderne"]),
  soundtrack("futur-positif", "Futur positif", ["innovation", "digital", "technologie", "moderne", "futur"]),
  soundtrack("digital-flow", "Digital flow", ["innovation", "digital", "réseaux", "moderne", "business"]),
  soundtrack("celebration-legere", "Célébration légère", ["fête", "ouverture", "événement", "nouveau"]),
  soundtrack("moment-festif", "Moment festif", ["fête", "ouverture", "événement", "célébration", "nouveau"]),
  soundtrack("nocturne-elegant", "Nocturne élégant", ["soir", "restaurant", "élégant", "ambiance"]),
  soundtrack("saveurs-modernes", "Saveurs modernes", ["restaurant", "gastronomie", "élégant", "ambiance", "commerce"]),
  soundtrack("cinema-inspirant", "Cinéma inspirant", ["inspirant", "émotion", "histoire", "impact", "premium"]),
] as const;

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
