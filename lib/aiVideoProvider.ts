import "server-only";

import { googleOmniVideoProvider } from "@/lib/aiVideoProviderGoogleOmni";
import { googleVeoVideoProvider } from "@/lib/aiVideoProviderGoogleVeo";
import { createGatewayAiVideoProvider } from "./aiVideoProviderGateway.ts";
import { getAiMediaVideoEngineRetirementIssue, getAiMediaVideoModel, normalizeAiMediaVideoEngine, type AiMediaVideoEngine } from "./aiMediaModelCatalog.ts";
import type {
  AiVideoProvider,
  AiVideoProviderGenerationArgs,
  AiVideoProviderResult,
} from "@/lib/aiVideoProviderTypes";

// Other engines do not load Kling's storage/voice implementation or credentials.
const klingAiVideoProvider: AiVideoProvider = {
  id: "kling-direct", model: "kling-4.0-omni",
  generate: async args => (await import("./aiVideoProviderKling.ts")).klingAiVideoProvider.generate(args),
};
export async function preflightKlingAiVideoAccess(args: Pick<AiVideoProviderGenerationArgs, "accountId" | "request" | "signal">) {
  if (args.request.videoEngine === "kling") await (await import("./aiVideoProviderKling.ts")).preflightKlingAiVideoAccess(args);
}

export type AiVideoProviderId = "google-gemini-omni" | "google-veo-fast" | "kling-direct" | `vercel-ai-gateway:${string}`;

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
  if (["kling", "kling-direct", "kling-4.0-omni"].includes(configured)) return klingAiVideoProvider;
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
    return createGatewayAiVideoProvider("veo");
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
  if (selectedModel.transport === "kling-direct") return klingAiVideoProvider;
  if (selectedModel.transport === "gateway") return createGatewayAiVideoProvider(requestedEngine);
  return requestedEngine === "veo"
    ? googleVeoVideoProvider
    : googleOmniVideoProvider;
}

export async function generateOriginalAiVideoClips(
  args: AiVideoProviderGenerationArgs,
): Promise<AiVideoProviderResult> {
  // Final application boundary: even a typed stale preset cannot submit Wan 3.
  // Identity lookups and recovery of existing clips remain available.
  const retiredVideoEngine = getAiMediaVideoEngineRetirementIssue(args.request.videoEngine);
  if (retiredVideoEngine) throw new Error(retiredVideoEngine.message);
  return await resolveProvider(args).generate(args);
}

export function getAiVideoProviderIdentity(engine?: AiMediaVideoEngine) {
  const provider = engine
    ? getAiMediaVideoModel(engine).transport === "kling-direct"
      ? klingAiVideoProvider
      : getAiMediaVideoModel(engine).transport === "gateway"
      ? createGatewayAiVideoProvider(engine)
      : engine === "veo" ? googleVeoVideoProvider : googleOmniVideoProvider
    : resolveProvider();
  return { provider: provider.id, model: provider.model };
}
