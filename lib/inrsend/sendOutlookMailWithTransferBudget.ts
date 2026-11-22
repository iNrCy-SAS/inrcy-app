import { parseRetryAfterMs } from "@/lib/mailDeliveryErrors";
import { waitForNextCampaignRecipient } from "@/lib/mailCampaignPacing";
import { getOutlookTransferIntervalMs, OUTLOOK_WINDOW_BYTES } from "@/lib/outlookMailTransferPacing";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const PROVIDER_FALLBACK_DELAY_MS = 15 * 60_000;
const SERVICE_RETRY_DELAY_MS = 60_000;

export class OutlookTransferDeferred extends Error {
  constructor(
    message: string,
    readonly reason: "outlook_transfer_budget" | "outlook_transfer_unavailable" | "rate_limited" | "configuration",
    readonly resumeAt: string | null,
  ) {
    super(message);
    this.name = "OutlookTransferDeferred";
  }
}

type OutlookMailRequest = {
  integrationId: string;
  userId: string;
  accessToken: string;
  body: string;
  campaign?: { waitUntil: number; beforeSend: () => Promise<void> };
};

function transferServiceUnavailable() {
  return new OutlookTransferDeferred(
    "Le contrôle du volume Outlook est temporairement indisponible. L’envoi reprendra automatiquement.",
    "outlook_transfer_unavailable",
    new Date(Date.now() + SERVICE_RETRY_DELAY_MS).toISOString(),
  );
}

async function reserveTransfer(request: OutlookMailRequest, payloadBytes: number, intervalMs: number) {
  const { data, error } = await supabaseAdmin.rpc("reserve_outlook_mail_transfer", {
    p_integration_id: request.integrationId,
    p_user_id: request.userId,
    p_payload_bytes: payloadBytes,
    p_min_interval_ms: intervalMs,
  }).then((result) => result, () => { throw transferServiceUnavailable(); });
  const reservation = Array.isArray(data) ? data[0] : null;
  if (error || !reservation) throw transferServiceUnavailable();
  if (reservation.allowed === true) return null;

  switch (reservation.reason) {
    case "invalid_payload":
      throw new OutlookTransferDeferred("Le message Outlook est trop volumineux pour être envoyé.", "configuration", null);
    case "unknown_mailbox":
      throw new OutlookTransferDeferred("Reconnectez la boîte Outlook avant de reprendre l’envoi.", "configuration", null);
    case "pacing":
    case "provider_cooldown": {
      const retryAt = Date.parse(String(reservation.retry_at || ""));
      if (!Number.isFinite(retryAt)) throw transferServiceUnavailable();
      return reservation.reason === "pacing"
        ? new OutlookTransferDeferred("Les envois Outlook sont espacés selon le poids des messages.", "outlook_transfer_budget", new Date(retryAt).toISOString())
        : new OutlookTransferDeferred("Outlook demande une pause avant la reprise des envois.", "rate_limited", new Date(retryAt).toISOString());
    }
    default:
      throw transferServiceUnavailable();
  }
}

export async function sendOutlookMailWithTransferBudget(request: OutlookMailRequest): Promise<Response> {
  const payloadBytes = Buffer.byteLength(request.body, "utf8");
  if (payloadBytes < 1 || payloadBytes > OUTLOOK_WINDOW_BYTES) {
    throw new OutlookTransferDeferred("Le message Outlook est trop volumineux pour être envoyé.", "configuration", null);
  }

  const intervalMs = request.campaign ? getOutlookTransferIntervalMs(payloadBytes) : 0;
  let deferred = await reserveTransfer(request, payloadBytes, intervalMs);
  if (deferred?.reason === "outlook_transfer_budget" && request.campaign) {
    const retryAt = Date.parse(deferred.resumeAt || "");
    if (retryAt <= request.campaign.waitUntil) {
      await waitForNextCampaignRecipient(retryAt - Date.now());
      deferred = await reserveTransfer(request, payloadBytes, intervalMs);
    }
  }
  if (deferred) throw deferred;

  await request.campaign?.beforeSend();
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { Authorization: `Bearer ${request.accessToken}`, "Content-Type": "application/json" },
    body: request.body,
  });

  if (response.status === 429) {
    const delay = Math.max(SERVICE_RETRY_DELAY_MS, parseRetryAfterMs(response.headers.get("retry-after")) ?? PROVIDER_FALLBACK_DELAY_MS);
    try {
      const { error } = await supabaseAdmin.rpc("defer_outlook_mail_transfer", {
        p_integration_id: request.integrationId,
        p_user_id: request.userId,
        p_retry_at: new Date(Date.now() + delay).toISOString(),
      });
      if (error) console.warn("[outlookTransfer] Could not persist provider cooldown", error.code);
    } catch {
      console.warn("[outlookTransfer] Could not persist provider cooldown");
    }
  }

  return response;
}
