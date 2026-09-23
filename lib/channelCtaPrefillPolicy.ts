type PostCtaState = {
  ctaMode?: string | null;
  cta?: string | null;
  ctaUrl?: string | null;
  ctaPhone?: string | null;
};

/** Empty generated/initial posts receive the configured CTA; explicit edits do not. */
export function shouldPrefillConfiguredChannelCta(
  post: PostCtaState | null | undefined,
  manuallyEdited: boolean,
): boolean {
  if (manuallyEdited) return false;
  if (!post) return true;
  if (post.ctaMode && post.ctaMode !== "none") return false;
  return !Boolean(post.cta || post.ctaUrl || post.ctaPhone);
}
