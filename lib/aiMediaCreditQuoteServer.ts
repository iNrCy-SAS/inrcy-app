import "server-only";
import { createHash } from "node:crypto";
import { quoteAiMediaCredits, type AiMediaCreditsQuoteInput } from "./aiMediaCreditsPricing.ts";
import type { AiMediaGenerationRequest } from "./aiMediaGenerationContracts.ts";
import { hasProvidedAiMediaCharacterVoice } from "./aiMediaCharacterVoices.ts";
import { normalizeAiMediaExactDialogue } from "./aiMediaExactDialogue.ts";
import { getAiMediaVideoEngineRetirementIssue, getAiMediaVideoCreditRateLimitIssue, isAiMediaVideoEngineAvailable, normalizeAiMediaVideoEngine } from "./aiMediaModelCatalog.ts";

import { getAiMediaVideoReferenceCompatibilityIssue } from "./aiMediaVideoClientOptions.ts";
import { usesHeygenAvatarRoute, getHeygenCinematicSettings } from "./aiMediaHeygenRoute.ts";

export function createAiMediaServerQuote(accountId: string, input: AiMediaCreditsQuoteInput) {
  const retiredVideoEngine = input.kind === "video" ? getAiMediaVideoEngineRetirementIssue(input.videoEngine) : null;
  if (retiredVideoEngine) throw new Error(retiredVideoEngine.message);
  if (input.kind === "video") {
    const engine = normalizeAiMediaVideoEngine(input.videoEngine ?? "omni");
    if (!engine) throw new TypeError("ai_media_video_engine_invalid");
    const issue = getAiMediaVideoCreditRateLimitIssue(engine, input.videoResolution, input)
      ?? (input.creationMode === "free" ? getAiMediaVideoReferenceCompatibilityIssue(engine, input) : null);
    if (issue) throw Object.assign(new TypeError(issue.message), { code: issue.code });
    if (engine === "heygen-avatar" && !usesHeygenAvatarRoute(input)) {
      const settings = getHeygenCinematicSettings({
        format: typeof input.format === "string" ? input.format : undefined,
        videoResolution: typeof input.videoResolution === "string" ? input.videoResolution : undefined,
        durationSeconds: input.durationSeconds,
      });
      if (settings.resolutionAdapted) throw Object.assign(new TypeError("Ce format HeyGen est disponible en 720p pour une scène cinématique. Choisissez cette qualité avant de générer."), { code: "AI_MEDIA_VIDEO_RESOLUTION_UNSUPPORTED" });
    }

  }
  // Both quote and generation routes enter here before reserving any credits.
  if (input.kind === "video" && !isAiMediaVideoEngineAvailable(input.videoEngine || "omni")) {
    throw new Error("ai_media_video_engine_unavailable");
  }
  if (input.kind === "video" && ["kling", "kling-flash"].includes(normalizeAiMediaVideoEngine(input.videoEngine) || "") && !String(process.env.KLING_API_KEY || "").trim()) {
    throw new Error("ai_video_kling_credentials_missing");
  }
  const quote = quoteAiMediaCredits(input);
  // Image format and the fixed provider canvas are part of the quote identity,
  // even when a bounded model has the same commercial price in every format.
  const quoteId = createHash("sha256").update(JSON.stringify({ accountId, ...quote,
    ...(input.exactDialogue !== undefined ? { exactDialogue: normalizeAiMediaExactDialogue(input.exactDialogue) } : {}),
  })).digest("hex");
  return { ...quote, quoteId };
}

export function quoteAiMediaRequest(accountId: string, request: AiMediaGenerationRequest) {
  return createAiMediaServerQuote(accountId, {
    ...request,
    inspirationImagesCount: request.inspirationImages.length,
    hasProvidedCharacterVoice: hasProvidedAiMediaCharacterVoice(request.inspirationImages),
  });
}

export function assertAiMediaCreditQuote(request: AiMediaGenerationRequest, quote: ReturnType<typeof createAiMediaServerQuote>) {
  return request.expectedCredits === quote.totalCredits &&
    request.creditTariffVersion === quote.tariffVersion && request.creditQuoteId === quote.quoteId;
}
