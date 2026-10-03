import {
  buildBoosterHashtagLine,
  buildBoosterInstagramCaption,
  buildBoosterMessage,
  buildCtaTextForNativeDestination,
  sanitizeBoosterPostForStructuredCta,
  type BoosterCtaContext,
  type BoosterPostLike,
} from "@/lib/boosterCta";
import { stripSiteTextFormattingPreserveLayout } from "@/lib/boosterFormatting";
import { normalizeBoosterInstagramPostHashtags } from "@/lib/boosterPublicationSafety";
import { getXPostTextMetrics, X_POST_WEIGHTED_LENGTH_MAX } from "@/lib/xChannel";

export type BoosterPreviewChannel =
  | "instagram"
  | "x"
  | "tiktok"
  | "youtube_shorts"
  | "pinterest";

export type BoosterPublicationTextPreview = {
  text: string;
  count: number;
  max: number;
  hashtagsOmitted: boolean;
};

function withOptionalHashtags(
  base: string,
  post: Partial<BoosterPostLike> | null | undefined,
  max: number,
  maxTags = 8,
): BoosterPublicationTextPreview {
  const tagLine = buildBoosterHashtagLine(post, base, maxTags);
  const withTags = [base, tagLine].filter(Boolean).join("\n\n");
  const hashtagsOmitted = Boolean(tagLine) && withTags.length > max;
  const text = hashtagsOmitted ? base : withTags;
  return { text, count: text.length, max, hashtagsOmitted };
}

function normalizeYoutubeHashtag(input: string): string {
  return String(input || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .slice(0, 40);
}

/**
 * Mirror the channel-specific text sent by Booster without publishing anything.
 * A red count means the required text itself exceeds the channel limit; optional
 * hashtags that the publisher omits are excluded from the displayed total.
 */
export function getBoosterPublicationTextPreview(
  channel: BoosterPreviewChannel,
  post: Partial<BoosterPostLike> | null | undefined,
  context?: BoosterCtaContext,
  options?: { youtubeAutoHashtags?: boolean },
): BoosterPublicationTextPreview {
  if (channel === "pinterest") {
    const sanitizedPost = sanitizeBoosterPostForStructuredCta(post, context);
    const content = stripSiteTextFormattingPreserveLayout(
      sanitizedPost.content || "",
    );
    const cta = buildCtaTextForNativeDestination(
      "pinterest",
      sanitizedPost,
      context,
    );
    const required = [content, cta].filter(Boolean).join("\n\n");
    return withOptionalHashtags(required, sanitizedPost, 500);
  }

  if (channel === "tiktok") {
    return withOptionalHashtags(
      buildBoosterMessage("tiktok", post, context),
      post,
      2200,
    );
  }

  if (channel === "youtube_shorts") {
    const base = buildBoosterMessage("youtube_shorts", post, context);
    const normalizedTags = (Array.isArray(post?.hashtags) ? post.hashtags : [])
      .map((tag) => normalizeYoutubeHashtag(String(tag)))
      .filter(Boolean)
      .slice(0, 8);
    const youtubeTags = options?.youtubeAutoHashtags === false
      ? normalizedTags
      : Array.from(new Set(["iNrCy", ...normalizedTags]));
    const tagLine = buildBoosterHashtagLine(
      { ...(post || {}), hashtags: youtubeTags },
      base,
      8,
    );
    // Mirror the upload adapter, which trims and keeps at most 4,800
    // characters rather than rejecting a longer description.
    const text = [base, tagLine].filter(Boolean).join("\n\n").trim().slice(0, 4800);
    return { text, count: text.length, max: 4800, hashtagsOmitted: false };
  }

  if (channel === "instagram") {
    const normalizedPost = normalizeBoosterInstagramPostHashtags(post || {}, 8);
    const base = buildBoosterMessage("instagram", normalizedPost, context);
    if (base.length > 2200) {
      // The publisher rejects this required text. Avoid throwing while the
      // editor renders the counter so the user can shorten it.
      return { text: base, count: base.length, max: 2200, hashtagsOmitted: false };
    }
    const text = buildBoosterInstagramCaption(normalizedPost, context);
    const tagLine = buildBoosterHashtagLine(normalizedPost, base, 8);
    const hashtagsOmitted = Boolean(tagLine) && `${base}\n\n${tagLine}`.length > 2200;
    return { text, count: text.length, max: 2200, hashtagsOmitted };
  }

  // The X publisher sends buildBoosterMessage; it does not append the
  // separately edited hashtags to the API text.
  const text = buildBoosterMessage("x", post, context);
  return {
    text,
    count: getXPostTextMetrics(text).weightedLength,
    max: X_POST_WEIGHTED_LENGTH_MAX,
    hashtagsOmitted: false,
  };
}
