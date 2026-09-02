import "server-only";

import { createHash } from "node:crypto";

import {
  buildNormalizedAiGenerationProfile,
  type NormalizedAiGenerationProfile,
} from "@/lib/aiGenerationProfile";
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

type SupabaseLike = Parameters<typeof getBoosterGenerationContext>[0]["supabase"];

export type AiMediaGenerationServerResult = {
  item: AiMediaLibraryPickerItem;
  soundtrack: AiMediaSoundtrackResponse | null;
  model: string;
  promptVersion: string;
  promptSha256: string;
};

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

function compactVideoValue(value: unknown, maximum = 260) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

/**
 * Veo accepte un contexte court. Ce brief dédié conserve les faits décisifs
 * du profil sans lui renvoyer le long prompt image, l'historique ou les règles
 * déjà répétées dans chaque plan.
 */
function buildConciseVideoProfileBrief(
  profile: NormalizedAiGenerationProfile,
) {
  const business = profile.business;
  const rows = [
    ["Entreprise", business.companyName],
    ["Métier", business.professionLabel || business.sectorLabel],
    ["Présentation", compactVideoValue(business.description, 360)],
    ["Prestations", business.services.slice(0, 5).join(", ")],
    ["Forces", business.strengths.slice(0, 4).join(", ")],
    ["Clientèle", business.customerTypologies.slice(0, 3).join(", ")],
    ["Localisation", [business.city, ...business.interventionZones.slice(0, 3)].filter(Boolean).join(", ")],
  ]
    .map(([label, value]) => {
      const normalized = compactVideoValue(value, 360);
      return normalized ? `${label}: ${normalized}` : "";
    })
    .filter(Boolean);
  return compactVideoValue(rows.join(". "), 1_600);
}

/**
 * Génère et normalise un média, puis l'inscrit comme brouillon temporaire et
 * invisible. `accountId` ne doit provenir que du scope serveur multicompte.
 */
