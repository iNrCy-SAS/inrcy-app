import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { claimInrAssistantUiAction, saveInrAssistantUiResult, verifyInrAssistantUiReceiptToken } from "@/lib/inrAssistantUiReceipts";

export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "no-store, private" };

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  const denied = (status = 400) => NextResponse.json({ ok: false, code: "assistant_ui_receipt_invalid" }, { status, headers });
  if (request.headers.get("sec-fetch-site") === "cross-site" || request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return denied(403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json") || !request.body) return denied();
  try {
    const reader = request.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 28_000) { await reader.cancel(); return denied(413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let body: Record<string, unknown>;
    try { body = JSON.parse(Buffer.concat(chunks, size).toString("utf8")); } catch { return denied(); }
    if (!body || typeof body !== "object" || typeof body.token !== "string") return denied();
    const plan = verifyInrAssistantUiReceiptToken(body.token, { accountId: auth.activeUserId, actorUserId: auth.authUserId });
    if (!plan) return denied(403);
    if (body.action === "claim") {
      if (typeof body.actionId !== "string" || !plan.actions.some(action => action.id === body.actionId)) return denied();
      const claimed = await claimInrAssistantUiAction(plan, body.actionId);
      return NextResponse.json({ ok: claimed, source: "browser_reported", ...(claimed ? {} : { code: "assistant_ui_already_claimed" }) }, { status: claimed ? 200 : 409, headers });
    }
    const result = await saveInrAssistantUiResult(plan, body.result);
    return result ? NextResponse.json({ ok: true, result, source: "browser_reported", businessActionConfirmed: false }, { headers }) : denied();
  } catch {
    return NextResponse.json({ ok: false, code: "assistant_ui_receipt_unavailable" }, { status: 503, headers });
  }
}
