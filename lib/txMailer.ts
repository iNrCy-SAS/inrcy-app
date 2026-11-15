import "server-only";

import nodemailer from "nodemailer";
import { optionalEnv, requireEnv } from "@/lib/env";
import { createSmtpHandshakeRetryGuard, withSmtpHandshakeRetry } from "@/lib/health/smtpRetryPolicy";
import {
  assertTxSmtpCircuitClosed,
  clearTxSmtpCircuit,
  openTxSmtpCircuit,
  isTxSmtpAuthenticationFailure,
  isTxSmtpCircuitOpenError,
  type TxSmtpCircuitIdentity,
} from "@/lib/txSmtpCircuit";
import { canUseTxResendFallback, sendTxResendMail } from "@/lib/txResend";

export type TxMailAttachment = {
  filename: string;
  mimeType?: string;
  content: Buffer;
  inline?: boolean;
  cid?: string;
};

export type TxMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Stable RFC Message-ID used by durable, at-least-once delivery flows. */
  messageId?: string;
  /** Stable business event key, preserved across retries by API mail providers. */
  idempotencyKey?: string;
  /** Reserve the backup provider for essential mail; deferred mail remains with its durable caller. */
  fallbackPolicy?: "critical" | "defer";
  /** Optional worker deadline; a timeout after invoking sendMail remains unknown. */
  deadlineAt?: number;
  attachments?: TxMailAttachment[];
};

type TxSmtpProfile = "transactional" | "monitoring";

type TxSmtpConfig = TxSmtpCircuitIdentity & {
  from: string;
  tlsRejectUnauthorized: boolean;
};

function profileEnv(
  profile: TxSmtpProfile,
  suffix: string,
  fallback = "",
) {
  if (profile === "transactional") {
    return suffix === "MAIL_FROM"
      ? optionalEnv("TX_MAIL_FROM", fallback)
      : requireEnv(`TX_${suffix}`);
  }
  return optionalEnv(
    `MONITORING_${suffix}`,
    suffix === "MAIL_FROM"
      ? optionalEnv("TX_MAIL_FROM", fallback)
      : optionalEnv(`TX_${suffix}`, fallback),
  );
}

function loadSmtpConfig(profile: TxSmtpProfile): TxSmtpConfig {
  const host = profileEnv(profile, "SMTP_HOST");
  const rawPort = profileEnv(profile, "SMTP_PORT");
  const user = profileEnv(profile, "SMTP_USER");
  const pass = profileEnv(profile, "SMTP_PASS");
  const port = Number(rawPort);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535 || !user || !pass) {
    throw new Error(`Configuration SMTP ${profile} incomplète.`);
  }

  const secureEnv = profile === "monitoring"
    ? optionalEnv("MONITORING_SMTP_SECURE", optionalEnv("TX_SMTP_SECURE", ""))
    : optionalEnv("TX_SMTP_SECURE", "");
  const secure =
    secureEnv === "true" ? true : secureEnv === "false" ? false : port === 465;
  const from = profileEnv(profile, "MAIL_FROM", user) || user;

  // ✅ Local/dev often breaks on OVH chain because of TLS interception (AV/proxy) or cert chain quirks.
  // - In production: default strict (true)
  // - In dev/local: default relaxed (false)
  const isProd = process.env.NODE_ENV === "production";
  const tlsEnv = profile === "monitoring"
    ? optionalEnv(
        "MONITORING_SMTP_TLS_REJECT_UNAUTHORIZED",
        optionalEnv(
          "TX_SMTP_TLS_REJECT_UNAUTHORIZED",
          isProd ? "true" : "false",
        ),
      )
    : optionalEnv(
        "TX_SMTP_TLS_REJECT_UNAUTHORIZED",
        isProd ? "true" : "false",
      );
  const tlsRejectUnauthorized =
    tlsEnv !== "false";

  return { host, port, user, pass, secure, from, tlsRejectUnauthorized };
}

