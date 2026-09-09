import "server-only";

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GoogleGenAI,
  VideoGenerationReferenceType,
  type GenerateVideosOperation,
  type Video,
} from "@google/genai";

import {
  commitAiGatewayAccountAttempt,
  recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt,
} from "@/lib/aiGatewayAccountGuard";
import { getAiMediaVideoSegmentDurations } from "@/lib/aiMediaVideoTimeline";
import {
  DEFAULT_VEO_MODEL,
  classifyVeoFailure,
  nextVeoInspirationMode,
  resolveVeoModelCandidates,
  selectVeoInspirationMode,
  supportsVeoReferenceImages,
} from "@/lib/aiVideoReliability";
import {
  AiVideoProviderBillableFailure,
  assertAiVideoReferenceTeamGoogleEgress,
  isAiVideoProviderBillableFailure,
  type AiVideoProvider,
  type AiVideoProviderClip,
  type AiVideoProviderGenerationArgs,
  type AiVideoProviderResult,
} from "@/lib/aiVideoProviderTypes";
import { resolveAiMediaDialogueSequence } from "@/lib/aiMediaDialogue";
import { describeAiMediaBrandColors } from "@/lib/aiMediaColorDirection";
import {
  extractAiMediaVideoContinuityFrame,
  type AiMediaVideoContinuityFrame,
} from "./aiMediaVideoContinuity.ts";
import { redactAiMediaSensitiveText } from "@/lib/aiMediaSensitiveText";

const PROVIDER_ID = "google-gemini";
const DEFAULT_FAST_COST_MICRO_USD_PER_SECOND = 100_000;
const DEFAULT_LITE_COST_MICRO_USD_PER_SECOND = 50_000;
const DEFAULT_STANDARD_COST_MICRO_USD_PER_SECOND = 400_000;
// Google annonce une latence pouvant atteindre six minutes en période de
// pointe. La marge d'une minute couvre le téléchargement du clip sans couper
// une opération Veo encore valide.
const DEFAULT_TIMEOUT_MS = 420_000;
// Un contrôle toutes les 2,5 s récupère le résultat terminé jusqu'à 2,5 s
// plus tôt, tout en restant assez espacé pour les opérations longues.
const DEFAULT_POLL_MS = 2_500;
const DEFAULT_SUBMIT_ATTEMPTS = 4;
const DEFAULT_DOWNLOAD_ATTEMPTS = 3;
// Le modèle exposé à cette clé annonce une limite d'entrée de 480 tokens.
// 1 400 caractères laisse une marge pour la tokenisation des accents et évite
// qu'un profil très rempli invalide toute la génération.
const MAX_VEO_PROMPT_CHARS = 1_400;
// Keep the established two-act parallelism within typical Google RPM quotas.
const DEFAULT_CONCURRENCY = 2;
const MAX_CLIP_BYTES = 128 * 1024 * 1024;
const MINOR_SUBJECT_PATTERN =
  /\b(enfants?|bébés?|bebes?|adolescents?|mineurs?|garçons?|garcons?|filles?|children?|child|kids?|bab(?:y|ies)|toddlers?|teen(?:ager)?s?|minors?)\b/gi;

function positiveInt(value: unknown, fallback: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(maximum, parsed)
    : fallback;
}

function costMicroUsdPerSecond(model: string) {
  const normalized = model.toLocaleLowerCase();
  if (normalized.includes("-lite-")) {
    return positiveInt(
      process.env.AI_MEDIA_VEO_LITE_COST_MICRO_USD_PER_SECOND,
      DEFAULT_LITE_COST_MICRO_USD_PER_SECOND,
      1_000_000,
    );
  }
  if (normalized.includes("-fast-")) {
    return positiveInt(
      process.env.AI_MEDIA_VEO_FAST_COST_MICRO_USD_PER_SECOND ||
        process.env.AI_MEDIA_VEO_COST_MICRO_USD_PER_SECOND,
      DEFAULT_FAST_COST_MICRO_USD_PER_SECOND,
      1_000_000,
    );
  }
  return positiveInt(
    process.env.AI_MEDIA_VEO_STANDARD_COST_MICRO_USD_PER_SECOND,
    DEFAULT_STANDARD_COST_MICRO_USD_PER_SECOND,
    1_000_000,
  );
}

function compact(value: unknown, max = 400) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function promptSnippet(value: unknown, max: number) {
  const normalized = compact(value, max + 32);
  const cropped =
    normalized.length <= max
      ? normalized
      : normalized.slice(0, max + 1).replace(/\s+\S*$/u, "");
  return cropped
    .replace(/[\s.,;:—-]+$/u, "")
    .trim();
}

/**
 * Conserve le début ET la fin d'une saisie longue. Les professionnels placent
 * souvent le résultat attendu à la fin de leur phrase ; l'ancien `slice(0)`
 * supprimait précisément cette partie avant l'appel vidéo.
 */
export function priorityPromptSnippet(value: unknown, max: number) {
  const normalized = compact(value, Math.max(max * 5, max + 64));
  if (normalized.length <= max) return promptSnippet(normalized, max);
  const separator = " | ";
  const available = Math.max(8, max - separator.length);
  const headLength = Math.max(4, Math.ceil(available * 0.64));
  const tailLength = Math.max(4, available - headLength);
  const head = promptSnippet(normalized, headLength);
  const tailSource = normalized.slice(-Math.min(normalized.length, tailLength + 32));
  const tail = tailSource.length <= tailLength
    ? tailSource
    : tailSource.slice(-tailLength).replace(/^\S+\s+/u, "").trim();
  return promptSnippet(
    [head, tail].filter(Boolean).join(separator).slice(0, max),
    max,
  );
}

function joinCompletePromptSections(
  sections: readonly string[],
  maximum = MAX_VEO_PROMPT_CHARS,
) {
  let prompt = "";
  for (const section of sections.map((value) => compact(value, maximum)).filter(Boolean)) {
    const candidate = prompt ? `${prompt} ${section}` : section;
    if (candidate.length <= maximum) prompt = candidate;
  }
  return prompt;
}

function apiKey() {
  const value = String(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      "",
  ).trim();
  if (!value) throw new Error("ai_video_veo_credentials_missing");
  return value;
}

function modelCandidates() {
  return resolveVeoModelCandidates({
    primary: process.env.AI_MEDIA_VEO_MODEL || DEFAULT_VEO_MODEL,
    fallbacks: process.env.AI_MEDIA_VEO_FALLBACK_MODELS,
  });
}

function modelId() {
  return modelCandidates()[0];
}

/**
 * Veo/Omni n'acceptent que 16:9 ou 9:16. Pour une sortie carrée avec un
 * bandeau éditorial, une source 16:9 est la plus proche de la zone d'image
 * finale et évite de transformer le plan en petite vidéo verticale centrée.
 */
