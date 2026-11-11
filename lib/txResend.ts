import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { TxMail } from "@/lib/txMailer";

function apiKey() {
  return String(process.env.TX_RESEND_API_KEY || process.env.RESEND_API_KEY || "").trim();
}

export function canUseTxResendFallback() {
  return Boolean(apiKey());
}

async function request(path: string, init: RequestInit) {
  const key = apiKey();
  if (!key) throw new Error("Le secours mail Resend n’est pas configuré.");
  const response = await fetch(`https://api.resend.com${path}`, {
    ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { ...init.headers, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  const payload = await response.json().catch(() => null);
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
