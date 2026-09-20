export type InrSendVideoAttachmentIdentity = {
  bucket?: string | null;
  storagePath?: string | null;
  publicUrl?: string | null;
  url?: string | null;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function comparableHttpUrl(value: unknown) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "";
  }
}

/**
 * Reconciles an editable client payload with the canonical video identity
 * already stored for the publication.
 *
 * Older clients kept the Storage path but omitted its bucket. When the path
 * (or the URL without its expiring signature) still identifies the exact same
 * video, the server restores only the trusted bucket/path pair. A genuinely
 * different incoming video keeps its own identity and must pass the normal
 * registry ownership check.
 */
export function reconcileInrSendVideoAttachment<
  T extends InrSendVideoAttachmentIdentity,
>(incoming: T | null, persisted: T | null): T | null {
  if (!incoming) return persisted;
  if (!persisted) return incoming;

  const persistedBucket = clean(persisted.bucket);
  const persistedPath = clean(persisted.storagePath);
  if (!persistedBucket || !persistedPath) return incoming;

  const incomingPath = clean(incoming.storagePath);
  const incomingUrl = comparableHttpUrl(incoming.publicUrl || incoming.url);
  const persistedUrl = comparableHttpUrl(persisted.publicUrl || persisted.url);
  const sameStoredObject =
    (incomingPath && incomingPath === persistedPath) ||
    (!incomingPath && incomingUrl && incomingUrl === persistedUrl);

  if (!sameStoredObject) return incoming;

  return {
    ...persisted,
    ...incoming,
    bucket: persistedBucket,
    storagePath: persistedPath,
  };
}
