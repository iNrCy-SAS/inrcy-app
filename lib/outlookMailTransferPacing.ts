export const OUTLOOK_WINDOW_BYTES = 100_000_000;
const OUTLOOK_WINDOW_SECONDS = 300;

const OUTLOOK_TRANSFER_TIERS: ReadonlyArray<readonly [maxBytes: number, intervalMs: number]> = [
  [3_000_000, 10_000],
  [4_000_000, 12_000],
  [5_000_000, 15_000],
  [6_000_000, 19_000],
  [7_000_000, 22_000],
  [8_000_000, 25_000],
  [9_000_000, 28_000],
  [10_000_000, 30_000],
  [11_000_000, 34_000],
  [12_000_000, 38_000],
  [14_000_000, 43_000],
  [16_500_000, 50_000],
  [20_000_000, 60_000],
  [25_000_000, 75_000],
];

/** Minimum interval between sends, measured against the serialized Graph request body. */
export function getOutlookTransferIntervalMs(payloadBytes: number): number {
  if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 0 || payloadBytes > OUTLOOK_WINDOW_BYTES) {
    throw new RangeError("Outlook payload size must be a whole number from 0 to 100,000,000 bytes.");
  }

  for (const [maxBytes, intervalMs] of OUTLOOK_TRANSFER_TIERS) {
    if (payloadBytes <= maxBytes) return intervalMs;
  }

  // Base64 can push an otherwise valid message above the last size tier.
  const sendsPerWindow = Math.floor(OUTLOOK_WINDOW_BYTES / payloadBytes);
  return Math.ceil(OUTLOOK_WINDOW_SECONDS / sendsPerWindow) * 1_000;
}
