/**
 * Client metadata is useful for previews only. Pipeline-owned keys must never
 * cross an upload ingress because downstream code treats them as server proof.
 */
export const RESERVED_MEDIA_PIPELINE_METADATA_KEYS = new Set([
  "video_normalization",
  "image_normalization",
  "normalization",
  "variants",
  "canonical",
  "canonical_variant",
  "pipeline_version",
  "pipeline_mission",
  "preparation_scope",
  "compatibility_proof",
  "compatibilityProof",
  "probe_provenance",
  "probeProvenance",
  "processing_status",
  "publication_status",
  "jpeg_recovery_replay",
]);

export function sanitizeClientMediaMetadata(
  value: unknown,
  maxEntries = 80,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const sanitizeValue = (candidate: unknown, depth: number): unknown => {
    if (depth > 6) return null;
    if (Array.isArray(candidate)) {
      return candidate
        .slice(0, maxEntries)
        .map((entry) => sanitizeValue(entry, depth + 1));
    }
    if (!candidate || typeof candidate !== "object") return candidate;
    return Object.fromEntries(
      Object.entries(candidate as Record<string, unknown>)
        .filter(([key]) => !RESERVED_MEDIA_PIPELINE_METADATA_KEYS.has(key))
        .slice(0, maxEntries)
        .map(([key, entry]) => [key, sanitizeValue(entry, depth + 1)]),
    );
  };
  return sanitizeValue(value, 0) as Record<string, unknown>;
}
