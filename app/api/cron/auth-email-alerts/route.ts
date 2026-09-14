import { NextResponse } from "next/server";

import { processDueAuthEmailFailureAlerts } from "@/lib/authMailDelivery";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "auth_email_alert_cron_failed";
  const code = "code" in error ? String(error.code || "") : "";
  return code.replace(/[^a-z0-9_-]/gi, "_").slice(0, 100) || "auth_email_alert_cron_failed";
}

export async function GET(request: Request) {
  const hasHeaderCredential =
    (request.headers.get("authorization") || "").startsWith("Bearer ") ||
    Boolean((request.headers.get("x-cron-secret") || "").trim());
  if (!hasHeaderCredential || !isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const alerts = await processDueAuthEmailFailureAlerts({ limit: 10 });
    console.info("[auth-mail][alert-cron-complete]", alerts);
    return NextResponse.json(
      { ok: true, alerts },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const code = safeErrorCode(error);
    console.error("[auth-mail][alert-cron-failed]", { code });
    return NextResponse.json(
      { ok: false, error: code },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
}
