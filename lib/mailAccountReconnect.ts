import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { asRecord } from "@/lib/tsSafe";

export function isMailAuthenticationFailure(error: unknown): boolean {
  const candidate = asRecord(error);
  const message = [
    error instanceof Error ? error.message : error,
    candidate["code"],
    candidate["responseCode"],
    candidate["statusCode"],
    candidate["response"],
    candidate["command"],
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" | ");
  return /authenticationfailed|authentication failed|authorizationfailed|authorization failed|invalid credentials|invalid login|login failed|bad credentials|username and password not accepted|mot de passe incorrect|\b535\b|invalid[_ -]?grant|token (?:has been |is )?(?:expired|revoked|invalid)/i.test(message);
}

export async function markMailAccountReconnectRequired(params: {
  userId: string;
  accountId: string;
  reason: string;
}) {
  if (!params.userId || !params.accountId) return;
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select("settings")
    .eq("id", params.accountId)
    .eq("user_id", params.userId)
    .eq("category", "mail")
    .maybeSingle();
  if (error || !data) return;
  const settings = asRecord(asRecord(data)["settings"]);
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("integrations")
    .update({
      status: "disconnected",
      settings: {
        ...settings,
        needs_reconnect: true,
        needs_reconnect_at: now,
        needs_reconnect_reason: params.reason,
      },
      updated_at: now,
    })
    .eq("id", params.accountId)
    .eq("user_id", params.userId)
    .eq("category", "mail");
}
