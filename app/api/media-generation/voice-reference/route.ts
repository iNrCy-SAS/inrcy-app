import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { enforceRateLimit } from "@/lib/rateLimit";
import { AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES } from "@/lib/aiMediaCharacterVoices";
import { normalizeAiMediaCharacterVoiceAudio } from "@/lib/aiMediaCharacterVoiceAudio";
import { readAiMediaCharacterVoice, removeAiMediaCharacterVoice, saveAiMediaCharacterVoice } from "@/lib/aiMediaCharacterVoiceStorage";
import { readAiMediaCharacterVoiceFromLibrary } from "@/lib/aiMediaCharacterVoiceLibrary";
import { saveMediaLibraryAudio } from "@/lib/mediaLibraryAudioStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const MAX_BODY = AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES + 64 * 1024;

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "voice_upload_failed";
  const duration = code === "voice_audio_duration_invalid";
  const storage = code.includes("storage") || code === "voice_reference_unavailable";
  return NextResponse.json({ ok: false, code: storage ? "voice_storage_unavailable" : code.startsWith("voice_") ? code : "voice_upload_failed", error:
    duration ? "Le vocal doit durer entre 1 et 10 secondes."
      : code.includes("expired") ? "Ce vocal n’est plus disponible. Ajoutez-le à nouveau."
        : storage ? "Le vocal est momentanément indisponible. Réessayez."
          : "Choisissez un vocal lisible de 1 à 10 secondes et de 3 Mo maximum." },
  { status: storage ? 503 : 400, headers: HEADERS });
}

async function boundedFormData(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;") || !request.body || Number(request.headers.get("content-length") || 0) > MAX_BODY) throw new Error("voice_audio_size_invalid");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > MAX_BODY) { await reader.cancel(); throw new Error("voice_audio_size_invalid"); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  return new Response(Buffer.concat(chunks), { headers: { "Content-Type": contentType } }).formData();
}

async function libraryMediaId(request: Request) {
  if (!request.body || Number(request.headers.get("content-length") || 0) > 1024) throw new Error("voice_library_reference_invalid");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 1024) { await reader.cancel(); throw new Error("voice_library_reference_invalid"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof body?.mediaLibraryId !== "string") throw new Error();
    return body.mediaLibraryId;
  } catch { throw new Error("voice_library_reference_invalid"); }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  const limited = await enforceRateLimit({ name: "studio_character_voice_upload", identifier: auth.activeUserId, limit: 18, fallbackLimit: 9, window: "10 m", failClosed: true, code: "voice_upload_rate_limit" });
  if (limited) return limited;
  try {
    if ((request.headers.get("content-type") || "").toLowerCase().split(";")[0] === "application/json") {
      const original = await readAiMediaCharacterVoiceFromLibrary({ accountId: auth.activeUserId, mediaId: await libraryMediaId(request), signal: request.signal });
      const normalized = await normalizeAiMediaCharacterVoiceAudio({ buffer: original.buffer, signal: request.signal });
      const sample = await saveAiMediaCharacterVoice({ accountId: auth.activeUserId, name: original.name, buffer: normalized.buffer });
      return NextResponse.json({ ok: true, sample: { ...sample, libraryMediaId: original.mediaId } }, { headers: HEADERS });
    }
    const form = await boundedFormData(request);
    const file = form.get("file");
    const recording = form.get("source") === "recording";
    if (!(file instanceof File) || !file.size || file.size > AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES) throw new Error("voice_audio_size_invalid");
    const mime = file.type.toLowerCase().split(";")[0];
    const imported = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav", "audio/vnd.wave"].includes(mime) ||
      ((!mime || mime === "application/octet-stream") && /\.(mp3|wav)$/i.test(file.name));
    const captured = recording && ["audio/webm", "audio/ogg", "audio/mp4", "audio/x-m4a"].includes(mime);
    if (!imported && !captured) throw new Error("voice_audio_format_invalid");
    const normalized = await normalizeAiMediaCharacterVoiceAudio({ buffer: Buffer.from(await file.arrayBuffer()), recording, signal: request.signal });
    const sample = await saveAiMediaCharacterVoice({ accountId: auth.activeUserId, name: file.name, buffer: normalized.buffer });
    try {
      const library = await saveMediaLibraryAudio({ accountId: auth.activeUserId, name: file.name.replace(/\.[^.]+$/, "") + ".wav", buffer: normalized.buffer, mimeType: "audio/wav", durationSeconds: normalized.durationSeconds, source: "studio_character_voice" });
      return NextResponse.json({ ok: true, sample: { ...sample, libraryMediaId: library.id } }, { headers: HEADERS });
    } catch {
      await removeAiMediaCharacterVoice({ accountId: auth.activeUserId, path: sample.path }).catch(() => undefined);
      throw new Error("voice_storage_unavailable");
    }
  } catch (error) { return failure(error); }
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  try {
    const { buffer } = await readAiMediaCharacterVoice({ accountId: auth.activeUserId, path: new URL(request.url).searchParams.get("path") || "", signal: request.signal });
    return new Response(new Uint8Array(buffer), { headers: { ...HEADERS, "Content-Type": "audio/wav", "Content-Length": String(buffer.length) } });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  try {
    await removeAiMediaCharacterVoice({ accountId: auth.activeUserId, path: new URL(request.url).searchParams.get("path") || "" });
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (error) { return failure(error); }
}
