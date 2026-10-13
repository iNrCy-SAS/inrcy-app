/** Shared commercial catalogue. Amounts are EUR HT; Stripe calculates tax. */
export const VIDEO_CREDIT_PACKS = Object.freeze([
  Object.freeze({ key: "video_50", seconds: 50, credits: 500, unit: "credit", priceEurHt: 19, priceEnv: "STRIPE_VIDEO_CREDITS_50_PRICE_ID" }),
  Object.freeze({ key: "video_100", seconds: 100, credits: 1000, unit: "credit", priceEurHt: 35, priceEnv: "STRIPE_VIDEO_CREDITS_100_PRICE_ID" }),
  Object.freeze({ key: "video_200", seconds: 200, credits: 2000, unit: "credit", priceEurHt: 65, priceEnv: "STRIPE_VIDEO_CREDITS_200_PRICE_ID" }),
  Object.freeze({ key: "video_500", seconds: 500, credits: 5000, unit: "credit", priceEurHt: 155, priceEnv: "STRIPE_VIDEO_CREDITS_500_PRICE_ID" }),
] as const);

export type VideoCreditPack = (typeof VIDEO_CREDIT_PACKS)[number];

export function findVideoCreditPack(key: unknown): VideoCreditPack | null {
  return VIDEO_CREDIT_PACKS.find((pack) => pack.key === key) ?? null;
}

export function isStripeCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com" && !url.username && !url.password;
  } catch { return false; }
}
