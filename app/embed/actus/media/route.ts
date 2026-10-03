import { NextResponse } from "next/server";
import {
  extractEmbedActusStorageReference,
  normalizeEmbedActusStorageReference,
  verifyEmbedActusMediaToken,
} from "@/lib/embedActusMedia";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";

export const runtime = "nodejs";

function mediaError(status: number) {
  const cacheControl = status === 404
    ? "public, s-maxage=3600, max-age=300, stale-while-revalidate=86400"
    : "private, no-store, max-age=0";

  return new NextResponse(null, {
    status,
    headers: {
      "cache-control": cacheControl,
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bucket = searchParams.get("bucket") || "";
  const storagePath = searchParams.get("path") || "";
  const token = searchParams.get("token") || "";

  const signedReference = verifyEmbedActusMediaToken(
    bucket,
    storagePath,
    token,
  )
    ? normalizeEmbedActusStorageReference(bucket, storagePath)
    : null;

  // Compatibility for an iframe HTML response generated before this patch.
  // The URL is still restricted to the configured Supabase origin and to the
  // two media buckets explicitly supported by the website publication flow.
  const parsedLegacyReference = signedReference
    ? null
    : extractEmbedActusStorageReference(searchParams.get("src") || "");
  // Legacy iframe markup only ever proxied the historical `booster` bucket.
  // Do not expose token-free signing for the newer private universal bucket.
  const legacyReference = parsedLegacyReference?.bucket === "booster"
    ? parsedLegacyReference
    : null;
  const reference = signedReference || legacyReference;
  if (!reference) return mediaError(400);

  const target = await createSafeStorageSignedUrl(
    reference.bucket,
    reference.storagePath,
    60 * 60,
  );
  if (!target) return mediaError(404);

  return NextResponse.redirect(target, {
    status: 302,
    headers: {
      // The signing helper may reuse a URL for up to 80% of its one-hour life.
      // Keep this redirect in the browser only and never serve it stale: even
      // at maximum reuse, the URL retains at least seven minutes of validity.
      "cache-control": "private, max-age=300, must-revalidate",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
