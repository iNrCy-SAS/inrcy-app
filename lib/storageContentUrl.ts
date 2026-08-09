import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { getAppBaseUrl } from "./tiktokMediaUrl";

function signingSecret() {
  return String(
    process.env.STORAGE_CONTENT_SECRET ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "",
  ).trim();
}

function signaturePayload(bucket: string, storagePath: string) {
  return `inrcy-storage-content:v1:${bucket}:${storagePath}`;
}

function sign(bucket: string, storagePath: string) {
  const secret = signingSecret();
  if (!secret || !bucket || !storagePath) return "";
  return createHmac("sha256", secret)
    .update(signaturePayload(bucket, storagePath))
    .digest("base64url");
}

export function buildStorageContentUrl(bucket: string, storagePath: string) {
  const cleanBucket = String(bucket || "").trim();
  const cleanPath = String(storagePath || "").trim().replace(/^\/+/, "");
  const token = sign(cleanBucket, cleanPath);
  if (!cleanBucket || !cleanPath || !token) return null;

  const params = new URLSearchParams({
    bucket: cleanBucket,
    path: cleanPath,
    token,
  });
  return `/api/storage/content?${params.toString()}`;
}

/**
 * Stable provider-facing URL. The opaque HMAC authenticates the storage
 * identity, while the route creates a fresh short-lived Supabase redirect on
 * every request. Crawlers can therefore revisit a publication days later
 * without holding on to an already-expired Supabase URL.
 */
export function buildAbsoluteStorageContentUrl(
  bucket: string,
  storagePath: string,
  requestUrl?: string,
) {
  const relativeUrl = buildStorageContentUrl(bucket, storagePath);
  const appBaseUrl = getAppBaseUrl(requestUrl);
  if (!relativeUrl || !appBaseUrl) return null;
  return new URL(relativeUrl, `${appBaseUrl}/`).toString();
}

export function verifyStorageContentToken(
  bucket: string,
  storagePath: string,
  token: string,
) {
  const expected = sign(bucket, storagePath);
  const received = String(token || "").trim();
  if (!expected || !received) return false;

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}
