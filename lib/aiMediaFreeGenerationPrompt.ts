import { createHash } from "node:crypto";
import { AI_MEDIA_FORMAT_SPECS, AiMediaRequestValidationError, type AiMediaGenerationRequest } from "./aiMediaGenerationContracts.ts";
import { buildAiMediaBusinessDnaPayload } from "./aiMediaBusinessDna.ts";
import type { AiMediaPromptBuilderArgs } from "./aiMediaPromptShared.ts";
import type { AiVideoProviderGenerationArgs } from "./aiVideoProviderTypes.ts";

export const AI_MEDIA_FREE_PROMPT_VERSION = "inrcy-free-creative-v2-native-voice";

/** One short native voice-over cue per eight-second act; empty acts stay silent. */
export function splitAiMediaFreeNarrationByScene(script: string, sceneCount: number): string[] {
  if (!Number.isInteger(sceneCount) || sceneCount < 1 || sceneCount > 3) {
    throw new AiMediaRequestValidationError("La durée du film libre est invalide.");
  }
  const words = script.trim().split(/\s+/u).filter(Boolean);
  if (!words.length) throw new AiMediaRequestValidationError("Le texte de la voix off est vide.");
  const activeScenes = Math.min(sceneCount, Math.max(1, Math.ceil(words.length / 15)));
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < activeScenes; index += 1) {
    const remaining = words.length - start;
    const remainingScenes = activeScenes - index;
    const target = Math.ceil(remaining / remainingScenes);
    const minimum = Math.max(1, remaining - 15 * (remainingScenes - 1));
    const maximum = Math.min(15, remaining - (remainingScenes - 1));
    const sentenceBreaks = Array.from({ length: maximum - minimum + 1 }, (_, offset) => minimum + offset)
      .filter((count) => /[.!?;][»”"']?$/u.test(words[start + count - 1] || ""));
    const count = remainingScenes === 1
      ? remaining
      : sentenceBreaks.length
        ? sentenceBreaks.reduce((best, candidate) => Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best)
        : Math.min(maximum, Math.max(minimum, target));
    lines.push(words.slice(start, start + count).join(" "));
    start += count;
  }
  return [...lines, ...Array.from({ length: sceneCount - activeScenes }, () => "")];
}

export function hashAiMediaFreeNarrationLines(lines: readonly string[]) {
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

function nativeNarrationTone(variant: AiMediaGenerationRequest["narrationVoiceVariant"]): string {
  switch (variant) {
    case "Kore": return "confident, composed and professional";
    case "Aoede": return "natural, fluid and spontaneous";
    case "Sulafat": return "warm, gentle and welcoming";
    case "Charon": return "calm, clear and informative";
    case "Orus": return "assertive, direct and professional";
    case "Puck": return "upbeat, positive and energetic";
    default: return "natural and professional";
  }
}

/** Free dialogue has no commercial fallback and never rewrites quoted speech. */
export function getAiMediaFreeRequestedDialogue(prompt: string) {
  const pattern = /(?:\b(?:dit|dis|disent|dire|dira|déclare|déclarent|répond|répondent|prononce|prononcent|récite|récitent|says?|speak|speaks|reply|replies|dice|diga|dicono|sagt|zegt|diz)\b|\b(?:réplique|dialogue|dialog|phrase\s+(?:exacte|à\s+(?:dire|prononcer))))[^«“"\n]{0,90}[«“"]([^»”"]+)[»”"]/giu;
  return Array.from(prompt.matchAll(pattern), (match) => match[1]!.replace(/\s+/g, " ").trim());
}

export function validateAiMediaFreeDialogueLine(line: string) {
  const nonSpaceScript = /[\p{Script=Han}\p{Script=Thai}]/u.test(line);
  const units = nonSpaceScript
    ? Array.from(line.replace(/[^\p{L}\p{N}]/gu, "")).length
    : line.split(/\s+/u).filter(Boolean).length;
  if (!line || line.length > 90 || units > (nonSpaceScript ? 42 : 14)) {
    throw new AiMediaRequestValidationError("Une réplique est trop longue pour un plan de 8 secondes. Utilisez au maximum 14 mots et 90 caractères par réplique, ou répartissez le dialogue sur plusieurs plans.");
  }
}

export function resolveAiMediaFreeDialogueSequence(args: {
  request: AiMediaGenerationRequest;
  plan: { scenes: ReadonlyArray<{ spokenLine?: string }> };
}) {
  if (args.request.kind !== "video" || args.request.teamVideoSpeechMode !== "characters") return [];
  const exact = getAiMediaFreeRequestedDialogue(args.request.freePrompt || "");
  if (exact.length > args.plan.scenes.length) {
    throw new AiMediaRequestValidationError("Prévoyez un plan de 8 secondes par réplique. Choisissez une durée supérieure ou réduisez le nombre de répliques.");
  }
  const lines = args.plan.scenes.map((scene, index) => exact.length ? exact[index] || "" : String(scene.spokenLine || "").trim());
  if (!lines.some(Boolean)) throw new AiMediaRequestValidationError("La préparation des voix des personnages est incomplète. Précisez leur dialogue dans votre demande.");
  lines.filter(Boolean).forEach(validateAiMediaFreeDialogueLine);
  return lines;
}

/** Exact output ratios within the provider's existing 16-pixel size contract. */
export function getAiMediaFreeImageSize(format: AiMediaGenerationRequest["format"]): `${number}x${number}` {
  return { square: "1024x1024", portrait: "1024x1280", story: "864x1536", landscape: "1536x864" }[format] as `${number}x${number}`;
}

/** Explicit references to this business authorize using its verified context. */
export function getAiMediaFreeBrandPolicy(prompt: string, companyName = "") {
  const normalized = prompt.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const company = companyName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const companyNamed = company.length > 2 && new RegExp(`(?:^|[^a-z0-9])${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(normalized);
  const useCompanyContext = companyNamed || /\b(?:mon|notre|ma|mes|nos)\s+(?:entreprise|marque|activite|societe|commerce|logo|charte|couleurs|site)\b|\b(?:my|our)\s+(?:company|business|brand|logo|colors|website)\b|\badn\b/.test(normalized);
  const logoExcluded = /\b(?:sans|aucun|pas|no|without)\b[^.!?\n]{0,36}\blogo\b|\blogo\b[^.!?\n]{0,24}\b(?:interdit|exclu|absent)\b/.test(normalized);
  const colorsExcluded = /\b(?:sans|aucune?|pas|no|without)\b[^.!?\n]{0,36}\b(?:charte|couleurs|palette|brand colors)\b/.test(normalized);
  const newLogo = /\b(?:nouveau|nouvel|new)\s+logo\b|\b(?:creer|dessiner|concevoir|create|design)\s+(?:un|a|my|mon|notre)\s+logo\b/.test(normalized);
  const useLogo = useCompanyContext && /\blogo\b/.test(normalized) && !logoExcluded && !newLogo;
  const useBrandColors = useCompanyContext && !colorsExcluded && /\b(?:charte|couleurs? (?:de |d['’])?(?:mon|notre|ma|la) (?:marque|entreprise|logo)|mes couleurs|nos couleurs)\b/.test(normalized);
  return { useCompanyContext, useLogo, useBrandColors };
}

export function buildAiMediaFreeReferenceInstructions(request: AiMediaGenerationRequest) {
  return request.inspirationImages.map((reference, index) => {
    const role = reference.role || "inspiration";
    const required = reference.usage === "required";
    return `Image ${index + 1} — rôle ${role}, usage ${required ? "obligatoire" : "inspiration"} : ${required
      ? role === "character"
        ? "conserver chaque personne autorisée distincte, reconnaissable, sans omission ni fusion."
        : role === "product"
          ? "conserver le produit, ses formes, matières et détails distinctifs."
          : role === "environment"
            ? "respecter le lieu et ses éléments reconnaissables."
            : "respecter les éléments pertinents pour la demande."
      : "retenir l'ambiance, le style ou la composition utiles au brief, sans recopier une identité ni imposer le sujet du fichier."}`;
  }).join("\n");
}

export function buildAiMediaFreeBusinessContext(args: AiMediaPromptBuilderArgs) {
  // Reuse only already approved business facts, never hidden guided AI settings.
  return Object.fromEntries(Object.entries(buildAiMediaBusinessDnaPayload(args.profile))
    .filter(([key]) => key !== "configuration_ia"));
}

function businessContext(args: AiMediaPromptBuilderArgs) {
  const policy = getAiMediaFreeBrandPolicy(args.request.freePrompt || "", args.profile.business.companyName);
  if (!policy.useCompanyContext) return "";
  return [
    "CONTEXTE D'ENTREPRISE FACULTATIF : utiliser seulement les faits utiles à la demande ; ne pas transformer une scène libre en publicité par défaut.",
    JSON.stringify(buildAiMediaFreeBusinessContext(args)),
    policy.useBrandColors && args.brandColors?.length ? `Palette officielle demandée : ${args.brandColors.join(", ")}.` : "",
    policy.useLogo && args.hasLogo ? "Le dernier fichier est le logo officiel : le placer uniquement selon la demande, avec ses proportions et lettres exactes." : "",
  ].filter(Boolean).join("\n");
}

function freeBrief(args: AiMediaPromptBuilderArgs) {
  return [
    "DEMANDE CRÉATIVE DU PROFESSIONNEL (conserver toutes ses intentions, contraintes et exclusions) :",
    args.request.freePrompt || "",
    "FIN DE LA DEMANDE.",
    buildAiMediaFreeReferenceInstructions(args.request),
    businessContext(args),
  ].filter(Boolean).join("\n\n");
}

export function buildAiMediaFreeImagePrompt(args: AiMediaPromptBuilderArgs) {
  const spec = AI_MEDIA_FORMAT_SPECS[args.request.format];
  return [
    "MODE LIBRE — création visuelle complète, conçue sur mesure à partir du brief.",
    `Livrer une seule image finale au format ${spec.aspectRatio}, ${spec.width} × ${spec.height}.`,
    "Interpréter le type de création, l'esthétique, les sujets, le cadrage, la hiérarchie et la mise en page à partir de la demande. Un flyer, une affiche ou une infographie doit être une composition graphique aboutie, pas une photographie d'un document ni un fond à compléter.",
    "Le fournisseur dessine le résultat ENTIER, y compris les textes demandés. Aucun gabarit, bandeau, slogan, CTA ou grille publicitaire ne sera ajouté ensuite. Ne pas inventer ces éléments lorsqu'ils ne sont pas demandés.",
    "Reproduire intégralement et fidèlement les textes cités, noms propres, prix, dates, coordonnées et chiffres fournis. Respecter accents, orthographe et ponctuation. Adapter la taille, les marges et la hiérarchie pour que tout reste lisible ; ne jamais tronquer un texte ni inventer des informations commerciales.",
    "Si la demande appelle du texte sans le rédiger, écrire un texte bref, naturel et pertinent dans la langue de la demande. Si elle demande une image sans texte, conserver ce choix. Le style est libre : photo, illustration, affiche, collage, dessin, 3D ou autre selon le brief.",
    freeBrief(args),
  ].join("\n\n");
}

export function buildAiMediaFreeVideoPrompt(args: AiMediaPromptBuilderArgs) {
  const spec = AI_MEDIA_FORMAT_SPECS[args.request.format];
  return [
    "MODE LIBRE — réaliser un film original selon la demande, sans gabarit ni habillage commercial imposé.",
    `Format autoritaire ${spec.aspectRatio}, durée totale ${args.request.durationSeconds || 8} secondes.`,
    `Scènes : ${args.request.sceneMode === "single" ? "une action continue dans un même décor, sans coupe ni changement de lieu entre les segments" : "plusieurs plans distincts et cohérents"}. Les personnages, décors, style, mouvements, transitions et textes proviennent du brief.`,
    args.request.teamVideoSpeechMode === "characters"
      ? "Les personnages parlent avec des voix synthétiques naturelles synchronisées à leurs mouvements de bouche. Respecter les répliques demandées, un locuteur à la fois, sans narrateur ajouté ni clonage de voix réelle."
      : args.request.withNarration
      ? "Le moteur vidéo produit une voix off native, audible et synchronisée avec le film. Une piste séparée n'est utilisée qu'en secours si la voix native échoue au contrôle. Ne pas animer les bouches pour la narration."
      : "Aucune voix off n'a été sélectionnée ; ne pas produire de dialogue ni de parole native.",
    args.request.withMusic ? "Une musique est ajoutée au montage." : "Aucune musique ; conserver seulement une ambiance pertinente si nécessaire.",
    "Textes visibles uniquement si demandés, mots et chiffres exacts, sans ajout automatique d'accroche, CTA ou logo. Le modèle choisit une réalisation adaptée à la demande, y compris animation ou motion design.",
    freeBrief(args),
  ].join("\n\n");
}

/** Independent reference preparation: the desired first frame, not a guided ad scene. */
export function buildAiMediaFreeSceneFramePrompt(args: AiMediaPromptBuilderArgs) {
  return [
    "MODE LIBRE — préparer la première image d'un film demandé par le professionnel.",
    `Cadre ${AI_MEDIA_FORMAT_SPECS[args.request.format].aspectRatio}.`,
    "Composer le premier instant du film selon le brief : sujets, décor, style et rôle des références. Réserver de l'espace pour l'action à venir. Respecter une composition graphique, animation ou collage si la demande le prévoit. Ne pas imposer une photo réaliste, une scène commerciale ni une mise en page de flyer.",
    "Ne dessiner que les textes et logos explicitement demandés à ce premier instant. Les paroles de voix off et des personnages sont du son, pas des lettres à dessiner.",
    freeBrief(args),
  ].join("\n\n");
}

/** Free Omni/Veo transport never invokes the guided visual/speech prompt rules. */
export function buildAiMediaFreeVideoScenePrompt(
  args: AiVideoProviderGenerationArgs,
  index: number,
  durationSeconds: 4 | 6 | 8,
  options: { continuation?: boolean; continuationFrame?: boolean; firstFrameTag?: boolean } = {},
) {
  const scene = args.plan.scenes[index];
  const nativeDialogue = args.request.teamVideoSpeechMode === "characters";
  const nativeVoiceover = !nativeDialogue && args.request.withNarration;
  const nativeNarrationLines = args.nativeNarrationLines;
  const spokenLine = nativeDialogue ? resolveAiMediaFreeDialogueSequence(args)[index] : "";
  if (nativeVoiceover && (
    !nativeNarrationLines || nativeNarrationLines.length !== args.plan.scenes.length ||
    !args.providerContract.parameters.includes(`narration_sha256=${hashAiMediaFreeNarrationLines(nativeNarrationLines)}`)
  )) {
    throw new Error("ai_video_native_narration_contract_incomplete");
  }
  const narrationLine = nativeVoiceover ? nativeNarrationLines?.[index] || "" : "";
  const opening = options.continuation
    ? "[# Sources <PREVIOUS_VIDEO>@Video1] Continue the prior action; same cast/style/place; no restart."
    : options.continuationFrame
      ? `${options.firstFrameTag ? "[# Sources <FIRST_FRAME>@Image1] " : ""}Continue from the supplied prior final frame; no restart.`
      : `FREE CREATIVE FILM, shot ${index + 1}/${args.plan.scenes.length}, ${durationSeconds}s.`;
  const prompt = [
    opening,
    `CREATIVE DIRECTION: ${args.plan.subline || args.request.freePrompt || ""}`,
    `THIS SHOT: ${scene?.visualBrief || "Follow the requested action."}`,
    `PARAMETERS: ${args.providerContract.parameters}`,
    `REFERENCES: ${args.providerContract.references}`,
    "Respect exact requested wording/numbers. Draw text only when explicitly requested; do not add ads, slogans, logo or CTA by default. Never display technical directions.",
    "Animate naturally from the first frame in the requested medium. Keep cast, objects and style consistent across shots.",
    nativeDialogue
      ? spokenLine
        ? `NATIVE DIALOGUE: the speaker identified in THIS SHOT says exactly once: “${spokenLine}” Synchronize the mouth and audible speech; finish before the shot ends, then remain silent. One speaker at a time, stable distinct synthetic voices. Never clone an actual person's voice. No narrator, repeated/previous lines, subtitles or music.`
        : "NATIVE DIALOGUE: no speech in this shot; keep mouths closed. The requested lines belong to other shots; never repeat them. No narrator, lyrics or music."
      : nativeVoiceover
        ? narrationLine
          ? `NATIVE VOICEOVER: an off-screen ${args.request.narrationVoice === "male" ? "male" : "female"} narrator speaks in ${args.contentLanguage || "the requested language"} with a ${nativeNarrationTone(args.request.narrationVoiceVariant)} tone and says exactly once: “${narrationLine}” The voice is generated together with this shot's action and ambience, naturally paced and fully audible before the shot ends. Keep the narrator's vocal identity consistent across shots. No on-screen character speaks or moves their mouth for this narration. No repeated/previous lines, subtitles or lyrics.`
          : "NATIVE VOICEOVER: this shot has no narration. Do not repeat a previous line or invent speech; keep all characters silent."
        : "No native voices or dialogue. Keep all characters silent.",
  ].join("\n");
  // Fail before any media call rather than truncate the professional's requirements.
  if (prompt.length > 3_200) throw new Error(`ai_video_instruction_contract_too_long:${prompt.length}:3200`);
  return prompt;
}
