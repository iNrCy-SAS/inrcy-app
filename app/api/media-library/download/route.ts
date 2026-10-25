import { NextResponse } from "next/server";

import { requireUser } from "@/lib/requireUser";
import {
  createMediaLibraryArchiveStream, MediaLibraryArchiveError, parseMediaLibraryArchiveIds, prepareMediaLibraryArchive,
} from "@/lib/mediaLibraryArchive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const MAX_BODY_BYTES = 16 * 1024;

function failure(error: unknown) {
  const known = error instanceof MediaLibraryArchiveError;
  return NextResponse.json({ error: known ? error.message : "Le téléchargement est momentanément indisponible. Réessayez." },
    { status: known ? error.status : 503, headers: HEADERS });
}

async function readIds(request: Request): Promise<string[]> {
  const invalid = () => new MediaLibraryArchiveError(400, "Sélectionnez entre 1 et 200 médias valides.");
  if (!request.body || Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) throw invalid();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw invalid(); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw invalid(); }
  return parseMediaLibraryArchiveIds(body?.ids);
}

/** Preflight first, then let the browser download without buffering the ZIP in client memory. */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  try {
    const ids = await readIds(request);
    await prepareMediaLibraryArchive(auth.activeUserId, ids, AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]));
    return NextResponse.json({ ok: true, downloadUrl: `/api/media-library/download?ids=${ids.join(",")}` }, { headers: HEADERS });
  } catch (error) { return failure(error); }
}

/** Re-check the account and all files: the preflight URL grants no permission itself. */
export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  try {
    const raw = new URL(request.url).searchParams.get("ids") || "";
    if (raw.length > 7400) throw new MediaLibraryArchiveError(400, "Sélectionnez au maximum 200 médias.");
    const ids = parseMediaLibraryArchiveIds(raw.split(","));
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(280_000)]);
    const entries = await prepareMediaLibraryArchive(auth.activeUserId, ids, signal);
    const name = `inrcy-medias-${new Date().toISOString().slice(0, 10)}.zip`;
    return new Response(createMediaLibraryArchiveStream(entries, signal), {
      headers: { ...HEADERS, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "X-Accel-Buffering": "no" },
    });
  } catch (error) { return failure(error); }
}
