type JsonRecord = Record<string, unknown>;

export type InrAgentScheduledPayloadCompactionOptions = {
  storageUrl?: (bucket: string, storagePath: string) => string | null;
};

type DurableMediaReference = {
  bucket: string;
  storagePath: string;
  url: string;
};

const INLINE_MEDIA_URL = /^data:(?:image|video)\/[a-z0-9.+-]+;base64,/i;
const INLINE_MEDIA_KEYS = new Set([
  "dataUrl",
  "data_url",
  "url",
  "publicUrl",
  "renderedUrl",
  "src",
  "downloadUrl",
  "originalUrl",
  "originalPublicUrl",
]);

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) return text;
  }
  return "";
}

function isInlineMediaUrl(value: unknown): value is string {
  return typeof value === "string" && INLINE_MEDIA_URL.test(value.trim());
}

function durableReferenceFromNode(source: JsonRecord): DurableMediaReference {
  const imageMeta = asRecord(source.imageMeta);
  const sourceMetadata = asRecord(source.sourceMetadata);
  return {
    storagePath: firstText(
      source.storagePath,
      source.storage_path,
      source.path,
      source.originalStoragePath,
      imageMeta?.storagePath,
      imageMeta?.storage_path,
      imageMeta?.path,
      sourceMetadata?.storagePath,
      sourceMetadata?.storage_path,
      sourceMetadata?.path,
    ),
    bucket: firstText(
      source.bucket,
      source.bucketName,
      source.bucket_name,
      imageMeta?.bucket,
      imageMeta?.bucketName,
      imageMeta?.bucket_name,
      sourceMetadata?.bucket,
      sourceMetadata?.bucketName,
      sourceMetadata?.bucket_name,
    ),
    url: firstText(
      ...[
        source.url,
        source.publicUrl,
        source.renderedUrl,
        source.src,
        source.downloadUrl,
        source.originalUrl,
        source.originalPublicUrl,
      ].filter((candidate) => !isInlineMediaUrl(candidate)),
    ),
  };
}

function collectDurableMediaReferences(
  value: unknown,
  references: Map<string, DurableMediaReference>,
) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectDurableMediaReferences(item, references));
    return;
  }
  const source = asRecord(value);
  if (!source) return;

  const imageKey = firstText(source.imageKey);
  const reference = durableReferenceFromNode(source);
  if (
    imageKey &&
    ((reference.bucket && reference.storagePath) || reference.url)
  ) {
    references.set(imageKey, reference);
  }
  Object.values(source).forEach((item) =>
    collectDurableMediaReferences(item, references),
  );
}

function compactNode(
  value: unknown,
  options: InrAgentScheduledPayloadCompactionOptions,
  references: Map<string, DurableMediaReference>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => compactNode(item, options, references));
  }

  const source = asRecord(value);
  if (!source) return value;

  const compacted = Object.fromEntries(
    Object.entries(source).map(([key, item]) => [
      key,
      compactNode(item, options, references),
    ]),
  ) as JsonRecord;
  const localReference = durableReferenceFromNode(compacted);
  const matchingReference = references.get(firstText(compacted.imageKey));
  const storagePath = firstText(
    localReference.storagePath,
    matchingReference?.storagePath,
  );
  const bucket = firstText(localReference.bucket, matchingReference?.bucket);
  const durableUrl = firstText(localReference.url, matchingReference?.url);
  const hasInlineMedia = Object.entries(compacted).some(
    ([key, item]) => INLINE_MEDIA_KEYS.has(key) && isInlineMediaUrl(item),
  );
  const canUseStorageReference = Boolean(bucket && storagePath);

  // Older iNrAgent schedules embedded every rendered image as a data URL.
  // The original Storage identity was nevertheless kept in imageMeta. Promote
  // that durable identity and remove only the redundant inline bytes.
  if (hasInlineMedia && (canUseStorageReference || durableUrl)) {
    for (const key of INLINE_MEDIA_KEYS) {
      if (isInlineMediaUrl(compacted[key])) delete compacted[key];
    }

    if (canUseStorageReference) {
      compacted.bucket = bucket;
      compacted.bucketName = bucket;
      compacted.storagePath = storagePath;
      compacted.path = storagePath;
      compacted.originalStoragePath = firstText(
        compacted.originalStoragePath,
        storagePath,
      );
      const resolvedUrl = options.storageUrl?.(bucket, storagePath) || "";
      const effectiveUrl = resolvedUrl || durableUrl;
      if (effectiveUrl) {
        compacted.url = effectiveUrl;
        compacted.publicUrl = effectiveUrl;
      }
    } else if (durableUrl) {
      compacted.url = durableUrl;
      compacted.publicUrl = durableUrl;
    }
  }

  return compacted;
}

/**
 * Removes redundant inline image/video bytes from an iNrAgent schedule while
 * retaining (and, when needed, promoting) its durable Storage reference.
 */
export function compactInrAgentScheduledPayload<T>(
  payload: T,
  options: InrAgentScheduledPayloadCompactionOptions = {},
): T {
  const references = new Map<string, DurableMediaReference>();
  collectDurableMediaReferences(payload, references);
  return compactNode(payload, options, references) as T;
}

export function containsInlineInrAgentScheduledMedia(
  payload: unknown,
): boolean {
  if (Array.isArray(payload)) {
    return payload.some((item) => containsInlineInrAgentScheduledMedia(item));
  }
  const record = asRecord(payload);
  if (!record) return isInlineMediaUrl(payload);
  return Object.values(record).some((item) =>
    containsInlineInrAgentScheduledMedia(item),
  );
}
