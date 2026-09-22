import {
  normalizeAiMediaGenerationRequest,
  type AiMediaGenerationMode,
  type AiMediaGenerationRequest,
  type AiMediaKind,
  type AiMediaPeopleCriterion,
  type AiMediaTypology,
  type AiMediaVideoSceneMode,
} from "./aiMediaGenerationContracts.ts";
import type { InrAgentMediaMixResolution } from "./inrAgentMediaMix.ts";
import type { InrAgentTheme } from "./inrAgentSettings.ts";

function typologyForTheme(theme: InrAgentTheme): AiMediaTypology {
  if (["realisations", "temoignages"].includes(theme)) return "showcase";
  if (theme === "offres") return "offer";
  if (theme === "services") return "service";
  if (theme === "coulisses") return "behind_scenes";
  if (theme === "recrutement") return "recruitment";
  if (theme === "actualites") return "event";
  return "advice";
}

function peopleCriterionForMode(
  peopleMode: InrAgentMediaMixResolution["peopleMode"]
): AiMediaPeopleCriterion {
  if (peopleMode === "none") return "none";
  if (peopleMode === "solo") return "one";
  if (peopleMode === "team") return "group";
  return "auto";
}

function videoSceneMode(args: {
  kind: AiMediaKind;
  durationSeconds: InrAgentMediaMixResolution["durationSeconds"];
  connectScenes: boolean;
}): AiMediaVideoSceneMode {
  if (
    args.kind !== "video" ||
    (args.durationSeconds || 8) <= 8 ||
    args.connectScenes
  ) {
    return "single";
  }
  return "multi";
}

/**
 * Adapte les choix éditoriaux iNrAgent au contrat public d'iNrStudio, puis les
 * fait passer par le normaliseur central. Ce module ne compose aucun prompt :
 * `generateAndSaveAiMedia` reste l'unique porte d'entrée vers le routeur v23.
 */
export function buildInrAgentMediaGenerationRequest(args: {
  requestId: string;
  idea: string;
  theme: InrAgentTheme;
  kind: AiMediaKind;
  mediaMix: InrAgentMediaMixResolution;
}): AiMediaGenerationRequest {
  const peopleCriterion = peopleCriterionForMode(args.mediaMix.peopleMode);
  const generationMode: AiMediaGenerationMode =
    peopleCriterion === "auto" ? "ai_free" : "ai_criteria";

  return normalizeAiMediaGenerationRequest({
    operation: "generate",
    inputMode: "essential",
    requestId: args.requestId,
    kind: args.kind,
    generationMode,
    peopleCriterion,
    settingCriterion: "auto",
    focusCriterion: "auto",
    subjectSource: "custom",
    idea: args.idea,
    aiInstruction: "",
    // Le texte social appartient à Booster. Ce contrat bloque explicitement
    // toute lettre, accroche, enseigne, interface ou sous-titre fournisseur.
    textMode: "none",
    exactText: "",
    withText: false,
    textKeywords: [],
    withMusic: args.mediaMix.withMusic,
    withNarration: args.mediaMix.withNarration,
    narrationVoice: args.mediaMix.narrationVoice,
    narrationVoiceVariant: null,
    format: args.mediaMix.format,
    typology: typologyForTheme(args.theme),
    visualStyle: args.mediaMix.visualStyle,
    imageStyle: args.mediaMix.imageStyle,
    shotType: args.mediaMix.shotType,
    peopleMode: args.mediaMix.peopleMode,
    creativity: args.mediaMix.creativity,
    useBrandColors: args.mediaMix.useBrandColors,
    logoMode: args.mediaMix.logoMode,
    videoEngine: args.kind === "video" ? "omni" : null,
    identityMode: "auto",
    videoCharacterMode: "auto",
    identityConsent: false,
    teamVideoMode: args.mediaMix.teamVideoMode,
    // iNrAgent n'envoie aucune identité autorisée. Les dialogues natifs
    // « personnages » sont donc ramenés à la voix off historique afin de ne
    // pas couper la narration ni inventer un consentement biométrique.
    teamVideoSpeechMode: "voiceover",
    teamVideoVeoConsent: false,
    identityReferenceSetId: "",
    durationSeconds: args.mediaMix.durationSeconds,
    sceneMode: videoSceneMode({
      kind: args.kind,
      durationSeconds: args.mediaMix.durationSeconds,
      connectScenes: args.mediaMix.connectScenes,
    }),
    connectScenes: args.mediaMix.connectScenes,
    inspirationImages: [],
    // Le quota et la médiathèque iNrAgent restent historiquement rattachés à
    // Booster ; seul le contrat de composition est désormais celui du Studio.
    source: "booster",
  });
}
