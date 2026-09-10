import type {
  AiMediaGenerationRequest,
  AiMediaKind,
} from "./aiMediaGenerationContracts.ts";
import {
  normalizeAiMediaGeneratorPreferences,
  type AiMediaGeneratorPreferences,
} from "./aiMediaGenerationPreferences.ts";
import {
  normalizeInrAgentStudioMediaPreferencePercent,
  type InrAgentTheme,
} from "./inrAgentSettings.ts";

export type InrAgentMediaPreferenceMode = "studio" | "creative";

export type InrAgentMediaParameterSet = Pick<
  AiMediaGenerationRequest,
  | "format"
  | "visualStyle"
  | "imageStyle"
  | "shotType"
  | "peopleMode"
  | "creativity"
  | "useBrandColors"
  | "logoMode"
  | "teamVideoMode"
  | "teamVideoSpeechMode"
  | "durationSeconds"
  | "connectScenes"
  | "withMusic"
  | "withNarration"
  | "narrationVoice"
>;

export type InrAgentMediaMixResolution = InrAgentMediaParameterSet & {
  mode: InrAgentMediaPreferenceMode;
  studioMediaPreferencePercent: number;
  appliedStudioBlockIds: number[];
};

const BASE_PARAMETERS: Record<AiMediaKind, InrAgentMediaParameterSet> = {
  image: {
    format: "portrait",
    visualStyle: "brand",
    imageStyle: "photo",
    shotType: "auto",
    peopleMode: "auto",
    creativity: "faithful",
    useBrandColors: true,
    logoMode: "discreet",
    teamVideoMode: "montage",
    teamVideoSpeechMode: "voiceover",
    durationSeconds: null,
    connectScenes: false,
    withMusic: false,
    withNarration: false,
    narrationVoice: null,
  },
  video: {
    format: "story",
    visualStyle: "brand",
    imageStyle: "photo",
    shotType: "auto",
    peopleMode: "auto",
    creativity: "faithful",
    useBrandColors: true,
    logoMode: "discreet",
    teamVideoMode: "montage",
    teamVideoSpeechMode: "voiceover",
    durationSeconds: 8,
    connectScenes: false,
    withMusic: true,
    withNarration: true,
    narrationVoice: "female",
  },
};

/**
 * Variations créatives bornées : elles changent l'univers visuel sans jamais
 * toucher au sujet, au thème, au texte social ni à l'identité consentie.
 * Ainsi « aléatoire » reste créatif, mais ne peut pas produire une requête
 * incohérente pour un fournisseur d'image ou de vidéo.
 */
const CREATIVE_VARIANTS: Array<
  Pick<
    InrAgentMediaParameterSet,
    | "visualStyle"
    | "imageStyle"
    | "shotType"
    | "peopleMode"
    | "creativity"
    | "useBrandColors"
    | "logoMode"
    | "teamVideoMode"
    | "teamVideoSpeechMode"
    | "durationSeconds"
    | "connectScenes"
    | "withMusic"
    | "withNarration"
    | "narrationVoice"
  >
> = [
  {
    visualStyle: "premium",
    imageStyle: "photo",
    shotType: "wide",
    peopleMode: "auto",
    creativity: "bold",
    useBrandColors: true,
    logoMode: "discreet",
    teamVideoMode: "cinematic",
    teamVideoSpeechMode: "voiceover",
    durationSeconds: 8,
    connectScenes: false,
    withMusic: true,
    withNarration: true,
    narrationVoice: "female",
  },
  {
    visualStyle: "warm",
    imageStyle: "illustration",
    shotType: "medium",
    peopleMode: "solo",
    creativity: "bold",
    useBrandColors: true,
    logoMode: "discreet",
    teamVideoMode: "montage",
    teamVideoSpeechMode: "voiceover",
    durationSeconds: 8,
    connectScenes: false,
    withMusic: true,
    withNarration: false,
    narrationVoice: "female",
  },
  {
    visualStyle: "dynamic",
    imageStyle: "graphic",
    shotType: "close",
    peopleMode: "team",
    creativity: "bold",
    useBrandColors: true,
    logoMode: "visible",
    teamVideoMode: "montage",
    teamVideoSpeechMode: "voiceover",
    durationSeconds: 16,
    connectScenes: false,
    withMusic: true,
    withNarration: true,
    narrationVoice: "male",
  },
  {
    visualStyle: "expert",
    imageStyle: "three_d",
    shotType: "wide",
    peopleMode: "none",
    creativity: "faithful",
    useBrandColors: true,
    logoMode: "discreet",
    teamVideoMode: "cinematic",
    teamVideoSpeechMode: "characters",
    durationSeconds: 8,
    connectScenes: false,
    withMusic: false,
    withNarration: true,
    narrationVoice: "male",
  },
  {
    visualStyle: "local",
    imageStyle: "photo",
    shotType: "medium",
    peopleMode: "auto",
    creativity: "bold",
    useBrandColors: false,
    logoMode: "none",
    teamVideoMode: "montage",
    teamVideoSpeechMode: "voiceover",
    durationSeconds: 8,
    connectScenes: false,
    withMusic: true,
    withNarration: false,
    narrationVoice: "female",
  },
];

