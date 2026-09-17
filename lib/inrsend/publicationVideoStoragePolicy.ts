export type InrSendVideoRegistryIdentity = {
  user_id?: unknown;
  bucket_name?: unknown;
  storage_path?: unknown;
  media_type?: unknown;
  upload_status?: unknown;
};

export type InrSendVideoStorageAuthorization = {
  bucket: string;
  storagePath: string;
  urlMode: "public" | "signed";
  registryAuthorized: boolean;
};

export type InrSendVideoStorageDependencies = {
  loadRegistryRow: (params: {
    accountId: string;
    bucket: string;
    storagePath: string;
  }) => Promise<InrSendVideoRegistryIdentity | null>;
  authorizeSource: (params: {
    accountId: string;
    bucket: string;
    storagePath: string;
    registryRow: InrSendVideoRegistryIdentity | null;
  }) => InrSendVideoStorageAuthorization;
  signAuthorizedUrl: (
    bucket: string,
    storagePath: string,
  ) => Promise<string | null>;
  getPublicUrl: (bucket: string, storagePath: string) => string | null;
};

export type ResolvedInrSendVideoDelivery = {
  url: string;
  bucket: string | null;
  storagePath: string | null;
  refreshed: boolean;
};

const LEGACY_BOOSTER_BUCKET = "booster";

function normalizeBucket(value: unknown) {
  const bucket = String(value || "").trim();
  return /^[a-zA-Z0-9._-]{1,100}$/.test(bucket) ? bucket : "";
}

function normalizeStoragePath(value: unknown) {
  const storagePath = String(value || "")
    .trim()
    .replace(/^\/+/, "");
  if (
    !storagePath ||
    storagePath.length > 1_500 ||
    storagePath.includes("\\") ||
    storagePath.includes("\u0000") ||
    storagePath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return "";
  }
  return storagePath;
}

function normalizeHttpUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? raw
      : "";
  } catch {
    return "";
  }
}

function inferStorageBucketFromUrl(value: unknown) {
  const currentUrl = normalizeHttpUrl(value);
  if (!currentUrl) return "";
  const parsed = new URL(currentUrl);
  const markers = [
    "/storage/v1/object/sign/",
    "/storage/v1/object/public/",
    "/storage/v1/object/authenticated/",
  ];
  const marker = markers.find((candidate) => parsed.pathname.includes(candidate));
  if (!marker) return "";
  const encodedIdentity = parsed.pathname.slice(
    parsed.pathname.indexOf(marker) + marker.length,
  );
  const separator = encodedIdentity.indexOf("/");
  if (separator <= 0) return "";
  try {
    return normalizeBucket(decodeURIComponent(encodedIdentity.slice(0, separator)));
  } catch {
    return "";
  }
}

export function normalizeInrSendVideoStorageReference(params: {
  bucket?: unknown;
  storagePath?: unknown;
  currentUrl?: unknown;
}) {
  const rawStoragePath = String(params.storagePath || "").trim();
  if (!rawStoragePath) return null;
  const storagePath = normalizeStoragePath(rawStoragePath);
  if (!storagePath) throw new Error("inrsend_video_storage_reference_untrusted");

  const rawBucket = String(params.bucket || "").trim();
  const explicitBucket = normalizeBucket(rawBucket);
  if (rawBucket && !explicitBucket) {
    throw new Error("inrsend_video_storage_reference_untrusted");
  }
  const bucket =
    explicitBucket ||
    inferStorageBucketFromUrl(params.currentUrl) ||
    LEGACY_BOOSTER_BUCKET;
  return { bucket, storagePath };
}

export async function resolveInrSendVideoDeliveryUrl(
  params: {
    accountId: string;
    bucket?: unknown;
    storagePath?: unknown;
    currentUrl?: unknown;
  },
  dependencies: InrSendVideoStorageDependencies,
): Promise<ResolvedInrSendVideoDelivery> {
  const accountId = String(params.accountId || "").trim();
  if (!accountId) throw new Error("inrsend_video_storage_reference_untrusted");

  const currentUrl = normalizeHttpUrl(params.currentUrl);
  const storageReference = normalizeInrSendVideoStorageReference(params);
  if (!storageReference) {
    if (!currentUrl) throw new Error("inrsend_video_url_unavailable");
    return {
      url: currentUrl,
      bucket: null,
      storagePath: null,
      refreshed: false,
    };
  }

  const registryRow = await dependencies.loadRegistryRow({
    accountId,
    bucket: storageReference.bucket,
    storagePath: storageReference.storagePath,
  });
  const authorization = dependencies.authorizeSource({
    accountId,
    bucket: storageReference.bucket,
    storagePath: storageReference.storagePath,
    registryRow,
  });

  const refreshedUrl = authorization.urlMode === "signed"
    ? await dependencies.signAuthorizedUrl(
        authorization.bucket,
        authorization.storagePath,
      )
    : dependencies.getPublicUrl(
        authorization.bucket,
        authorization.storagePath,
      );
  const normalizedUrl = normalizeHttpUrl(refreshedUrl);
  if (!normalizedUrl || !normalizedUrl.startsWith("https://")) {
    throw new Error("inrsend_video_url_refresh_failed");
  }

  return {
    url: normalizedUrl,
    bucket: authorization.bucket,
    storagePath: authorization.storagePath,
    refreshed: true,
  };
}
