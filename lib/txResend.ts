import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { TxMail } from "@/lib/txMailer";
import { resendFailureDetails, TxResendDeliveryError } from "@/lib/resendFailurePolicy";
import { readTxResendQuotaState, readTxResendQuotaStatus, rememberTxResendQuota, type TxResendQuotaState } from "@/lib/txResendQuota";

function apiKey() {
  return String(process.env.TX_RESEND_API_KEY || process.env.RESEND_API_KEY || "").trim();
}

export function canUseTxResendFallback() {
  return Boolean(apiKey());
}

type ResendResponse = { id?: string; name?: string; data?: Array<{ name?: string; status?: string }> };

export { TxResendDeliveryError } from "@/lib/resendFailurePolicy";

export async function readTxResendFallbackQuota() {
  return readTxResendQuotaState(apiKey());
}

export async function readTxResendFallbackQuotaStatus() {
  return readTxResendQuotaStatus(apiKey());
}

function quotaError(state: TxResendQuotaState) {
  const details = resendFailureDetails(429, `${state.scope}_quota_exceeded`, null);
  return new TxResendDeliveryError({
    ...details, retryAt: state.retryAt, retryAtIsEstimate: state.retryAtIsEstimate,
    retryAfterSeconds: Math.max(0, Math.ceil((Date.parse(state.retryAt) - Date.now()) / 1000)),
  }, state.storage);
}

async function request(path: string, init: RequestInit, attempt = 0): Promise<ResendResponse> {
  const key = apiKey();
  if (!key) throw new Error("Le secours mail Resend n’est pas configuré.");
  if (path === "/emails") {
    const quota = await readTxResendQuotaState(key);
    if (quota) throw quotaError(quota);
  }
  let response: Response;
  try {
    response = await fetch(`https://api.resend.com${path}`, {
      ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { ...init.headers, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    });
  } catch {
    throw new TxResendDeliveryError({
      ...resendFailureDetails(503, "service_unavailable", null),
      code: "TX_RESEND_TRANSPORT_UNAVAILABLE", message: "La réponse du secours mail n’a pas pu être vérifiée.", deliveryState: "unknown",
    });
  }
  const payload: ResendResponse | null = await response.json().catch(() => null);
  if (response.ok && !payload) throw new TxResendDeliveryError({
    ...resendFailureDetails(502, null, null), code: "TX_RESEND_ACCEPTANCE_UNCONFIRMED",
    message: "La réponse du secours mail n’a pas pu être vérifiée.", deliveryState: "unknown",
  });
  if (!response.ok || !payload) {
    const details = resendFailureDetails(response.status, payload?.name, response.headers.get("Retry-After"));
    if (details.quotaScope && details.retryAt) {
      const quota = await rememberTxResendQuota(key, {
        scope: details.quotaScope, observedAt: new Date().toISOString(),
        retryAt: details.retryAt, retryAtIsEstimate: details.retryAtIsEstimate,
      });
      throw new TxResendDeliveryError(details, quota.storage);
    }
    // Only the explicit short burst limit is safe to retry inside this request.
    // A long Retry-After is returned to the durable caller, never shortened.
    const waitMs = Math.max(1000, (details.retryAfterSeconds ?? 1) * 1000);
    if (response.status === 429 && details.providerCode === "rate_limit_exceeded" && attempt < 2 && waitMs <= 5000) {
      await new Promise<void>(resolve => setTimeout(resolve, waitMs));
      return request(path, init, attempt + 1);
    }
    throw new TxResendDeliveryError(details);
  }
  return payload;
}

/** Read-only readiness check. It never sends mail or changes DNS. */
export async function verifyTxResendFallback(from: string) {
  const quota = await readTxResendFallbackQuota();
  if (quota) throw quotaError(quota);
  const domain = /@([^<>\s]+)/.exec(from)?.[1]?.toLowerCase();
  const payload = await request("/domains?limit=100", { method: "GET" });
  if (!domain || !Array.isArray(payload.data) || !payload.data.some((row: {name?: string; status?: string}) => row.name === domain && row.status === "verified")) {
    throw new Error("Le domaine expéditeur du secours mail Resend n’est pas validé.");
  }
}

/** Only called after a definitive SMTP AUTH rejection, never after an ambiguous send. */
export async function sendTxResendMail(mail: TxMail, from: string) {
  const deliveryKey = mail.idempotencyKey || mail.messageId || randomUUID();
  const idempotencyKey = "tx/" + createHash("sha256").update([from, mail.to, deliveryKey].join("\n")).digest("hex");
  const payload = await request("/emails", {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html,
      ...(mail.messageId ? { headers: { "Message-ID": mail.messageId } } : {}),
      attachments: (mail.attachments || []).map(attachment => ({
        filename: attachment.filename || "piece-jointe", content: attachment.content.toString("base64"),
        content_type: attachment.mimeType || "application/octet-stream",
        ...(attachment.inline && attachment.cid ? { content_id: attachment.cid } : {}),
      })),
    }),
  });
  if (typeof payload.id !== "string" || !payload.id) throw new TxResendDeliveryError({
    ...resendFailureDetails(502, null, null), code: "TX_RESEND_ACCEPTANCE_UNCONFIRMED",
    message: "L’acceptation du mail par Resend n’est pas confirmée.", deliveryState: "unknown",
  });
  return { messageId: payload.id, accepted: [mail.to], rejected: [], provider: "resend" as const };
}
