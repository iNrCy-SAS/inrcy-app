import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { decryptSecret, encryptSecret } from "@/lib/imapCrypto";
import nodemailer from "nodemailer";
import net from "net";
import { withApi } from "@/lib/observability/withApi";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withImap } from "@/lib/imapClient";

import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { asRecord, asString } from "@/lib/tsSafe";
function isPrivateIp(ip: string): boolean {
  if (/^10\./.test(ip)) return true;
  if (/^127\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip === "0.0.0.0") return true;
  if (ip === "::1") return true;
  if (/^fc/i.test(ip) || /^fd/i.test(ip)) return true;
  if (/^fe80:/i.test(ip)) return true;
  return false;
}

function validateHost(input: string): string {
  const host = String(input || "").trim();
  if (!host) throw new Error("Le serveur de messagerie est manquant.");
  if (host.includes("/") || host.includes("\\")) throw new Error("L'adresse du serveur de messagerie est invalide.");
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error("L'adresse du serveur de messagerie est invalide.");

  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".local") || lower.endsWith(".internal")) {
    throw new Error("Ce serveur de messagerie n'est pas autorisé.");
  }

  const ipVersion = net.isIP(host);
  if (ipVersion && isPrivateIp(host)) {
    throw new Error("Ce serveur de messagerie n'est pas autorisé.");
  }

  return host;
}

function validatePort(n: number, fallback: number): number {
  const p = Number.isFinite(n) ? Math.trunc(n) : fallback;
  if (p < 1 || p > 65535) throw new Error("Le numéro de port renseigné n'est pas valide.");
  return p;
}

function isCertificateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /self-signed certificate|certificate chain|unable to verify the first certificate|unable to get local issuer certificate|certificate has expired|certificate not yet valid/i.test(message);
}

function translateMailConnectionError(error: unknown, fallback = "Connexion impossible pour le moment."): string {
  const message = error instanceof Error ? error.message : String(error || "");
  const lower = message.toLowerCase();

  if (isCertificateError(error)) {
    return "Le serveur mail présente un certificat SSL non reconnu. La connexion sécurisée IMAP a été refusée.";
  }
  if (/authentication failed|invalid login|535 5\.7\.1|username and password not accepted|login failed/i.test(lower)) {
    return "Identifiant ou mot de passe incorrect pour ce serveur mail.";
  }
  if (/econnrefused|enotfound|getaddrinfo|server is unreachable|connection timeout|timed out/i.test(lower)) {
    return "Impossible de joindre le serveur mail. Vérifiez l'adresse du serveur et le port.";
  }
  return fallback;
}

