import { NextResponse } from "next/server";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { log } from "@/lib/observability/logger";
import { getRequestId } from "@/lib/observability/request";
import {
  scheduleSubscriptionCancellationForUser,
  SubscriptionCancellationError,
} from "@/lib/scheduleSubscriptionCancellation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let stage = "authentication";
  try {
    const { user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    stage = "schedule_cancellation";
    const result = await scheduleSubscriptionCancellationForUser(user.id);

    return NextResponse.json({
      ok: true,
      end_date: result.endDate,
      next_renewal_date: result.nextRenewalDate,
      cancellation_policy: result.policy,
    });
  } catch (e: unknown) {
    if (e instanceof SubscriptionCancellationError) {
      return NextResponse.json(
        { error: e.message, code: e.code, provider: e.provider },
        { status: e.code === "NO_ACTIVE_SUBSCRIPTION" ? 400 : 409 },
      );
    }
    const code = String((e as { code?: unknown } | null)?.code || "");
    const requestId = getRequestId(request);
    log.error("billing_cancellation_failed", {
      route: "/api/billing/cancel", stage, status_code: 500,
      error_code: /^[a-z0-9_]{1,40}$/i.test(code) ? code : "unexpected_failure",
      request_id: requestId && /^[0-9a-f-]{36}$/i.test(requestId) ? requestId : undefined,
    });
    const msg = getSimpleFrenchErrorMessage(e, "Le service est momentanément indisponible. Merci de réessayer dans quelques minutes.");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
