import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeStorageDeliveryUrl } from "@/lib/storageUrlSanitization";

function normalizePath(value: unknown) {
  const path = String(value ?? "").trim().replace(/^\/+/, "");
  if (!path || path.includes("..") || path.includes("\\")) return "";
  return path;
}

export type StorageObjectProbe = "exists" | "missing" | "unknown";

type SignedUrlCacheEntry = {
  url: string;
  validUntil: number;
};

const signedUrlCache = new Map<string, SignedUrlCacheEntry>();
const signingInFlight = new Map<string, Promise<string | null>>();
const missingObjectCache = new Map<string, number>();
const MAX_CACHE_ENTRIES = 500;
const MISSING_OBJECT_TTL_MS = 10 * 60_000;
const RETRY_DELAYS_MS = [180, 550, 1_250] as const;

function cacheKey(bucket: string, path: string, expiresIn: number) {
  return `${bucket}:${path}:${expiresIn}`;
}

function objectKey(bucket: string, path: string) {
  return `${bucket}:${path}`;
}

function rememberMissingObject(bucket: string, path: string) {
  missingObjectCache.set(objectKey(bucket, path), Date.now() + MISSING_OBJECT_TTL_MS);
}

function isKnownMissingObject(bucket: string, path: string, now = Date.now()) {
  const key = objectKey(bucket, path);
  const validUntil = missingObjectCache.get(key) || 0;
  if (validUntil <= now) {
    missingObjectCache.delete(key);
    return false;
  }
  return true;
}

function clearMissingObject(bucket: string, path: string) {
  missingObjectCache.delete(objectKey(bucket, path));
}

