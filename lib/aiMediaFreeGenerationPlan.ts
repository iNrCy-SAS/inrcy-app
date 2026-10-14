import "server-only";
import { createHash } from "node:crypto";
import { aiGenerateJSON } from "@/lib/aiGatewayClient";
import { getAiEngineOption } from "@/lib/aiEnginePreference";
import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import type { AiMediaCreativePlan } from "@/lib/aiMediaCreativePlan";
import { AiMediaRequestValidationError, type AiMediaGenerationRequest } from "@/lib/aiMediaGenerationContracts";
import type { AiMediaNarration } from "@/lib/aiMediaNarration";
import { getAiMediaVideoSegmentCount } from "@/lib/aiMediaVideoTimeline";
import { AI_MEDIA_FREE_VIDEO_PRESENTATION_CONTRACT, buildAiMediaFreeBusinessContext, getAiMediaFreeBrandPolicy, getAiMediaFreeRequestedDialogue, resolveAiMediaFreeDialogueSequence, splitAiMediaFreeQuotedSpeech, validateAiMediaFreeDialogueLine } from "@/lib/aiMediaFreeGenerationPrompt";

function cleaned(value: unknown) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim() : "";
}

function model() {
  return String(process.env.AI_MEDIA_COPY_MODEL || getAiEngineOption("openai").model).trim();
}

