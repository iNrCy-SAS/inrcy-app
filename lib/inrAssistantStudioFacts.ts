import { AI_MEDIA_AVAILABLE_VIDEO_MODELS, AI_MEDIA_IMAGE_MODELS, AI_MEDIA_VIDEO_MODELS, getAiMediaVideoDurations } from "./aiMediaModelCatalog.ts";
import { isAiMediaCharacterVoiceEngine } from "./aiMediaCharacterVoices.ts";

/** Public native catalogue, never provider credentials, prices or a promise of availability. */
export function inrAssistantStudioFacts(query: string, maxChars = 1_600): string {
  const text = query.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (!/studio|moteurs?|models?|modeles?|voix|vocal|voice|image|video/.test(text)) return "";
  if (!/moteurs?|models?|modeles?|compatib|voix|vocal|voice|lip.?sync|options?|choix|possibil/.test(text)) return "";
  const provided = AI_MEDIA_AVAILABLE_VIDEO_MODELS.filter(model => isAiMediaCharacterVoiceEngine(model.id));
  const videos = AI_MEDIA_AVAILABLE_VIDEO_MODELS.map(model => {
    const durations = [...new Set(model.resolutions.flatMap(resolution => ["single", "multi"].flatMap(mode => getAiMediaVideoDurations(model.id, resolution, mode as "single" | "multi"))))].filter(seconds => seconds >= 4 && seconds <= 30).sort((a, b) => a - b);
    return `${model.label} (${durations[0]}–${durations.at(-1)} s selon qualité/plans ; ${model.resolutions.join("/")})`;
  }).join(", ");
  const retired = AI_MEDIA_VIDEO_MODELS.filter(model => !AI_MEDIA_AVAILABLE_VIDEO_MODELS.some(available => available.id === model.id));
  const voiceQuestion = /voix|vocal|voice|lip.?sync/.test(text);
  const imageOnly = /image|photo|visuel/.test(text) && !/video|voix|vocal|voice|personnage/.test(text);
  const voice = [
    `Photo/personnage avec vocal réel fourni : ${provided.map(model => model.label).join(" ou ")}. Conserver ces noms sans inventer le développement de R2V. Pour Kling, un vocal de parole de 5 à 10 secondes est nécessaire ; le vocal caractérise le timbre, les paroles exactes restent un réglage distinct.`,
    "Parcours vocal réel : Studio → Voix → Ajouter un vocal → Importer/Enregistrer/Médiathèque, puis affecter le vocal au personnage et vérifier l’usage. Le professionnel confirme les droits personnels. Voix off sans personnage : parcours natif de voix off, distinct de l’animation d’un personnage.",
  ];
  const lines = [
    "Capacités Studio issues du catalogue natif actuel ; les devis natifs vérifient moteurs, durée et crédits avant génération.",
    ...(imageOnly ? ["Image : proposer seulement les moteurs d’image, aucun moteur vidéo."] : [`Vidéos retirées et indisponibles pour générer : ${retired.map(model => model.label).join(", ")}.`]),
    ...(voiceQuestion ? voice : []),
    `Images : ${AI_MEDIA_IMAGE_MODELS.map(model => model.label).join(", ")}.`,
    ...(!imageOnly ? [`Vidéos proposées : ${videos}.`, ...(!voiceQuestion ? voice : [])] : []),
    "Nommer les contrôles visibles et proposer l’aide ou le prompt éditable ; ne demander aucun ID ni champ technique au professionnel. Pour une demande de prompt seule, proposer l’insertion, sans lancer une génération.",
  ];
  const result: string[] = [];
  for (const line of lines) if ([...result, line].join("\n").length <= maxChars) result.push(line);
  return result.join("\n");
}
