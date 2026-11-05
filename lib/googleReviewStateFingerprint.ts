import { createHash } from "node:crypto";
const row = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** A reply approval is tied to the review text AND the exact previous business reply. */
export function googleReviewStateFingerprint(value: unknown) {
  const review = row(value), reply = row(review.reply);
  return createHash("sha256").update(JSON.stringify([review.name ?? null, review.comment ?? null, review.starRating ?? null, review.updateTime ?? null,
    reply.comment ?? null, reply.updateTime ?? null])).digest("hex");
}
