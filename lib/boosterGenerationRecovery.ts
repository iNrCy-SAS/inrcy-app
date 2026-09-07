const BOOSTER_GENERATION_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{12,80}$/;

const RECOVERABLE_CHANNELS = new Set([
  "inrcy_site",
  "site_web",
  "inr_search",
  "gmb",
  "facebook",
  "instagram",
  "linkedin",
  "x",
  "tiktok",
  "youtube_shorts",
  "pinterest",
]);

export type BoosterGenerationRecoveryPayload = {
  generationRequestId: string;
  generatedAt: string;
  versions: Record<string, unknown>;
  recoveredChannels: string[];
  aiFallback?: Record<string, unknown>;
  mediaAnalysisFallback?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanStringArray(value: unknown, max = 30): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, max),
    ),
  );
}

export function normalizeBoosterGenerationRequestId(value: unknown): string {
  const normalized = String(value || "").trim().slice(0, 80);
  return BOOSTER_GENERATION_REQUEST_ID_PATTERN.test(normalized)
    ? normalized
    : "";
}

export function readBoosterGenerationRecoveryPayload(
  generatedContent: unknown,
  expectedRequestId: unknown,
): BoosterGenerationRecoveryPayload | null {
  const expectedId = normalizeBoosterGenerationRequestId(expectedRequestId);
  if (!expectedId) return null;

  const content = asRecord(generatedContent);
  const receipt = asRecord(content.boosterGenerationReceipt);
  const receiptId = normalizeBoosterGenerationRequestId(receipt.requestId);
  if (receiptId !== expectedId || receipt.status !== "ready") return null;

  const rawVersions = asRecord(content.postByChannel);
  const versions = Object.fromEntries(
    Object.entries(rawVersions).filter(([channel, post]) => {
      return RECOVERABLE_CHANNELS.has(channel) && Object.keys(asRecord(post)).length > 0;
    }),
  );
  if (!Object.keys(versions).length) return null;

  const generatedAt = String(
    receipt.generatedAt || content.generatedAt || "",
  ).trim();
  const recoveredChannels = cleanStringArray(receipt.recoveredChannels).filter(
    (channel) => RECOVERABLE_CHANNELS.has(channel),
  );
  const aiFallback = asRecord(receipt.aiFallback);
  const mediaAnalysisFallback = asRecord(receipt.mediaAnalysisFallback);

  return {
    generationRequestId: receiptId,
    generatedAt,
    versions,
    recoveredChannels,
    ...(Object.keys(aiFallback).length ? { aiFallback } : {}),
    ...(Object.keys(mediaAnalysisFallback).length
      ? { mediaAnalysisFallback }
      : {}),
  };
}
