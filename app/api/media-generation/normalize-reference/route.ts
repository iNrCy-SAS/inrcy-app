import { NextResponse } from "next/server";
import sharp from "sharp";

import {
  AI_MEDIA_INSPIRATION_MAX_DIMENSION,
  AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS,
  AI_MEDIA_INSPIRATION_NORMALIZED_MAX_BYTES,
  AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES,
} from "@/lib/aiMediaGenerationContracts";
import { normalizeImageAiPreviewBuffer } from "@/lib/mediaImageNormalizer";
import { isInrMediaImageFile } from "@/lib/mediaRules";
import { sanitizeUniversalMediaSegment } from "@/lib/mediaUploadPolicy";
import { requireUser } from "@/lib/requireUser";
import { enforceRateLimit } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TRANSIENT_BUCKET = "inrcy-pro-media";
const TRANSIENT_FOLDER = "studio-identity-reference";
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function jsonError(error: string, status = 400, code?: string) {
  return NextResponse.json(
    { ok: false, error, ...(code ? { code } : {}) },
    { status, headers: NO_STORE_HEADERS },
  );
}

function cleanText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function transientAccountPrefix(accountId: string) {
  const account = sanitizeUniversalMediaSegment(
    accountId,
    "invalid-account",
  ).replace(/\./g, "-");
  return `users/${account}/${TRANSIENT_FOLDER}/image/`;
}

function ownedTransientPath(accountId: string, value: unknown) {
  const path = cleanText(value, 900).replace(/^\/+/, "");
  if (!path || path.includes("..") || path.includes("\\")) return "";
  return path.startsWith(transientAccountPrefix(accountId)) ? path : "";
}

async function removeTransientReference(storagePath: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const removed = await supabaseAdmin.storage
      .from(TRANSIENT_BUCKET)
      .remove([storagePath]);
    if (!removed.error) return;
    lastError = removed.error;
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  throw lastError || new Error("identity_reference_cleanup_failed");
}

async function constrainAiReferencePreview(input: Buffer) {
  if (
    input.byteLength > 0 &&
    input.byteLength <= AI_MEDIA_INSPIRATION_NORMALIZED_MAX_BYTES
  ) {
    return input;
  }

  const attempts = [
    { maxSide: AI_MEDIA_INSPIRATION_MAX_DIMENSION, quality: 70 },
    { maxSide: 1_152, quality: 64 },
    { maxSide: 1_024, quality: 58 },
    { maxSide: 896, quality: 52 },
    { maxSide: 768, quality: 46 },
    { maxSide: 640, quality: 40 },
  ] as const;

  for (const attempt of attempts) {
    const rendered = await sharp(input, {
      failOn: "error",
      limitInputPixels: 20_000_000,
      pages: 1,
    })
      .rotate()
      .resize({
        width: attempt.maxSide,
        height: attempt.maxSide,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toColourspace("srgb")
      .jpeg({
        quality: attempt.quality,
        progressive: false,
        chromaSubsampling: "4:2:0",
      })
      .toBuffer();
    if (
      rendered.byteLength > 0 &&
      rendered.byteLength <= AI_MEDIA_INSPIRATION_NORMALIZED_MAX_BYTES
    ) {
      return rendered;
    }
  }

  throw new Error("identity_reference_normalized_too_large");
}

async function requireIdentityReferenceUser() {
  const auth = await requireUser();
  if (auth.errorResponse) return { ...auth, limited: null };
  const limited = await enforceRateLimit({
    name: "ai_media_identity_reference_normalization",
    identifier: auth.activeUserId,
    limit: 24,
    fallbackLimit: 12,
    window: "10 m",
    failClosed: true,
    code: "ai_media_identity_reference_normalization_burst",
  });
  return { ...auth, limited };
}

export async function POST(request: Request) {
  let storagePath = "";
  let activeUserId = "";
  try {
    const auth = await requireIdentityReferenceUser();
    if (auth.errorResponse) return auth.errorResponse;
    if (auth.limited) return auth.limited;
    activeUserId = auth.activeUserId;

    const body = await request.json().catch(() => null);
    storagePath = ownedTransientPath(activeUserId, body?.storagePath);
    const fileName = cleanText(body?.fileName, 240);
    const mimeType = cleanText(body?.mimeType, 120).toLowerCase();
    if (!storagePath) {
      return jsonError(
        "Référence temporaire invalide.",
        400,
        "identity_reference_path_invalid",
      );
    }
    if (!isInrMediaImageFile({ name: fileName, type: mimeType })) {
      return jsonError(
        "Ce format d’image n’est pas pris en charge.",
        415,
        "identity_reference_format_unsupported",
      );
    }

    const downloaded = await supabaseAdmin.storage
      .from(TRANSIENT_BUCKET)
      .download(storagePath);
    if (downloaded.error || !downloaded.data) {
      throw downloaded.error || new Error("identity_reference_download_failed");
    }
    const source = Buffer.from(await downloaded.data.arrayBuffer());
    if (
      !source.byteLength ||
      source.byteLength > AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES
    ) {
      return jsonError(
        "L’image de référence est vide ou dépasse 12 Mo.",
        413,
        "identity_reference_size_invalid",
      );
    }

    const normalized = await normalizeImageAiPreviewBuffer({
      buffer: source,
      mimeType,
      originalFileName: fileName,
    });
    const prepared = await constrainAiReferencePreview(
      normalized.aiPreview.buffer,
    );
    const data = prepared.toString("base64");
    if (
      data.length < 64 ||
      data.length > AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS
    ) {
      throw new Error("identity_reference_payload_invalid");
    }

    // La réponse n'est émise qu'après suppression confirmée de l'original.
    await removeTransientReference(storagePath);
    storagePath = "";

    return NextResponse.json(
      {
        ok: true,
        image: {
          mimeType: "image/jpeg",
          data,
          name: `${fileName.replace(/\.[^.]+$/, "").slice(0, 110) || "reference"}.jpg`,
        },
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.warn("[ai-media] transient identity reference normalization failed", {
      accountId: activeUserId || null,
      code:
        error instanceof Error
          ? error.message.slice(0, 160)
          : "identity_reference_normalization_failed",
    });
    return jsonError(
      "Cette image n’a pas pu être convertie. Essayez une autre image ou réessayez dans un instant.",
      422,
      "identity_reference_normalization_failed",
    );
  } finally {
    if (storagePath) {
      await removeTransientReference(storagePath).catch((cleanupError) => {
        console.error("[ai-media] transient identity reference cleanup failed", {
          accountId: activeUserId || null,
          code:
            cleanupError instanceof Error
              ? cleanupError.message.slice(0, 160)
              : "identity_reference_cleanup_failed",
        });
      });
    }
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireIdentityReferenceUser();
    if (auth.errorResponse) return auth.errorResponse;
    if (auth.limited) return auth.limited;
    const body = await request.json().catch(() => null);
    const storagePath = ownedTransientPath(
      auth.activeUserId,
      body?.storagePath,
    );
    if (!storagePath) {
      return jsonError(
        "Référence temporaire invalide.",
        400,
        "identity_reference_path_invalid",
      );
    }
    await removeTransientReference(storagePath);
    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch {
    return jsonError(
      "La référence temporaire n’a pas pu être supprimée.",
      500,
      "identity_reference_cleanup_failed",
    );
  }
}
