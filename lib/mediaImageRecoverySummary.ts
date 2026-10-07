/** Public, non-sensitive recovery information from server-owned media metadata. */
export function getMediaImageRecoverySummary(metadata: unknown): {
  requiresCanonical?: true;
  imageRecovery?: { kind: "truncated_jpeg"; version: 1; requiresReview: true };
} {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
  const source = record(record(record(metadata).image_normalization).source);
  if (source.probeProvenance !== "server_sharp") return {};
  const recovery = record(source.recovery);
  if (recovery.kind === "truncated_jpeg" && recovery.version === 1) {
    return {
      requiresCanonical: true,
      imageRecovery: { kind: "truncated_jpeg", version: 1, requiresReview: true },
    };
  }
  return source.requiresCanonical === true ? { requiresCanonical: true } : {};
}
