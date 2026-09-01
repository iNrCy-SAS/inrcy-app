import "server-only";

import { createHash } from "node:crypto";

import { buildNormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import {
  getExistingGeneratedAiMedia,
  saveGeneratedAiMedia,
} from "@/lib/aiGeneratedMediaRegistry";
import { getBoosterGenerationContext } from "@/lib/boosterGenerationContext";
import {
  buildAiMediaTitle,
  type AiMediaGenerationRequest,
  type AiMediaLibraryPickerItem,
  type AiMediaSoundtrackResponse,
} from "@/lib/aiMediaGenerationContracts";
import {
  generateAiMediaImage,
  generateAiMediaVideo,
  type AiMediaGatewayResult,
} from "@/lib/aiMediaGateway";
import {
  AI_MEDIA_PROMPT_VERSION,
  buildAiMediaPrompt,
  getAiMediaPromptOutputSpec,
} from "@/lib/aiMediaGenerationPrompt";
import { loadAiMediaSoundtrack } from "@/lib/aiMediaGenerationSoundtracks";
import {
  normalizeGeneratedAiImage,
  normalizeGeneratedAiVideo,
  type NormalizedAiMedia,
} from "@/lib/aiMediaNormalizer";

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
    warnings: gateway.warnings,
    usage: gateway.usage,
  };
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
}): Promise<AiMediaGenerationServerResult> {
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
  const prompt = buildAiMediaPrompt({ request: args.request, profile });
  const promptHash = promptSha256(prompt);

  let gateway: AiMediaGatewayResult;
  let normalized: NormalizedAiMedia;
  let soundtrack: Awaited<ReturnType<typeof loadAiMediaSoundtrack>> | null = null;

  if (args.request.kind === "image") {
    gateway = await generateAiMediaImage({
      accountId: args.accountId,
      prompt,
    });
    normalized = await normalizeGeneratedAiImage(gateway.buffer);
  } else {
    gateway = await generateAiMediaVideo({
      accountId: args.accountId,
      prompt,
    });
    soundtrack = args.request.withMusic
      ? await loadAiMediaSoundtrack(args.request.idea || prompt)
      : null;
    normalized = await normalizeGeneratedAiVideo({
      input: gateway.buffer,
      soundtrack,
    });
  }

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
        source: "vercel_ai_gateway",
        surface: args.request.source,
        prompt_version: AI_MEDIA_PROMPT_VERSION,
        prompt_sha256: promptHash,
        subject_source: args.request.subjectSource,
        with_text: args.request.withText,
        with_music: args.request.withMusic,
        generated_at: generatedAt,
        active_account_id: args.accountId,
        actor_auth_user_id: args.authUserId,
        context_cache_source: generationContext.cacheSource,
      },
      output_spec: getAiMediaPromptOutputSpec(args.request.kind),
      gateway: cleanProviderMetadata(gateway),
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
    model: gateway.model,
    promptVersion: AI_MEDIA_PROMPT_VERSION,
    promptSha256: promptHash,
  };
}
