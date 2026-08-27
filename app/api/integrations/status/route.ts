import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { asRecord } from "@/lib/tsSafe";

import { getConnectionDisplayStatus, mailConnectionKind, readConnectionVersion } from "@/lib/connectionVersions";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";

function publicImapSettings(settings: Record<string, unknown>) {
  const imap = asRecord(settings["imap"]);
  const smtp = asRecord(settings["smtp"]);
  return {
    imap_host: String(imap["host"] || ""),
    imap_port: Number(imap["port"] || 993),
    imap_secure: typeof imap["secure"] === "boolean" ? Boolean(imap["secure"]) : Number(imap["port"] || 993) === 993,
    smtp_host: String(smtp["host"] || ""),
    smtp_port: Number(smtp["port"] || 587),
    smtp_secure: typeof smtp["secure"] === "boolean" ? Boolean(smtp["secure"]) : Number(smtp["port"] || 587) === 465,
    smtp_starttls: Boolean(smtp["starttls"]),
  };
}

export async function GET() {
  const supabase = await createSupabaseServer();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return jsonUserFacingError("Non authentifié.", { status: 401 });
  }

  const userId = await resolveActiveInrcyAccountId(supabase, userData.user.id);

  const { data: rows, error: mailError } = await supabase
    .from("integrations")
    .select("id, provider, account_email, settings, status, created_at")
    .eq("user_id", userId)
    .eq("category", "mail")
    .order("created_at", { ascending: true });

  const mailAccounts =
    (rows ?? []).map((r: Record<string, unknown>) => {
      const rr = asRecord(r);
      const settings = asRecord(rr["settings"]);
      const kind = mailConnectionKind(rr["provider"]);
      const isConnected = String(rr["status"] || "").toLowerCase() === "connected";
      const computedConnectionStatus = kind
        ? getConnectionDisplayStatus(isConnected, kind, settings)
        : isConnected
          ? "connected"
          : "disconnected";
      // A disconnected mailbox row only remains when the provider credentials
      // need attention. An intentional disconnect deletes the row entirely.
      const connectionStatus = kind && computedConnectionStatus === "disconnected"
        ? "needs_update"
        : computedConnectionStatus;
      return {
        id: rr["id"],
        provider: rr["provider"],
        email_address: rr["account_email"],
        account_email: rr["account_email"],
        email: rr["account_email"],
        display_name: settings["display_name"] ?? null,
        status: rr["status"],
        connection_status: connectionStatus,
        requires_update: connectionStatus === "needs_update",
        connection_version: readConnectionVersion(settings),
        imap_settings: rr["provider"] === "imap" ? publicImapSettings(settings) : null,
        created_at: rr["created_at"],
      };
    }) ?? [];


  if (mailError) {
    return jsonUserFacingError(mailError, { status: 500, fallback: "Impossible de charger vos comptes de messagerie pour le moment." });
  }

  return NextResponse.json({
    mailAccounts: mailAccounts,
    limits: { maxMailAccounts: 4 },
  });
}
