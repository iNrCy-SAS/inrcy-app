import { NextResponse } from "next/server";
import { getBoosterSoundtrackCatalog } from "@/lib/boosterSoundtracks";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, soundtracks: getBoosterSoundtrackCatalog() }, {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" },
  });
}
