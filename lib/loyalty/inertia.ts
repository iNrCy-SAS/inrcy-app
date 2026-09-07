export type InertiaChannels = {
  site_inrcy: boolean;
  site_web: boolean;
  gmb: boolean;
  facebook: boolean;
  instagram: boolean;
  linkedin: boolean;
  x: boolean;
  tiktok: boolean;
  youtube_shorts: boolean;
};

export type InertiaSnapshot = {
  /** total connected channels (0..9) */
  connectedCount: number;
  /** total available channels (always 9 for now) */
  totalChannels: number;
  /** additive bonus sum (connected channels only) */
  bonus: number;
  /** final multiplier (base 1 + bonus, internally capped) */
  multiplier: number;
  /** max multiplier cap used for this snapshot */
  maxMultiplier: number;
  /** per-channel bonuses (for UI display) */
  breakdown: Array<{ key: keyof InertiaChannels; label: string; bonus: number; connected: boolean }>;
};

const TOTAL_CHANNELS = 9;

/**
 * Barème — 2026-03
 * Modèle additif : base 1 + bonusCanaux
 * (Le plafond est géré en interne, pas nécessaire de l’afficher)
 */
const BONUS: Record<keyof InertiaChannels, number> = {
  facebook: 0.5,
  instagram: 0.5,
  linkedin: 0.5,
  x: 0.5,
  tiktok: 0.5,
  youtube_shorts: 0.5,
  gmb: 1,
  site_web: 1,
  site_inrcy: 2.5,
};

const LABELS: Record<keyof InertiaChannels, string> = {
  site_inrcy: "Site iNrCy",
  site_web: "Site web",
  gmb: "Google Business",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
  tiktok: "TikTok",
  youtube_shorts: "YouTube",
};

export function computeInertiaSnapshot(
  channels: InertiaChannels,
  opts?: { maxMultiplier?: number }
): InertiaSnapshot {
  const maxMultiplier = opts?.maxMultiplier ?? 7;

  const breakdown = (Object.keys(BONUS) as Array<keyof InertiaChannels>).map((key) => ({
    key,
    label: LABELS[key],
    bonus: BONUS[key],
    connected: Boolean(channels[key]),
  }));

  const connectedCount = breakdown.filter((b) => b.connected).length;

  const bonus = breakdown.reduce((acc, b) => (b.connected ? acc + b.bonus : acc), 0);

  const raw = 1 + bonus;
  const multiplier = Math.min(raw, maxMultiplier);

  return {
    connectedCount,
    totalChannels: TOTAL_CHANNELS,
    bonus,
    multiplier,
    maxMultiplier,
    breakdown,
  };
}
