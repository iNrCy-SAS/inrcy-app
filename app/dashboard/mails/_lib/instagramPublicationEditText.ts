import { applyImageInteractionCtaFallback, getPrimaryImageInteractionLink } from "@/lib/boosterImageInteractionCta";
import { getBoosterInstagramCaptionState, type BoosterCtaContext } from "@/lib/boosterCta";
import type { PublicationEditForm } from "./mailboxPhase1";

/** Count the exact caption; never shorten a professional's manual correction. */
export function getInstagramPublicationEditText(
  form: PublicationEditForm,
  images: readonly unknown[],
  context?: BoosterCtaContext,
) {
  const post = applyImageInteractionCtaFallback("instagram", {
    ...form,
    hashtags: form.hashtags.split(/[;,\n\s]+/).map(tag => tag.trim().replace(/^#+/, "")).filter(Boolean),
  }, getPrimaryImageInteractionLink(images));
  return getBoosterInstagramCaptionState(post, context);
}
