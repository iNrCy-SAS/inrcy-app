/** Images and amounts are fixed server-side. EUR HT; Stripe calculates tax. */
export const IMAGE_CREDIT_PACKS = Object.freeze([
  Object.freeze({ key: "image_20", images: 20, priceEurHt: 5, priceEnv: "STRIPE_IMAGE_CREDITS_20_PRICE_ID" }),
  Object.freeze({ key: "image_50", images: 50, priceEurHt: 10, priceEnv: "STRIPE_IMAGE_CREDITS_50_PRICE_ID" }),
  Object.freeze({ key: "image_100", images: 100, priceEurHt: 19, priceEnv: "STRIPE_IMAGE_CREDITS_100_PRICE_ID" }),
] as const);

export type ImageCreditPack = (typeof IMAGE_CREDIT_PACKS)[number];
export function findImageCreditPack(key: unknown): ImageCreditPack | null {
  return IMAGE_CREDIT_PACKS.find((pack) => pack.key === key) ?? null;
}
