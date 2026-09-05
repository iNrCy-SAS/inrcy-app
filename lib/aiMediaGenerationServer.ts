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
  return {
    model: gateway.model,
    provider_media_type: gateway.mediaType,
    reference_images_count: gateway.referenceImagesCount,
    reference_policy: "official_logo_only",
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

  const brandKitTask = measure("brand_kit", () =>
    loadAiMediaBrandKit({
      accountId: args.accountId,
      profile: generationContext.profile,
    }),
  );
  const profile = buildNormalizedAiGenerationProfile({
    profile: generationContext.profile,
    business: generationContext.business,
    idea: args.request.idea,
    theme: args.request.idea,
    style: "",
    media: {
      type: args.request.kind === "video" ? "video" : "images",
      count: 1,
      hasVisualContext: false,
      hasAudioTranscript: false,
      context: "",
    },
  });
  const initialCreativePlan = buildAiMediaCreativePlan({
    request: args.request,
    profile,
    recentPublications: generationContext.recentPublications,
  });
  const creativePlanTask = args.request.withText
    ? measure("headline", () =>
        writeAiMediaHeadline({
          accountId: args.accountId,
          request: args.request,
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
  const officialLogo = args.request.logoMode === "none" ? null : brandKit.logo;
  const effectiveColors = args.request.useBrandColors
    ? brandKit.colors
    : FREE_STYLE_PALETTES[args.request.visualStyle];
  const prompt = buildAiMediaPrompt({
    request: args.request,
    profile,
    recentPublications: generationContext.recentPublications,
    brandColors: args.request.useBrandColors ? brandKit.colors : [],
    hasLogo: Boolean(officialLogo),
    copy: creativePlan,
  });
  const promptHash = promptSha256(prompt);
  const format = AI_MEDIA_FORMAT_SPECS[args.request.format];

  let normalized: NormalizedAiMedia;
  let soundtrack: Awaited<ReturnType<typeof loadAiMediaSoundtrack>> | null = null;
  let model = "";
  let providerMetadata: Record<string, unknown>;
  let videoEngineResult: AiMediaGenerationServerResult["videoEngineResult"] = null;

  if (args.request.kind === "image") {
    args.signal?.throwIfAborted();
    const gateway: AiMediaGatewayResult = await measure("image_provider", () =>
      generateAiMediaImage({
        accountId: args.accountId,
        prompt,
        officialLogo,
        size: format.generationSize,
        signal: args.signal,
      }),
    );
    // Sujet, profil et logo ont déjà guidé GPT Image. Cette étape ne dessine
    // rien : elle garantit uniquement le cadrage et le JPEG universel.
    normalized = await measure("image_normalization", () =>
      normalizeGeneratedAiImage(gateway.buffer, {
        width: format.width,
        height: format.height,
      }),
    );
    args.signal?.throwIfAborted();
    model = gateway.model;
    providerMetadata = cleanProviderMetadata(gateway);
  } else {
    args.signal?.throwIfAborted();
    const pipelineWarnings: string[] = [];
    const durationSeconds = args.request.durationSeconds || 8;
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
            visualStyle: args.request.visualStyle,
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
    const videoGatewayTask = measure("video_generation", () =>
      generateOriginalAiVideoClips({
        accountId: args.accountId,
        request: args.request,
        plan: creativePlan,
        creativeBrief: buildAiMediaVideoDnaBrief(profile),
        brandColors: effectiveColors,
        profession:
          profile.business.professionLabel ||
          profile.business.sectorLabel ||
          creativePlan.companyName,
        signal: args.signal,
      }),
    );
    const narrationTask = measure("narration_pipeline", async () => {
      try {
        const narration = await measure("narration_copy", () =>
          writeAiMediaNarration({
            accountId: args.accountId,
            request: args.request,
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
              narrationVoice: args.request.narrationVoice || "female",
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
      if (!args.request.withMusic) {
        return { value: null, warnings: [] as string[] };
      }
      try {
        const value = await loadAiMediaSoundtrack(
          args.request.idea ||
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
              visualStyle: args.request.visualStyle,
              logoMode: args.request.logoMode,
              withText: args.request.withText,
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
      videoGateway.model,
      narrationAudio?.model,
      "inrcy/video-composer-v4-controlled-audio",
    ].filter(Boolean).join("+");
    videoEngineResult = videoGateway.provider.includes("+")
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
      // Le brief libre sert uniquement au prompt en mémoire. Il n'est ni
      // conservé dans les métadonnées, ni réutilisé comme titre Médiathèque.
      title: buildAiMediaTitle("", args.request.kind),
      media: normalized,
      metadata: {
        provenance: {
          source: args.request.kind === "video"
            ? "inrcy_original_ai_video_engine"
            : "inrcy_brand_image_engine",
          surface: args.request.source,
          prompt_version: AI_MEDIA_PROMPT_VERSION,
          prompt_sha256: promptHash,
          subject_source: args.request.subjectSource,
          with_text: args.request.withText,
          text_keyword_count: args.request.textKeywords.length,
          with_music: args.request.withMusic,
          with_narration: args.request.withNarration,
          narration_voice: args.request.narrationVoice,
          format: args.request.format,
          typology: args.request.typology,
          visual_style: args.request.visualStyle,
          image_style: args.request.imageStyle,
          shot_type: args.request.shotType,
          people_mode: args.request.peopleMode,
          creativity: args.request.creativity,
          use_brand_colors: args.request.useBrandColors,
          logo_mode: args.request.logoMode,
          video_engine: args.request.videoEngine,
          duration_seconds: args.request.durationSeconds,
          inspiration_image_count: args.request.inspirationImages.length,
          inspiration_image_sha256: args.request.inspirationImages.map((image) =>
            createHash("sha256").update(image.data).digest("hex"),
          ),
          exact_logo_applied: Boolean(officialLogo),
          brand_palette_applied: args.request.useBrandColors ? brandKit.colors : [],
          professional_library_images_used: 0,
          original_ai_video: args.request.kind === "video",
          recent_publications_analyzed:
            generationContext.recentPublications.length,
          generated_at: generatedAt,
          active_account_id: args.accountId,
          actor_auth_user_id: args.authUserId,
          context_cache_source: generationContext.cacheSource,
        },
        output_spec: getAiMediaPromptOutputSpec(args.request),
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
    kind: args.request.kind,
    durationSeconds: args.request.durationSeconds || null,
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
