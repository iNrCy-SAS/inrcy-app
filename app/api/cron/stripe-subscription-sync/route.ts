import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { reconcileStripeSubscriptionStatuses } from "@/lib/stripeSubscriptionStatusSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const hasHeaderCredential =
    (request.headers.get("authorization") || "").startsWith("Bearer ") ||
    Boolean((request.headers.get("x-cron-secret") || "").trim());
  if (!hasHeaderCredential || !isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await reconcileStripeSubscriptionStatuses();
    return NextResponse.json(result, {
      status: result.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(
      "[stripe-subscription-sync][failed]",
      error instanceof Error ? error.message : "sync_failed",
    );
    return NextResponse.json(
      { ok: false, error: "stripe_subscription_sync_failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
