import { NextResponse } from "next/server";

import {
  AuthMailDeliveryError,
  authResendApiKey,
  processAuthEmailFailureAlert,
  recordResendAuthEmailEvent,
} from "@/lib/authMailDelivery";
import {
  AuthMailPayloadError,
  authMailStatusNeedsAlert,
  normalizeResendAuthEvent,
  redactAuthMailError,
} from "@/lib/authMailPolicy";
import {
  readStandardWebhookHeaders,
  verifyResendAuthEmailWebhook,
} from "@/lib/authMailWebhookSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function webhookFailure(error: unknown) {
  const safe = redactAuthMailError(error);
  if (error instanceof AuthMailDeliveryError) {
    return { status: error.httpStatus, code: error.code };
  }
  if (error instanceof AuthMailPayloadError) {
    if (error.code === "missing_resend_configuration") return { status: 503, code: error.code };
    if (error.code === "missing_signature_headers") return { status: 401, code: error.code };
    return { status: 400, code: error.code };
  }
  if (error instanceof SyntaxError) return { status: 400, code: "invalid_json" };
  if (String((error as { name?: unknown })?.name || "") === "WebhookVerificationError") {
    return { status: 401, code: "invalid_signature" };
  }
  return { status: 503, code: safe.code || "auth_mail_webhook_failed" };
}

export async function POST(request: Request) {
  try {
    // Resend signs the unparsed body. Parsing before verification would make
    // signatures fragile and would expose an unauthenticated event surface.
    const rawBody = await request.text();
    const headers = readStandardWebhookHeaders(request.headers, "svix");
    const verifiedPayload = verifyResendAuthEmailWebhook({
      rawBody,
      headers,
      webhookSecret: String(process.env.RESEND_WEBHOOK_SECRET || ""),
      apiKey: authResendApiKey(),
    });
    const event = normalizeResendAuthEvent(verifiedPayload);
    if (event.kind === "ignored") {
      return NextResponse.json({ received: true, ignored: event.reason }, { status: 200 });
    }

    const recorded = await recordResendAuthEmailEvent({ svixId: headers.id, event });
    const hasPendingAlert =
      recorded.alert_status === "pending" ||
      recorded.alert_status === "retry_wait" ||
      recorded.alert_status === "processing";
    const deliveryNeedsAlert = authMailStatusNeedsAlert(recorded.delivery_status || "");
    if (recorded.delivery_id && deliveryNeedsAlert) {
      const alert = await processAuthEmailFailureAlert({ deliveryId: recorded.delivery_id });
      if (
        alert.outcome === "retrying" ||
        alert.outcome === "uncertain" ||
        (alert.outcome === "not_due" && hasPendingAlert)
      ) {
        throw new AuthMailDeliveryError({
          code: "auth_mail_alert_pending",
          message: "Authentication email failure alert is pending",
          httpStatus: 503,
          retryable: true,
        });
      }
    }

    console.info("[auth-mail][resend-event-processed]", {
      event: event.eventType,
      result: recorded.event_result,
      delivery: event.deliveryKey?.replace(/^v1:/, "") || null,
    });
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    const failure = webhookFailure(error);
    console.error("[auth-mail][resend-webhook-failed]", {
      code: failure.code,
      status: failure.status,
    });
    return NextResponse.json({ error: failure.code }, { status: failure.status });
  }
}
