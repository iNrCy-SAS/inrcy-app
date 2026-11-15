import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { drainNotificationDigests } from "@/lib/notificationDigestOutbox";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...await drainNotificationDigests() });
  } catch {
    return NextResponse.json({ ok: false, error: "DIGEST_QUEUE_UNAVAILABLE" }, { status: 503 });
  }
}