function pruneCache(now: number) {
  for (const [key, validUntil] of missingObjectCache) {
    if (validUntil <= now) missingObjectCache.delete(key);
  }

  for (const [key, entry] of signedUrlCache) {
    if (entry.validUntil <= now) signedUrlCache.delete(key);
  }

  if (missingObjectCache.size > MAX_CACHE_ENTRIES) {
    const overflow = missingObjectCache.size - MAX_CACHE_ENTRIES;
    let removedMissing = 0;
    for (const key of missingObjectCache.keys()) {
      missingObjectCache.delete(key);
      removedMissing += 1;
      if (removedMissing >= overflow) break;
    }
  }

  if (signedUrlCache.size <= MAX_CACHE_ENTRIES) return;
  const overflow = signedUrlCache.size - MAX_CACHE_ENTRIES;
  let removed = 0;
  for (const key of signedUrlCache.keys()) {
    signedUrlCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function isMissingObjectError(error: unknown) {
  const candidate = error as { statusCode?: string | number; status?: number; message?: string; error?: string } | null;
  const status = Number(candidate?.statusCode || candidate?.status || 0);
  const message = `${candidate?.message || ""} ${candidate?.error || ""}`.toLowerCase();
  return status === 400 || status === 404 || message.includes("not found") || message.includes("does not exist");
}

function isTransientStorageError(error: unknown) {
  const candidate = error as { statusCode?: string | number; status?: number; message?: string; error?: string } | null;
  const status = Number(candidate?.statusCode || candidate?.status || 0);
  const message = `${candidate?.message || ""} ${candidate?.error || ""}`.toLowerCase();
  return status === 408 || status === 429 || status >= 500 || message.includes("timeout") || message.includes("fetch failed") || message.includes("econnreset");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeStorageObjectByListing(
  bucket: string,
  path: string,
): Promise<StorageObjectProbe> {
  const separatorIndex = path.lastIndexOf("/");
  const folder = separatorIndex >= 0 ? path.slice(0, separatorIndex) : "";
  const fileName = separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
  if (!fileName) return "missing";

  try {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .list(folder, {
        limit: 100,
        search: fileName,
      });
    if (error) return "unknown";

    const exists = (data || []).some((entry) => entry.name === fileName);
    if (exists) {
      clearMissingObject(bucket, path);
      return "exists";
    }
    rememberMissingObject(bucket, path);
    return "missing";
  } catch {
    return "unknown";
  }
}

/**
 * Exact object probe through a service-role-only SQL function.
 * Reading storage.objects through PostgREST avoids turning a stale registry
 * reference into a noisy Storage 400 before we have had a chance to repair it.
 */
export async function probeStorageObject(
  bucket: string,
  storagePath: string,
): Promise<StorageObjectProbe> {
  const normalizedBucket = String(bucket || "").trim();
  const path = normalizePath(storagePath);
  if (!normalizedBucket || !path) return "missing";
  if (isKnownMissingObject(normalizedBucket, path)) return "missing";

  try {
    const { data, error } = await supabaseAdmin.rpc(
      "inrcy_storage_object_exists",
      { p_bucket: normalizedBucket, p_path: path },
    );
    if (!error && data === true) {
      clearMissingObject(normalizedBucket, path);
      return "exists";
    }
    if (!error && data === false) {
      rememberMissingObject(normalizedBucket, path);
      return "missing";
    }
    return probeStorageObjectByListing(normalizedBucket, path);
  } catch {
    return probeStorageObjectByListing(normalizedBucket, path);
  }
}

async function signWithRetry(bucket: string, path: string, expiresIn: number): Promise<string | null> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUrl(path, expiresIn);

      if (!error && data?.signedUrl) {
        const signedUrl = normalizeStorageDeliveryUrl(data.signedUrl);
        if (!signedUrl) return null;
        clearMissingObject(bucket, path);
        return signedUrl;
      }
      lastError = error;

      // A stale/non-existent path is deterministic: retrying only creates more 400s.
      if (isMissingObjectError(error)) {
        rememberMissingObject(bucket, path);
        return null;
      }
      if (!isTransientStorageError(error)) return null;
    } catch (error) {
      lastError = error;
      if (!isTransientStorageError(error)) return null;
    }

    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  console.error("[storage-sign] unavailable after retries", {
    bucket,
    path,
    error: lastError instanceof Error ? lastError.message : String(lastError || "unknown"),
  });
  return null;
}

/**
 * Central signed-URL service:
 * - probes the exact object before signing, when the registry/listing is available;
 * - still attempts signing when the probe is inconclusive, preserving availability;
 * - one in-flight request per object (prevents request storms);
 * - retries only transient 5xx/timeout failures;
 * - never retries deterministic 400/404 stale paths;
 * - caches the URL for less than its real TTL so callers do not keep re-signing it.
 */
export async function createSafeStorageSignedUrl(
  bucket: string,
  storagePath: string,
  expiresIn: number,
) {
  const normalizedBucket = String(bucket || "").trim();
  const normalizedPath = normalizePath(storagePath);
  const ttlSeconds = Math.max(60, Math.floor(Number(expiresIn) || 0));
  if (!normalizedBucket || !normalizedPath) return null;

  const key = cacheKey(normalizedBucket, normalizedPath, ttlSeconds);
  const now = Date.now();
  pruneCache(now);
  if (isKnownMissingObject(normalizedBucket, normalizedPath, now)) return null;

  const cached = signedUrlCache.get(key);
  if (cached && cached.validUntil > now) return cached.url;

  const active = signingInFlight.get(key);
  if (active) return active;

  const request = probeStorageObject(normalizedBucket, normalizedPath)
    .then((objectState) => {
      if (objectState === "missing") return null;
      return signWithRetry(normalizedBucket, normalizedPath, ttlSeconds);
    })
    .then((url) => {
      if (url) {
        // Keep a safety margin: never serve a URL close to expiration.
        const cacheSeconds = Math.max(30, Math.min(ttlSeconds - 30, Math.floor(ttlSeconds * 0.8)));
        signedUrlCache.set(key, { url, validUntil: Date.now() + cacheSeconds * 1_000 });
      }
      return url;
    })
    .finally(() => {
      signingInFlight.delete(key);
    });

  signingInFlight.set(key, request);
  return request;
}