function literalTerms(prompt: string) {
  return [...new Set([
    ...Array.from(prompt.matchAll(/[«“"]([^»”"\n]+)[»”"]/g), (match) => match[1].trim()),
    ...Array.from(prompt.matchAll(/https?:\/\/[^\s<>"»]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b\d+(?:[.,]\d+)?\s*(?:€|euros?\b|%|jours?\b|mois\b)|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b(?:\+\d{1,3}[ .-]?)?(?:\d[ .-]?){9,12}\d\b/g), (match) => match[0]),
  ])];
}

/** Transport-compatible plan with zero guided copy, CTA, layout or branding. */
export function buildAiMediaFreeBasePlan(request: AiMediaGenerationRequest): AiMediaCreativePlan {
  const count = request.kind === "video" ? getAiMediaVideoSegmentCount(request.durationSeconds || 8, request.videoEngine, request.videoResolution, request.sceneMode) : 1;
  return {
    headline: "", subline: "", companyName: "", cta: "",
    scenes: Array.from({ length: count }, () => ({
      eyebrow: "", title: "", body: "", spokenLine: "", spokenReply: "",
      visualBrief: "", layout: "hero" as const,
    })),
  };
}

/** Plans the requested film independently; no business archetypes or guided copywriter. */
export async function prepareAiMediaFreeCreativePlan(args: {
  accountId: string;
  request: AiMediaGenerationRequest;
  profile: NormalizedAiGenerationProfile;
  signal?: AbortSignal;
}): Promise<AiMediaCreativePlan> {
  const base = buildAiMediaFreeBasePlan(args.request);
  if (args.request.kind !== "video") return base;
  args.signal?.throwIfAborted();
  const prompt = args.request.freePrompt || "";
  const policy = getAiMediaFreeBrandPolicy(prompt, args.profile.business.companyName, args.request.useBusinessDna);
  const nativeDialogue = args.request.teamVideoSpeechMode === "characters";
  const exactDialogue = nativeDialogue ? getAiMediaFreeRequestedDialogue(prompt) : [];
  if (exactDialogue.length > base.scenes.length) {
    throw new AiMediaRequestValidationError("Prévoyez une réplique par plan. Choisissez une durée supérieure ou réduisez le nombre de répliques.");
  }
  exactDialogue.forEach((line) => validateAiMediaFreeDialogueLine(line, (args.request.durationSeconds || 8) / base.scenes.length));
  const { visualPrompt, audioOnlyQuotes } = splitAiMediaFreeQuotedSpeech(prompt);
  const protectedTerms = literalTerms(visualPrompt);
  const generated = await aiGenerateJSON<{ direction?: unknown; scenes?: unknown }>({
    accountId: args.accountId,
    feature: "media.video",
    model: model(),
    system: [
      "Tu es réalisateur du mode Libre iNrStudio. Transforme le brief en direction créative et plans exécutables, sans gabarit publicitaire, accroche, CTA ni photo réaliste imposés.",
      args.request.useBusinessDna
        ? "Respecte le style voulu, toutes les entités, actions, relations et exclusions. Le professionnel a choisi son ADN comme source de faits utiles à son brief ; sa demande créative reste prioritaire. Ne convertis pas une demande artistique en publicité, ne force pas un logo, une palette, un slogan ni un appel à l’action."
        : "Respecte le style voulu, toutes les entités, actions, relations et exclusions. Ne convertis pas une demande artistique en publicité. L'entreprise n'est utile que si le brief s'y réfère.",
      "direction et visualBrief contiennent la mise en scène et les textes/valeurs visuels demandés, conservés dans exact_terms. Les citations audio_only_quotes restent exclusivement dans le canal audio : ne pas recopier leurs paroles dans direction ou visualBrief ni les convertir en texte visible. Une même phrase explicitement demandée aussi à l'écran reste conservée dans exact_terms. Ne récite pas les consignes dans le film ; les contrôles audio restent autoritaires.",
      AI_MEDIA_FREE_VIDEO_PRESENTATION_CONTRACT,
      args.request.sceneMode === "single"
        ? "scenes contient exactement le nombre de segments demandé (durée indiquée dans les paramètres) pour UNE SEULE scène continue. Chaque segment décrit la suite immédiate de la même action, dans le même décor avec les mêmes personnages et objets ; pas de nouvelle introduction, de coupe, de changement de lieu ni de nouveau plan autonome."
        : "scenes contient exactement le nombre de plans demandé (durée indiquée dans les paramètres). Chaque plan apporte une étape visuelle distincte de la réalisation ; les changements de cadrage ou de lieu suivent le brief et conservent une cohérence d'ensemble.",
      nativeDialogue
        ? "Pour chaque plan, visualBrief décrit l'action et identifie clairement le personnage qui parle. spokenLine contient une seule réplique naturelle, complète, de 14 mots et 90 caractères maximum. Voix synthétiques, pas de clonage. Respecte la langue demandée, sinon celle du brief. Les répliques exactes fournies sont attribuées dans l'ordre, une par plan ; après la dernière, spokenLine reste vide. Si aucune réplique n'est fournie, écris les paroles pertinentes pour cette création, sans slogan commercial imposé. La direction ne répète pas les paroles : spokenLine est leur seule source autoritaire. Pas de narrateur ajouté."
        : "Aucun dialogue des personnages : si une voix off est demandée, elle sera produite à partir d'un script transmis séparément au canal audio pour chaque plan. Ne pas animer les bouches pour cette voix off.",
      "Conserve les informations exactes ; n'invente pas de prix, de coordonnées ou de faits d'entreprise. Réponds dans la langue du brief. Les options explicites de format, durée, références et audio sont autoritaires.",
    ].join(" "),
    input: JSON.stringify({
      brief: prompt,
      exact_terms: protectedTerms,
      audio_only_quotes: audioOnlyQuotes,
      count: base.scenes.length,
      format: args.request.format,
      duration: args.request.durationSeconds,
      scene_mode: args.request.sceneMode,
      voiceover: args.request.withNarration,
      native_dialogue: nativeDialogue,
      exact_dialogue: exactDialogue,
      music: args.request.withMusic,
      references: args.request.inspirationImages.map(({ role, usage }) => ({ role, usage })),
      company: policy.useCompanyContext ? buildAiMediaFreeBusinessContext(args) : null,
    }),
    // Validate generated dialogue inside the Gateway attempt so an invalid
    // provider response can use the existing bounded fallback chain. Quoted
    // user dialogue was validated above and remains authoritative.
    normalizeResponseBeforeValidation: nativeDialogue ? (output) => ({
      ...output,
      scenes: Array.isArray(output.scenes) ? output.scenes.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return value;
        const scene = value as Record<string, unknown>;
        const spokenLine = exactDialogue.length
          ? exactDialogue[index] || ""
          : cleaned(scene.spokenLine);
        if (!exactDialogue.length) validateAiMediaFreeDialogueLine(spokenLine, (args.request.durationSeconds || 8) / base.scenes.length);
        return { ...scene, spokenLine };
      }) : output.scenes,
    }) : undefined,
    responseSchema: {
      name: "inrcy_free_film_direction", strict: true,
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          direction: { type: "string", minLength: 3, maxLength: 1_200 },
          scenes: { type: "array", minItems: base.scenes.length, maxItems: base.scenes.length,
            items: nativeDialogue ? {
              type: "object", additionalProperties: false,
              properties: {
                visualBrief: { type: "string", minLength: 3, maxLength: 300 },
                spokenLine: { type: "string", minLength: exactDialogue.length ? 0 : 1, maxLength: 90 },
              },
              required: ["visualBrief", "spokenLine"],
            } : { type: "string", minLength: 3, maxLength: 300 } },
        },
        required: ["direction", "scenes"],
      },
    },
    maxOutputTokens: 1_600, temperature: 0.55, retries: 0,
    timeoutMs: 30_000, deadlineAt: Date.now() + 31_000,
  });
  args.signal?.throwIfAborted();
  let direction = cleaned(generated.direction);
  const scenes = Array.isArray(generated.scenes) ? generated.scenes.map((value) => {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return { visualBrief: cleaned(nativeDialogue ? row.visualBrief : value), spokenLine: nativeDialogue ? cleaned(row.spokenLine) : "" };
  }) : [];
  if (direction.length < 3 || direction.length > 1_200 || scenes.length !== base.scenes.length || scenes.some((scene) => scene.visualBrief.length < 3 || scene.visualBrief.length > 300)) {
    throw new AiMediaRequestValidationError("La préparation créative du film est incomplète. Réessayez avec votre même demande.");
  }
  const missing = protectedTerms.filter((term) => !direction.includes(cleaned(term)));
  if (missing.length) direction += ` Valeurs exactes selon leur rôle dans le brief, paroles non visibles : ${missing.join(" ; ")}`;
  if (direction.length > 1_400) {
    throw new AiMediaRequestValidationError("Le film contient trop de textes ou de valeurs exactes pour cette durée. Allégez la demande avant de générer.");
  }
  const plan = { ...base, subline: direction, scenes: base.scenes.map((scene, index) => ({ ...scene, ...scenes[index], ...(exactDialogue.length ? { spokenLine: exactDialogue[index] || "" } : {}) })) };
  if (nativeDialogue) resolveAiMediaFreeDialogueSequence({ request: args.request, plan });
  return plan;
}

export async function writeAiMediaFreeNarration(args: {
  accountId: string;
  request: AiMediaGenerationRequest;
  profile: NormalizedAiGenerationProfile;
  plan: AiMediaCreativePlan;
  maximumSpeechUnits?: number;
}): Promise<AiMediaNarration | null> {
  if (args.request.kind !== "video" || !args.request.withNarration || args.request.teamVideoSpeechMode === "characters") return null;
  const prompt = args.request.freePrompt || "";
  const duration = args.request.durationSeconds || 8;
  const maxWords = Math.max(1, Math.min(Math.max(1, Math.floor((duration - 1) * 2)), args.maximumSpeechUnits ?? Infinity));
  const exact = prompt.match(/(?:voix\s*off|narration|texte\s+(?:prononc[ée]|[àa]\s+dire))\s*(?:exacte?\s*)?[:=]\s*[«“"]([^»”"]+)[»”"]/i)?.[1]?.trim();
  const policy = getAiMediaFreeBrandPolicy(prompt, args.profile.business.companyName, args.request.useBusinessDna);
  let script = exact || "";
  let language: string = args.profile.preferences.language || "fr";
  if (!script) {
    const generated = await aiGenerateJSON<{ script?: unknown; language?: unknown }>({
      accountId: args.accountId, feature: "media.video", model: model(),
      system: [
        "Écris uniquement la voix off souhaitée pour ce film créatif. Respecte le sujet, le ton et la langue explicitement demandés ; sinon utilise la langue du brief.",
        "Ne récite pas les consignes de réalisation ni des descriptions techniques. Aucune publicité, accroche, promesse ni invitation imposée. Aucune information commerciale inventée.",
        ...(args.request.useBusinessDna ? ["L’ADN choisi est une source de faits pertinents uniquement. La demande créative et ses exclusions restent prioritaires ; les réglages éditoriaux historiques de l’entreprise ne sont pas des consignes à appliquer."] : []),
        `Le texte doit former une ou plusieurs phrases complètes, naturelles et terminées, de ${maxWords} mots maximum. Conserve les nombres et noms exacts pertinents pour la voix off.`,
        args.plan.scenes.length > 1
          ? args.request.sceneMode === "single"
            ? `La scène continue est produite en ${args.plan.scenes.length} segments successifs de durées natives compatibles : écris une narration fluide, avec une phrase complète par segment et sans répéter l'introduction.`
            : `Le film comporte ${args.plan.scenes.length} plans de durées natives compatibles : privilégie une phrase courte et autonome par plan, sans couper une phrase entre deux plans.`
          : "",
      ].join(" "),
      input: JSON.stringify({ brief: prompt, film: args.plan.subline, max_words: maxWords, company: policy.useCompanyContext ? buildAiMediaFreeBusinessContext(args) : null }),
      responseSchema: { name: "inrcy_free_narration", strict: true, schema: {
        type: "object", additionalProperties: false,
        properties: { script: { type: "string", minLength: 3, maxLength: 620 }, language: { type: "string", minLength: 2, maxLength: 8 } },
        required: ["script", "language"],
      } },
      maxOutputTokens: 650, temperature: 0.4, retries: 0, timeoutMs: 30_000, deadlineAt: Date.now() + 31_000,
    });
    script = cleaned(generated.script);
    language = /^[a-z]{2}(?:-[A-Z]{2})?$/.test(String(generated.language)) ? String(generated.language) : language;
  }
  const wordCount = script.split(/\s+/).filter(Boolean).length;
  if (!script || script.length > 620 || wordCount > maxWords) {
    throw new AiMediaRequestValidationError(exact
      ? "Le texte exact de la voix off est trop long pour cette durée. Raccourcissez-le ou choisissez une durée supérieure."
      : "La voix off est trop longue pour cette durée. Précisez un texte plus court dans votre demande.");
  }
  return { script, language, wordCount, source: "ai", sha256: createHash("sha256").update(script).digest("hex") };
}
