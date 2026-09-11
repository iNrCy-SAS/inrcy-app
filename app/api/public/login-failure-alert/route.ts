import { after, NextResponse } from "next/server";

import {
  clearLoginFailureCountersForUser,
  fingerprintLoginTelemetryValue,
  getLoginFailureMonitoringSafeCode,
  processLoginFailureSignal,
} from "@/lib/loginFailureAlert";
import { parseLoginFailureSignal } from "@/lib/loginFailureAlertPolicy";
import { log } from "@/lib/observability/logger";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { createSupabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PAYLOAD_BYTES = 2_048;

function acceptedResponse() {
  return NextResponse.json(
    { ok: true },
    {
      status: 202,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

async function readBoundedJson(request: Request) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) return null;

  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PAYLOAD_BYTES) return null;
  if (!request.body) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const reader = request.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_PAYLOAD_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

function isExplicitCrossSiteRequest(request: Request) {
  return String(request.headers.get("sec-fetch-site") || "").toLowerCase() === "cross-site";
}

async function processAuthenticatedSuccess() {
  try {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.id) {
      log.info("login_failure_success_signal_unauthenticated");
      return;
    }
    await clearLoginFailureCountersForUser(data.user.id);
  } catch (error) {
    log.warn("login_failure_success_reset_failed", {
      error_code: getLoginFailureMonitoringSafeCode(error),
    });
  }
}

export async function POST(request: Request) {
  try {
    if (isExplicitCrossSiteRequest(request)) return acceptedResponse();

    const parsed = parseLoginFailureSignal(await readBoundedJson(request));
    if (!parsed) {
      log.info("login_failure_signal_rejected", { reason: "invalid_payload" });
      return acceptedResponse();
    }

    if (parsed.kind === "success") {
      await processAuthenticatedSuccess();
      return acceptedResponse();
    }

    const ipFingerprint = fingerprintLoginTelemetryValue(`ip:${getClientIp(request)}`);
    const emailFingerprint = fingerprintLoginTelemetryValue(`email:${parsed.email}`);

    after(async () => {
      try {
        const limited = await enforceRateLimit({
          name: "login_failure_signal_ip",
          identifier: ipFingerprint,
          limit: 20,
          fallbackLimit: 8,
          window: "15 m",
          failClosed: false,
          code: "login_failure_signal_rate_limited",
        });
        if (limited) {
          log.info("login_failure_signal_rate_limited", {
            category: parsed.category,
            error_code: parsed.errorCode,
            email_fingerprint: emailFingerprint,
            ip_fingerprint: ipFingerprint,
          });
          return;
        }

        await processLoginFailureSignal(parsed, {
          emailFingerprint,
          ipFingerprint,
        });
      } catch (error) {
        log.warn("login_failure_signal_processing_failed", {
          category: parsed.category,
          error_code: parsed.errorCode,
          status_code: parsed.errorStatus ?? undefined,
          email_fingerprint: emailFingerprint,
          ip_fingerprint: ipFingerprint,
          failure_code: getLoginFailureMonitoringSafeCode(error),
        });
      }
    });
  } catch (error) {
    log.warn("login_failure_signal_handler_failed", {
      failure_code: getLoginFailureMonitoringSafeCode(error),
    });
  }

  return acceptedResponse();
}
