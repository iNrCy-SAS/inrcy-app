import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { TxMail } from "@/lib/txMailer";

function apiKey() {
  return String(process.env.TX_RESEND_API_KEY || process.env.RESEND_API_KEY || "").trim();
}

export function canUseTxResendFallback() {
  return Boolean(apiKey());
}

type ResendResponse = { id?: string; message?: string; data?: Array<{ name?: string; status?: string }> };

async function request(path: string, init: RequestInit, attempt = 0): Promise<ResendResponse> {
  const key = apiKey();
  if (!key) throw new Error("Le secours mail Resend n’est pas configuré.");
  const response = await fetch(`https://api.resend.com${path}`, {
    ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { ...init.headers, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  const payload: ResendResponse | null = await response.json().catch(() => null);
  // A 429 explicitly refuses the request. Retry the identical idempotent body,
  // respecting the provider delay, rather than losing a burst of queued mail.
  if (response.status === 429 && attempt < 2) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    const waitMs = Math.min(5_000, Math.max(1_000, Number.isFinite(retryAfter) ? retryAfter * 1_000 : 1_000));
    await new Promise<void>(resolve => setTimeout(resolve, waitMs));
    return request(path, init, attempt + 1);
  }
  if (!response.ok || !payload) {
    throw Object.assign(new Error(String(payload?.message || `Resend HTTP ${response.status}`).replaceAll(key, "[redacted]")), {
      code: "TX_RESEND_DELIVERY_FAILED", responseCode: response.status,
    });
  }
  return payload;
}

/** Read-only readiness check. It never sends mail or changes DNS. */
export async function verifyTxResendFallback(from: string) {
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
  if (typeof payload.id !== "string" || !payload.id) throw new Error("L’acceptation du mail par Resend n’est pas confirmée.");
  return { messageId: payload.id, accepted: [mail.to], rejected: [], provider: "resend" as const };
}
