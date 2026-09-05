import "server-only";

import { createHash } from "node:crypto";

import {
  buildNormalizedAiGenerationProfile,
} from "@/lib/aiGenerationProfile";
import { buildAiMediaVideoDnaBrief } from "@/lib/aiMediaBusinessDna";
import { loadAiMediaBrandKit } from "@/lib/aiMediaBrandKit";
import {
  renderAiMediaVideoOverlay,
} from "@/lib/aiMediaBrandRenderer";
import { buildAiMediaCreativePlan } from "@/lib/aiMediaCreativePlan";
import { writeAiMediaHeadline } from "@/lib/aiMediaCopywriter";
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
  type AiMediaGatewayResult,
} from "@/lib/aiMediaGateway";
import { composeOriginalAiVideo } from "@/lib/aiMediaGeneratedVideo";
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
import {
  AI_MEDIA_PROMPT_VERSION,
  buildAiMediaPrompt,
  getAiMediaPromptOutputSpec,
} from "@/lib/aiMediaGenerationPrompt";
import { loadAiMediaSoundtrack } from "@/lib/aiMediaGenerationSoundtracks";
import {
  normalizeGeneratedAiImage,
  type NormalizedAiMedia,
} from "@/lib/aiMediaNormalizer";
import { generateOriginalAiVideoClips } from "@/lib/aiVideoProvider";
import type { DashboardEdition } from "@/lib/dashboardEdition";

type SupabaseLike = Parameters<typeof getBoosterGenerationContext>[0]["supabase"];

