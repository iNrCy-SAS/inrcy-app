import { NextResponse } from "next/server";

import { sendPreparedAuthEmail, AuthMailDeliveryError } from "@/lib/authMailDelivery";
import {
  AuthMailPayloadError,
  buildPreparedAuthEmails,
  parseSupabaseAuthEmailHookPayload,
  redactAuthMailError,
} from "@/lib/authMailPolicy";
import {
  readStandardWebhookHeaders,
  verifySupabaseAuthEmailHook,
} from "@/lib/authMailWebhookSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appOrigin() {
  return String(
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://app.inrcy.com",
  ).trim();
}

function hookError(error: unknown) {
  const safe = redactAuthMailError(error);
  if (error instanceof AuthMailDeliveryError) {
    return { status: error.httpStatus, code: error.code };
  }
  if (error instanceof AuthMailPayloadError) {
    if (error.code === "missing_hook_secret") return { status: 503, code: error.code };
    if (error.code === "missing_signature_headers") return { status: 401, code: error.code };
    return { status: 400, code: error.code };
  }
  if (error instanceof SyntaxError) return { status: 400, code: "invalid_json" };
  if (String((error as { name?: unknown })?.name || "") === "WebhookVerificationError") {
    return { status: 401, code: "invalid_signature" };
  }
  return { status: 503, code: safe.code || "auth_mail_hook_failed" };
}

function retryHeaders(status: number) {
  if (status === 429) return { "Retry-After": "60" };
  if (status === 503) return { "Retry-After": "5" };
  return undefined;
}

export async function POST(request: Request) {
  try {
    // Signature verification must use the exact bytes received from Supabase.
    const rawBody = await request.text();
    const headers = readStandardWebhookHeaders(request.headers, "webhook");
    const verifiedPayload = verifySupabaseAuthEmailHook({
      rawBody,
      headers,
      secret: String(process.env.SEND_EMAIL_HOOK_SECRET || ""),
    });
    const payload = parseSupabaseAuthEmailHookPayload(verifiedPayload);
    const messages = buildPreparedAuthEmails({
      payload,
      hookId: headers.id,
      appOrigin: appOrigin(),
      allowLocalhost: process.env.NODE_ENV !== "production",
    });

    await Promise.all(messages.map((message) => sendPreparedAuthEmail(message)));
    console.info("[auth-mail][supabase-hook-accepted]", {
      action: payload.emailData.action,
      deliveries: messages.map((message) => message.deliveryHash),
    });
    // Supabase expects an empty JSON object on successful hook execution.
    return NextResponse.json({}, { status: 200 });
  } catch (error) {
    const failure = hookError(error);
    console.error("[auth-mail][supabase-hook-failed]", {
      code: failure.code,
      status: failure.status,
    });
    return NextResponse.json(
      { error: { http_code: failure.status, message: failure.code } },
      { status: failure.status, headers: retryHeaders(failure.status) },
    );
  }
}
