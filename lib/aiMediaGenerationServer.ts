import "server-only";

import { createHash } from "node:crypto";

import { buildNormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import { buildAiMediaVideoDnaBrief } from "@/lib/aiMediaBusinessDna";
import { loadAiMediaBrandKit } from "@/lib/aiMediaBrandKit";
import {
  composeAiMediaBrandedImage,
  renderAiMediaVideoOverlay,
} from "@/lib/aiMediaBrandRenderer";
import { composeAiMediaContactImage } from "@/lib/aiMediaImageContactComposer";
import { buildAiMediaCreativePlan } from "@/lib/aiMediaCreativePlan";
import { writeAiMediaHeadline } from "@/lib/aiMediaCopywriter";
import {
  AiGatewayAccountLimitError,
  AiGatewayGuardUnavailableError,
} from "@/lib/aiGatewayAccountGuard";
import {
  getExistingGeneratedAiMedia,
  saveGeneratedAiMedia,
} from "@/lib/aiGeneratedMediaRegistry";
import { getBoosterGenerationContext } from "@/lib/boosterGenerationContext";
import {
  AiMediaRequestValidationError,
  buildAiMediaTitle,
  AI_MEDIA_FORMAT_SPECS,
  type AiMediaGenerationRequest,
  type AiMediaLibraryPickerItem,
  type AiMediaSoundtrackResponse,
  type AiMediaVisualStyle,
} from "@/lib/aiMediaGenerationContracts";
import {
  generateAiMediaImage,
  generateAiMediaImageWithGoogle,
  type AiMediaGatewayResult,
} from "@/lib/aiMediaGateway";
import { composeOriginalAiVideo } from "@/lib/aiMediaGeneratedVideo";
import { AI_MEDIA_VIDEO_TEXT_LAYOUT } from "@/lib/aiMediaVideoLayout";
import {
  AiMediaIdentityReferenceValidationError,
  prepareAiMediaIdentityReferences,
} from "@/lib/aiMediaIdentityReferences";
import {
  createAiMediaFallbackVideo,
  createBrandMotionFrame,
  prepareReferenceTeamCompositionForAnimation,
  createReferenceIdentityMontage,
  createReferenceTeamFallbackVideo,
  createReferenceTeamMontage,
} from "@/lib/aiMediaReferenceTeam";
import { writeAiMediaNarration } from "@/lib/aiMediaNarration";
import { generateAiMediaNarrationAudio } from "@/lib/aiMediaNarrationAudio";
import { auditAiMediaNativeDialogueWithGoogle } from "@/lib/aiMediaNativeDialogueQaGoogle";
import { resolveAiMediaDialogueSequence } from "@/lib/aiMediaDialogue";
import {
  AI_MEDIA_PROMPT_VERSION,
  buildAiMediaPrompt,
  getAiMediaRenderDirection,
  getAiMediaPromptOutputSpec,
} from "@/lib/aiMediaGenerationPrompt";
import { loadAiMediaSoundtrack } from "@/lib/aiMediaGenerationSoundtracks";
import {
  normalizeGeneratedAiImage,
  type NormalizedAiMedia,
} from "@/lib/aiMediaNormalizer";
import {
  redactAiMediaSensitiveText,
  safeAiMediaErrorMessage,
} from "@/lib/aiMediaSensitiveText";
import {
  cleanAiMediaProfilePhone,
  isAiMediaProfilePhoneDisplayRequested,
} from "@/lib/aiMediaVisibleContact";
import { generateOriginalAiVideoClips } from "@/lib/aiVideoProvider";
import { classifyVeoFailure } from "@/lib/aiVideoReliability";
import {
  isAiVideoProviderBillableFailure,
  type AiVideoProviderGenerationArgs,
  type AiVideoProviderResult,
} from "@/lib/aiVideoProviderTypes";
import type { DashboardEdition } from "@/lib/dashboardEdition";
import {
  getAiMediaVideoMaxDuration,
  type AiMediaVideoDurationLimit,
} from "@/lib/aiMediaGenerationQuotaPolicy";

type SupabaseLike = Parameters<
  typeof getBoosterGenerationContext
>[0]["supabase"];

export type AiMediaGenerationServerResult = {
  item: AiMediaLibraryPickerItem;
  soundtrack: AiMediaSoundtrackResponse | null;
  model: string;
  videoEngineResult:
    | "omni"
    | "veo"
    | "omni_veo_fallback"
    | "veo_omni_fallback"
    | "local_fallback"
    | null;
  promptVersion: string;
  promptSha256: string;
  pipelineTimingsMs: Record<string, number>;
};

const DEFAULT_NARRATION_AFTER_VIDEO_GRACE_MS = 6_000;

function positiveInt(value: unknown, fallback: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(maximum, parsed)
    : fallback;
}

function roundedDurationMs(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

async function waitForOptionalTaskWithinGrace<T>(args: {
  task: Promise<T>;
  graceMs: number;
  signal?: AbortSignal;
}): Promise<T | null> {
  args.signal?.throwIfAborted();
  return new Promise<T | null>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      args.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      try {
        args.signal?.throwIfAborted();
      } catch (error) {
        fail(error);
      }
    };
    const timer = setTimeout(() => finish(null), args.graceMs);
    args.signal?.addEventListener("abort", onAbort, { once: true });
    if (args.signal?.aborted) onAbort();
    args.task.then(finish, fail);
  });
}

function promptSha256(prompt: string) {
  return createHash("sha256").update(prompt).digest("hex");
}

function cleanProviderMetadata(gateway: AiMediaGatewayResult) {
  const hasIdentityReferences = gateway.identityReferenceImagesCount > 0;
  const hasGenericReferences = gateway.genericReferenceImagesCount > 0;
  return {
    provider: gateway.provider,
    model: gateway.model,
    provider_media_type: gateway.mediaType,
    reference_images_count: gateway.referenceImagesCount,
    identity_reference_images_count: gateway.identityReferenceImagesCount,
    generic_reference_images_count: gateway.genericReferenceImagesCount,
    official_logo_included: gateway.officialLogoIncluded,
    reference_policy: hasIdentityReferences
      ? gateway.officialLogoIncluded
        ? "authorized_identity_and_official_logo"
        : "authorized_identity_only"
      : hasGenericReferences
      ? gateway.officialLogoIncluded
        ? "generic_inspiration_and_official_logo"
        : "generic_inspiration_only"
      : gateway.officialLogoIncluded
      ? "official_logo_only"
      : "none",
    warnings: gateway.warnings,
    usage: gateway.usage,
  };
}

const FREE_STYLE_PALETTES: Record<
  AiMediaVisualStyle,
  [string, string, string]
> = {
  brand: ["#2563eb", "#7c3aed", "#ec4899"],
  clean: ["#e2e8f0", "#94a3b8", "#0f172a"],
  premium: ["#111827", "#b8904f", "#f8fafc"],
  warm: ["#c56a3a", "#e8b36a", "#6b3d2e"],
  dynamic: ["#0ea5e9", "#7c3aed", "#f43f5e"],
  expert: ["#0f3b5d", "#3b82a0", "#dbeafe"],
  local: ["#4f6f52", "#c58b57", "#f3ead8"],
  colorful: ["#f97316", "#ec4899", "#2563eb"],
};

