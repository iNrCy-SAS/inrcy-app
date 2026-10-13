import "server-only";

import { googleOmniVideoProvider } from "@/lib/aiVideoProviderGoogleOmni";
import { googleVeoVideoProvider } from "@/lib/aiVideoProviderGoogleVeo";
import { createGatewayAiVideoProvider } from "./aiVideoProviderGateway.ts";
import { getAiMediaVideoModel, normalizeAiMediaVideoEngine, type AiMediaVideoEngine } from "./aiMediaModelCatalog.ts";
import type {
  AiVideoProvider,
  AiVideoProviderGenerationArgs,
  AiVideoProviderResult,
} from "@/lib/aiVideoProviderTypes";

export type AiVideoProviderId = "google-gemini-omni" | "google-veo-fast" | `vercel-ai-gateway:${string}`;

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
  const requestedEngine = normalizeAiMediaVideoEngine(args?.request.videoEngine ?? "omni");
  if (!requestedEngine) throw new Error("ai_media_video_engine_invalid");
  const selectedModel = getAiMediaVideoModel(requestedEngine);
  // The reviewed, quoted request always wins. The legacy environment setting
  // remains a default only for callers that have no explicit Studio request.
  const forced = args ? null : configuredProvider();
  if (forced) return forced;
  if (selectedModel.transport === "gateway") return createGatewayAiVideoProvider(requestedEngine);
  return requestedEngine === "veo"
    ? googleVeoVideoProvider
    : googleOmniVideoProvider;
}

export async function generateOriginalAiVideoClips(
  args: AiVideoProviderGenerationArgs,
): Promise<AiVideoProviderResult> {
  return await resolveProvider(args).generate(args);
}

export function getAiVideoProviderIdentity(engine?: AiMediaVideoEngine) {
  const provider = engine
    ? getAiMediaVideoModel(engine).transport === "gateway"
      ? createGatewayAiVideoProvider(engine)
      : engine === "veo" ? googleVeoVideoProvider : googleOmniVideoProvider
    : resolveProvider();
  return { provider: provider.id, model: provider.model };
}