async function sendSmtpMail(mail: TxMail, config: TxSmtpConfig) {
  const identity: TxSmtpCircuitIdentity = {
    host: config.host,
    port: config.port,
    user: config.user,
    pass: config.pass,
    secure: config.secure,
  };

  await assertTxSmtpCircuitClosed(identity);
  const retryGuard = createSmtpHandshakeRetryGuard();

  try {
    const delivery = await withSmtpHandshakeRetry(async (attempt) => {
      // Only a fast TLS alert at CONN can reach the second attempt. Nothing
      // has been authenticated or delivered; never retry an ambiguous send.
      const handshakeTimeout = attempt === 2 ? 5_000 : 15_000;
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.pass },
        connectionTimeout: handshakeTimeout,
        greetingTimeout: handshakeTimeout,
        socketTimeout: 20_000,
        transactionLog: true,
        logger: retryGuard.logger,
        tls: {
          rejectUnauthorized: config.tlsRejectUnauthorized,
        },
      });

      try {
        const remainingMs = mail.deadlineAt ? mail.deadlineAt - Date.now() : null;
        if (remainingMs !== null && remainingMs <= 0) throw Object.assign(new Error("Le délai du worker mail est écoulé avant l’envoi."), {
          code: "TX_SMTP_DELIVERY_DEADLINE", deliveryState: "rejected", retryable: true,
        });
        const sending = transporter.sendMail({
          from: config.from,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          messageId: mail.messageId,
          attachments: (mail.attachments || []).map((attachment) => ({
            filename: attachment.filename || "piece-jointe",
            content: attachment.content,
            contentType: attachment.mimeType || "application/octet-stream",
            cid: attachment.inline ? attachment.cid : undefined,
            contentDisposition: attachment.inline ? "inline" : "attachment",
          })),
        });
        if (remainingMs === null) return await sending;
        let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([sending, new Promise<never>((_resolve, reject) => {
            deadlineTimer = setTimeout(() => {
              transporter.close();
              reject(Object.assign(new Error("Le délai du worker mail est écoulé. L’acceptation doit être vérifiée avant toute reprise."), {
                // SMTPTransport.close() does not attest cancellation of an
                // active send. Once invoked, delivery may continue afterwards.
                code: "TX_SMTP_DELIVERY_DEADLINE", deliveryState: "unknown", retryable: false,
              }));
            }, remainingMs);
          })]);
        } finally {
          if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
        }
      } finally {
        transporter.close();
      }
    }, { canRetry: retryGuard.canRetry });
    await clearTxSmtpCircuit(identity);
    return delivery;
  } catch (error) {
    const failure = error as { code?: unknown; command?: unknown; responseCode?: unknown; response?: unknown } | null;
    const responseCode = Number(failure?.responseCode);
    const negativeDataReply = String(failure?.command || "").toUpperCase() === "DATA" &&
      responseCode >= 400 && responseCode <= 599 &&
      new RegExp(`^${responseCode}(?:[ -]|$)`).test(String(failure?.response || "").trim());
    if (error && typeof error === "object" && String(failure?.command || "").toUpperCase() === "CONN" &&
      ["ETIMEDOUT", "ESOCKET", "ECONNECTION", "EDNS"].includes(String(failure?.code || "")) && retryGuard.canRetry()) {
      // The SMTP logger attests that AUTH/DATA never started. A mislabeled
      // CONN error after authentication must retain its ambiguous outcome.
      Object.assign(error, { deliveryState: "rejected", retryable: true, retryAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    }
    if (error && typeof error === "object" && negativeDataReply) {
      // An explicit negative SMTP reply after DATA certifies non-delivery
      // (RFC 5321 4.2.5); a timeout or reset without that reply stays unknown.
      Object.assign(error, { deliveryState: "rejected", retryable: true, retryAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    }
    await openTxSmtpCircuit(error, identity);
    throw error;
  }
}

export async function sendTxMail(mail: TxMail) {
  let config: TxSmtpConfig;
  try {
    config = loadSmtpConfig("transactional");
  } catch {
    throw Object.assign(new Error("Le transport SMTP principal n’est pas configuré. L’envoi reste à reprendre."), {
      code: "TX_SMTP_CONFIGURATION_UNAVAILABLE", provider: "smtp", deliveryState: "rejected", retryable: true,
      retryAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
  }
  try {
    return await sendSmtpMail(mail, config);
  } catch (error) {
    const failure = error as { command?: unknown; code?: unknown } | null;
    const command = String(failure?.command || "").trim().toUpperCase();
    const authRejected = isTxSmtpAuthenticationFailure(error) &&
      (command.startsWith("AUTH") || (!command && failure?.code === "EAUTH"));
    if (!canUseTxResendFallback() || (!authRejected && !isTxSmtpCircuitOpenError(error))) throw error;
    if (mail.fallbackPolicy === "defer") {
      throw Object.assign(new Error("Ce mail est différé pendant l’indisponibilité du transport SMTP principal."), {
        code: "TX_MAIL_FALLBACK_DEFERRED", provider: "smtp", deliveryState: "rejected", retryable: true,
        retryAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
    }
    return sendTxResendMail(mail, config.from);
  }
}

/** Low-volume internal alerts, isolated from user-facing notifications. */
export async function sendMonitoringMail(mail: TxMail) {
  await sendSmtpMail(mail, loadSmtpConfig("monitoring"));
}

/** Monitoring mail variant used when the caller must verify SMTP recipients. */
export async function sendMonitoringMailWithResult(mail: TxMail) {
  return sendSmtpMail(mail, loadSmtpConfig("monitoring"));
}
