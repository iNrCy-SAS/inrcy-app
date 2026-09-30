export type AdsPublicationPhase = "idle" | "saving" | "sending" | "success";

// This is an indication of waiting, not progress reported by the ad platform.
// Only the confirmed response may switch the UI to 100%.
export function nextAdsPublicationProgress(current: number, phase: "saving" | "sending"): number {
  const ceiling = phase === "saving" ? 12 : 99;
  const floor = phase === "saving" ? 1 : 12;
  const value = Math.max(floor, Math.min(ceiling, current));
  return Math.min(ceiling, value + Math.max(1, Math.ceil((ceiling - value) / 28)));
}
