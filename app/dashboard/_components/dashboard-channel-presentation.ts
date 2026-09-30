import type { DashboardFluxBubbleData } from "./DashboardFluxBubble";

export type ChannelTone = "connected" | "available" | "warning" | "disabled";

/** Keep the existing channel warning rules even when its base connection is still valid. */
export function getChannelTone(item: DashboardFluxBubbleData): ChannelTone {
  if (item.bubbleStatus === "reconnect") return "warning";
  if (item.bubbleStatus === "coming") return "disabled";

  const status = item.bubbleStatusText.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const warningWords = ["reconnect", "reconnexion", "reconectar", "ricolleg", "neu verbinden", "opnieuw", "religar", "actual", "update", "aktual", "bijwerk", "expire", "token", "attention"];
  if (warningWords.some((word) => status.includes(word))) return "warning";
  return item.bubbleStatus === "connected" ? "connected" : "available";
}

export const CHANNEL_BUBBLE_REST_GAP = 44;
export const CHANNEL_BUBBLE_EDGE = 24;

// Deliberately asymmetric anchors: no shared rows, columns or mirrored pairs.
// Local relaxation below changes only crowded regions, keeping this art direction.
const CONSTELLATION_ANCHORS = [
  [0.105, 0.20, 1.07], [0.30, 0.14, 0.91],
  [0.245, 0.465, 1.01], [0.075, 0.63, 0.90],
  [0.185, 0.90, 0.96], [0.335, 0.755, 1.04],
  [0.72, 0.22, 0.94], [0.90, 0.14, 1.08],
  [0.80, 0.50, 1.02], [0.94, 0.64, 0.88],
  [0.87, 0.89, 0.97], [0.68, 0.69, 0.92],
] as const;

type ChannelSceneSlot = { x: number; y: number; size: number };

/**
 * Twelve individually sized satellites around a protected central sphere.
 * A 44px resting gap leaves >=24px even with +/-6px x, +/-8px y motion.
 * The 24px edge inset leaves >=16px at the extreme vertical phase.
 */
export function getChannelSceneLayout(width: number, height: number) {
  const centerSize = Math.min(380, width * 0.275, height - 96);
  const centerY = height / 2;
  const arrowSize = 44;
  const arrowGap = 20;
  const arrowOffset = centerSize / 2 + arrowGap + arrowSize / 2;
  const baseSize = Math.min(164, width * 0.104, height * 0.244);
  // Mobile has its own in-flow grid; do not run desktop packing for that viewport.
  if (width < 940 || height < 420) {
    return { centerSize, centerY, arrowOffset, arrowSize, arrowGap, satelliteSize: baseSize, slots: CONSTELLATION_ANCHORS.map(([x, y, scale]) => ({ x: x * width, y: y * height, size: baseSize * scale })) };
  }

  const centerX = width / 2;
  // The controls sit outside the floating centre, so they remain fixed obstacles.
  const fixedCircles = [
    { x: centerX, y: centerY, size: centerSize, gap: CHANNEL_BUBBLE_REST_GAP },
    { x: centerX - arrowOffset, y: centerY, size: arrowSize, gap: 34.1 },
    { x: centerX + arrowOffset, y: centerY, size: arrowSize, gap: 34.1 },
  ];
  const fitWithinBounds = (slot: ChannelSceneSlot) => {
    const inset = CHANNEL_BUBBLE_EDGE + slot.size / 2;
    slot.x = Math.max(inset, Math.min(width - inset, slot.x));
    slot.y = Math.max(inset, Math.min(height - inset, slot.y));
  };
  let slots: ChannelSceneSlot[] = [];

  // Only 12 circles, with a fixed small bound. Most desktop sizes accept attempt 0.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    slots = CONSTELLATION_ANCHORS.map(([x, y, scale]) => ({
      x: x * width,
      y: y * height,
      size: Math.max(90, baseSize * scale * (1 - attempt * 0.035)),
    }));
    slots.forEach(fitWithinBounds);

    for (let step = 0; step < 160; step += 1) {
      let largestCorrection = 0;
      for (let index = 0; index < slots.length; index += 1) {
        const slot = slots[index];
        for (const obstacle of fixedCircles) {
          const dx = slot.x - obstacle.x;
          const dy = slot.y - obstacle.y;
          const distance = Math.hypot(dx, dy);
          const required = (obstacle.size + slot.size) / 2 + obstacle.gap;
          if (distance < required) {
            const correction = required - distance;
            slot.x += dx / distance * correction;
            slot.y += dy / distance * correction;
            largestCorrection = Math.max(largestCorrection, correction);
          }
        }
        for (let otherIndex = index + 1; otherIndex < slots.length; otherIndex += 1) {
          const other = slots[otherIndex];
          const pairDx = other.x - slot.x;
          const pairDy = other.y - slot.y;
          const pairDistance = Math.hypot(pairDx, pairDy);
          const pairRequired = (slot.size + other.size) / 2 + CHANNEL_BUBBLE_REST_GAP;
          if (pairDistance < pairRequired) {
            const correction = (pairRequired - pairDistance) / 2;
            const moveX = pairDx / pairDistance * correction;
            const moveY = pairDy / pairDistance * correction;
            slot.x -= moveX;
            slot.y -= moveY;
            other.x += moveX;
            other.y += moveY;
            largestCorrection = Math.max(largestCorrection, correction * 2);
          }
        }
        fitWithinBounds(slot);
      }
      if (largestCorrection < 0.005) break;
    }

    const fits = slots.every((slot, index) => {
      if (fixedCircles.some((obstacle) => Math.hypot(slot.x - obstacle.x, slot.y - obstacle.y) < (slot.size + obstacle.size) / 2 + obstacle.gap - 0.02)) return false;
      return slots.slice(index + 1).every((other) => Math.hypot(slot.x - other.x, slot.y - other.y) >= (slot.size + other.size) / 2 + CHANNEL_BUBBLE_REST_GAP - 0.02);
    });
    if (fits) break;
  }

  return { centerSize, centerY, arrowOffset, arrowSize, arrowGap, satelliteSize: Math.max(...slots.map((slot) => slot.size)), slots };
}
