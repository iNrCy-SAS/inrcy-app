import "server-only";

import { googleOmniVideoProvider } from "@/lib/aiVideoProviderGoogleOmni";
import { googleVeoVideoProvider } from "@/lib/aiVideoProviderGoogleVeo";
import type {
  AiVideoProvider,
  AiVideoProviderGenerationArgs,
  AiVideoProviderResult,
} from "@/lib/aiVideoProviderTypes";

export type AiVideoProviderId = "google-gemini-omni" | "google-veo-fast";

function compact(value: unknown, max = 240) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function configuredProvider(): AiVideoProvider | null {
  const configured = compact(process.env.AI_MEDIA_VIDEO_PROVIDER, 80).toLowerCase();
  if (!configured || configured === "auto") return null;
  if (
    ["google-gemini-omni", "gemini-omni", "omni", "omni-flash"].includes(
      configured,
    )
  ) {
    return googleOmniVideoProvider;
  }
  if (
    ["google-veo-fast", "google-veo", "veo", "veo-fast", "gemini"].includes(
      configured,
    )
  ) {
    return googleVeoVideoProvider;
  }
  throw new Error("ai_video_provider_invalid");
}

function resolveProvider(args?: AiVideoProviderGenerationArgs): AiVideoProvider {
  // A 16/24 s render is one story, not two or three unrelated generations.
  // Omni carries the preceding video state through previous_interaction_id;
  // the Veo multi-clip path cannot offer that exact continuity contract.
  if ((args?.request.durationSeconds || 8) > 8) {
    return googleOmniVideoProvider;
  }
  const forced = configuredProvider();
  if (forced) return forced;
  return args?.request.videoEngine === "veo"
    ? googleVeoVideoProvider
    : googleOmniVideoProvider;
}

export async function generateOriginalAiVideoClips(
  args: AiVideoProviderGenerationArgs,
): Promise<AiVideoProviderResult> {
  return await resolveProvider(args).generate(args);
}

export function getAiVideoProviderIdentity() {
  const provider = resolveProvider();
  return { provider: provider.id, model: provider.model };
}