/**
 * Génère et normalise un média, puis l'inscrit comme brouillon temporaire et
 * invisible. `accountId` ne doit provenir que du scope serveur multicompte.
 */
export async function generateAndSaveAiMedia(args: {
  supabase: SupabaseLike;
  accountId: string;
  authUserId: string;
  jobId: string;
  edition?: DashboardEdition;
  request: AiMediaGenerationRequest;
  /** Autorisation résolue avant réservation, contrôlée une seconde fois ici. */
  videoMaxDurationSeconds?: AiMediaVideoDurationLimit;
  signal?: AbortSignal;
}): Promise<AiMediaGenerationServerResult> {
  const pipelineStartedAt = performance.now();
  const pipelineTimingsMs: Record<string, number> = {};
  const measure = async <T>(stage: string, action: () => Promise<T>) => {
    const startedAt = performance.now();
    try {
      return await action();
    } finally {
      pipelineTimingsMs[stage] = roundedDurationMs(startedAt);
    }
  };

  args.signal?.throwIfAborted();
  if (args.request.kind === "video") {
    const authorizedDuration =
      args.videoMaxDurationSeconds ??
      getAiMediaVideoMaxDuration(args.edition ?? "standard");
    if ((args.request.durationSeconds || 16) > authorizedDuration) {
      throw new AiMediaRequestValidationError(
        `Cette génération vidéo dépasse la durée autorisée de ${authorizedDuration} secondes.`
      );
    }
  }
  const [existing, generationContext] = await Promise.all([
    measure("draft_lookup", () =>
      getExistingGeneratedAiMedia({
        accountId: args.accountId,
        jobId: args.jobId,
      })
    ),
    measure("business_context", () =>
      getBoosterGenerationContext({
        supabase: args.supabase,
        userId: args.accountId,
        edition: args.edition,
      })
    ),
  ]);
  if (existing) {
    pipelineTimingsMs.total = roundedDurationMs(pipelineStartedAt);
    return {
      item: existing,
      soundtrack: null,
      model: "replayed",
      videoEngineResult: null,
      promptVersion: AI_MEDIA_PROMPT_VERSION,
      promptSha256: "",
      pipelineTimingsMs: { ...pipelineTimingsMs },
    };
  }

  let preparedIdentityReferences: Awaited<
    ReturnType<typeof prepareAiMediaIdentityReferences>
  >;
  try {
    preparedIdentityReferences = await measure(
      "identity_reference_normalization",
      () => prepareAiMediaIdentityReferences(args.request.inspirationImages)
    );
  } catch (error) {
    if (error instanceof AiMediaIdentityReferenceValidationError) {
      throw new AiMediaRequestValidationError(error.message);
    }
    throw error;
  }
  // À partir d'ici, seules les références décodées, validées, réorientées et
  // réencodées sans métadonnées peuvent atteindre un fournisseur, image ou
  // vidéo. Les octets bruts reçus par la route ne quittent jamais ce point.
  const providerRequest: AiMediaGenerationRequest = {
    ...args.request,
    inspirationImages: preparedIdentityReferences.providerImages,
  };
  const preparedReferenceRoles = providerRequest.inspirationImages.map(
    ({ role, characterIndex }) => ({ role, characterIndex })
  );
  const preparedCharacterBuffers = preparedIdentityReferences.buffers.filter(
    (_, index) =>
      providerRequest.inspirationImages[index]?.role === "character" ||
      (!providerRequest.inspirationImages[index]?.role &&
        providerRequest.identityMode !== "auto")
  );

  const brandKitTask = measure("brand_kit", () =>
    loadAiMediaBrandKit({
      accountId: args.accountId,
      profile: generationContext.profile,
    })
  );
  const profile = buildNormalizedAiGenerationProfile({
    profile: generationContext.profile,
    business: generationContext.business,
    idea: providerRequest.idea,
    theme: providerRequest.idea,
    style: "",
    media: {
      type: providerRequest.kind === "video" ? "video" : "images",
      count: 1,
      hasVisualContext: false,
      hasAudioTranscript: false,
      context: "",
    },
  });
  const profilePhoneDisplayRequested =
    providerRequest.kind === "image" &&
    isAiMediaProfilePhoneDisplayRequested(providerRequest.aiInstruction);
  const profilePhone = profilePhoneDisplayRequested
    ? cleanAiMediaProfilePhone(profile.business.phone)
    : "";
  // Dès qu'un texte doit apparaître sur une image, le moteur crée uniquement
  // le fond. iNrCy compose ensuite localement les lettres et le logo exacts :
  // aucune accroche ne peut être redessinée, mal orthographiée ou tronquée par
  // le fournisseur. Le téléphone conserve sa composition dédiée.
  const useExactContactComposition = profilePhoneDisplayRequested;
  const useDeterministicImageComposition =
    providerRequest.kind === "image" &&
    (providerRequest.withText || useExactContactComposition);
  const initialCreativePlan = buildAiMediaCreativePlan({
    request: providerRequest,
    profile,
    recentPublications: generationContext.recentPublications,
  });
  const creativePlanTask =
    providerRequest.withText ||
    (providerRequest.kind === "video" &&
      providerRequest.teamVideoSpeechMode === "characters")
      ? measure("headline", () =>
          writeAiMediaHeadline({
            accountId: args.accountId,
            request: providerRequest,
            profile,
            plan: initialCreativePlan,
          })
        )
      : Promise.resolve(initialCreativePlan);
  const [brandKit, creativePlan] = await Promise.all([
    brandKitTask,
    creativePlanTask,
  ]);
  args.signal?.throwIfAborted();
  const officialLogo =
    providerRequest.logoMode === "none" ? null : brandKit.logo;
  const effectiveColors = providerRequest.useBrandColors
    ? brandKit.colors
    : FREE_STYLE_PALETTES[providerRequest.visualStyle];
  const prompt = buildAiMediaPrompt({
    request: providerRequest,
    profile,
    recentPublications: generationContext.recentPublications,
    brandColors: providerRequest.useBrandColors ? brandKit.colors : [],
    hasLogo: Boolean(officialLogo) && !useDeterministicImageComposition,
    deferVisibleElementsToComposer: useDeterministicImageComposition,
    copy: creativePlan,
  });
  const promptHash = promptSha256(prompt);
  const format = AI_MEDIA_FORMAT_SPECS[providerRequest.format];
  const localFallbackFrameTasks = new Map<string, Promise<Buffer>>();
  const getLocalFallbackFrame = (
    includeLogo = providerRequest.kind === "image"
  ) => {
    const cacheKey = includeLogo ? "with-logo" : "without-logo";
    const cached = localFallbackFrameTasks.get(cacheKey);
    if (cached) return cached;
    const task = (async () => {
      const referenceArgs = {
        references:
          providerRequest.inputMode === "essential"
            ? preparedCharacterBuffers
            : preparedIdentityReferences.buffers,
        width: format.width,
        height: format.height,
        brandColors: effectiveColors,
        officialLogo:
          includeLogo && !useExactContactComposition ? officialLogo : null,
      };
      if (referenceArgs.references.length) {
        try {
          return providerRequest.identityMode === "reference_team"
            ? await createReferenceTeamMontage(referenceArgs)
            : await createReferenceIdentityMontage(referenceArgs);
        } catch {
          // Un logo historique non décodable ne doit pas empêcher le secours
          // exact-photo. Les références, déjà assainies, restent prioritaires.
          const withoutLogo = { ...referenceArgs, officialLogo: null };
          return providerRequest.identityMode === "reference_team"
            ? await createReferenceTeamMontage(withoutLogo)
            : await createReferenceIdentityMontage(withoutLogo);
        }
      }
      return await createBrandMotionFrame({
        width: format.width,
        height: format.height,
        brandColors: effectiveColors,
        officialLogo:
          includeLogo && !useExactContactComposition ? officialLogo : null,
        companyName: creativePlan.companyName,
        headline:
          providerRequest.withText && !useExactContactComposition
            ? creativePlan.headline
            : "",
      });
    })();
    localFallbackFrameTasks.set(cacheKey, task);
    return task;
  };
  const referenceTeamPrecompositionPrompt =
    providerRequest.identityMode === "reference_team"
      ? `${buildAiMediaPrompt({
          request: {
            ...providerRequest,
            kind: "image",
            withText: false,
            textKeywords: [],
            withMusic: false,
            withNarration: false,
            narrationVoice: null,
            narrationVoiceVariant: null,
            videoEngine: null,
            durationSeconds: null,
            logoMode: "none",
          },
          profile,
          recentPublications: generationContext.recentPublications,
          brandColors: providerRequest.useBrandColors ? brandKit.colors : [],
          hasLogo: false,
        })}\n\nIMAGE MAÎTRE ÉPHÉMÈRE POUR ANIMATION : réunir les ${
          preparedCharacterBuffers.length
        } adultes autorisés dans une seule scène continue, plein cadre et cinématographique — jamais un collage, un écran partagé, des cartes portrait ni un diaporama. Image 1 = personne 1, image 2 = personne 2${
          preparedCharacterBuffers.length === 3 ? ", image 3 = personne 3" : ""
        }. Chaque personne apparaît exactement une fois, reste distincte et reconnaissable ; aucune fusion, permutation, duplication, omission ni substitution générique. Garder tous les visages clairement visibles ainsi que suffisamment de corps et d’espace autour de chaque personne pour permettre regards, expressions, gestes, pas, interactions et mouvements de caméra naturels.${
          providerRequest.teamVideoSpeechMode === "characters"
            ? " Les disposer dans une interaction conversationnelle crédible, avec les bouches bien visibles pour permettre une future synchronisation labiale naturelle."
            : " Préserver des expressions naturelles sans posture de parole imposée."
        } Style final obligatoire : ${getAiMediaRenderDirection(
          providerRequest
        )}. Aucun texte ni logo.`
      : "";
  const essentialScenePrecompositionPrompt =
    providerRequest.inputMode === "essential" &&
    providerRequest.kind === "video" &&
    providerRequest.inspirationImages.length
      ? `${buildAiMediaPrompt({
          request: {
            ...providerRequest,
            kind: "image",
            withText: false,
            textKeywords: [],
            withMusic: false,
            withNarration: false,
            narrationVoice: null,
            narrationVoiceVariant: null,
            videoEngine: null,
            durationSeconds: null,
            logoMode: "none",
          },
          profile,
          recentPublications: generationContext.recentPublications,
          brandColors: providerRequest.useBrandColors ? brandKit.colors : [],
          hasLogo: false,
        })}\n\nIMAGE MAÎTRE ÉPHÉMÈRE POUR UNE NOUVELLE SCÈNE VIDÉO : composer une image plein cadre entièrement nouvelle qui réunisse exactement les personnages demandés et intègre le décor et le produit selon leur rôle explicite. Les fichiers fournis ne sont jamais la première image à déplacer, un collage, un écran partagé, une carte portrait ou un diaporama. Prévoir une action, des postures, de l’espace autour des corps et une profondeur de scène permettant de vrais mouvements, gestes et déplacements de caméra.${
          providerRequest.teamVideoSpeechMode === "characters"
            ? " Les personnages doivent former une interaction crédible et avoir la bouche clairement visible pour permettre une synchronisation labiale naturelle."
            : " Les personnages restent naturellement expressifs sans posture de parole imposée."
        } Style final obligatoire : ${getAiMediaRenderDirection(
          providerRequest
        )}. Aucun texte ni logo.`
      : "";

  let normalized: NormalizedAiMedia;
  let soundtrack: Awaited<ReturnType<typeof loadAiMediaSoundtrack>> | null =
    null;
  let model = "";
  let providerMetadata: Record<string, unknown>;
  let videoEngineResult: AiMediaGenerationServerResult["videoEngineResult"] =
    null;
  let localFallbackUsed = false;
  let exactContactCompositionApplied = false;
  let deterministicImageCompositionApplied = false;
  let teamPrecompositionGateway: AiMediaGatewayResult | null = null;
  let teamPrecompositionModel = "";
  let teamPrecompositionMetadata: Record<string, unknown> | null = null;

  if (providerRequest.kind === "image") {
    args.signal?.throwIfAborted();
    let gateway: AiMediaGatewayResult;
    try {
      gateway = await measure("image_provider", () =>
        generateAiMediaImage({
          accountId: args.accountId,
          prompt,
          identityMode: providerRequest.identityMode,
          identityReferences: preparedIdentityReferences.buffers,
          referenceRoles: preparedReferenceRoles,
          officialLogo: useDeterministicImageComposition ? null : officialLogo,
          size: format.generationSize,
          signal: args.signal,
        })
      );
    } catch (primaryError) {
      args.signal?.throwIfAborted();
      if (
        primaryError instanceof AiGatewayAccountLimitError ||
        primaryError instanceof AiGatewayGuardUnavailableError
      ) {
        throw primaryError;
      }
      console.warn("[ai-media] primary image provider failed", {
        accountId: args.accountId,
        jobId: args.jobId,
        provider: "vercel-ai-gateway",
        error: safeAiMediaErrorMessage(primaryError, 400),
      });
      try {
        gateway = await measure("image_provider_google_fallback", () =>
          generateAiMediaImageWithGoogle({
            accountId: args.accountId,
            prompt,
            identityMode: providerRequest.identityMode,
            identityReferences: preparedIdentityReferences.buffers,
            referenceRoles: preparedReferenceRoles,
            officialLogo: useDeterministicImageComposition
              ? null
              : officialLogo,
            size: format.generationSize,
            signal: args.signal,
          })
        );
      } catch (fallbackError) {
        args.signal?.throwIfAborted();
        console.warn("[ai-media] secondary image provider failed", {
          accountId: args.accountId,
          jobId: args.jobId,
          provider: "google-gemini-direct",
          error: safeAiMediaErrorMessage(fallbackError, 400),
        });
        throw new Error(
          preparedIdentityReferences.buffers.length &&
          providerRequest.identityMode !== "auto"
            ? "ai_image_identity_generation_unavailable"
            : "ai_image_generation_unavailable",
          { cause: new AggregateError([primaryError, fallbackError]) }
        );
      }
    }
    const imageBuffer = gateway.buffer;
    // Cette étape garantit le cadrage et le JPEG universel du fichier produit
    // par un vrai moteur génératif. Une photo source n'est jamais utilisée
    // comme substitut silencieux à une génération échouée.
    try {
      normalized = await measure("image_normalization", () =>
        normalizeGeneratedAiImage(imageBuffer, {
          width: format.width,
          height: format.height,
        })
      );
    } catch (error) {
      args.signal?.throwIfAborted();
      throw new Error("ai_image_provider_output_invalid", { cause: error });
    }
    if (useExactContactComposition) {
      try {
        const composedBuffer = await measure(
          "image_exact_contact_composition",
          () =>
            composeAiMediaContactImage({
              input: normalized.buffer,
              width: format.width,
              height: format.height,
              headline: providerRequest.withText ? creativePlan.headline : "",
              phone: profilePhone,
              officialLogo,
              logoMode: providerRequest.logoMode,
              brandColors: effectiveColors,
            })
        );
        normalized = { ...normalized, buffer: composedBuffer };
        exactContactCompositionApplied = true;
      } catch (error) {
        args.signal?.throwIfAborted();
        throw new Error("ai_image_exact_contact_composition_failed", {
          cause: error,
        });
      }
    } else if (providerRequest.withText) {
      const imageScene = creativePlan.scenes[0];
      if (!imageScene) throw new Error("ai_image_visible_copy_missing");
      try {
        const composedBuffer = await measure(
          "image_exact_copy_composition",
          () =>
            composeAiMediaBrandedImage({
              input: normalized.buffer,
              width: format.width,
              height: format.height,
              scene: {
                ...imageScene,
                eyebrow: "",
                title: creativePlan.headline,
                body: "",
              },
              logo: officialLogo,
              colors: effectiveColors,
              companyName: creativePlan.companyName,
              visualStyle: providerRequest.visualStyle,
              logoMode: providerRequest.logoMode,
              withText: true,
            })
        );
        normalized = { ...normalized, buffer: composedBuffer };
        deterministicImageCompositionApplied = true;
      } catch (error) {
        args.signal?.throwIfAborted();
        throw new Error("ai_image_exact_copy_composition_failed", {
          cause: error,
        });
      }
    }
    args.signal?.throwIfAborted();
    model = gateway.model;
    const contactWarnings =
      profilePhoneDisplayRequested && !profilePhone
        ? ["profile_phone_unavailable_omitted"]
        : [];
    const cleanGatewayMetadata = cleanProviderMetadata(gateway);
    providerMetadata = {
      ...cleanGatewayMetadata,
      warnings: Array.from(
        new Set([...cleanGatewayMetadata.warnings, ...contactWarnings])
      ),
      exact_contact_composition_applied: exactContactCompositionApplied,
      deterministic_image_composition_applied:
        deterministicImageCompositionApplied,
      profile_phone_requested: profilePhoneDisplayRequested,
      profile_phone_applied: Boolean(profilePhone),
    };
  } else {
    args.signal?.throwIfAborted();
    const pipelineWarnings: string[] = [];
    const durationSeconds = providerRequest.durationSeconds || 8;
    const narrationController = new AbortController();
    const abortNarrationFromCaller = () =>
      narrationController.abort(args.signal?.reason);
    args.signal?.addEventListener("abort", abortNarrationFromCaller, {
      once: true,
    });

    let minimalOverlaysTask: Promise<Buffer[]> | null = null;
    const renderMinimalOverlays = () => {
      minimalOverlaysTask ||= Promise.all(
        creativePlan.scenes.map((scene) =>
          renderAiMediaVideoOverlay({
            scene,
            logo: null,
            colors: effectiveColors,
            companyName: creativePlan.companyName,
            visualStyle: providerRequest.visualStyle,
            logoMode: "none",
            withText: false,
            width: format.width,
            height: format.height,
          })
        )
      );
      return minimalOverlaysTask;
    };

    type VideoProviderOverrides = Pick<
      AiVideoProviderGenerationArgs,
      | "identityTeamPrecomposed"
      | "identityTeamMemberCount"
      | "identityTeamGoogleEgressConsent"
    >;
    const recordVideoEngineFailure = (failureArgs: {
      engine: NonNullable<AiMediaGenerationRequest["videoEngine"]>;
      stage: "primary" | "cross_engine";
      error: unknown;
    }) => {
      const failure = classifyVeoFailure(failureArgs.error);
      pipelineWarnings.push(
        `video_engine_${failureArgs.engine}_failure_${failure.kind}`
      );
      // Ne jamais journaliser les prompts complets ni les images encodées. Ce
      // diagnostic court permet cependant de distinguer quota, sécurité,
      // configuration et panne réseau lors d'un canari réel.
      console.warn("[ai-media] video engine attempt failed", {
        accountId: args.accountId,
        jobId: args.jobId,
        engine: failureArgs.engine,
        stage: failureArgs.stage,
        durationSeconds,
        identityMode: providerRequest.identityMode,
        failureKind: failure.kind,
        status: failure.status || null,
        details: redactAiMediaSensitiveText(failure.details, 500),
      });
    };
    const generateProviderVideo = async (
      request: AiMediaGenerationRequest,
      overrides: Partial<VideoProviderOverrides> = {}
    ): Promise<AiVideoProviderResult> => {
      const providerArgs: AiVideoProviderGenerationArgs = {
        accountId: args.accountId,
        request,
        plan: creativePlan,
        creativeBrief: buildAiMediaVideoDnaBrief(profile),
        brandColors: effectiveColors,
        profession:
          profile.business.professionLabel ||
          profile.business.sectorLabel ||
          creativePlan.companyName,
        contentLanguage: profile.preferences.language,
        ...overrides,
        signal: args.signal,
      };
      try {
        return await generateOriginalAiVideoClips(providerArgs);
      } catch (primaryError) {
        args.signal?.throwIfAborted();
        recordVideoEngineFailure({
          engine: request.videoEngine || "omni",
          stage: "primary",
          error: primaryError,
        });
        // The selected provider already returned a chargeable asset. A local
        // recovery may still finish the request, but invoking another remote
        // video engine would create an invisible second bill for the same
        // film and could mix its cast/model between acts.
        if (isAiVideoProviderBillableFailure(primaryError)) {
          throw primaryError;
        }
        // Omni conserve un repli Veo uniquement pour un clip isolé de 8 s.
        // Quand Veo est choisi et échoue avant tout résultat facturable, tenter
        // Omni avec exactement le même plan et
        // les mêmes références avant le mouvement local évite une fausse
        // "animation réelle" presque fixe.
        if (request.videoEngine !== "veo") throw primaryError;
        pipelineWarnings.push("veo_fallback_to_omni");
        try {
          return await generateOriginalAiVideoClips({
            ...providerArgs,
            request: { ...request, videoEngine: "omni" },
          });
        } catch (fallbackError) {
          args.signal?.throwIfAborted();
          recordVideoEngineFailure({
            engine: "omni",
            stage: "cross_engine",
            error: fallbackError,
          });
          throw fallbackError;
        }
      }
    };

    // Le chemin critique commence immédiatement : le moteur vidéo choisi, la voix, la musique et
    // les calques sont indépendants et sont donc préparés en parallèle. La
    // qualité nominale reste identique, mais les temps ne s'additionnent plus.
    const videoGatewayTask = measure("video_generation", async () => {
      if (
        providerRequest.inputMode === "essential" &&
        preparedIdentityReferences.buffers.length > 0
      ) {
        if (
          providerRequest.identityMode === "reference_team" &&
          !providerRequest.teamVideoVeoConsent
        ) {
          throw new Error("ai_media_team_video_consent_required");
        }
        try {
          teamPrecompositionGateway = await measure(
            "video_essential_scene_precomposition",
            () =>
              generateAiMediaImage({
                accountId: args.accountId,
                prompt: essentialScenePrecompositionPrompt,
                identityMode: providerRequest.identityMode,
                identityReferences: preparedIdentityReferences.buffers,
                referenceRoles: preparedReferenceRoles,
                officialLogo: null,
                size: format.generationSize,
                signal: args.signal,
              })
          );
        } catch (primaryError) {
          args.signal?.throwIfAborted();
          if (
            primaryError instanceof AiGatewayAccountLimitError ||
            primaryError instanceof AiGatewayGuardUnavailableError
          ) {
            throw primaryError;
          }
          teamPrecompositionGateway = await measure(
            "video_essential_scene_precomposition_google_fallback",
            () =>
              generateAiMediaImageWithGoogle({
                accountId: args.accountId,
                prompt: essentialScenePrecompositionPrompt,
                identityMode: providerRequest.identityMode,
                identityReferences: preparedIdentityReferences.buffers,
                referenceRoles: preparedReferenceRoles,
                officialLogo: null,
                size: format.generationSize,
                signal: args.signal,
              })
          );
        }
        teamPrecompositionModel = teamPrecompositionGateway.model;
        teamPrecompositionMetadata = {
          ...cleanProviderMetadata(teamPrecompositionGateway),
          stage: "ephemeral_essential_scene_frame",
          persisted: false,
          reference_roles: preparedReferenceRoles,
        };
        const sceneImage = await measure(
          "video_essential_scene_precomposition_normalization",
          () =>
            prepareReferenceTeamCompositionForAnimation(
              teamPrecompositionGateway!.buffer
            )
        );
        return await generateProviderVideo(
          {
            ...providerRequest,
            inspirationImages: [sceneImage],
          },
          providerRequest.identityMode === "reference_team"
            ? {
                identityTeamPrecomposed: true,
                identityTeamMemberCount: preparedCharacterBuffers.length as
                  | 2
                  | 3,
                identityTeamGoogleEgressConsent: true,
              }
            : {}
        );
      }
      if (
        providerRequest.identityMode !== "auto" &&
        providerRequest.identityMode !== "reference_team" &&
        preparedIdentityReferences.buffers.length > 0 &&
        providerRequest.teamVideoMode === "montage"
      ) {
        localFallbackUsed = true;
        const montage = await getLocalFallbackFrame(false);
        const motion = await createAiMediaFallbackVideo({
          montage,
          width: format.width,
          height: format.height,
          durationSeconds,
          signal: args.signal,
        });
        return {
          ...motion,
          warnings: Array.from(
            new Set([
              ...motion.warnings,
              "identity_reference_local_motion_selected",
            ])
          ),
        };
      }
      if (providerRequest.identityMode === "reference_team") {
        try {
          teamPrecompositionGateway = await measure(
            "video_team_precomposition",
            () =>
              generateAiMediaImage({
                accountId: args.accountId,
                prompt: referenceTeamPrecompositionPrompt,
                identityMode: "reference_team",
                identityReferences: preparedIdentityReferences.buffers,
                referenceRoles: preparedReferenceRoles,
                // Le logo exact est ajouté une seule fois par le compositeur
                // vidéo ; il ne surcharge pas les références d'identité.
                officialLogo: null,
                size: format.generationSize,
                signal: args.signal,
              })
          );
          teamPrecompositionModel = teamPrecompositionGateway.model;
          teamPrecompositionMetadata = {
            ...cleanProviderMetadata(teamPrecompositionGateway),
            stage: "ephemeral_group_frame",
            persisted: false,
          };
          const groupImage = await measure(
            "video_team_precomposition_normalization",
            () =>
              prepareReferenceTeamCompositionForAnimation(
                teamPrecompositionGateway!.buffer
              )
          );
          if (
            providerRequest.teamVideoMode === "cinematic" &&
            providerRequest.teamVideoVeoConsent
          ) {
            try {
              // Google ne reçoit jamais les 2–3 portraits d'origine. La seule
              // référence transmise est l'image de groupe éphémère, assainie
              // et composée auparavant par GPT-Image-2.
              return await generateProviderVideo(
                {
                  ...providerRequest,
                  // L'image de groupe assainie est compatible avec les deux
                  // moteurs Google. Conserver le choix explicite du pro : le
                  // mode rapide reste Omni et le mode cinématique reste Veo.
                  videoEngine: providerRequest.videoEngine,
                  inspirationImages: [groupImage],
                },
                {
                  identityTeamPrecomposed: true,
                  identityTeamMemberCount: preparedCharacterBuffers.length as
                    | 2
                    | 3,
                  identityTeamGoogleEgressConsent: true,
                }
              );
            } catch {
              args.signal?.throwIfAborted();
              // Le rendu local clôt la même tentative sans nouvel appel
              // externe et sans rendre l'échec du provider visible au pro.
              pipelineWarnings.push(
                "identity_team_cinematic_unavailable_local_motion"
              );
              if (providerRequest.teamVideoSpeechMode === "characters") {
                pipelineWarnings.push(
                  "identity_team_character_dialogue_unavailable_local_motion"
                );
              }
            }
          } else if (providerRequest.teamVideoMode === "cinematic") {
            pipelineWarnings.push(
              "identity_team_google_consent_missing_local_motion"
            );
          }
          localFallbackUsed = true;
          const motion = await createAiMediaFallbackVideo({
            montage: Buffer.from(groupImage.data, "base64"),
            width: format.width,
            height: format.height,
            durationSeconds,
            signal: args.signal,
          });
          return {
            ...motion,
            provider: "inrcy-team-ai-frame-local-motion",
            model: `${teamPrecompositionGateway.model}+inrcy/local-motion-v2-continuous`,
            warnings: [
              "identity_team_ai_group_frame_local_motion",
              "identity_team_similarity_review_required",
              ...pipelineWarnings.filter((warning) =>
                warning.startsWith("identity_team_")
              ),
            ],
            clips: motion.clips.map((clip) => ({
              ...clip,
              warnings: [
                "identity_team_ai_group_frame_local_motion",
                "identity_team_similarity_review_required",
                ...pipelineWarnings.filter((warning) =>
                  warning.startsWith("identity_team_")
                ),
              ],
            })),
          };
        } catch {
          args.signal?.throwIfAborted();
          localFallbackUsed = true;
          const montage = await getLocalFallbackFrame(false);
          return await createReferenceTeamFallbackVideo({
            montage,
            width: format.width,
            height: format.height,
            durationSeconds,
            signal: args.signal,
          });
        }
      }
      try {
        return await generateProviderVideo(providerRequest);
      } catch (providerError) {
        args.signal?.throwIfAborted();
        if (providerRequest.inputMode === "essential") throw providerError;
        localFallbackUsed = true;
        const fallbackFrame = await getLocalFallbackFrame(false);
        return await createAiMediaFallbackVideo({
          montage: fallbackFrame,
          width: format.width,
          height: format.height,
          durationSeconds,
          signal: args.signal,
        });
      }
    });
    const emptyNarrationResult = () => ({
      narration: null,
      audio: null,
      warnings: [] as string[],
    });
    const generateNarrationResult = async (
      narrationRequest: AiMediaGenerationRequest
    ) => {
      try {
        const narration = await measure("narration_copy", () =>
          writeAiMediaNarration({
            accountId: args.accountId,
            request: narrationRequest,
            profile,
            plan: creativePlan,
          })
        );
        args.signal?.throwIfAborted();
        if (!narration) return emptyNarrationResult();
        try {
          const audio = await measure("narration_audio", () =>
            generateAiMediaNarrationAudio({
              accountId: args.accountId,
              narration,
              durationSeconds,
              narrationVoice: narrationRequest.narrationVoice || "female",
              narrationVoiceVariant: narrationRequest.narrationVoiceVariant,
              signal: narrationController.signal,
            })
          );
          return { narration, audio, warnings: [] as string[] };
        } catch (error) {
          args.signal?.throwIfAborted();
          if (
            narrationRequest.inputMode === "essential" &&
            narrationRequest.withNarration
          ) {
            throw new Error("ai_media_narration_audio_unavailable", {
              cause: error,
            });
          }
          return {
            narration,
            audio: null,
            warnings: ["narration_unavailable_video_continued"],
          };
        }
      } catch (error) {
        args.signal?.throwIfAborted();
        if (
          narrationRequest.inputMode === "essential" &&
          narrationRequest.withNarration
        ) {
          throw new Error("ai_media_narration_unavailable", { cause: error });
        }
        return {
          narration: null,
          audio: null,
          warnings: ["narration_unavailable_video_continued"],
        };
      }
    };
    const narrationTask =
      providerRequest.teamVideoSpeechMode === "characters"
        ? Promise.resolve(emptyNarrationResult())
        : measure("narration_pipeline", () =>
            generateNarrationResult(providerRequest)
          );
    const soundtrackTask = measure("soundtrack", async () => {
      if (!providerRequest.withMusic) {
        return { value: null, warnings: [] as string[] };
      }
      try {
        const value = await loadAiMediaSoundtrack(
          providerRequest.idea ||
            `${creativePlan.companyName} ${creativePlan.headline}`
        );
        return { value, warnings: [] as string[] };
      } catch {
        args.signal?.throwIfAborted();
        // The original Veo ambience remains available when a local soundtrack
        // asset cannot be loaded.
        return {
          value: null,
          warnings: ["soundtrack_unavailable_video_continued"],
        };
      }
    });
    const overlaysTask = measure("video_overlays", async () => {
      try {
        const value = await Promise.all(
          creativePlan.scenes.map((scene) =>
            renderAiMediaVideoOverlay({
              scene,
              logo: officialLogo,
              colors: effectiveColors,
              companyName: creativePlan.companyName,
              visualStyle: providerRequest.visualStyle,
              logoMode: providerRequest.logoMode,
              withText: providerRequest.withText,
              width: format.width,
              height: format.height,
            })
          )
        );
        return { value, warnings: [] as string[], error: null };
      } catch (error) {
        args.signal?.throwIfAborted();
        if (
          providerRequest.inputMode === "essential" &&
          (providerRequest.withText || Boolean(officialLogo))
        ) {
          return { value: null, warnings: [] as string[], error };
        }
        // Un logo corrompu ou une accroche impossible à rasteriser ne doit pas
        // annuler les clips Veo déjà facturés. On conserve la vidéo avec un
        // calque transparent et on signale explicitement la dégradation.
        try {
          const value = await renderMinimalOverlays();
          return {
            value,
            warnings: ["branding_overlay_unavailable_video_continued"],
            error: null,
          };
        } catch (error) {
          return { value: null, warnings: [] as string[], error };
        }
      }
    });

    let videoGateway: Awaited<typeof videoGatewayTask>;
    try {
      videoGateway = await videoGatewayTask;
    } catch (error) {
      narrationController.abort(error);
      throw error;
    }
    args.signal?.throwIfAborted();

    const characterDialogueRequested =
      providerRequest.teamVideoMode === "cinematic" &&
      providerRequest.teamVideoSpeechMode === "characters";
    const characterDialogueProviderFallback =
      characterDialogueRequested && videoGateway.provider.startsWith("inrcy-");
    const expectedDialogueLines = resolveAiMediaDialogueSequence({
      scenes: creativePlan.scenes,
      headline: creativePlan.headline,
      language: profile.preferences.language,
    });
    const nativeDialogueQa =
      characterDialogueRequested && !characterDialogueProviderFallback
        ? await measure("native_character_dialogue_qa", () =>
            auditAiMediaNativeDialogueWithGoogle({
              accountId: args.accountId,
              language: profile.preferences.language,
              signal: args.signal,
              clips: videoGateway.clips.map((clip, index) => ({
                sceneIndex: index,
                buffer: clip.buffer,
                mediaType: clip.mediaType,
                durationSeconds: clip.durationSeconds,
                sourceStartSeconds: clip.sourceStartSeconds,
                expectedLine: expectedDialogueLines[index] || "",
              })),
            })
          )
        : null;
    if (
      providerRequest.inputMode === "essential" &&
      characterDialogueRequested &&
      (characterDialogueProviderFallback || nativeDialogueQa?.status !== "passed")
    ) {
      narrationController.abort(
        new Error("ai_media_character_dialogue_quality_unverified")
      );
      throw new Error("ai_media_character_dialogue_quality_unverified");
    }
    const narrationJoinStartedAt = performance.now();
    const narrationResult = await waitForOptionalTaskWithinGrace({
      task: narrationTask,
      graceMs: positiveInt(
        process.env.AI_MEDIA_NARRATION_AFTER_VIDEO_GRACE_MS,
        DEFAULT_NARRATION_AFTER_VIDEO_GRACE_MS,
        20_000
      ),
      signal: args.signal,
    });
    pipelineTimingsMs.narration_join_after_veo = roundedDurationMs(
      narrationJoinStartedAt
    );
    if (!narrationResult) {
      narrationController.abort(new Error("ai_media_narration_deadline"));
      if (
        providerRequest.inputMode === "essential" &&
        providerRequest.withNarration
      ) {
        throw new Error("ai_media_narration_deadline");
      }
      pipelineWarnings.push("narration_slow_video_continued");
    }
    if (
      providerRequest.inputMode === "essential" &&
      providerRequest.withNarration &&
      (!narrationResult?.narration || !narrationResult.audio)
    ) {
      throw new Error("ai_media_narration_unavailable");
    }
    // La piste audio native et les mouvements de bouche sont produits ensemble
    // par le moteur vidéo. Une transcription explicitement rejetée ne doit
    // jamais être livrée : on garde alors le mouvement mais on coupe la voix,
    // sans lui substituer un TTS qui serait désynchronisé. Une indisponibilité
    // technique du contrôle reste distincte d'un rejet de contenu.
    if (nativeDialogueQa?.status === "rejected") {
      pipelineWarnings.push(
        "native_character_dialogue_qa_rejected_native_audio_muted"
      );
    } else if (nativeDialogueQa?.status === "unavailable") {
      pipelineWarnings.push(
        "native_character_dialogue_qa_unavailable_native_audio_preserved"
      );
    }
    if (characterDialogueProviderFallback) {
      pipelineWarnings.push(
        "identity_team_character_dialogue_unavailable_silent_motion"
      );
    }
    args.signal?.removeEventListener("abort", abortNarrationFromCaller);

    const [soundtrackResult, overlaysResult] = await Promise.all([
      soundtrackTask,
      overlaysTask,
    ]);
    args.signal?.throwIfAborted();
    pipelineWarnings.push(
      ...(narrationResult?.warnings || []),
      ...soundtrackResult.warnings,
      ...overlaysResult.warnings
    );
    soundtrack = soundtrackResult.value;
    if (overlaysResult.error || !overlaysResult.value) {
      throw overlaysResult.error || new Error("ai_media_video_overlay_missing");
    }
    let overlays = overlaysResult.value;
    let narration = narrationResult?.narration || null;
    let narrationAudio = narrationResult?.audio || null;
    let nativeCharacterDialoguePreserved =
      characterDialogueRequested &&
      !characterDialogueProviderFallback &&
      (providerRequest.inputMode === "essential"
        ? nativeDialogueQa?.status === "passed"
        : nativeDialogueQa?.status !== "rejected");

    const clips = videoGateway.clips.map((clip) => ({
      buffer: clip.buffer,
      durationSeconds: clip.durationSeconds,
      sourceStartSeconds: clip.sourceStartSeconds,
    }));
    try {
      normalized = await measure("video_composition", () =>
        composeOriginalAiVideo({
          clips,
          overlays,
          width: format.width,
          height: format.height,
          durationSeconds,
          soundtrack,
          narration: narrationAudio,
          nativeAudioMode: nativeCharacterDialoguePreserved
            ? "dialogue"
            : characterDialogueRequested
            ? "mute"
            : "ambience",
          signal: args.signal,
        })
      );
    } catch (compositionError) {
      args.signal?.throwIfAborted();
      if (providerRequest.inputMode === "essential") {
        throw new Error("ai_media_essential_video_composition_failed", {
          cause: compositionError,
        });
      }
      const compositionMessage = String(
        (compositionError as { message?: unknown })?.message || compositionError
      );
      let effectiveCompositionError: unknown = compositionError;
      let naturalPaceFallbackSucceeded = false;

      // Si le TTS dépasse exceptionnellement la fenêtre malgré le budget de
      // mots réduit, conserver le montage, le texte, le logo et la musique.
      // Seule la voix est retirée : jamais de débit artificiellement accéléré,
      // jamais de phrase coupée et aucun nouvel appel coûteux au moteur vidéo.
      if (
        !characterDialogueRequested &&
        narrationAudio &&
        compositionMessage.includes("ai_narration_too_long_for_natural_pace")
      ) {
        try {
          normalized = await measure(
            "video_composition_without_overspeed_narration",
            () =>
              composeOriginalAiVideo({
                clips,
                overlays,
                width: format.width,
                height: format.height,
                durationSeconds,
                soundtrack,
                narration: null,
                nativeAudioMode: "ambience",
                signal: args.signal,
              })
          );
          narration = null;
          narrationAudio = null;
          pipelineWarnings.push("narration_omitted_to_preserve_natural_pace");
          naturalPaceFallbackSucceeded = true;
        } catch (naturalPaceFallbackError) {
          args.signal?.throwIfAborted();
          effectiveCompositionError = naturalPaceFallbackError;
        }
      }

      if (!naturalPaceFallbackSucceeded) {
        // Les pistes audio et l'habillage sont facultatifs. Si FFmpeg refuse
        // l'un de ces actifs, réassembler les mêmes clips en mode minimal évite
        // de rappeler Veo et préserve le rendu déjà payé.
        overlays = await renderMinimalOverlays();
        soundtrack = null;
        pipelineWarnings.push("video_enhancements_unavailable_video_continued");
        const nativeDialogueMissing = String(
          (effectiveCompositionError as { message?: unknown })?.message ||
            effectiveCompositionError
        ).includes("ai_original_video_native_dialogue_missing");
        let minimalNativeDialogueSucceeded = false;

        // Si seuls la musique ou l'habillage ont cassé, garder d'abord le vrai
        // dialogue Veo payé plutôt que de le remplacer inutilement par un TTS.
        if (nativeCharacterDialoguePreserved && !nativeDialogueMissing) {
          try {
            normalized = await measure(
              "video_composition_minimal_native_dialogue",
              () =>
                composeOriginalAiVideo({
                  clips,
                  overlays,
                  width: format.width,
                  height: format.height,
                  durationSeconds,
                  soundtrack: null,
                  narration: null,
                  nativeAudioMode: "dialogue",
                  signal: args.signal,
                })
            );
            minimalNativeDialogueSucceeded = true;
          } catch {
            args.signal?.throwIfAborted();
          }
        }

        if (!minimalNativeDialogueSucceeded) {
          if (characterDialogueRequested) {
            // Sans piste native exploitable, un repli TTS sur une bouche déjà
            // animée serait trompeur et fatalement hors synchronisation. Livrer
            // le mouvement sans parole reste le seul repli audiovisuel honnête.
            narration = null;
            narrationAudio = null;
            pipelineWarnings.push(
              "identity_team_character_dialogue_unavailable_silent_motion",
              "video_audio_unavailable_video_continued"
            );
          } else {
            // Pour une vidéo classique, une narration potentiellement malformée
            // reste un embellissement facultatif et ne doit pas casser le rendu.
            narration = null;
            narrationAudio = null;
          }
          nativeCharacterDialoguePreserved = false;
          try {
            normalized = await measure("video_composition_fallback", () =>
              composeOriginalAiVideo({
                clips,
                overlays,
                width: format.width,
                height: format.height,
                durationSeconds,
                soundtrack: null,
                narration: narrationAudio,
                nativeAudioMode: characterDialogueRequested
                  ? "mute"
                  : narrationAudio
                  ? "mute"
                  : "ambience",
                signal: args.signal,
              })
            );
          } catch (fallbackCompositionError) {
            args.signal?.throwIfAborted();
            if (!characterDialogueRequested) {
              throw fallbackCompositionError;
            }
            // Dernier repli honnête : le mouvement H264 reste livré. Toute parole
            // native inutilisable est coupée, sans lui substituer un TTS qui ne
            // pourrait pas suivre les mouvements de bouche déjà générés.
            narration = null;
            narrationAudio = null;
            pipelineWarnings.push(
              "identity_team_character_dialogue_fallback_silent_motion",
              "video_audio_unavailable_video_continued"
            );
            normalized = await measure(
              "video_composition_silent_fallback",
              () =>
                composeOriginalAiVideo({
                  clips,
                  overlays,
                  width: format.width,
                  height: format.height,
                  durationSeconds,
                  soundtrack: null,
                  narration: null,
                  nativeAudioMode: "mute",
                  signal: args.signal,
                })
            );
          }
        }
      }
    }
    // Le compositeur a déjà décodé, recadré et normalisé chaque piste. Une
    // seconde lecture FFmpeg purement consultative ajoutait jusqu'à 4 s sans
    // pouvoir réparer le média : les scans lourds restent disponibles pour
    // les canaris/tests, hors du chemin critique payé par le professionnel.
    const finalVideoQa = {
      version: 1,
      status: "compositor_validated" as const,
      checks: ["duration", "frame_layout", "audio_policy"] as const,
      caption_layout: AI_MEDIA_VIDEO_TEXT_LAYOUT,
    };
    model = [
      teamPrecompositionModel,
      videoGateway.model,
      narrationAudio?.model,
      "inrcy/video-composer-v6-full-frame-overlay",
    ]
      .filter(Boolean)
      .join("+");
    videoEngineResult = videoGateway.provider.startsWith("inrcy-")
      ? "local_fallback"
      : providerRequest.videoEngine === "veo" &&
        videoGateway.provider.includes("google-gemini-omni")
      ? "veo_omni_fallback"
      : videoGateway.provider.includes("+")
      ? "omni_veo_fallback"
      : videoGateway.provider === "google-gemini-omni"
      ? "omni"
      : "veo";
    providerMetadata = {
      provider: videoGateway.provider,
      model: videoGateway.model,
      original_clip_count: videoGateway.clips.length,
      provider_request_ids: videoGateway.clips.map((clip) => clip.requestId),
      estimated_cost_micro_usd: videoGateway.estimatedCostMicroUsd,
      warnings: Array.from(
        new Set([...videoGateway.warnings, ...pipelineWarnings])
      ),
      team_precomposition: teamPrecompositionMetadata,
      team_video_speech_mode: providerRequest.teamVideoSpeechMode,
      native_character_dialogue_preserved: nativeCharacterDialoguePreserved,
      quality_assurance: {
        native_dialogue: characterDialogueRequested
          ? nativeDialogueQa || {
              version: 1,
              status: "unavailable",
              reason: "provider_fallback",
              clips: [],
            }
          : { version: 1, status: "not_requested" },
        final_video: finalVideoQa,
      },
      narration:
        narration && narrationAudio
          ? {
              enabled: true,
              model: narrationAudio.model,
              voice: narrationAudio.voice,
              language: narration.language,
              word_count: narration.wordCount,
              script_source: narration.source,
              script_sha256: narration.sha256,
            }
          : { enabled: false },
    };
  }

  args.signal?.throwIfAborted();
  const generatedAt = new Date().toISOString();
  const item = await measure("media_persistence", () =>
    saveGeneratedAiMedia({
      accountId: args.accountId,
      authUserId: args.authUserId,
      jobId: args.jobId,
      // Le brief et la consigne ponctuelle servent uniquement au prompt en
      // mémoire. Leur texte n'est ni conservé dans les métadonnées, ni
      // réutilisé comme titre Médiathèque.
      title: buildAiMediaTitle("", providerRequest.kind),
      media: normalized,
      metadata: {
        provenance: {
          source: localFallbackUsed
            ? "inrcy_local_media_fallback"
            : providerRequest.kind === "video"
            ? "inrcy_original_ai_video_engine"
            : "inrcy_brand_image_engine",
          surface: providerRequest.source,
          prompt_version: AI_MEDIA_PROMPT_VERSION,
          prompt_sha256: promptHash,
          subject_source: providerRequest.subjectSource,
          ai_instruction_present: Boolean(providerRequest.aiInstruction),
          ai_instruction_char_count: providerRequest.aiInstruction.length,
          with_text: providerRequest.withText,
          text_keyword_count: providerRequest.textKeywords.length,
          with_music: providerRequest.withMusic,
          with_narration: providerRequest.withNarration,
          narration_voice: providerRequest.narrationVoice,
          narration_voice_variant: providerRequest.narrationVoiceVariant,
          format: providerRequest.format,
          typology: providerRequest.typology,
          visual_style: providerRequest.visualStyle,
          image_style: providerRequest.imageStyle,
          shot_type: providerRequest.shotType,
          people_mode: providerRequest.peopleMode,
          creativity: providerRequest.creativity,
          use_brand_colors: providerRequest.useBrandColors,
          logo_mode: providerRequest.logoMode,
          video_engine: providerRequest.videoEngine,
          team_video_mode: providerRequest.teamVideoMode,
          team_video_speech_mode: providerRequest.teamVideoSpeechMode,
          identity_mode: providerRequest.identityMode,
          video_character_mode: providerRequest.videoCharacterMode,
          identity_consent: providerRequest.identityConsent
            ? {
                granted: true,
                recorded_at: generatedAt,
                version: "inrcy-media-identity-consent-v1",
              }
            : null,
          duration_seconds: providerRequest.durationSeconds,
          connect_scenes: providerRequest.connectScenes,
          inspiration_image_count: providerRequest.inspirationImages.length,
          exact_logo_applied: Boolean(officialLogo),
          logo_version_applied: officialLogo ? brandKit.logoVersion : null,
          exact_contact_composition_applied: exactContactCompositionApplied,
          deterministic_image_composition_applied:
            deterministicImageCompositionApplied,
          profile_phone_display_requested: profilePhoneDisplayRequested,
          profile_phone_display_applied: Boolean(profilePhone),
          brand_palette_applied: providerRequest.useBrandColors
            ? brandKit.colors
            : [],
          professional_library_images_used: 0,
          original_ai_video:
            providerRequest.kind === "video" && !localFallbackUsed,
          recent_publications_analyzed:
            generationContext.recentPublications.length,
          generated_at: generatedAt,
          active_account_id: args.accountId,
          actor_auth_user_id: args.authUserId,
          context_cache_source: generationContext.cacheSource,
        },
        output_spec: getAiMediaPromptOutputSpec(providerRequest),
        gateway: providerMetadata,
        soundtrack: soundtrack
          ? {
              id: soundtrack.id,
              name: soundtrack.name,
              file_name: soundtrack.fileName,
              duration_seconds: soundtrack.durationSeconds,
              license: soundtrack.license,
              sha256: soundtrack.sha256,
              size_bytes: soundtrack.sizeBytes,
            }
          : null,
      },
    })
  );

  pipelineTimingsMs.total = roundedDurationMs(pipelineStartedAt);
  const completedPipelineTimings = { ...pipelineTimingsMs };
  console.info("[ai-media] generation pipeline completed", {
    accountId: args.accountId,
    jobId: args.jobId,
    kind: providerRequest.kind,
    durationSeconds: providerRequest.durationSeconds || null,
    timingsMs: completedPipelineTimings,
  });

  return {
    item,
    soundtrack: soundtrack
      ? { id: soundtrack.id, name: soundtrack.name }
      : null,
    model,
    videoEngineResult,
    promptVersion: AI_MEDIA_PROMPT_VERSION,
    promptSha256: promptHash,
    pipelineTimingsMs: completedPipelineTimings,
  };
}
