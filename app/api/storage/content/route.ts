import { NextRequest, NextResponse } from "next/server";

import {
  createSafeStorageSignedUrl,
  probeStorageObject,
} from "@/lib/safeStorageSignedUrl";
import { verifyStorageContentToken } from "@/lib/storageContentUrl";

export const runtime = "nodejs";

function notFound() {
  return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
}

async function redirectToFreshStorageUrl(request: NextRequest) {
  const bucket = String(request.nextUrl.searchParams.get("bucket") || "").trim();
  const storagePath = String(request.nextUrl.searchParams.get("path") || "")
    .trim()
    .replace(/^\/+/, "");
  const token = request.nextUrl.searchParams.get("token") || "";

  if (
    !/^[a-zA-Z0-9_-]{1,100}$/.test(bucket) ||
    !storagePath ||
    storagePath.length > 1000 ||
    storagePath.includes("..") ||
    !verifyStorageContentToken(bucket, storagePath, token)
  ) {
    return notFound();
  }

  const probe = await probeStorageObject(bucket, storagePath);
  if (probe === "missing") return notFound();
  if (probe === "unknown") {
    return NextResponse.json(
      { error: "Stockage momentanément indisponible." },
      { status: 503 },
    );
  }

  // Do not buffer large private videos in Vercel. A stable inrCy URL issues a
  // fresh redirect for every crawler request and preserves Range/HEAD semantics.
  const signedUrl = await createSafeStorageSignedUrl(
    bucket,
    storagePath,
    60 * 60,
  );
  if (!signedUrl) {
    return NextResponse.json(
      { error: "Lecture momentanément indisponible." },
      { status: 503 },
    );
  }

  return new Response(null, {
    status: 307,
    headers: {
      Location: signedUrl,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}

export const GET = redirectToFreshStorageUrl;
export const HEAD = redirectToFreshStorageUrl;
