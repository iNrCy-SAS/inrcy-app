import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { enforceRateLimit } from "@/lib/rateLimit";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeStorageDeliveryUrl } from "@/lib/storageUrlSanitization";

export const runtime = "nodejs";

const BUCKET = "booster";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const TEMP_FOLDER = "booster-transcription-audio";

function normalizeSafeSegment(value: string, fallback: string) {
  const safe = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 90);
  return safe || fallback;
}

function safeUserId(userId: string) {
  return normalizeSafeSegment(userId, randomUUID()).replace(/\./g, "-");
}

function safeAudioName(name: string) {
  const raw =
    String(name || "video-audio.wav")
      .split(/[\\/]/)
      .pop() || "video-audio.wav";
  const base = normalizeSafeSegment(raw.replace(/\.[^.]+$/, ""), "video-audio");
  return `${base}.wav`.toLowerCase();
}

function buildStoragePath(userId: string, name: string) {
  return `${safeUserId(userId)}/${TEMP_FOLDER}/${randomUUID()}-${safeAudioName(name)}`;
}

function belongsToUser(storagePath: string, userId: string) {
  const path = String(storagePath || "").replace(/^\/+/, "");
  return path.startsWith(`${safeUserId(userId)}/${TEMP_FOLDER}/`);
}

export async function POST(request: Request) {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const rateLimited = await enforceRateLimit({
    name: "booster_transcription_audio_signed_upload",
    identifier: activeUserId,
    limit: 12,
    window: "10 m",
    failClosed: false,
  });
  if (rateLimited) return rateLimited;

  const body = await request.json().catch(() => null);
  const name = String((body as any)?.name || "video-audio.wav");
  const type = String((body as any)?.type || "audio/wav")
    .toLowerCase()
    .split(";")[0]
    .trim();
  const size = Number((body as any)?.size || 0);

  if (!Number.isFinite(size) || size < 900 || size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Taille audio de transcription invalide." },
      { status: size > MAX_AUDIO_BYTES ? 413 : 400 },
    );
  }
  if (type && type !== "audio/wav" && type !== "audio/x-wav") {
    return NextResponse.json(
      { error: "Seul le WAV extrait par Booster est accepté." },
      { status: 415 },
    );
  }

  const storagePath = buildStoragePath(activeUserId, name);
  const signed = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signed.error || !signed.data?.token) {
    return NextResponse.json(
      { error: signed.error?.message || "Upload audio temporaire indisponible." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    bucket: BUCKET,
    storagePath,
    path: storagePath,
    token: signed.data.token,
    signedUrl: normalizeStorageDeliveryUrl(signed.data.signedUrl),
    contentType: "audio/wav",
  });
}

export async function DELETE(request: Request) {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = await request.json().catch(() => null);
  const storagePath = String((body as any)?.storagePath || "").trim();
  if (!storagePath || !belongsToUser(storagePath, activeUserId)) {
    return NextResponse.json({ error: "Chemin audio invalide." }, { status: 400 });
  }

  await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
  return NextResponse.json({ ok: true });
}