export function resolveGoogleVideoAspectRatio(
  format: AiVideoProviderGenerationArgs["request"]["format"],
): "16:9" | "9:16" {
  return format === "portrait" || format === "story" ? "9:16" : "16:9";
}

function generationCancelledError() {
  const error = new Error("ai_media_generation_cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw generationCancelledError();
}

function delay(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(generationCancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isExplicitlyRetryable(error: unknown) {
  return classifyVeoFailure(error).retryable;
}

function retryDelayMs(error: unknown, attempt: number) {
  const message = classifyVeoFailure(error).details;
  const explicitSeconds = message.match(
    /(?:retry(?:Delay)?|retry\s+in)[^0-9]{0,24}(\d+(?:\.\d+)?)\s*s/i,
  );
  if (explicitSeconds) {
    return Math.min(
      60_000,
      Math.max(2_000, Number(explicitSeconds[1]) * 1_000),
    );
  }
  const schedule = [1_000, 2_500, 6_000, 12_000] as const;
  const base = schedule[Math.min(attempt, schedule.length - 1)];
  // Jitter avoids several parallel clips retrying on the same millisecond.
  return Math.round(base * (0.85 + Math.random() * 0.3));
}

function normalizedProviderError(error: unknown) {
  const failure = classifyVeoFailure(error);
  const details = compact(failure.details, 700);
  if (failure.kind === "cancelled") return generationCancelledError();
  if (failure.kind === "safety") return safetyFilteredError(details);
  const codes: Partial<Record<typeof failure.kind, string>> = {
    invalid_argument: "ai_video_veo_configuration_rejected",
    rate_limited: "ai_video_veo_rate_limited",
    unavailable: "ai_video_veo_unavailable",
    timeout: "ai_video_veo_timeout",
    authentication: "ai_video_veo_credentials_rejected",
    permission: "ai_video_veo_permission_denied",
    not_found: "ai_video_veo_model_unavailable",
    network: "ai_video_veo_network_failed",
  };
  const code = codes[failure.kind] || "ai_video_veo_operation_failed";
  return new Error(details ? `${code}:${details}` : code);
}

function providerError(operation: GenerateVideosOperation) {
  const details = operation.error
    ? compact(JSON.stringify(operation.error), 600)
    : "unknown";
  if (/safety|rai|responsible/i.test(details)) {
    return safetyFilteredError(details);
  }
  return normalizedProviderError(operation.error || details);
}

function safetyFilteredError(reasons: unknown) {
  const values = Array.isArray(reasons) ? reasons : [reasons];
  const details = compact(
    values
      .map((reason) =>
        typeof reason === "string" ? reason : JSON.stringify(reason),
      )
      .filter(Boolean)
      .join(" | "),
    600,
  );
  return new Error(
    details && details !== "undefined"
      ? `ai_video_veo_safety_filtered:${details}`
      : "ai_video_veo_safety_filtered",
  );
}

function isSafetyFiltered(error: unknown) {
  return compact(
    error instanceof Error ? error.message : error,
    1_000,
  ).includes("ai_video_veo_safety_filtered");
}

function mentionsMinorAudience(value: unknown) {
  MINOR_SUBJECT_PATTERN.lastIndex = 0;
  return MINOR_SUBJECT_PATTERN.test(String(value ?? ""));
}

function adultSafePromptText(value: unknown, max: number) {
  MINOR_SUBJECT_PATTERN.lastIndex = 0;
  return compact(
    String(value ?? "").replace(MINOR_SUBJECT_PATTERN, "public familial"),
    max,
  );
}

export function buildGoogleVideoSafetyFallbackPrompt(prompt: string) {
  const withoutReferenceInstructions = prompt
    .replace(
      /Animate the supplied initial image naturally\.[^.]*\.[^.]*\./i,
      "Create a fresh original scene faithful to the requested business subject and visual direction.",
    )
    .replace(
      /Use every supplied asset reference[^.]*\.[^.]*\./i,
      "Create a fresh original scene faithful to the requested business subject and visual direction.",
    );
  return compact(
    [
      "SAFETY RECOVERY: create a new scene without copying any recognizable real person's face or identity. Only unmistakably mature adults aged 25 or older may be visible.",
      withoutReferenceInstructions,
    ].join(" "),
    MAX_VEO_PROMPT_CHARS,
  );
}

export function promptForInspirationMode(
  prompt: string,
  mode: "references" | "source" | "none",
) {
  if (mode === "references") return prompt;
  if (mode === "source") {
    const sourceContract =
      "REFERENCE: supplied image is animation source; keep subject/design; real motion at 0.0s; no freeze/slideshow/pan-zoom.";
    // Le prompt v18 place le rôle de la référence dans une section bornée.
    // La remplacer in situ conserve le budget réservé aux paramètres et à la
    // continuité ; préfixer puis tronquer ferait justement disparaître la fin
    // critique sur les prompts proches de la limite Veo.
    const currentReference = prompt.match(
      /REFERENCE:[\s\S]*?(?=\sACT:)/i,
    )?.[0];
    if (!currentReference) return prompt;
    // Une référence d'identité ou une source cinématique possède déjà son
    // contrat d'animation. Ne jamais l'écraser par un rôle générique.
    if (
      /identities locked|same face\/hair\/build|same design\/features|source to animate/i.test(
        currentReference,
      )
    ) {
      return prompt;
    }
    const sourcePrompt = prompt.replace(
      /REFERENCE:[\s\S]*?(?=\sACT:)/i,
      `${sourceContract} `,
    );
    if (sourcePrompt.length <= MAX_VEO_PROMPT_CHARS) return sourcePrompt;

    // Le contenu après CONTINUITY (ou PEOPLE sur un plan unique) est
    // facultatif. S'il faut récupérer quelques caractères, supprimer ces
    // sections entières évite de couper une instruction au milieu d'un mot.
    const finalRequiredSection = sourcePrompt.includes(" CONTINUITY:")
      ? sourcePrompt.lastIndexOf(" CONTINUITY:")
      : sourcePrompt.lastIndexOf(" PEOPLE:");
    const finalRequiredPeriod = sourcePrompt.indexOf(
      ". ",
      Math.max(0, finalRequiredSection),
    );
    if (
      finalRequiredSection >= 0 &&
      finalRequiredPeriod > finalRequiredSection &&
      finalRequiredPeriod + 1 <= MAX_VEO_PROMPT_CHARS
    ) {
      return sourcePrompt.slice(0, finalRequiredPeriod + 1);
    }
    throw new Error(
      `ai_video_veo_source_prompt_budget_exceeded:${sourcePrompt.length}`,
    );
  }
  return prompt
    .replace(
      /Animate the supplied initial image naturally\.[^.]*\.[^.]*\./i,
      "Create a fresh original scene faithful to the exact business subject and visual direction.",
    )
    .replace(
      /Use every supplied asset reference[^.]*\.[^.]*\./i,
      "Create a fresh original scene faithful to the exact business subject and visual direction.",
    );
}

function subjectVisualEvidence(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
  const evidence: string[] = [];

  if (
    /\b(application|appli|app|mobile|smartphone|telephone|tablette)\b/.test(
      normalized,
    )
  ) {
    evidence.push(
      "Keep a smartphone, tablet or laptop in the foreground and show a real person tapping, swiping or using the digital product",
    );
  }
  if (
    /\b(logiciel|plateforme|saas|dashboard|site web|site internet|numerique|digital)\b/.test(
      normalized,
    )
  ) {
    evidence.push(
      "Make the software workflow visible through a clean unlabeled interface made only of cards, icons, images and motion",
    );
  }
  if (
    /\b(media|medias|image|images|video|videos|contenu|publication|communication|reseaux sociaux|ia|intelligence artificielle)\b/.test(
      normalized,
    )
  ) {
    evidence.push(
      "Show visual content being created, previewed or published through recognizable photo and video thumbnails",
    );
  }
  if (
    /\b(maconnerie|macon|construction|batiment|chantier|renovation|brique|beton)\b/.test(
      normalized,
    )
  ) {
    evidence.push(
      "Show an unmistakable masonry or construction site with the relevant craftsperson, tools and materials such as bricks, mortar, concrete or a trowel",
    );
  }
  if (
    /\b(cheval|chevaux|equitation|equestre|equine|ecurie|poney|poneys)\b/.test(
      normalized,
    )
  ) {
    evidence.push(
      "Show real horses as central subjects in a credible stable, paddock or riding environment with the requested human action",
    );
  }

  return compact(
    evidence.length
      ? evidence.join(". ")
      : "Show tangible objects, gestures and actions explicitly connected to the primary subject",
    180,
  );
}

function subjectDigitalDirection(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
  return /\b(application|appli|app|mobile|smartphone|telephone|tablette|logiciel|plateforme|saas|dashboard|site web|site internet|numerique|digital|reseaux sociaux)\b/.test(
    normalized,
  )
    ? "This is a digital subject: keep a relevant device in view and show a clean app or software workflow through unlabeled shapes, icons, images and motion"
    : "";
}

function subjectSafetyDirection(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();

  if (
    /\b(massage|massages|spa|bien[- ]etre|relaxation|soin du corps|soins du corps|therapie manuelle)\b/.test(
      normalized,
    )
  ) {
    return "Professional wellness service only: show a clearly adult client modestly covered by towels or sheets, with only shoulders, upper back, hands or lower legs visible; the adult practitioner wears professional clothing; calm non-sexual care, no intimate body area";
  }
  if (
    /\b(esthetique|beaute|institut|visage|coiffure|barbier|onglerie|manucure|pedicure)\b/.test(
      normalized,
    )
  ) {
    return "Professional beauty service only: clearly adult client and practitioner, normal salon clothing or modest treatment coverage, no intimate body area and no sexualized pose";
  }
  if (
    /\b(medecin|medical|sante|clinique|cabinet|kine|physiotherapie|osteopath|dentiste|infirmier)\b/.test(
      normalized,
    )
  ) {
    return "Professional healthcare context only: clearly adult patient and qualified adult professional, modest clothing, non-graphic routine care, no injury detail, blood or invasive procedure";
  }
  return "";
}

const VEO_VISUAL_STYLE_CUES: Record<
  AiVideoProviderGenerationArgs["request"]["visualStyle"],
  string
> = {
  brand: "brand-led",
  clean: "minimal",
  premium: "luxury",
  warm: "human-warm",
  dynamic: "energetic",
  expert: "precise",
  local: "authentic-local",
  colorful: "vivid",
};

const VEO_RENDER_CUES: Record<
  AiVideoProviderGenerationArgs["request"]["imageStyle"],
  string
> = {
  photo: "cinematic",
  illustration: "animated",
  three_d: "polished-3d",
  graphic: "motion-graphics",
};

/** Every UI choice is encoded once, without depending on optional prose. */
export function buildGoogleVideoParameterContract(
  request: AiVideoProviderGenerationArgs["request"],
  durationSeconds: 4 | 6 | 8,
  colors: string,
) {
  // Hex values are rendering metadata, not content for a generative model.
  // Describe their visible effect without giving it codes to print as a chart.
  const colorNames = request.useBrandColors
    ? describeAiMediaBrandColors(colors.split(","))
    : [];
  const palette = colorNames.length ? colorNames.join("/") : "subject-led";
  return compact(
    [
      `${durationSeconds}s`,
      request.format,
      request.typology,
      `visual=${request.visualStyle}/${VEO_VISUAL_STYLE_CUES[request.visualStyle]}`,
      `render=${request.imageStyle}/${VEO_RENDER_CUES[request.imageStyle]}`,
      `shot=${request.shotType}`,
      `people=${request.peopleMode}`,
      `creative=${request.creativity}`,
      `light/material-accents=${palette}`,
    ].join(";"),
    220,
  );
}

function selectedVideoFraming(shotType: AiVideoProviderGenerationArgs["request"]["shotType"]) {
  switch (shotType) {
    case "close":
      return {
        contract: "FRAME close/full heads",
        direction: "Stable close shot, never extreme close-up; keep the complete head, chin and shoulders visible with headroom",
      };
    case "medium":
      return {
        contract: "FRAME medium/full heads",
        direction: "Stable medium shot; keep the complete head, shoulders and upper torso visible with headroom",
      };
    case "wide":
      return {
        contract: "FRAME wide/full subjects",
        direction: "Stable wide shot; keep complete subjects and their surroundings visible with comfortable margins",
      };
    default:
      return {
        contract: "FRAME medium-wide/full heads",
        direction: "Stable medium-wide shot, never extreme close-up; keep complete hairline, entire head, chin, shoulders and upper torso in frame with headroom",
      };
  }
}

export function buildGoogleVideoFramingDirection(
  request: AiVideoProviderGenerationArgs["request"],
) {
  const common = selectedVideoFraming(request.shotType).direction;
  const identityIsAnimated =
    request.teamVideoMode === "cinematic" &&
    request.inspirationImages.length > 0;
  if (!identityIsAnimated) {
    return `${common}. Keep every face, head and important subject fully inside frame with comfortable margins.`;
  }
  if (request.format === "square") {
    return `FINAL 1:1 SAFE FRAME — ${common}; keep speakers upper-centre and leave clean space below`;
  }
  if (request.format === "portrait") {
    return `FINAL 4:5 SAFE FRAME — ${common}; keep speakers centred in the safe area`;
  }
  return `${common}. Keep the person away from every edge of the final frame`;
}

export function buildGoogleVideoTeamSpeechDirection(
  args: AiVideoProviderGenerationArgs,
  index: number,
) {
  if (
    args.request.teamVideoMode !== "cinematic" ||
    args.request.inspirationImages.length === 0
  ) {
    return "AUDIO: natural ambience only; no speech, voice-over, lyrics or music. iNrCy adds final audio.";
  }

  if (args.request.teamVideoSpeechMode !== "characters") {
    return "VOICE-OVER: people stay silent with closed mouths; no native speech, lip-sync, vocalisation, lyrics or music; ambience only. iNrCy adds narration.";
  }

  const language = String(args.contentLanguage || "fr").toLowerCase();
  const firstLine = resolveAiMediaDialogueSequence({
    scenes: args.plan.scenes,
    headline: args.plan.headline,
    language,
  })[index];
  if (args.request.identityMode !== "reference_team") {
    return `DIALOGUE: recurring character lip-syncs once 0.2–5.5s: “${firstLine}” Then mouth closed/silent. No repeat/old line/narrator/music/cloning; stable adult synthetic voice.`;
  }
  const teamSize = args.identityTeamMemberCount === 3 ? 3 : 2;
  const firstSpeaker = (index % teamSize) + 1;
  return `DIALOGUE: Person ${firstSpeaker} left-to-right lip-syncs once 0.2–5.5s: “${firstLine}” Then mouth closed/silent. No repeat/old line/narrator/music/cloning/voice-face swap; stable adult synthetic voice.`;
}

export function buildGoogleVideoSequenceDirection(
  index: number,
  total: number,
) {
  if (index <= 0) {
    return "OPENING: requested action moves at frame 1";
  }
  if (index >= total - 1) {
    return "FINAL: same task reaches requested result";
  }
  return "MIDDLE: new proof step; no opening replay";
}

function buildGoogleVideoContinuityCast(
  request: AiVideoProviderGenerationArgs["request"],
  identityTeamMemberCount?: 2 | 3,
) {
  if (request.videoCharacterMode === "reference_team") {
    return `same ${identityTeamMemberCount === 3 ? 3 : 2} approved adults, each once`;
  }
  if (request.videoCharacterMode === "professional") {
    return "same approved adult, face/hair/build";
  }
  if (request.videoCharacterMode === "brand_avatar") {
    return "same approved avatar/design";
  }
  if (request.inspirationImages.length && request.teamVideoMode === "cinematic") {
    return "same supplied subject/design";
  }
  return request.peopleMode === "none"
    ? "no people"
    : "the same credible adult cast";
}

/**
 * Compact deterministic continuity contract repeated in every 8 s act.
 * Keeping this below a fixed budget is essential: the immutable anchors must
 * remain alongside the visual continuation frame, never the optional part
 * that disappears when a professional writes a long instruction.
 */
export function buildGoogleVideoContinuityContract(
  args: AiVideoProviderGenerationArgs,
) {
  const firstScene = args.plan.scenes[0];
  const finalScene = args.plan.scenes.at(-1);
  const startState = promptSnippet(
    firstScene?.title || firstScene?.visualBrief || args.request.idea,
    12,
  );
  const endState = promptSnippet(
    finalScene?.title || finalScene?.visualBrief || args.plan.cta,
    12,
  );
  return compact(
    [
      `CAST ${buildGoogleVideoContinuityCast(
        args.request,
        args.identityTeamMemberCount,
      )}`,
      "LOCK faces/hair/clothes/voices/place/light/palette/lens/camera",
      `PATH ${startState || "task begins"}->${endState || "task completed"}`,
      selectedVideoFraming(args.request.shotType).contract,
    ].join("; "),
    180,
  );
}

export function buildGoogleVideoReferenceContract(
  request: AiVideoProviderGenerationArgs["request"],
  identityTeamMemberCount?: 2 | 3,
) {
  const count = request.inspirationImages.length;
  if (!count) return "none; create an original scene";
  if (request.identityMode === "reference_team") {
    return `group=${identityTeamMemberCount === 3 ? 3 : 2} adults, each once; identities locked; all move 0.0s; no merge/omit/duplicate/swap`;
  }
  if (request.identityMode === "professional") {
    return `${count} adult identity view${count === 1 ? "" : "s"}; same face/hair/build each act; real motion at 0.0s`;
  }
  if (request.identityMode === "brand_avatar") {
    return `${count} avatar reference${count === 1 ? "" : "s"}; same design/features each act; real motion at 0.0s`;
  }
  if (request.teamVideoMode === "cinematic") {
    return "source to animate, not mood board; keep main subject/design each act; real motion at 0.0s";
  }
  return `${count} inspiration image${count === 1 ? "" : "s"}; use subject/mood/composition/style, not real identity`;
}

function preservesIdentityReferences(
  request: AiVideoProviderGenerationArgs["request"],
) {
  return (
    request.inspirationImages.length > 0 &&
    (request.teamVideoMode === "cinematic" ||
      request.videoCharacterMode === "professional" ||
      request.videoCharacterMode === "brand_avatar" ||
      request.videoCharacterMode === "reference_team")
  );
}

function identityReferenceRejectedError(error: unknown) {
  const details = compact(classifyVeoFailure(error).details, 620);
  return new Error(
    details
      ? `ai_video_identity_reference_rejected:${details}`
      : "ai_video_identity_reference_rejected",
  );
}

function isIdentityReferenceRejected(error: unknown) {
  return compact(
    error instanceof Error ? error.message : error,
    1_000,
  ).includes("ai_video_identity_reference_rejected");
}

export function buildGoogleVideoScenePrompt(
  args: AiVideoProviderGenerationArgs,
  index: number,
  durationSeconds: 4 | 6 | 8,
  options: { continuation?: boolean; continuationFrame?: boolean; firstFrameTag?: boolean } = {},
) {
  const scene = args.plan.scenes[index];
  const colors = args.brandColors.filter(Boolean).slice(0, 5).join(", ");
  const rawContext = [
    args.request.idea,
    args.request.aiInstruction,
    args.creativeBrief,
    scene?.visualBrief,
    scene?.title,
    scene?.body,
  ]
    .filter(Boolean)
    .join(" ");
  const servesMinorAudience = mentionsMinorAudience(rawContext);
  const exactIdea = adultSafePromptText(args.request.idea, 700);
  const professionalActivity = adultSafePromptText(
    args.profession || args.plan.companyName,
    140,
  );
  const visualEvidence = subjectVisualEvidence(rawContext);
  const digitalDirection = subjectDigitalDirection(rawContext);
  const safetyDirection = subjectSafetyDirection(rawContext);
  const businessContext = adultSafePromptText(args.creativeBrief, 180);
  const sceneDirection = adultSafePromptText(scene?.visualBrief, 700);
  const punctualInstruction = adultSafePromptText(
    args.request.aiInstruction,
    700,
  );
  const speechDirection = buildGoogleVideoTeamSpeechDirection(args, index);
  const framingDirection = buildGoogleVideoFramingDirection(args.request);
  const sequenceDirection = buildGoogleVideoSequenceDirection(
    index,
    args.plan.scenes.length,
  );
  const storyArc = args.plan.scenes
    .map((plannedScene, plannedIndex) => {
      const beat = promptSnippet(
        plannedScene.title ||
          plannedScene.body ||
          plannedScene.visualBrief ||
          args.request.idea,
        22,
      );
      return `${plannedIndex + 1}:${beat}`;
    })
    .join(" -> ");
  const nativeDialogueRequested =
    args.request.teamVideoMode === "cinematic" &&
    args.request.teamVideoSpeechMode === "characters" &&
    args.request.inspirationImages.length > 0;
  // Le budget Veo est strict. Ces limites privilégient la saisie du
  // professionnel, mais conservent aussi le rôle du fichier joint, l'action de
  // l'acte et les paramètres visuels dans CHAQUE segment indépendant.
  const subjectSource = exactIdea
      ? exactIdea
      : `${professionalActivity}; ${businessContext}`;
  const actionSource = [sceneDirection, scene?.title, scene?.body].filter(Boolean).join(" — ");
  let subjectBudget = nativeDialogueRequested ? 105 : 190;
  let instructionBudget = nativeDialogueRequested ? 54 : 125;
  let actionBudget = nativeDialogueRequested ? 70 : 118;
  let primarySubject = priorityPromptSnippet(subjectSource, subjectBudget);
  let userDirection = priorityPromptSnippet(punctualInstruction, instructionBudget);
  const referenceContract = promptSnippet(
    options.continuationFrame
      ? "prior generated frame; preserve its visible cast/design/place/framing; continue action"
      : buildGoogleVideoReferenceContract(
      args.request,
      args.identityTeamMemberCount,
    ),
    nativeDialogueRequested ? 98 : 175,
  );
  // Depuis le plan v18, visualBrief commence par le rôle propre de l'acte. Le
  // garder avant son titre évite que les actes 1–8, 9–16 et 17–24 rejouent la
  // même pose ou que seule la seconde tranche anime la référence.
  let actAction = priorityPromptSnippet(actionSource, actionBudget);
  const sequenceHeader = options.continuation
    ? "[# Sources <PREVIOUS_VIDEO>@Video1] Continue prior frame: same scene/motion; no intro/reset/recap/cut."
    : options.continuationFrame
      ? `${options.firstFrameTag ? "[# Sources <FIRST_FRAME>@Image1] " : ""}Start from first frame (prior shot's end); continue motion; no reset/cut.`
    : `SHOT ${index + 1}/${args.plan.scenes.length}; ${durationSeconds}s; one continuous take.`;
  const adultSafety =
    args.request.peopleMode === "none"
      ? "PEOPLE: none, including silhouettes/faces."
      : "PEOPLE: mature adults 25+ only; no minors.";
  const selectedParameters = buildGoogleVideoParameterContract(
    args.request,
    durationSeconds,
    colors,
  );

  // Contrat commun image→vidéo : l'ordre reflète la hiérarchie produit. Les
  // garde-fous de texte arrivent avant tout contexte facultatif afin que Veo
  // ne génère plus de faux panneaux (« Agenice », « Agenue », etc.).
  const requiredSections = () => [
    sequenceHeader,
    `SUBJECT: ${primarySubject}. Keep entities/actions/relations; no swaps.`,
    userDirection
      ? `USER: ${userDirection}. Obey; never show/recite.`
      : "",
    `REFERENCE: ${referenceContract}`,
    `ACT: ${promptSnippet(sequenceDirection, 45)}; ${actAction}. Animate from 0.0s throughout; no still/freeze/slideshow/pan-zoom/reset/cut.`,
    "NO VISUAL TEXT: blank surfaces; no text/pseudo-text/numbers/UI/logos/watermarks/swatches/color charts/hex codes/technical annotations, even from refs. Never draw PARAMS.",
    speechDirection,
    `PARAMS: ${selectedParameters}.`,
    adultSafety,
    args.plan.scenes.length > 1
      ? `CONTINUITY: ${promptSnippet(buildGoogleVideoContinuityContract(args), 170)}.`
      : "",
  ].filter(Boolean);
  let sections = requiredSections();
  let requiredPrompt = sections.join(" ");
  // Frame tags and long selected parameters share the same strict budget.
  // Reduce only descriptive excerpts, preserving their beginning AND ending;
  // never drop dialogue, references, selected settings or complete guardrails.
  while (
    requiredPrompt.length > MAX_VEO_PROMPT_CHARS &&
    (subjectBudget > 80 || instructionBudget > 42 || actionBudget > 50)
  ) {
    const reduction = Math.max(4, Math.ceil((requiredPrompt.length - MAX_VEO_PROMPT_CHARS) / 3));
    subjectBudget = Math.max(80, subjectBudget - reduction);
    instructionBudget = Math.max(42, instructionBudget - reduction);
    actionBudget = Math.max(50, actionBudget - reduction);
    primarySubject = priorityPromptSnippet(subjectSource, subjectBudget);
    userDirection = priorityPromptSnippet(punctualInstruction, instructionBudget);
    actAction = priorityPromptSnippet(actionSource, actionBudget);
    sections = requiredSections();
    requiredPrompt = sections.join(" ");
  }
  if (requiredPrompt.length > MAX_VEO_PROMPT_CHARS) {
    throw new Error(
      `ai_video_veo_required_prompt_budget_exceeded:${requiredPrompt.length}:${sections
        .map((section) => section.length)
        .join(",")}`,
    );
  }

  return joinCompletePromptSections([
    requiredPrompt,
    !options.continuation && args.plan.scenes.length > 1
      ? `ONE FILM: ${promptSnippet(storyArc, 90)}; advance without restart or contradiction.`
      : "",
    `VISUAL PROOF: ${promptSnippet(visualEvidence, 120)}.`,
    framingDirection ? `${promptSnippet(framingDirection, 150)}.` : "",
    safetyDirection ? `PROFESSIONAL SAFETY: ${promptSnippet(safetyDirection, 135)}.` : "",
    digitalDirection ? `${promptSnippet(digitalDirection, 110)}.` : "",
    servesMinorAudience
      ? "Family-facing context is shown only through venue, equipment, products, animals and adult staff."
      : "",
    businessContext ? `VERIFIED CONTEXT: ${priorityPromptSnippet(businessContext, 110)}.` : "",
    "Credible anatomy, action and continuity; clean composition and comfortable edge margins.",
  ]);
}

async function submitOperation(args: {
  ai: GoogleGenAI;
  model: string;
  prompt: string;
  durationSeconds: 4 | 6 | 8;
  aspectRatio: "16:9" | "9:16";
  inspirationImages?: AiVideoProviderGenerationArgs["request"]["inspirationImages"];
  continuityFrame?: AiMediaVideoContinuityFrame;
  preserveIdentityReferences: boolean;
  signal: AbortSignal;
}) {
  let lastError: unknown = null;
  let inspirationMode = args.continuityFrame ? "source" as const : selectVeoInspirationMode({
    model: args.model,
    durationSeconds: args.durationSeconds,
    imageCount: args.inspirationImages?.length || 0,
  });
  let transientAttempt = 0;
  const warnings: string[] = [];

  while (transientAttempt < DEFAULT_SUBMIT_ATTEMPTS) {
    try {
      const sourceImage =
        args.continuityFrame || (inspirationMode === "source" ? args.inspirationImages?.[0] : null);
      const operation = await args.ai.models.generateVideos({
        model: args.model,
        source: {
          prompt: args.continuityFrame
            ? args.prompt
            : promptForInspirationMode(args.prompt, inspirationMode),
          ...(sourceImage
            ? {
                image: {
                  imageBytes: sourceImage.data,
                  mimeType: sourceImage.mimeType,
                },
              }
            : {}),
        },
        // Gemini Developer API / Veo 3.1 Fast whitelist. Do not add generic
        // GenerateVideosConfig fields here unless the Veo model contract lists
        // them explicitly. Audio, one output and 720p are model defaults.
        config: {
          abortSignal: args.signal,
          durationSeconds: args.durationSeconds,
          aspectRatio: args.aspectRatio,
          // Les routes Veo 3/3.1 européennes n'acceptent que allow_adult pour
          // les personnes. L'expliciter avec une référence évite que le visage
          // adulte autorisé soit rejeté selon le défaut régional du projet.
          ...(args.continuityFrame || args.inspirationImages?.length
            ? { personGeneration: "allow_adult" }
            : {}),
          ...(!args.continuityFrame && inspirationMode === "references" && args.inspirationImages
            ? {
                referenceImages: args.inspirationImages.map((image) => ({
                  image: {
                    imageBytes: image.data,
                    mimeType: image.mimeType,
                  },
                  referenceType: VideoGenerationReferenceType.ASSET,
                })),
              }
            : {}),
        },
      });
      return { operation, warnings };
    } catch (error) {
      lastError = error;
      const failure = classifyVeoFailure(error);
      // Generic inspiration is optional. Approved identity references are a
      // hard contract: never downgrade them to a source-only or text-only
      // request, because that would silently substitute another person.
      const nextMode = nextVeoInspirationMode(inspirationMode);
      if (failure.kind === "invalid_argument" && nextMode) {
        if (args.preserveIdentityReferences || args.continuityFrame) {
          throw identityReferenceRejectedError(error);
        }
        warnings.push(
          inspirationMode === "references"
            ? "veo_inspiration_references_downgraded"
            : "veo_inspiration_image_downgraded",
        );
        inspirationMode = nextMode;
        continue;
      }
      transientAttempt += 1;
      if (transientAttempt >= DEFAULT_SUBMIT_ATTEMPTS || !failure.retryable) {
        throw normalizedProviderError(error);
      }
      await delay(retryDelayMs(error, transientAttempt - 1), args.signal);
    }
  }
  throw normalizedProviderError(lastError);
}

function assertMp4Clip(buffer: Buffer) {
  if (!buffer.length) throw new Error("ai_video_veo_clip_empty");
  if (buffer.length > MAX_CLIP_BYTES) {
    throw new Error("ai_video_veo_clip_too_large");
  }
  const signatureOffset = buffer.indexOf(Buffer.from("ftyp"), 0);
  if (signatureOffset < 4 || signatureOffset > 24) {
    throw new Error("ai_video_veo_clip_not_mp4");
  }
}

async function downloadVideo(args: {
  ai: GoogleGenAI;
  video: Video;
  signal: AbortSignal;
}) {
  const mediaType = compact(args.video.mimeType, 80) || "video/mp4";
  let inlineError: unknown = null;
  if (args.video.videoBytes) {
    try {
      const buffer = Buffer.from(args.video.videoBytes, "base64");
      assertMp4Clip(buffer);
      return { buffer, mediaType };
    } catch (error) {
      inlineError = error;
      // Some responses expose both inline bytes and a downloadable URI. If
      // the inline payload is malformed, recover the same already-generated
      // (and potentially billed) video through its URI instead of creating a
      // second render.
      if (!args.video.uri) throw error;
    }
  }

  const directory = await mkdtemp(join(tmpdir(), "inrcy-veo-"));
  try {
    let lastError: unknown = inlineError;
    for (let attempt = 0; attempt < DEFAULT_DOWNLOAD_ATTEMPTS; attempt += 1) {
      const outputPath = join(directory, `clip-${attempt}.mp4`);
      try {
        await args.ai.files.download({
          file: args.video,
          downloadPath: outputPath,
          config: { abortSignal: args.signal },
        });
        const info = await stat(outputPath);
        if (!info.size) throw new Error("ai_video_veo_clip_empty");
        if (info.size > MAX_CLIP_BYTES) {
          throw new Error("ai_video_veo_clip_too_large");
        }
        const buffer = await readFile(outputPath);
        assertMp4Clip(buffer);
        return { buffer, mediaType: "video/mp4" };
      } catch (error) {
        lastError = error;
        const retryable =
          classifyVeoFailure(error).retryable ||
          /ai_video_veo_clip_(?:empty|not_mp4)/.test(
            compact(error instanceof Error ? error.message : error, 200),
          );
        if (attempt >= DEFAULT_DOWNLOAD_ATTEMPTS - 1 || !retryable) break;
        await delay(retryDelayMs(error, attempt), args.signal);
      }
    }
    const details = compact(classifyVeoFailure(lastError).details, 700);
    throw new Error(
      details
        ? `ai_video_veo_download_failed:${details}`
        : "ai_video_veo_download_failed",
    );
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

async function generateClip(args: {
  ai: GoogleGenAI;
  models: string[];
  prompt: string;
  durationSeconds: 4 | 6 | 8;
  aspectRatio: "16:9" | "9:16";
  inspirationImages?: AiVideoProviderGenerationArgs["request"]["inspirationImages"];
  continuityFrame?: AiMediaVideoContinuityFrame;
  preserveIdentityReferences: boolean;
  timeoutMs: number;
  pollMs: number;
  onBillable: (model: string) => void;
  signal?: AbortSignal;
}): Promise<AiVideoProviderClip> {
  throwIfAborted(args.signal);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(generationCancelledError());
  args.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("ai_video_veo_timeout"));
  }, args.timeoutMs);
  try {
    let lastError: unknown = null;
    const accumulatedWarnings: string[] = [];

    for (let modelIndex = 0; modelIndex < args.models.length; modelIndex += 1) {
      const model = args.models[modelIndex];
      let billableOutputExists = false;
      const inspirationImages = args.inspirationImages || [];
      const contentAttempts =
        (inspirationImages.length && args.preserveIdentityReferences) || args.continuityFrame
          ? [{ prompt: args.prompt, inspirationImages }]
          : inspirationImages.length
          ? [
              { prompt: args.prompt, inspirationImages },
              { prompt: args.prompt, inspirationImages: [] },
              {
                prompt: buildGoogleVideoSafetyFallbackPrompt(args.prompt),
                inspirationImages: [],
              },
            ]
          : [
              { prompt: args.prompt, inspirationImages: [] },
              {
                prompt: buildGoogleVideoSafetyFallbackPrompt(args.prompt),
                inspirationImages: [],
              },
            ];

      for (
        let attemptIndex = 0;
        attemptIndex < contentAttempts.length;
        attemptIndex += 1
      ) {
        const attempt = contentAttempts[attemptIndex];
        try {
          const submitted = await submitOperation({
            ...args,
            model,
            prompt: attempt.prompt,
            inspirationImages: attempt.inspirationImages,
            preserveIdentityReferences: args.preserveIdentityReferences,
            signal: controller.signal,
          });
          accumulatedWarnings.push(...submitted.warnings);
          let operation = submitted.operation;
          const requestId = compact(operation.name, 220);
          if (!requestId) throw new Error("ai_video_veo_operation_id_missing");

          while (!operation.done) {
            await delay(args.pollMs, controller.signal);
            try {
              operation = await args.ai.operations.getVideosOperation({
                operation,
                config: { abortSignal: controller.signal },
              });
            } catch (error) {
              if (!isExplicitlyRetryable(error)) {
                throw normalizedProviderError(error);
              }
              await delay(retryDelayMs(error, 0), controller.signal);
            }
          }
          if (operation.error) throw providerError(operation);
          const response = operation.response;
          if (response?.raiMediaFilteredCount) {
            throw safetyFilteredError(response.raiMediaFilteredReasons);
          }
          const video = response?.generatedVideos?.[0]?.video;
          if (!video) throw new Error("ai_video_veo_video_missing");

          // From this point the provider can charge the clip. Never submit a
          // replacement model if its download fails: only retry the download.
          billableOutputExists = true;
          args.onBillable(model);
          const downloaded = await downloadVideo({
            ai: args.ai,
            video,
            signal: controller.signal,
          });
          return {
            ...downloaded,
            durationSeconds: args.durationSeconds,
            requestId,
            model,
            warnings: Array.from(new Set(accumulatedWarnings)),
          };
        } catch (error) {
          lastError = error;
          if (billableOutputExists) throw error;
          const failure = classifyVeoFailure(error);
          if (
            (args.continuityFrame || (args.preserveIdentityReferences &&
            attempt.inspirationImages.length > 0)) &&
            (failure.kind === "invalid_argument" || failure.kind === "safety")
          ) {
            lastError = isIdentityReferenceRejected(error)
              ? error
              : identityReferenceRejectedError(error);
            break;
          }
          const canRetryWithoutInspiration =
            !args.preserveIdentityReferences && !args.continuityFrame &&
            attempt.inspirationImages.length > 0 &&
            (failure.kind === "invalid_argument" || failure.kind === "safety");
          if (canRetryWithoutInspiration) {
            accumulatedWarnings.push(
              failure.kind === "safety"
                ? "veo_inspiration_safety_downgraded"
                : "veo_async_inspiration_downgraded",
            );
            continue;
          }
          const nextAttempt = contentAttempts[attemptIndex + 1];
          const canRetryAfterSafety =
            isSafetyFiltered(error) && nextAttempt?.prompt !== attempt.prompt;
          if (canRetryAfterSafety) {
            accumulatedWarnings.push("veo_safety_prompt_recovery");
            continue;
          }
          break;
        }
      }

      const failure = classifyVeoFailure(lastError);
      const missingNonBillableOutput =
        /ai_video_veo_(?:video|operation_id)_missing/.test(
          compact(
            lastError instanceof Error ? lastError.message : lastError,
            400,
          ),
        );
      const canUseFallback =
        modelIndex < args.models.length - 1 &&
        !timedOut &&
        !isIdentityReferenceRejected(lastError) &&
        (failure.modelFallbackEligible || missingNonBillableOutput);
      if (!canUseFallback) throw lastError;
      accumulatedWarnings.push(
        `veo_model_fallback:${model}->${args.models[modelIndex + 1]}`,
      );
    }
    throw lastError;
  } catch (error) {
    if (timedOut) throw new Error("ai_video_veo_timeout");
    if (args.signal?.aborted || controller.signal.aborted) {
      throw generationCancelledError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    args.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export const googleVeoVideoProvider: AiVideoProvider = {
  id: PROVIDER_ID,
  get model() {
    return modelId();
  },
  async generate(args): Promise<AiVideoProviderResult> {
    throwIfAborted(args.signal);
    // Défense en profondeur : même avec les marqueurs internes, Google ne peut
    // recevoir ni les portraits bruts ni un mélange de références.
    assertAiVideoReferenceTeamGoogleEgress(args);
    const ai = new GoogleGenAI({ apiKey: apiKey() });
    const preserveIdentityReferences = preservesIdentityReferences(
      args.request,
    );
    const configuredModels = modelCandidates();
    // Approved identities stay on a reference-capable model. Independent acts
    // reuse the originals; connected acts inherit the prior generated frame.
    const models =
      preserveIdentityReferences && args.request.inspirationImages.length > 0
        ? configuredModels.filter(supportsVeoReferenceImages)
        : configuredModels;
    if (!models.length) {
      throw new Error(
        "ai_video_identity_reference_rejected:no_compatible_reference_model",
      );
    }
    const primaryModel = models[0];
    const timeoutMs = positiveInt(
      process.env.AI_MEDIA_VIDEO_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      600_000,
    );
    const pollMs = positiveInt(
      process.env.AI_MEDIA_VEO_POLL_MS,
      DEFAULT_POLL_MS,
      15_000,
    );
    const requestedDurations = getAiMediaVideoSegmentDurations(
      args.request.durationSeconds || 16,
    );
    // Keep exact commercial durations for both independent and connected acts.
    const durations: Array<4 | 6 | 8> = [...requestedDurations];
    if (args.plan.scenes.length !== durations.length) {
      throw new Error("ai_video_veo_scene_count_invalid");
    }
    const connectScenes = durations.length > 1 && args.request.connectScenes === true;
    const configuredConcurrency = positiveInt(
      process.env.AI_MEDIA_VEO_CONCURRENCY,
      DEFAULT_CONCURRENCY,
      4,
    );
    // Keep the per-clip allowance while bounding the whole sequential film.
    // 600 s leaves headroom inside the 800 s route for planning/composition.
    const generationDeadline = Date.now() + Math.min(600_000, timeoutMs * durations.length);
    const totalDurationSeconds = durations.reduce(
      (total, duration) => total + duration,
      0,
    );
    // A commercial 16/24 s film must never change renderer between acts.
    // Model fallback remains useful for a single 8 s clip, but a long film
    // locks its primary model and lets the server recover locally if that
    // model cannot deliver the complete set.
    const filmModels = durations.length > 1 ? [primaryModel] : models;
    // Reserve the most expensive configured candidate so a model fallback can
    // never make the actual charge exceed the economic guard reservation.
    const reservedCostPerSecond = Math.max(
      ...filmModels.map((model) => costMicroUsdPerSecond(model)),
    );
    const estimatedCostMicroUsd = totalDurationSeconds * reservedCostPerSecond;
    const reservation = await reserveAiGatewayAccountAttempt(args.accountId, {
      estimatedInputTokens: 0,
      reservedOutputTokens: 0,
      estimatedCostMicroUsd,
    });
    let actualCostMicroUsd = 0;
    const billableModels = new Set<string>();
    try {
      const clips = new Array<AiVideoProviderClip | undefined>(
        durations.length,
      );
      let cursor = 0;
      let stopped = false;
      let firstError: unknown = null;
      let preferredModel = primaryModel;
      const worker = async () => {
        while (!stopped && cursor < durations.length) {
          throwIfAborted(args.signal);
          const index = cursor;
          cursor += 1;
          const durationSeconds = durations[index];
          const orderedModels =
            durations.length > 1
              ? filmModels
              : Array.from(new Set([preferredModel, ...filmModels]));
          try {
            const previousClip = connectScenes && index > 0 ? clips[index - 1] : undefined;
            if (connectScenes && index > 0 && !previousClip) {
              throw new Error("ai_video_continuity_context_missing");
            }
            const continuityFrame = previousClip
              ? await extractAiMediaVideoContinuityFrame({ ...previousClip, signal: args.signal })
              : undefined;
            const remainingMs = generationDeadline - Date.now();
            if (remainingMs <= 0) throw new Error("ai_video_veo_timeout");
            const clip = await generateClip({
              ai,
              models: orderedModels,
              prompt: buildGoogleVideoScenePrompt(args, index, durationSeconds, {
                continuationFrame: Boolean(continuityFrame),
              }),
              durationSeconds,
              aspectRatio: resolveGoogleVideoAspectRatio(
                args.request.format,
              ),
              inspirationImages:
                index === 0 || (!connectScenes && preserveIdentityReferences)
                  ? args.request.inspirationImages
                  : [],
              continuityFrame,
              preserveIdentityReferences,
              timeoutMs: Math.min(timeoutMs, remainingMs),
              pollMs,
              signal: args.signal,
              onBillable: (usedModel) => {
                actualCostMicroUsd +=
                  durationSeconds * costMicroUsdPerSecond(usedModel);
                billableModels.add(usedModel);
              },
            });
            clips[index] = continuityFrame
              ? { ...clip, warnings: [...clip.warnings, "video_last_frame_continuity"] }
              : clip;
            // Once a fallback proved healthy, later unscheduled clips start
            // there instead of repeating a known failing primary route.
            preferredModel = clip.model;
          } catch (error) {
            const failure = classifyVeoFailure(error);
            console.warn("[ai-media] Veo scene failed", {
              scene: index + 1,
              durationSeconds,
              requestedModel: orderedModels[0] || primaryModel,
              failureKind: failure.kind,
              status: failure.status || null,
              details: redactAiMediaSensitiveText(failure.details, 500),
            });
            stopped = true;
            firstError ||= error;
          }
        }
      };
      const concurrency = connectScenes ? 1 : Math.min(configuredConcurrency, durations.length);
      // Wait for every already-started act: an early rejection must not let an
      // outer fallback race with chargeable outputs from the other workers.
      const workers = await Promise.allSettled(Array.from({ length: concurrency }, () => worker()));
      for (const result of workers) {
        if (result.status === "rejected") firstError ||= result.reason;
      }
      if (firstError) throw firstError;
      if (clips.some((clip) => !clip)) {
        throw new Error("ai_video_veo_clip_set_incomplete");
      }
      const completedClips = clips as AiVideoProviderClip[];
      const usedModels = Array.from(
        new Set(completedClips.map((clip) => clip.model)),
      );
      if (durations.length > 1 && usedModels.length !== 1) {
        throw new Error("ai_video_veo_film_model_mixed");
      }
      const accountingModel = usedModels.join("+") || primaryModel;
      await commitAiGatewayAccountAttempt({
        reservation,
        feature: "media.video",
        model: accountingModel,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        actualCostMicroUsd,
      });
      return {
        provider: PROVIDER_ID,
        model: accountingModel,
        clips: completedClips,
        estimatedCostMicroUsd: actualCostMicroUsd,
        warnings: Array.from(
          new Set(completedClips.flatMap((clip) => clip.warnings)),
        ),
      };
    } catch (error) {
      const accountingModel =
        Array.from(billableModels).join("+") || primaryModel;
      if (actualCostMicroUsd > 0) {
        await commitAiGatewayAccountAttempt({
          reservation,
          feature: "media.video",
          model: accountingModel,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          actualCostMicroUsd,
        }).catch(() => undefined);
      } else {
        await rollbackAiGatewayAccountAttempt(reservation).catch(
          () => undefined,
        );
      }
      await recordAiGatewayAccountFailure({
        accountId: args.accountId,
        feature: "media.video",
        model: accountingModel,
      }).catch(() => undefined);
      if (actualCostMicroUsd > 0) {
        if (isAiVideoProviderBillableFailure(error)) throw error;
        throw new AiVideoProviderBillableFailure({
          provider: PROVIDER_ID,
          model: accountingModel,
          stage: "film_incomplete",
          details: redactAiMediaSensitiveText(
            error instanceof Error ? error.message : error,
            700,
          ),
          cause: error,
        });
      }
      throw error;
    }
  },
};
