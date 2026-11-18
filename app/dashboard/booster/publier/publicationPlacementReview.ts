import { buildMetaPublicationSelection, type MetaPublicationPlacement } from "@/lib/metaPublicationTargets";
import { getMetaPlacementVideoIssues } from "@/lib/metaPlacementVideoPolicy";

export type PublicationPlacementReview = {
  targetKey: string;
  placement: MetaPublicationPlacement;
  label: string;
  blockers: string[];
  blockerCodes: string[];
  warnings: string[];
};

export type PublicationTargetFailure = { code: string; error: string; retryable: false };

export function buildPublicationPlacementReviews(input: {
  channel: string;
  channelLabel: string;
  primaryPlacement: MetaPublicationPlacement;
  includeStory: boolean;
  hasImage: boolean;
  hasVideo: boolean;
  durationSeconds?: number | null;
  source?: { width?: number | null; height?: number | null; frameRate?: number | null } | null;
  sizeBytes?: number;
  format?: string;
  placementLabels?: Record<MetaPublicationPlacement, string>;
}): PublicationPlacementReview[] {
  const { channel } = input;
  if (channel !== "facebook" && channel !== "instagram") return [];
  return buildMetaPublicationSelection(input.primaryPlacement, input.includeStory).placements.map((placement) => {
    const label = `${input.channelLabel} · ${input.placementLabels?.[placement] || (placement === "story" ? "Story" : placement === "reel" ? "Reel" : "Publication classique")}`;
    const issues = input.hasVideo ? getMetaPlacementVideoIssues({
      channel, placement, durationSeconds: input.durationSeconds,
      width: input.source?.width, height: input.source?.height, frameRate: input.source?.frameRate,
      sizeBytes: input.sizeBytes, format: input.format,
    }) : [];
    const mediaRequired = placement !== "classic" && !input.hasImage && !input.hasVideo;
    return {
      targetKey: `${channel}:${placement}`, placement, label,
      blockers: [...(mediaRequired ? [`${label} nécessite une image ou une vidéo.`] : []), ...issues.filter((issue) => issue.severity === "error").map((issue) => issue.message)],
      blockerCodes: [...(mediaRequired ? ["meta_placement_media_required"] : []), ...issues.filter((issue) => issue.severity === "error").map((issue) => issue.code)],
      warnings: issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message),
    };
  });
}

export function getPublicationTargetFailures(reviews: readonly PublicationPlacementReview[]): Record<string, PublicationTargetFailure> {
  return Object.fromEntries(reviews.filter((review) => review.blockers.length).map((review) => [review.targetKey, {
    code: review.blockerCodes[0] || "prepublish_validation_failed",
    error: review.blockers.join(" · ").slice(0, 600), retryable: false as const,
  }]));
}