const handler = async (req: Request) => {
  const supabase = await createSupabaseServer();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return jsonUserFacingError("Accès non autorisé.", { status: 401, code: "auth_required" });

  try {
    const body = await req.json().catch(() => ({}));
    const accountId = String(body.accountId || "").trim();
    const submittedPassword = String(body.password || "");

    const userId = await resolveActiveInrcyAccountId(supabase, userData.user.id);
    let existingQuery = supabaseAdmin
      .from("integrations")
      .select("id,account_email,refresh_token_enc,settings")
      .eq("user_id", userId)
      .eq("category", "mail")
      .eq("provider", "imap");
    if (accountId) existingQuery = existingQuery.eq("id", accountId);
    const { data: existingRows, error: existingReadError } = await existingQuery
      .order("created_at", { ascending: true })
      .limit(1);
    if (existingReadError) {
      return jsonUserFacingError("Impossible de charger cette boîte IMAP pour le moment.", { status: 500, code: "imap_read_failed" });
    }
    const existing = asRecord(existingRows?.[0]);
    if (accountId && !existing["id"]) {
      return jsonUserFacingError("Cette boîte IMAP est introuvable.", { status: 404, code: "imap_account_not_found" });
    }

    const login = String(body.login || existing["account_email"] || "").trim();
    const existingPasswordEnc = asString(existing["refresh_token_enc"]) || "";
    const storedPassword = !submittedPassword && existingPasswordEnc ? decryptSecret(existingPasswordEnc) : "";
    const password = submittedPassword || storedPassword;

    const imap_host = validateHost(body.imap_host);
    const imap_port = validatePort(Number(body.imap_port ?? 993), 993);
    const imap_secure = !!body.imap_secure;

    const smtp_host = validateHost(body.smtp_host);
    const smtp_port = validatePort(Number(body.smtp_port ?? 587), 587);
    const smtp_secure = !!body.smtp_secure;
    const smtp_starttls = !!body.smtp_starttls;

    if (!login || !password) {
      return jsonUserFacingError("Merci de renseigner l'identifiant et le mot de passe.", { status: 400, code: "invalid_input" });
    }

    try {
      await withImap(
        { user: login, password, host: imap_host, port: imap_port, secure: imap_secure },
        async (client) => {
          await client.mailboxOpen("INBOX");
          return true;
        }
      );
    } catch (imapError) {
      if (isCertificateError(imapError)) {
        await withImap(
          { user: login, password, host: imap_host, port: imap_port, secure: imap_secure, tls: { rejectUnauthorized: false } },
          async (client) => {
            await client.mailboxOpen("INBOX");
            return true;
          }
        );
      } else {
        throw imapError;
      }
    }

    const transport = nodemailer.createTransport({
      host: smtp_host,
      port: smtp_port,
      secure: smtp_secure,
      auth: { user: login, pass: password },
      requireTLS: smtp_starttls,
      tls: process.env.NODE_ENV === "development" ? { rejectUnauthorized: false } : undefined,
    });
    await transport.verify();

    const password_enc = submittedPassword || !existingPasswordEnc
      ? encryptSecret(password)
      : existingPasswordEnc;
    const existingSettings = asRecord(existing["settings"]);
    const cleanedSettings = { ...existingSettings };
    delete cleanedSettings["mailbox_feedback_scan_failure_count"];
    delete cleanedSettings["mailbox_feedback_scan_paused_until"];
    delete cleanedSettings["mailbox_feedback_scan_last_failed_at"];
    delete cleanedSettings["mailbox_feedback_scan_last_error_code"];
    const payload = {
        user_id: userId,
        provider: "imap",
        category: "mail",
        product: "imap",
        account_email: login,
        provider_account_id: null,
        status: "connected",
        access_token_enc: null,
        refresh_token_enc: password_enc,
        expires_at: null,
        settings: withCurrentConnectionVersion("mail:imap", {
          ...cleanedSettings,
          display_name: "IMAP",
          imap: { host: imap_host, port: imap_port, secure: imap_secure },
          smtp: { host: smtp_host, port: smtp_port, secure: smtp_secure, starttls: smtp_starttls },
        }),
        updated_at: new Date().toISOString(),
      };

    const saveQuery = existing["id"]
      ? supabaseAdmin
          .from("integrations")
          .update(payload)
          .eq("id", String(existing["id"]))
          .eq("user_id", userId)
          .select("id")
          .single()
      : supabaseAdmin
          .from("integrations")
          .insert(payload)
          .select("id")
          .single();
    const { data, error } = await saveQuery;

    if (error) return jsonUserFacingError("Impossible d'enregistrer ce compte de messagerie pour le moment.", { status: 500, code: "imap_save_failed" });
    return NextResponse.json({ ok: true, id: data?.id, updated: Boolean(existing["id"]) });
  } catch (e: unknown) {
    return jsonUserFacingError(translateMailConnectionError(e, "Connexion impossible pour le moment."), {
      status: 400,
      fallback: "Connexion impossible pour le moment.",
      code: "imap_connect_failed",
      extra: process.env.NODE_ENV === "development" ? { technical_error: e instanceof Error ? e.message : String(e || "") } : undefined,
    });
  }
};

export const POST = withApi(handler, { route: "/api/integrations/imap/connect" });
