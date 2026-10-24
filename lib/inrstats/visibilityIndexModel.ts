/** Versioned product score. Provider measurements are never modified. */
export const VISIBILITY_INDEX_MODEL = Object.freeze({
  version: "v1", monthlySeniorityBonus: 0.01,
  connected: 12, audience: 8, posts: 10, visibility: 6, contacts: 12, potential: 6,
});
export const VISIBILITY_INDEX_CHANNELS = ["inrbadge", "inr_search", "site_web", "gmb", "facebook", "instagram", "threads", "linkedin", "x", "mails", "tiktok", "youtube_shorts", "pinterest"] as const;
export type VisibilityIndexChannelKey = typeof VISIBILITY_INDEX_CHANNELS[number];
export type VisibilityIndexChannel = {
  key: VisibilityIndexChannelKey; connected: boolean; ready: boolean;
  audience: number | null; posts: number | null; visibility: number | null;
  contacts: number | null; potential: number | null;
};
export type VisibilityIndexInputs = { connected: number; audience: number | null; posts: number | null; visibility: number | null; contacts: number | null; potential: number | null };
export function visibilityIndexBasis(channels: readonly VisibilityIndexChannel[]) {
  const active = channels.filter(channel => channel.connected && channel.ready);
  const sum = (key: Exclude<keyof VisibilityIndexInputs, "connected">) => {
    const known = active.flatMap(channel => typeof channel[key] === "number" && Number.isFinite(channel[key]) && channel[key]! >= 0 ? [channel[key]!] : []);
    return known.length ? known.reduce((a, b) => a + b, 0) : null;
  };
  const inputs: VisibilityIndexInputs = { connected: active.length, audience: sum("audience"), posts: sum("posts"), visibility: sum("visibility"), contacts: sum("contacts"), potential: sum("potential") };
  const model = VISIBILITY_INDEX_MODEL;
  const contributions = {
    connected: inputs.connected * model.connected,
    audience: Math.log1p(inputs.audience ?? 0) * model.audience,
    posts: Math.log1p(inputs.posts ?? 0) * model.posts,
    visibility: Math.log1p((inputs.visibility ?? 0) / 100) * model.visibility,
    contacts: Math.log1p(inputs.contacts ?? 0) * model.contacts,
    potential: Math.log1p(inputs.potential ?? 0) * model.potential,
  };
  return { inputs, contributions, base: Object.values(contributions).reduce((a, b) => a + b, 0) };
}
export function visibilityIndexCoefficient(createdAt: string, at: Date): number | null {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created) || !Number.isFinite(at.getTime()) || at.getTime() < created) return null;
  const months = (at.getTime() - created) / (86_400_000 * 365.2425 / 12);
  return 1 + months * VISIBILITY_INDEX_MODEL.monthlySeniorityBonus;
}
export function visibilityMetric(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string" || typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
