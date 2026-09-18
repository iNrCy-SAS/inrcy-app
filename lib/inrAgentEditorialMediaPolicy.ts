export const INR_AGENT_EDITORIAL_VIDEO_RATIO = 0.1;
export const INR_AGENT_EDITORIAL_MIN_SLOTS_FOR_VIDEO = 8;

/**
 * Videos stay exceptional in an automatically generated editorial calendar.
 * A short plan contains images only; longer plans target roughly one video for
 * ten publications. YouTube-only plans are handled separately by the planner.
 */
export function inrAgentEditorialVideoCount(totalSlotsRaw: number): number {
  const totalSlots = Math.max(0, Math.floor(Number(totalSlotsRaw) || 0));
  if (totalSlots < INR_AGENT_EDITORIAL_MIN_SLOTS_FOR_VIDEO) return 0;
  return Math.max(1, Math.round(totalSlots * INR_AGENT_EDITORIAL_VIDEO_RATIO));
}