function stableHash(value: string): number {
  // FNV-1a : déterministe entre les retries, sans Math.random et sans
  // dépendance Node dans le bundle client.
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function chooseVariant(seed: string) {
  return CREATIVE_VARIANTS[
    stableHash(`${seed}:creative-variant`) % CREATIVE_VARIANTS.length
  ];
}

function shouldUseStudioPreferences(percent: number, seed: string): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  return stableHash(`${seed}:studio-preference`) % 100 < percent;
}

function studioParametersForKind(args: {
  kind: AiMediaKind;
  preferences: AiMediaGeneratorPreferences;
}): { parameters: InrAgentMediaParameterSet; appliedStudioBlockIds: number[] } {
  const base = { ...BASE_PARAMETERS[args.kind] };
  const appliedStudioBlockIds: number[] = [];
  const blocks = args.preferences.blocks;

  if (blocks[2].saved) {
    base.format = blocks[2].defaults.format;
    appliedStudioBlockIds.push(2);
  }
  if (blocks[3].saved) {
    Object.assign(base, blocks[3].defaults);
    appliedStudioBlockIds.push(3);
  }
  if (blocks[4].saved) {
    Object.assign(base, blocks[4].defaults);
    appliedStudioBlockIds.push(4);
  }
  if (blocks[5].saved) {
    base.peopleMode = blocks[5].defaults.peopleMode;
    base.teamVideoMode = blocks[5].defaults.teamVideoMode;
    base.teamVideoSpeechMode = blocks[5].defaults.teamVideoSpeechMode;
    appliedStudioBlockIds.push(5);
  }
  if (blocks[6].saved) {
    base.durationSeconds = args.kind === "video"
      ? blocks[6].defaults.durationSeconds
      : null;
    base.connectScenes = args.kind === "video" && blocks[6].defaults.connectScenes;
    base.withMusic = args.kind === "video" && blocks[6].defaults.withMusic;
    base.withNarration = args.kind === "video" && blocks[6].defaults.withNarration;
    base.narrationVoice = args.kind === "video"
      ? blocks[6].defaults.narrationVoice
      : null;
    appliedStudioBlockIds.push(6);
  }

  // Le bloc 1 (source du sujet et type de média) est volontairement ignoré :
  // iNrAgent impose le kind et son idée éditoriale pour cette publication.
  // identityMode / consentement ne sont pas persistés dans Studio et ne sont
  // donc jamais réutilisés automatiquement.
  return { parameters: base, appliedStudioBlockIds };
}

/**
 * Résout une seule génération iNrAgent. La décision est stable pour un même
 * seed (action + index), ce qui garantit qu'un retry ne change pas de famille
 * de réglages par surprise.
 */
export function resolveInrAgentMediaMix(args: {
  kind: AiMediaKind;
  theme: InrAgentTheme;
  studioMediaPreferencePercent: number;
  studioPreferences?: AiMediaGeneratorPreferences | null;
  seed: string;
}): InrAgentMediaMixResolution {
  const percent = normalizeInrAgentStudioMediaPreferencePercent(
    args.studioMediaPreferencePercent,
    0,
  );
  const useStudio = shouldUseStudioPreferences(percent, args.seed);

  if (useStudio) {
    const preferences = args.studioPreferences
      ? normalizeAiMediaGeneratorPreferences(args.studioPreferences)
      : normalizeAiMediaGeneratorPreferences(null);
    const studio = studioParametersForKind({
      kind: args.kind,
      preferences,
    });
    return {
      ...studio.parameters,
      mode: "studio",
      studioMediaPreferencePercent: percent,
      appliedStudioBlockIds: studio.appliedStudioBlockIds,
    };
  }

  const creative = chooseVariant(args.seed);
  const base = BASE_PARAMETERS[args.kind];
  return {
    ...base,
    ...creative,
    format: base.format,
    durationSeconds: args.kind === "video" ? creative.durationSeconds : null,
    connectScenes: args.kind === "video" ? creative.connectScenes : false,
    withMusic: args.kind === "video" && creative.withMusic,
    withNarration: args.kind === "video" && creative.withNarration,
    narrationVoice: args.kind === "video" ? creative.narrationVoice : null,
    mode: "creative",
    studioMediaPreferencePercent: percent,
    appliedStudioBlockIds: [],
  };
}