export type AiMediaGenerationServerResult = {
  item: AiMediaLibraryPickerItem;
  soundtrack: AiMediaSoundtrackResponse | null;
  model: string;
  videoEngineResult: "omni" | "veo" | "omni_veo_fallback" | null;
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

const FREE_STYLE_PALETTES: Record<AiMediaVisualStyle, [string, string, string]> = {
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
  const [existing, generationContext] = await Promise.all([
    measure("draft_lookup", () =>
      getExistingGeneratedAiMedia({
        accountId: args.accountId,
        jobId: args.jobId,
      }),
    ),
    measure("business_context", () =>
      getBoosterGenerationContext({
        supabase: args.supabase,
        userId: args.accountId,
        edition: args.edition,
      }),
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
      () => prepareAiMediaIdentityReferences(args.request.inspirationImages),
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

  const brandKitTask = measure("brand_kit", () =>
    loadAiMediaBrandKit({
      accountId: args.accountId,
      profile: generationContext.profile,
    }),
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
  const initialCreativePlan = buildAiMediaCreativePlan({
    request: providerRequest,
    profile,
    recentPublications: generationContext.recentPublications,
  });
  const creativePlanTask = providerRequest.withText
    ? measure("headline", () =>
        writeAiMediaHeadline({
          accountId: args.accountId,
          request: providerRequest,
          profile,
          plan: initialCreativePlan,
        }),
      )
    : Promise.resolve(initialCreativePlan);
  const [brandKit, creativePlan] = await Promise.all([
    brandKitTask,
    creativePlanTask,
  ]);
  args.signal?.throwIfAborted();
  const officialLogo = providerRequest.logoMode === "none" ? null : brandKit.logo;
  const effectiveColors = providerRequest.useBrandColors
    ? brandKit.colors
    : FREE_STYLE_PALETTES[providerRequest.visualStyle];
  const prompt = buildAiMediaPrompt({
    request: providerRequest,
    profile,
    recentPublications: generationContext.recentPublications,
    brandColors: providerRequest.useBrandColors ? brandKit.colors : [],
    hasLogo: Boolean(officialLogo),
    copy: creativePlan,
  });
  const promptHash = promptSha256(prompt);
  const format = AI_MEDIA_FORMAT_SPECS[providerRequest.format];
  const localFallbackFrameTasks = new Map<string, Promise<Buffer>>();
  const getLocalFallbackFrame = (includeLogo = providerRequest.kind === "image") => {
    const cacheKey = includeLogo ? "with-logo" : "without-logo";
    const cached = localFallbackFrameTasks.get(cacheKey);
    if (cached) return cached;
    const task = (async () => {
      const referenceArgs = {
        references: preparedIdentityReferences.buffers,
        width: format.width,
        height: format.height,
        brandColors: effectiveColors,
        officialLogo: includeLogo ? officialLogo : null,
      };
      if (preparedIdentityReferences.buffers.length) {
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
        officialLogo: includeLogo ? officialLogo : null,
        companyName: creativePlan.companyName,
        headline: providerRequest.withText ? creativePlan.headline : "",
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
            videoEngine: null,
            durationSeconds: null,
            logoMode: "none",
          },
          profile,
          recentPublications: generationContext.recentPublications,
          brandColors: providerRequest.useBrandColors ? brandKit.colors : [],
          hasLogo: false,
        })}\n\nIMAGE MAÎTRE ÉPHÉMÈRE POUR ANIMATION : réunir les ${preparedIdentityReferences.buffers.length} adultes autorisés dans une seule scène cohérente. Image 1 = personne 1, image 2 = personne 2${preparedIdentityReferences.buffers.length === 3 ? ", image 3 = personne 3" : ""}. Chaque personne apparaît exactement une fois, reste distincte et reconnaissable ; aucune fusion, permutation, duplication, omission ni substitution générique. Garder tous les visages clairement visibles, une posture naturelle propice à une animation légère et aucun texte ni logo.`
      : "";

  let normalized: NormalizedAiMedia;
  let soundtrack: Awaited<ReturnType<typeof loadAiMediaSoundtrack>> | null = null;
  let model = "";
  let providerMetadata: Record<string, unknown>;
  let videoEngineResult: AiMediaGenerationServerResult["videoEngineResult"] = null;
  let localFallbackUsed = false;
  let teamPrecompositionGateway: AiMediaGatewayResult | null = null;
  let teamPrecompositionModel = "";
  let teamPrecompositionMetadata: Record<string, unknown> | null = null;

  if (providerRequest.kind === "image") {
    args.signal?.throwIfAborted();
    let imageBuffer: Buffer;
    let gateway: AiMediaGatewayResult | null = null;
    try {
      gateway = await measure("image_provider", () =>
        generateAiMediaImage({
          accountId: args.accountId,
          prompt,
          identityMode: providerRequest.identityMode,
          identityReferences: preparedIdentityReferences.buffers,
          officialLogo,
          size: format.generationSize,
          signal: args.signal,
        }),
      );
      imageBuffer = gateway.buffer;
    } catch {
      args.signal?.throwIfAborted();
      localFallbackUsed = true;
      imageBuffer = await measure("image_local_fallback", () =>
        getLocalFallbackFrame(true),
      );
    }
    // Cette étape garantit le cadrage et le JPEG universel, aussi bien pour le
    // fournisseur nominal que pour le motion-graphic local de secours.
    try {
      normalized = await measure("image_normalization", () =>
        normalizeGeneratedAiImage(imageBuffer, {
          width: format.width,
          height: format.height,
        }),
      );
    } catch {
      args.signal?.throwIfAborted();
      if (!gateway) throw new Error("ai_image_local_fallback_invalid");
      // Aucun second appel payant : si les octets fournisseur ne sont pas
      // décodables, la composition locale fidèle clôt la même tentative.
      gateway = null;
      localFallbackUsed = true;
      imageBuffer = await measure(
        "image_local_fallback_after_normalization",
        () => getLocalFallbackFrame(true),
      );
      normalized = await measure("image_local_fallback_normalization", () =>
        normalizeGeneratedAiImage(imageBuffer, {
          width: format.width,
          height: format.height,
        }),
      );
    }
    args.signal?.throwIfAborted();
    model = gateway?.model || (providerRequest.identityMode === "reference_team"
      ? "inrcy/reference-team-composer-v1"
      : "inrcy/local-brand-composer-v1");
    providerMetadata = gateway
      ? cleanProviderMetadata(gateway)
      : {
          provider: "inrcy-local-composer",
          model,
          reference_images_count: preparedIdentityReferences.buffers.length,
          identity_reference_images_count:
            providerRequest.identityMode === "auto"
              ? 0
              : preparedIdentityReferences.buffers.length,
          generic_reference_images_count:
            providerRequest.identityMode === "auto"
              ? preparedIdentityReferences.buffers.length
              : 0,
          official_logo_included: Boolean(officialLogo),
          estimated_cost_micro_usd: 0,
          warnings: [
            providerRequest.identityMode === "reference_team"
              ? "identity_team_exact_photo_local_composition"
              : "image_provider_unavailable_local_composition",
          ],
          usage: null,
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
          }),
        ),
      );
      return minimalOverlaysTask;
    };

    // Le chemin critique commence immédiatement : le moteur vidéo choisi, la voix, la musique et
    // les calques sont indépendants et sont donc préparés en parallèle. La
    // qualité nominale reste identique, mais les temps ne s'additionnent plus.
    const videoGatewayTask = measure("video_generation", async () => {
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
                // Le logo exact est ajouté une seule fois par le compositeur
                // vidéo ; il ne surcharge pas les références d'identité.
                officialLogo: null,
                size: format.generationSize,
                signal: args.signal,
              }),
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
                teamPrecompositionGateway!.buffer,
              ),
          );
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
            model: `${teamPrecompositionGateway.model}+inrcy/local-motion-v1`,
            warnings: [
              "identity_team_ai_group_frame_local_motion",
              "identity_team_similarity_review_required",
            ],
            clips: motion.clips.map((clip) => ({
              ...clip,
              warnings: [
                "identity_team_ai_group_frame_local_motion",
                "identity_team_similarity_review_required",
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
        return await generateOriginalAiVideoClips({
          accountId: args.accountId,
          request: providerRequest,
          plan: creativePlan,
          creativeBrief: buildAiMediaVideoDnaBrief(profile),
          brandColors: effectiveColors,
          profession:
            profile.business.professionLabel ||
            profile.business.sectorLabel ||
            creativePlan.companyName,
          signal: args.signal,
        });
      } catch {
        args.signal?.throwIfAborted();
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
    const narrationTask = measure("narration_pipeline", async () => {
      try {
        const narration = await measure("narration_copy", () =>
          writeAiMediaNarration({
            accountId: args.accountId,
            request: providerRequest,
            profile,
            plan: creativePlan,
          }),
        );
        args.signal?.throwIfAborted();
        if (!narration) {
          return {
            narration: null,
            audio: null,
            warnings: [] as string[],
          };
        }
        try {
          const audio = await measure("narration_audio", () =>
            generateAiMediaNarrationAudio({
              accountId: args.accountId,
              narration,
              durationSeconds,
              narrationVoice: providerRequest.narrationVoice || "female",
              signal: narrationController.signal,
            }),
          );
          return { narration, audio, warnings: [] as string[] };
        } catch {
          args.signal?.throwIfAborted();
          return {
            narration,
            audio: null,
            warnings: ["narration_unavailable_video_continued"],
          };
        }
      } catch {
        args.signal?.throwIfAborted();
        return {
          narration: null,
          audio: null,
          warnings: ["narration_unavailable_video_continued"],
        };
      }
    });
    const soundtrackTask = measure("soundtrack", async () => {
      if (!providerRequest.withMusic) {
        return { value: null, warnings: [] as string[] };
      }
      try {
        const value = await loadAiMediaSoundtrack(
          providerRequest.idea ||
            `${creativePlan.companyName} ${creativePlan.headline}`,
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
            }),
          ),
        );
        return { value, warnings: [] as string[], error: null };
      } catch {
        args.signal?.throwIfAborted();
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

    const narrationJoinStartedAt = performance.now();
    const narrationResult = await waitForOptionalTaskWithinGrace({
      task: narrationTask,
      graceMs: positiveInt(
        process.env.AI_MEDIA_NARRATION_AFTER_VIDEO_GRACE_MS,
        DEFAULT_NARRATION_AFTER_VIDEO_GRACE_MS,
        20_000,
      ),
      signal: args.signal,
    });
    pipelineTimingsMs.narration_join_after_veo = roundedDurationMs(
      narrationJoinStartedAt,
    );
    if (!narrationResult) {
      narrationController.abort(new Error("ai_media_narration_deadline"));
      pipelineWarnings.push("narration_slow_video_continued");
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
      ...overlaysResult.warnings,
    );
    soundtrack = soundtrackResult.value;
    if (overlaysResult.error || !overlaysResult.value) {
      throw overlaysResult.error || new Error("ai_media_video_overlay_missing");
    }
    let overlays = overlaysResult.value;
    let narration = narrationResult?.narration || null;
    let narrationAudio = narrationResult?.audio || null;

    const clips = videoGateway.clips.map((clip) => ({
      buffer: clip.buffer,
      durationSeconds: clip.durationSeconds,
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
          signal: args.signal,
        }),
      );
    } catch {
      args.signal?.throwIfAborted();
      // Les pistes audio et l'habillage sont facultatifs. Si FFmpeg refuse
      // l'un de ces actifs, réassembler une seule fois les mêmes clips en mode
      // minimal évite de rappeler Veo et préserve le rendu déjà payé.
      overlays = await renderMinimalOverlays();
      soundtrack = null;
      narration = null;
      narrationAudio = null;
      pipelineWarnings.push("video_enhancements_unavailable_video_continued");
      normalized = await measure("video_composition_fallback", () =>
        composeOriginalAiVideo({
          clips,
          overlays,
          width: format.width,
          height: format.height,
          durationSeconds,
          soundtrack: null,
          narration: null,
          signal: args.signal,
        }),
      );
    }
    model = [
      teamPrecompositionModel,
      videoGateway.model,
      narrationAudio?.model,
      "inrcy/video-composer-v4-controlled-audio",
    ].filter(Boolean).join("+");
    videoEngineResult = videoGateway.provider.startsWith("inrcy-")
      ? null
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
        new Set([...videoGateway.warnings, ...pipelineWarnings]),
      ),
      team_precomposition: teamPrecompositionMetadata,
      narration: narration && narrationAudio
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
          inspiration_image_count: providerRequest.inspirationImages.length,
          exact_logo_applied: Boolean(officialLogo),
          brand_palette_applied: providerRequest.useBrandColors ? brandKit.colors : [],
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
    }),
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
