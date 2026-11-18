import { getMetaPlacementVideoIssues } from "@/lib/metaPlacementVideoPolicy";

export function getMetaPreparedVideoFailure(channel: string, placement: unknown, value: unknown) {
  if ((channel !== "facebook" && channel !== "instagram") ||
    (placement !== "reel" && placement !== "story") || !value || typeof value !== "object") return null;
  const video = value as Record<string, unknown>;
  const metadata = video.sourceMetadata && typeof video.sourceMetadata === "object"
    ? video.sourceMetadata as Record<string, unknown> : {};
  const errors = getMetaPlacementVideoIssues({ channel, placement, durationSeconds: video.duration ?? metadata.duration,
    width: metadata.width, height: metadata.height, frameRate: metadata.frameRate ?? metadata.fps,
    sizeBytes: video.size, format: "original" }).filter(issue => issue.severity === "error");
  return errors.length ? { ok: false as const, code: errors[0].code, retryable: false,
    source: "server_preflight", placement, error: errors.map(issue => issue.message).join(" "), blockers: errors } : null;
}
