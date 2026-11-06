import { applyImageInteractionCtaFallback, getPrimaryImageInteractionLink } from "@/lib/boosterImageInteractionCta";
import { buildPinterestPublicationText } from "@/lib/pinterestTextRules";
import type { BoosterCtaContext } from "@/lib/boosterCta";
import type { PublicationEditForm } from "./mailboxPhase1";

/** The native edit request groups retained images before newly rendered ones.
 * Feed that same order here so a Studio image's fallback CTA is counted too. */
export function getPinterestPublicationEditText(
  form: PublicationEditForm,
  images: readonly unknown[],
  context?: BoosterCtaContext,
) {
  const post = applyImageInteractionCtaFallback("pinterest", {
    ...form,
    hashtags: form.hashtags.split(/[;,\n\s]+/).map(tag => tag.trim().replace(/^#+/, "")).filter(Boolean),
  }, getPrimaryImageInteractionLink(images));
  return buildPinterestPublicationText(post, context);
}

export function orderPinterestPublicationEditImages<T>(images: readonly T[], isRetained: (image: T) => boolean): T[] {
  const retained: T[] = [], added: T[] = [];
  for (const image of images) (isRetained(image) ? retained : added).push(image);
  return [...retained, ...added];
}
