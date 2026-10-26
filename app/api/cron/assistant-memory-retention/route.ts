import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { inrAssistantMemoryCutoff } from "@/lib/inrAssistantMemory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET || "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Fixed-table cleanup only. Never accept account IDs, filters or a cutoff from the caller. */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store, private" };
  if (!authorized(request)) return NextResponse.json({ error: "Non autorisé." }, { status: 401, headers });
  const cutoff = inrAssistantMemoryCutoff();
  try {
    const result = await supabaseAdmin.from("inr_assistant_turns").delete({ count: "exact" })
      .lt("created_at", cutoff).abortSignal(AbortSignal.timeout(25_000));
    if (result.error) return NextResponse.json({ error: "Nettoyage de la mémoire indisponible." }, { status: 503, headers });
    // No prose, identity or deleted row is returned or logged.
    return NextResponse.json({ success: true, deleted: result.count ?? null, cutoff, retentionMonths: 2 }, { headers });
  } catch {
    return NextResponse.json({ error: "Nettoyage de la mémoire indisponible." }, { status: 503, headers });
  }
}
