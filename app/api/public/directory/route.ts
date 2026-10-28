import { NextRequest, NextResponse } from "next/server";
import { getInrDirectoryResult } from "@/lib/inrDirectoryQuery";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "no-store, max-age=0" };
export function OPTIONS() { return new NextResponse(null, { status: 204, headers }); }
export async function GET(request: NextRequest) {
  try {
    const origin = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(request.nextUrl.hostname) ? request.nextUrl.origin : undefined;
    return NextResponse.json(await getInrDirectoryResult(request.nextUrl.searchParams, origin), { headers });
  } catch (error) {
    console.error("[inr-directory] public listing unavailable", error instanceof Error ? error.message : "Database error");
    return NextResponse.json({ ok: false, error: "Annuaire iNrCy momentanément indisponible." }, { status: 503, headers });
  }
}
