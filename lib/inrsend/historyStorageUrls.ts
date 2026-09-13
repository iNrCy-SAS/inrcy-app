type HistoryStorageReference = {
  bucket: string;
  path: string;
};

export type HistoryStorageUrlOptions = {
  activeUserId: string;
  supabaseUrl: string;
  resolvePrivateUrl: (bucket: string, path: string) => Promise<string | null>;
};

const SIGNED_STORAGE_URL_PATTERN =
  /(?:https?:\/\/[^\s"'<>]+)?\/storage\/v1\/(?:object\/sign|render\/image\/sign)\/[^\s"'<>]+/gi;
const PRIVATE_PATH_PREFIXES = ["users/"] as const;

function cleanStoragePath(value: unknown) {
  const path = String(value || "").trim().replace(/^\/+/, "");
  if (
    !path ||
    path.length > 1_500 ||
    path.includes("\\") ||
    path.includes("\u0000") ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return "";
  }
  return path;
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function configuredSupabaseOrigin(value: string) {
  try {
    return new URL(String(value || "").trim()).origin;
  } catch {
    return "";
  }
}

export function parseHistoricalSupabaseSignedUrl(
  value: unknown,
  supabaseUrl: string,
): HistoryStorageReference | null {
  const raw = String(value || "").trim();
  const expectedOrigin = configuredSupabaseOrigin(supabaseUrl);
  if (!raw || !expectedOrigin) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw, `${expectedOrigin}/`);
  } catch {
    return null;
  }
  if (parsed.origin !== expectedOrigin) return null;

  const markers = [
    "/storage/v1/object/sign/",
    "/storage/v1/render/image/sign/",
  ];
  const marker = markers.find((candidate) => parsed.pathname.includes(candidate));
  if (!marker) return null;

  const encodedIdentity = parsed.pathname.slice(
    parsed.pathname.indexOf(marker) + marker.length,
  );
  const separator = encodedIdentity.indexOf("/");
  if (separator <= 0) return null;

  const bucket = safeDecode(encodedIdentity.slice(0, separator));
  const path = cleanStoragePath(safeDecode(encodedIdentity.slice(separator + 1)));
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(bucket) || !path) return null;
  return { bucket, path };
}

export function buildBoosterPublicHistoryUrl(
  supabaseUrl: string,
  path: string,
) {
  const origin = configuredSupabaseOrigin(supabaseUrl);
  const cleanPath = cleanStoragePath(path);
  if (!origin || !cleanPath) return null;
  const encodedPath = cleanPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${origin}/storage/v1/object/public/booster/${encodedPath}`;
}

export function isPrivateHistoryStoragePathOwned(
  activeUserId: string,
  path: string,
) {
  const userId = String(activeUserId || "").trim();
  const cleanPath = cleanStoragePath(path);
  if (!userId || !cleanPath) return false;
  if (cleanPath === userId || cleanPath.startsWith(`${userId}/`)) return true;
  return PRIVATE_PATH_PREFIXES.some((prefix) =>
    cleanPath.startsWith(`${prefix}${userId}/`),
  );
}

function hasRemovedStorageMarker(value: Record<string, unknown>) {
  const uploadStatus = String(
    value.upload_status || value.uploadStatus || value.storage_status || "",
  )
    .trim()
    .toLowerCase();
  if (uploadStatus === "removed" || uploadStatus === "deleted") return true;
  if (value.removed === true) return true;

  const hasStorageIdentity = Boolean(
    value.storagePath || value.storage_path || value.bucket || value.storage_bucket,
  );
  const status = String(value.status || "").trim().toLowerCase();
  return hasStorageIdentity && (status === "removed" || status === "deleted");
}

function signedStorageUrlsInText(value: string) {
  return Array.from(value.matchAll(SIGNED_STORAGE_URL_PATTERN), (match) => match[0]);
}

/**
 * Replaces only historical Supabase signed URLs. External URLs and stable
 * iNrCy content/download endpoints are left untouched.
 */
export async function sanitizeHistoryStorageValue<T>(
  value: T,
  options: HistoryStorageUrlOptions,
): Promise<T> {
  const resolvedUrls = new Map<string, Promise<string | null>>();

  const resolveSignedUrl = (signedUrl: string, removed: boolean) => {
    if (removed) return Promise.resolve(null);
    const cached = resolvedUrls.get(signedUrl);
    if (cached) return cached;

    const reference = parseHistoricalSupabaseSignedUrl(
      signedUrl,
      options.supabaseUrl,
    );
    const resolution = (async () => {
      if (!reference) return null;
      if (reference.bucket === "booster") {
        return buildBoosterPublicHistoryUrl(options.supabaseUrl, reference.path);
      }
      if (!isPrivateHistoryStoragePathOwned(options.activeUserId, reference.path)) {
        return null;
      }
      const freshUrl = await options.resolvePrivateUrl(
        reference.bucket,
        reference.path,
      );
      const normalized = String(freshUrl || "").trim();
      // A resolver must never hand the persisted token straight back to the client.
      return normalized && normalized !== signedUrl ? normalized : null;
    })();
    resolvedUrls.set(signedUrl, resolution);
    return resolution;
  };

  const visit = async (current: unknown, removed: boolean): Promise<unknown> => {
    if (typeof current === "string") {
      const signedUrls = signedStorageUrlsInText(current);
      if (!signedUrls.length) return current;

      const replacements = await Promise.all(
        signedUrls.map(async (signedUrl) => ({
          signedUrl,
          replacement: await resolveSignedUrl(signedUrl, removed),
        })),
      );
      if (current.trim() === signedUrls[0] && signedUrls.length === 1) {
        return replacements[0].replacement;
      }

      let next = current;
      for (const { signedUrl, replacement } of replacements) {
        next = next.split(signedUrl).join(replacement || "");
      }
      return next;
    }
    if (Array.isArray(current)) {
      return Promise.all(current.map((entry) => visit(entry, removed)));
    }
    if (!current || typeof current !== "object") return current;

    const record = current as Record<string, unknown>;
    const recordRemoved = removed || hasRemovedStorageMarker(record);
    const entries = await Promise.all(
      Object.entries(record).map(async ([key, entry]) => [
        key,
        await visit(entry, recordRemoved),
      ] as const),
    );
    return Object.fromEntries(entries);
  };

  return (await visit(value, false)) as T;
}

export async function sanitizeInrSendHistoryStorageUrls<
  T extends Record<string, unknown>,
>(items: T[], options: HistoryStorageUrlOptions): Promise<T[]> {
  // Sanitize the complete response item, not only `attachments`: the mailbox
  // also re-opens media from `raw.payload`, and HTML/text snapshots may still
  // contain the same persisted signed URL.
  return Promise.all(items.map((item) => sanitizeHistoryStorageValue(item, options)));
}
