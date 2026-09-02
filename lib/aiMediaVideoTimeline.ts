import type { AiMediaVideoDuration } from "@/lib/aiMediaGenerationContracts";

const SEGMENTS: Readonly<Record<AiMediaVideoDuration, readonly (4 | 6 | 8)[]>> =
  Object.freeze({
    8: Object.freeze([8] as const),
    16: Object.freeze([8, 8] as const),
    24: Object.freeze([8, 8, 8] as const),
  });

/**
 * Veo genere nativement des plans de 4, 6 ou 8 secondes. Ces timelines
 * alignent les durees commerciales iNrCy sur le format natif de 8 secondes :
 * aucun plan partiel, aucune seconde generee puis jetee.
 */
export function getAiMediaVideoSegmentDurations(
  durationSeconds: AiMediaVideoDuration,
): readonly (4 | 6 | 8)[] {
  return SEGMENTS[durationSeconds];
}

export function getAiMediaVideoSegmentCount(
  durationSeconds: AiMediaVideoDuration,
) {
  return getAiMediaVideoSegmentDurations(durationSeconds).length;
}
