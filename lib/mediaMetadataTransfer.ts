export type TransferableMediaMetadata = {
  width?: unknown;
  height?: unknown;
  duration?: unknown;
  durationSeconds?: unknown;
  duration_seconds?: unknown;
  media_metadata?: unknown;
};

export type NormalizedMediaMetadata = {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstPositiveNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/**
 * Normalise les métadonnées qui traversent la Médiathèque, le workspace
 * persistant et Booster. Les colonnes SQL restent prioritaires ; les preuves
 * FFmpeg persistées servent de repli pour les anciennes lignes incomplètes.
 */
export function normalizeTransferredMediaMetadata(
  value: TransferableMediaMetadata | null | undefined,
): NormalizedMediaMetadata {
  const input = asRecord(value);
  const mediaMetadata = asRecord(input.media_metadata);
  const normalization = asRecord(mediaMetadata.video_normalization);
  const source = asRecord(normalization.source);
  const optimization = asRecord(mediaMetadata.library_optimization);

  return {
    width: firstPositiveNumber(
      input.width,
      source.orientedWidth,
      source.oriented_width,
      source.width,
      optimization.outputWidth,
      optimization.output_width,
    ),
    height: firstPositiveNumber(
      input.height,
      source.orientedHeight,
      source.oriented_height,
      source.height,
      optimization.outputHeight,
      optimization.output_height,
    ),
    durationSeconds: firstPositiveNumber(
      input.durationSeconds,
      input.duration_seconds,
      input.duration,
      source.durationSeconds,
      source.duration_seconds,
      source.duration,
      optimization.outputDurationSeconds,
      optimization.output_duration_seconds,
    ),
  };
}

export function mergeTransferredMediaMetadata(
  preferred: TransferableMediaMetadata | null | undefined,
  fallback: TransferableMediaMetadata | null | undefined,
): NormalizedMediaMetadata {
  const primary = normalizeTransferredMediaMetadata(preferred);
  const secondary = normalizeTransferredMediaMetadata(fallback);
  return {
    width: primary.width ?? secondary.width,
    height: primary.height ?? secondary.height,
    durationSeconds: primary.durationSeconds ?? secondary.durationSeconds,
  };
}

export function hasCompleteVideoMetadata(
  value: TransferableMediaMetadata | null | undefined,
) {
  const normalized = normalizeTransferredMediaMetadata(value);
  return Boolean(
    normalized.width && normalized.height && normalized.durationSeconds,
  );
}
