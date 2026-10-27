import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeBoosterSoundtrackId } from "@/lib/boosterSoundtracks";
import { META_IMAGE_SOUNDTRACK_ASSET_SECONDS } from "@/lib/metaImageMotionTiming";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let soundtrackId: string | null;
  try { soundtrackId = normalizeBoosterSoundtrackId(id); }
  catch { return new Response(null, { status: 404 }); }
  if (!soundtrackId) return new Response(null, { status: 404 });
  try {
    // The exact catalogue lookup above prevents filesystem input/path traversal.
    const bytes = await readFile(path.join(process.cwd(), "assets", "media-generation", "soundtracks", `${soundtrackId}-${META_IMAGE_SOUNDTRACK_ASSET_SECONDS}s.wav`));
    if (bytes.byteLength < 44 || bytes.byteLength > 4_000_000 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("soundtrack_preview_invalid");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch { return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
