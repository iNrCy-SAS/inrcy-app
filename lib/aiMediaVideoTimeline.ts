import type { AiMediaVideoDuration } from "@/lib/aiMediaGenerationContracts";

const SEGMENTS: Readonly<Record<AiMediaVideoDuration, readonly (4 | 6 | 8)[]>> =
  Object.freeze({
    10: Object.freeze([6, 4] as const),
    20: Object.freeze([8, 8, 4] as const),
    30: Object.freeze([8, 8, 8, 6] as const),
  });

/**
 * Veo genere nativement des plans de 4, 6 ou 8 secondes. Ces timelines
 * produisent exactement les durees commerciales iNrCy sans generer puis jeter
 * des secondes facturables.
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
