export type InrSearchFeedPublication = {
  id: string;
  title: string;
  content: string;
  imageUrl: string | null;
  videoUrl: string | null;
  videoMime: string;
  videoThumbnailUrl: string | null;
  createdAt: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function hasSuccessfulInrSearchChannel(payloadValue: unknown) {
  const payload = asRecord(payloadValue);
  const result = asRecord(asRecord(payload.results).inr_search);
  const status = cleanStatus(result.status);

  if (Object.keys(result).length) {
    if (
      result.deleted === true ||
      result.ok === false ||
      status === "deleted" ||
      status === "failed" ||
      status === "error" ||
      status === "cancelled" ||
      status === "canceled"
    ) {
      return false;
    }

    if (
      result.ok === true ||
      status === "delivered" ||
      status === "published" ||
      status === "completed"
    ) {
      return true;
    }
  }

  // Both synchronous and asynchronous Booster finalizers persist `channels`
  // as the successful channel list. It is a safe compatibility fallback for
  // older events whose detailed result object was not retained.
  return Array.isArray(payload.channels)
    && payload.channels.some((channel) => cleanStatus(channel) === "inr_search");
}

function publicationTimestamp(value: string | null) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function mergeInrSearchPublicationFeeds<T extends InrSearchFeedPublication>(
  primary: T[],
  durableFallback: T[],
  limit = 10,
) {
  const byId = new Map<string, T>();

  for (const publication of durableFallback) {
    if (!publication?.id || byId.has(publication.id)) continue;
    byId.set(publication.id, publication);
  }

  for (const publication of primary) {
    if (!publication?.id) continue;
    const fallback = byId.get(publication.id);
    byId.set(publication.id, {
      ...(fallback || publication),
      ...publication,
      imageUrl: publication.imageUrl || fallback?.imageUrl || null,
      videoUrl: publication.videoUrl || fallback?.videoUrl || null,
      videoMime: publication.videoMime || fallback?.videoMime || "video/mp4",
      videoThumbnailUrl:
        publication.videoThumbnailUrl || fallback?.videoThumbnailUrl || null,
      createdAt: publication.createdAt || fallback?.createdAt || null,
    });
  }

  const safeLimit = Math.max(0, Math.min(100, Math.trunc(limit)));
  return Array.from(byId.values())
    .sort(
      (left, right) =>
        publicationTimestamp(right.createdAt) - publicationTimestamp(left.createdAt),
    )
    .slice(0, safeLimit);
}
