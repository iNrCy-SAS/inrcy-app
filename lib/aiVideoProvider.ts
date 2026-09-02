import "server-only";

import { googleVeoVideoProvider } from "@/lib/aiVideoProviderGoogleVeo";
import type {
  AiVideoProvider,
  AiVideoProviderGenerationArgs,
  AiVideoProviderResult,
} from "@/lib/aiVideoProviderTypes";

export type AiVideoProviderId = "google-veo-fast";

function resolveProvider(): AiVideoProvider {
  const configured = String(process.env.AI_MEDIA_VIDEO_PROVIDER || "google-veo-fast")
    .trim()
    .toLocaleLowerCase();
  if (["google-veo-fast", "google-veo", "veo", "gemini"].includes(configured)) {
    return googleVeoVideoProvider;
  }
  throw new Error("ai_video_provider_invalid");
}

export async function generateOriginalAiVideoClips(
  args: AiVideoProviderGenerationArgs,
): Promise<AiVideoProviderResult> {
  return await resolveProvider().generate(args);
}

export function getAiVideoProviderIdentity() {
  const provider = resolveProvider();
  return { provider: provider.id, model: provider.model };
}
