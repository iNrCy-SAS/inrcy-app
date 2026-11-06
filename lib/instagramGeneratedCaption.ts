import { getBoosterInstagramCaptionState, type BoosterCtaContext, type BoosterPostLike } from "./boosterCta.ts";
import { limitBoosterGeneratedContent, limitBoosterGeneratedTitle } from "./boosterChannelRules.ts";
import { normalizeBoosterInstagramPostHashtags } from "./boosterPublicationSafety.ts";
import { applyImageInteractionCtaFallback } from "./boosterImageInteractionCta.ts";
import type { ImageOverlayLinkHotspot } from "./imageOverlay.ts";
import { INSTAGRAM_CAPTION_MAX_LENGTH, InstagramCaptionValidationError } from "./instagramCaptionLimits.ts";

/** Only for fresh generation results before review. An image's computed CTA
 * influences the budget without becoming a sticky, manually selected CTA. */
export function fitGeneratedInstagramPost<T extends BoosterPostLike>(post: T, context?: BoosterCtaContext, imageLink?: ImageOverlayLinkHotspot | null): T {
  const normalized = normalizeBoosterInstagramPostHashtags(post, 8);
  let candidate = {
    ...normalized,
    title: limitBoosterGeneratedTitle("instagram", normalized.title),
    content: limitBoosterGeneratedContent("instagram", normalized.content),
  };
  const captionState = (value: typeof candidate) => getBoosterInstagramCaptionState(
    applyImageInteractionCtaFallback("instagram", value, imageLink), context,
  );
  const fixed = captionState({ ...candidate, content: "" });
  if (fixed.issue) throw new InstagramCaptionValidationError(fixed.issue);
  const bodyBudget = Math.max(0, INSTAGRAM_CAPTION_MAX_LENGTH - fixed.length - (fixed.length ? 2 : 0));
  candidate = { ...candidate, content: limitBoosterGeneratedContent("instagram", candidate.content, bodyBudget) };
  if (normalized.content.trim() && !candidate.content.trim()) {
    const unfitted = captionState({ ...candidate, content: normalized.content });
    if (unfitted.issue) throw new InstagramCaptionValidationError(unfitted.issue);
  }
  const complete = captionState(candidate);
  if (complete.issue) throw new InstagramCaptionValidationError(complete.issue);
  return candidate;
}
