/** Existing Meta review identity explicitly approved for full product testing. */
export const FULL_PRODUCT_REVIEWER_ACCOUNT_ID = "dc41bc01-bfb1-43b3-9a1f-060def1f893f";

export function hasFullProductReviewerAccess(role: unknown, accountId: unknown): boolean {
  return role === "reviewer" && accountId === FULL_PRODUCT_REVIEWER_ACCOUNT_ID;
}
