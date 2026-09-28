import type { AiMediaGenerationRequest } from "./aiMediaGenerationContracts.ts";

/**
 * Synthetic casting directions, not identities. Only unspecified traits may
 * vary: an explicit brief or an approved character reference always wins.
 */
export const AI_MEDIA_CASTING_VARIANTS = [
  { key: "angular-short", description: "un adulte à la peau mate, aux cheveux courts foncés, au visage anguleux et au regard attentif, avec une présentation masculine si le brief laisse ce choix libre" },
  { key: "silver-oval", description: "un adulte mûr à la peau claire, aux cheveux grisonnants, au visage ovale et à l'expression posée, avec une présentation féminine si le brief laisse ce choix libre" },
  { key: "curly-round", description: "un adulte à la peau foncée, aux cheveux bouclés, au visage rond et à l'expression énergique, avec une présentation masculine si le brief laisse ce choix libre" },
  { key: "cropped-fine", description: "un adulte à la peau mate, aux cheveux très courts, aux traits fins et au regard concentré, avec une présentation féminine si le brief laisse ce choix libre" },
  { key: "wavy-cheekbones", description: "un adulte à la peau claire, aux cheveux mi-longs ondulés, aux pommettes marquées et au sourire discret, avec une présentation masculine si le brief laisse ce choix libre" },
  { key: "senior-silver", description: "un adulte senior à la peau foncée, aux cheveux argentés, aux rides naturelles et à la posture assurée, avec une présentation féminine si le brief laisse ce choix libre" },
  { key: "tied-square", description: "un adulte à la peau claire, aux cheveux attachés, au visage carré et à l'expression chaleureuse, avec une présentation féminine si le brief laisse ce choix libre" },
  { key: "coiled-long", description: "un adulte à la peau foncée, aux cheveux crépus, au visage allongé et au regard franc, avec une présentation masculine si le brief laisse ce choix libre" },
  { key: "light-triangular", description: "un adulte à la peau mate, aux cheveux clairs courts, au visage triangulaire et à l'expression calme, avec une présentation féminine si le brief laisse ce choix libre" },
  { key: "shaved-soft", description: "un adulte à la peau claire, au crâne rasé, aux traits doux et à la gestuelle naturelle, avec une présentation masculine si le brief laisse ce choix libre" },
] as const;

export type AiMediaCastingVariantKey =
  (typeof AI_MEDIA_CASTING_VARIANTS)[number]["key"];

export type AiMediaCastingVariation = {
  key: AiMediaCastingVariantKey;
  direction: string;
};

type CastingRequest = Pick<
  AiMediaGenerationRequest,
  | "requestId"
  | "kind"
  | "operation"
  | "creationMode"
  | "peopleMode"
  | "identityMode"
  | "inspirationImages"
>;

function stableScore(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function chooseAiMediaCastingVariation(args: {
  request: CastingRequest;
  /** Most recent first; only successful image generations are counted. */
  recentVariantKeys?: readonly string[];
}): AiMediaCastingVariation | null {
  const { request } = args;
  if (
    request.kind !== "image" ||
    request.operation === "modify" ||
    request.creationMode === "free" ||
    request.peopleMode === "none" ||
    request.identityMode !== "auto" ||
    request.inspirationImages.some(
      (image) => image.role === "character" && image.usage === "required"
    )
  ) {
    return null;
  }

  const recent = (args.recentVariantKeys || []).slice(0, 16);
  const ranked = AI_MEDIA_CASTING_VARIANTS.map((variant) => {
    const positions = recent.flatMap((key, index) =>
      key === variant.key ? [index] : []
    );
    // First exhaust unused looks, then avoid the newest looks in the window.
    const score =
      positions.length * 100 +
      positions.reduce(
        (total, index) => total + (index === 0 ? 60 : index === 1 ? 30 : index < 4 ? 10 : 0),
        0
      );
    return {
      ...variant,
      score,
      tieBreak: stableScore(`${request.requestId}:casting:${variant.key}`),
    };
  }).sort((left, right) => left.score - right.score || left.tieBreak - right.tieBreak);
  const selected = ranked[0];
  if (!selected) return null;

  return {
    key: selected.key,
    direction: [
      "VARIÉTÉ DE PERSONNAGES IA : seulement si le sujet justifie une présence humaine et si aucune identité de référence n'est imposée.",
      `Pour les traits laissés libres par le brief, privilégier ${selected.description}.`,
      "Créer une personne fictive aux traits distinctifs crédibles, pas le portrait publicitaire féminin générique ni un visage récurrent par défaut.",
      "Varier aussi l'action, la posture et le cadrage quand ils ne sont pas imposés ; ne pas montrer systématiquement un professionnel avec une tablette.",
      "Ne pas ajouter une personne si l'objet, le geste ou le lieu raconte mieux le sujet. Les personnes, leur genre, leur âge et leur apparence explicitement demandés restent prioritaires.",
    ].join(" "),
  };
}
