import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { markQueuedRecipientsBlockedBySuppression, normalizeSuppressionEmail, removeSuppressionEntry, upsertSuppressionEntry } from "@/lib/mailSuppression";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";

export const runtime = "nodejs";

const ALLOWED_REASONS = new Set(["opt_out", "blacklist", "hard_bounce", "complaint"]);

export async function GET() {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const { data, error } = await supabase
    .from("mail_suppression_list")
    .select("id,email,email_normalized,reason,source,note,created_at,updated_at")
    .eq("user_id", activeUserId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: getSimpleFrenchErrorMessage(error, "Impossible de charger la liste de désabonnement.") }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

export async function POST(req: Request) {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = await req.json().catch(() => ({}));
  const email = normalizeSuppressionEmail(body?.email);
  const reason = String(body?.reason || "blacklist").trim().toLowerCase();
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (!email) return NextResponse.json({ error: "Email manquant." }, { status: 400 });
  if (!ALLOWED_REASONS.has(reason)) return NextResponse.json({ error: "Raison invalide." }, { status: 400 });

  const row = await upsertSuppressionEntry({
    user_id: activeUserId,
    email,
    reason: reason as any,
    source: "dashboard_api",
    note: note || null,
  });

  const blockedQueued = await markQueuedRecipientsBlockedBySuppression({
    userId: activeUserId,
    email,
    reason: reason as any,
    source: "dashboard_api",
    note: note || null,
  });

  return NextResponse.json({ success: true, item: row, blockedQueued });
}

export async function DELETE(req: Request) {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const url = new URL(req.url);
  const email = normalizeSuppressionEmail(url.searchParams.get("email"));
  if (!email) return NextResponse.json({ error: "Email manquant." }, { status: 400 });

  await removeSuppressionEntry(activeUserId, email);
  return NextResponse.json({ success: true });
}
