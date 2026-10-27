import { createHash } from "node:crypto";

export type AiMediaSoundtrackDefinition = {
  id: string;
  name: string;
  moods: readonly string[];
  license: "inrcy-original-procedural-v1" | "inrcy-original-instrumental-v2";
  /** Omitted on immutable historical tracks stored in the catalogue root. */
  assetVersion?: 2;
};

export type AiMediaSoundtrackDuration = number;

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

export const LEGACY_AI_MEDIA_SOUNDTRACKS: readonly AiMediaSoundtrackDefinition[] = [
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

const instrumental = (id: string, name: string, moods: readonly string[]): AiMediaSoundtrackDefinition => ({
  id, name, moods, license: "inrcy-original-instrumental-v2", assetVersion: 2,
});

/** Current selection catalogue. Historical IDs remain loadable, never re-selected by Auto. */
export const AI_MEDIA_SOUNDTRACKS: readonly AiMediaSoundtrackDefinition[] = [
  instrumental("piano-serein", "Piano serein", ["piano", "doux", "calme", "bien-être", "accompagnement"]),
  instrumental("guitare-solaire", "Guitare solaire", ["guitare", "acoustique", "chaleureux", "artisan", "local"]),
  instrumental("ukulele-souriant", "Acoustique souriante", ["pop acoustique", "guitare", "boîte à musique", "léger", "joyeux", "famille", "commerce"]),
  instrumental("folk-en-route", "Folk en route", ["folk", "guitare", "nature", "voyage", "savoir-faire"]),
  instrumental("bossa-terrasse", "Bossa terrasse", ["bossa", "guitare nylon", "terrasse", "café", "restaurant"]),
  instrumental("jazz-velours", "Jazz velours", ["jazz", "piano", "contrebasse", "élégant", "soir"]),
  instrumental("funk-boutique", "Funk boutique", ["funk", "basse", "groove", "commerce", "moderne"]),
  instrumental("disco-lumiere", "Disco lumière", ["disco", "cordes", "danse", "fête", "événement"]),
  instrumental("house-elan", "House élan", ["house", "piano", "énergie", "sport", "dynamique"]),
  instrumental("electro-neon", "Électro néon", ["électro", "synthétiseur", "digital", "technologie", "innovation"]),
  instrumental("chill-lofi", "Chill lo-fi", ["lo-fi", "piano électrique", "détente", "calme", "créatif"]),
  instrumental("hiphop-pulsation", "Hip-hop pulsation", ["hip-hop", "basse", "rythme", "urbain", "réseaux"]),
  instrumental("afro-percussions", "Afro percussions", ["afro", "kalimba", "marimba", "percussions", "énergie", "rencontre"]),
  instrumental("reggae-soleil", "Reggae soleil", ["reggae", "orgue", "soleil", "vacances", "proximité"]),
  instrumental("latin-fiesta", "Latin fiesta", ["latin", "cuivres", "percussions", "fête", "ouverture"]),
  instrumental("pop-optimiste", "Pop optimiste", ["pop", "piano", "positif", "pro", "entreprise", "service"]),
  instrumental("rock-atelier", "Rock atelier", ["rock", "guitare électrique", "artisan", "atelier", "impact"]),
  instrumental("blues-garage", "Blues garage", ["blues", "piano honky-tonk", "guitare", "authentique", "fabrication"]),
  instrumental("cordes-cinema", "Cordes cinéma", ["cinéma", "cordes", "inspirant", "émotion", "histoire"]),
  instrumental("valse-elegante", "Valse élégante", ["valse", "accordéon", "violon", "trois temps", "premium", "luxe"]),
  instrumental("harpe-nature", "Harpe nature", ["harpe", "flûte", "nature", "bio", "bien-être"]),
  instrumental("ambient-espace", "Ambient espace", ["ambient", "nappes", "espace", "serein", "futur"]),
  instrumental("marimba-tropicale", "Marimba tropicale", ["marimba", "tropical", "joyeux", "voyage", "commerce"]),
  instrumental("cloches-hiver", "Cloches d’hiver", ["cloches", "célesta", "hiver", "fête", "famille"]),
  instrumental("country-banjo", "Country banjo", ["country", "banjo", "guitare", "artisan", "local"]),
  instrumental("celtique-flute", "Flûte celtique", ["celtique", "flûte", "harpe", "nature", "voyage"]),
  instrumental("tango-passion", "Tango passion", ["tango", "accordéon", "cordes", "élégant", "émotion"]),
  instrumental("synthwave-retro", "Synthwave rétro", ["synthwave", "synthétiseur", "rétro", "digital", "moderne"]),
  instrumental("chiptune-arcade", "Chiptune arcade", ["chiptune", "arcade", "électronique", "créatif", "innovation"]),
  instrumental("drum-bass-rapide", "Drum and bass", ["drum and bass", "batterie", "basse", "rapide", "sport", "énergie"]),
] as const;

/** Recovery and explicit saved choices may still reference an immutable old asset. */
export const ALL_AI_MEDIA_SOUNDTRACKS: readonly AiMediaSoundtrackDefinition[] = [
  ...LEGACY_AI_MEDIA_SOUNDTRACKS, ...AI_MEDIA_SOUNDTRACKS,
];

export function findAiMediaSoundtrack(id: unknown): AiMediaSoundtrackDefinition | undefined {
  return typeof id === "string" ? ALL_AI_MEDIA_SOUNDTRACKS.find(track => track.id === id) : undefined;
}

/** Build paths exclusively from registered IDs and supported physical assets. */
export function getAiMediaSoundtrackAssetRelativePath(id: string, durationSeconds: number): string {
  const definition = findAiMediaSoundtrack(id);
  if (!definition) throw new Error("ai_soundtrack_id_invalid");
  if (![8, 16, 24].includes(durationSeconds)) throw new Error("ai_soundtrack_duration_invalid");
  return `${definition.assetVersion === 2 ? "v2/" : ""}${definition.id}-${durationSeconds}s.wav`;
}

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
