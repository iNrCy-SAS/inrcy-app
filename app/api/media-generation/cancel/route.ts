import { NextResponse } from "next/server";

import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const REQUEST_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{7,179}$/i;
const MAX_BODY_BYTES = 2_048;

function publicError(status: number, code: string, error: string) {
  return NextResponse.json({ ok: false, code, error }, { status, headers: NO_STORE_HEADERS });
}

/**
 * Claim an absent key as terminal before it can reserve credits. A unique-key
 * conflict means the original job won: never update, fail or refund that job.
 */
export async function POST(request: Request) {
  try {
    const current = await getCurrentInrcyAccountScope();
    if (!current) return publicError(401, "UNAUTHORIZED", "Non authentifié.");
    const { activeUserId: accountId, authUserId } = current.scope;
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) return publicError(400, "AI_MEDIA_CANCEL_INVALID", "Demande d’arrêt invalide.");
    const raw = await request.text().catch(() => "");
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(raw); } catch { /* Invalid requests remain public. */ }
    if (raw.length > MAX_BODY_BYTES || !body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.requestId !== "string" || !REQUEST_KEY_PATTERN.test(body.requestId) ||
      !["image", "video"].includes(String(body.mediaKind)) || !["studio", "booster"].includes(String(body.surface))) {
      return publicError(400, "AI_MEDIA_CANCEL_INVALID", "Demande d’arrêt invalide.");
    }
    // This is an epoch guard only. The caller never chooses the account used
    // for the insert or lookup; both always use the authenticated active scope.
    if (body.expectedAccountId !== undefined && (typeof body.expectedAccountId !== "string" || body.expectedAccountId !== accountId)) {
      return publicError(409, "AI_MEDIA_ACCOUNT_CHANGED", "L’établissement actif a changé. Revenez sur l’établissement d’origine pour vérifier cette tentative.");
    }
    const limited = await enforceRateLimit({
      name: "ai_media_cancellation", identifier: accountId, limit: 30, fallbackLimit: 10,
      window: "10 m", failClosed: true, code: "ai_media_cancellation_burst",
    });
    if (limited) return limited;
    const edition = await getDashboardEditionForAccountId(accountId);
    const now = new Date();
    const inserted = await supabaseAdmin.from("ai_media_generation_jobs").insert({
      account_id: accountId, actor_auth_user_id: authUserId,
      request_key: body.requestId, request_fingerprint: "0".repeat(64),
      media_kind: body.mediaKind, surface: body.surface, edition, monthly_limit: 1,
      quota_period_start: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`,
      quota_unit: "credit", quota_amount: 1, purchased_quota_amount: 0,
      status: "failed", failed_at: now.toISOString(),
      reservation_expires_at: new Date(now.getTime() + 60_000).toISOString(),
      error_code: "AI_MEDIA_CANCELLED_BEFORE_RESERVATION",
      metadata: { cancellation_before_reservation: true },
    });
    // The schema requires a positive amount, but this failed marker creates
    // no reservation row and changes no wallet, counter or credit ledger.
    if (!inserted.error) return NextResponse.json({ ok: true, status: "failed", cancellationPreventedReservation: true }, { headers: NO_STORE_HEADERS });
    if (inserted.error.code !== "23505") throw inserted.error;
    const existing = await supabaseAdmin.from("ai_media_generation_jobs")
      .select("status").eq("account_id", accountId).eq("request_key", body.requestId).maybeSingle();
    if (existing.error) throw existing.error;
    const status = existing.data?.status;
    if (status === "failed" || status === "expired" || status === "completed") {
      return NextResponse.json({ ok: true, status, cancellationPreventedReservation: false }, { headers: NO_STORE_HEADERS });
    }
    if (status === "reserved" || status === "processing") {
      return NextResponse.json({ ok: true, status: "processing", cancellationPreventedReservation: false }, { status: 202, headers: NO_STORE_HEADERS });
    }
    throw new Error("ai_media_cancellation_state_unavailable");
  } catch {
    return publicError(503, "AI_MEDIA_CANCEL_UNAVAILABLE", "L’arrêt de la tentative n’a pas encore pu être confirmé.");
  }
}
