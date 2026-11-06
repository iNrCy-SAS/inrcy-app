import {
  buildBoosterHashtagLine,
  buildBoosterNativeDestinationMessage,
  type BoosterCtaContext,
  type BoosterPostLike,
} from "./boosterCta.ts";
import { stripSiteTextFormatting } from "./boosterFormatting.ts";
import {
  countPinterestCharacters,
  getPinterestTextIssues,
} from "./pinterestTextLimits.ts";

export * from "./pinterestTextLimits.ts";

/** Build exactly the description submitted to Pinterest, including native CTA
 * copy and deduplicated hashtags. Creation keeps its title in the native title
 * field; the existing published-edit layout also includes it in the body. */
export function buildPinterestPublicationText(
  post: Partial<BoosterPostLike> | null | undefined,
  context?: BoosterCtaContext,
  options: { includeTitle?: boolean } = {},
) {
  const title = stripSiteTextFormatting(post?.title || "Publication iNrCy").replace(/\s+/g, " ").trim();
  const descriptionPost = options.includeTitle === false ? { ...post, title: "" } : post;
  const message = buildBoosterNativeDestinationMessage("pinterest", descriptionPost, context);
  const tagLine = buildBoosterHashtagLine(post, message, 8);
  const description = [message, tagLine].filter(Boolean).join("\n\n");
  return {
    title,
    description,
    titleLength: countPinterestCharacters(title),
    descriptionLength: countPinterestCharacters(description),
    issues: getPinterestTextIssues(title, description),
  };
}

export function getPinterestPublicationTextIssue(
  post: Partial<BoosterPostLike> | null | undefined,
  context?: BoosterCtaContext,
  options: { includeTitle?: boolean } = {},
) {
  return buildPinterestPublicationText(post, context, options).issues[0] ?? null;
}