export async function generateAndSaveAiMedia(args: {
  supabase: SupabaseLike;
  accountId: string;
  authUserId: string;
  jobId: string;
  request: AiMediaGenerationRequest;
  signal?: AbortSignal;
}): Promise<AiMediaGenerationServerResult> {
  args.signal?.throwIfAborted();
  const existing = await getExistingGeneratedAiMedia({
    accountId: args.accountId,
    jobId: args.jobId,
  });
  if (existing) {
    return {
      item: existing,
      soundtrack: null,
      model: "replayed",
      promptVersion: AI_MEDIA_PROMPT_VERSION,
      promptSha256: "",
    };
  }

  const generationContext = await getBoosterGenerationContext({
    supabase: args.supabase,
    userId: args.accountId,
  });
  const [brandKit] = await Promise.all([
    loadAiMediaBrandKit({
      accountId: args.accountId,
      profile: generationContext.profile,
    }),
  ]);
  args.signal?.throwIfAborted();
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
  const creativePlan = args.request.withText && args.request.textKeywords.length
    ? await writeAiMediaHeadline({
        accountId: args.accountId,
        request: args.request,
        profile,
        plan: initialCreativePlan,
      })
    : initialCreativePlan;
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

  if (args.request.kind === "image") {
    args.signal?.throwIfAborted();
    const gateway: AiMediaGatewayResult = await generateAiMediaImage({
      accountId: args.accountId,
      prompt,
      officialLogo,
      size: format.generationSize,
    });
    // Sujet, profil et logo ont déjà guidé GPT Image. Cette étape ne dessine
    // rien : elle garantit uniquement le cadrage et le JPEG universel.
    normalized = await normalizeGeneratedAiImage(gateway.buffer, {
      width: format.width,
      height: format.height,
    });
    args.signal?.throwIfAborted();
    model = gateway.model;
    providerMetadata = cleanProviderMetadata(gateway);
  } else {
    args.signal?.throwIfAborted();
    const pipelineWarnings: string[] = [];
    const narration = await writeAiMediaNarration({
      accountId: args.accountId,
      request: args.request,
      profile,
      plan: creativePlan,
    });
    // La voix est préparée avant les clips coûteux. Une panne TTS ne peut donc
    // jamais déclencher une facture Veo pour une vidéo privée de sa narration.
    let narrationAudio: Awaited<
      ReturnType<typeof generateAiMediaNarrationAudio>
    > | null = null;
    if (narration) {
      try {
        narrationAudio = await generateAiMediaNarrationAudio({
          accountId: args.accountId,
          narration,
          durationSeconds: args.request.durationSeconds || 8,
        });
      } catch {
        args.signal?.throwIfAborted();
        // Narration is an enhancement. A TTS outage must not prevent the core
        // Veo video from being generated and delivered.
        pipelineWarnings.push("narration_unavailable_video_continued");
      }
    }
    args.signal?.throwIfAborted();
    const videoGateway = await generateOriginalAiVideoClips({
      accountId: args.accountId,
      request: args.request,
      plan: creativePlan,
      creativeBrief: buildConciseVideoProfileBrief(profile),
      brandColors: effectiveColors,
      profession:
        profile.business.professionLabel ||
        profile.business.sectorLabel ||
        creativePlan.companyName,
      signal: args.signal,
    });
    args.signal?.throwIfAborted();
    if (args.request.withMusic) {
      try {
        soundtrack = await loadAiMediaSoundtrack(
          args.request.idea ||
            `${creativePlan.companyName} ${creativePlan.headline}`,
        );
      } catch {
        args.signal?.throwIfAborted();
        // The original Veo ambience remains available when a local soundtrack
        // asset cannot be loaded.
        soundtrack = null;
        pipelineWarnings.push("soundtrack_unavailable_video_continued");
      }
    }
    const renderMinimalOverlays = () =>
      Promise.all(
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
    let overlays: Buffer[];
    try {
      overlays = await Promise.all(
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
    } catch {
      args.signal?.throwIfAborted();
      // Un logo corrompu ou une accroche impossible à rasteriser ne doit pas
      // annuler les clips Veo déjà facturés. On conserve la vidéo avec un
      // calque transparent et on signale explicitement la dégradation.
      overlays = await renderMinimalOverlays();
      pipelineWarnings.push("branding_overlay_unavailable_video_continued");
    }

    const clips = videoGateway.clips.map((clip) => ({
      buffer: clip.buffer,
      durationSeconds: clip.durationSeconds,
    }));
    try {
      normalized = await composeOriginalAiVideo({
        clips,
        overlays,
        width: format.width,
        height: format.height,
        durationSeconds: args.request.durationSeconds || 8,
        soundtrack,
        narration: narrationAudio,
        signal: args.signal,
      });
    } catch {
      args.signal?.throwIfAborted();
      // Les pistes audio et l'habillage sont facultatifs. Si FFmpeg refuse
      // l'un de ces actifs, réassembler une seule fois les mêmes clips en mode
      // minimal évite de rappeler Veo et préserve le rendu déjà payé.
      overlays = await renderMinimalOverlays();
      soundtrack = null;
      narrationAudio = null;
      pipelineWarnings.push("video_enhancements_unavailable_video_continued");
      normalized = await composeOriginalAiVideo({
        clips,
        overlays,
        width: format.width,
        height: format.height,
        durationSeconds: args.request.durationSeconds || 8,
        soundtrack: null,
        narration: null,
        signal: args.signal,
      });
    }
    model = [
      videoGateway.model,
      narrationAudio?.model,
      "inrcy/video-composer-v4-controlled-audio",
    ].filter(Boolean).join("+");
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
  const item = await saveGeneratedAiMedia({
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
        format: args.request.format,
        typology: args.request.typology,
        visual_style: args.request.visualStyle,
        image_style: args.request.imageStyle,
        shot_type: args.request.shotType,
        people_mode: args.request.peopleMode,
        creativity: args.request.creativity,
        use_brand_colors: args.request.useBrandColors,
        logo_mode: args.request.logoMode,
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
  });

  return {
    item,
    soundtrack: soundtrack
      ? { id: soundtrack.id, name: soundtrack.name }
      : null,
    model,
    promptVersion: AI_MEDIA_PROMPT_VERSION,
    promptSha256: promptHash,
  };
}
