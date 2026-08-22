import "server-only";

import nodemailer from "nodemailer";
import { optionalEnv, requireEnv } from "@/lib/env";
import {
  assertTxSmtpCircuitClosed,
  clearTxSmtpCircuit,
  openTxSmtpCircuit,
  type TxSmtpCircuitIdentity,
} from "@/lib/txSmtpCircuit";

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

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    // Timeouts help surface network issues quickly instead of hanging.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
    tls: {
      rejectUnauthorized: config.tlsRejectUnauthorized,
    },
  });

  try {
    await transporter.sendMail({
      from: config.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: (mail.attachments || []).map((attachment) => ({
        filename: attachment.filename || "piece-jointe",
        content: attachment.content,
        contentType: attachment.mimeType || "application/octet-stream",
        cid: attachment.inline ? attachment.cid : undefined,
        contentDisposition: attachment.inline ? "inline" : "attachment",
      })),
    });
    await clearTxSmtpCircuit(identity);
  } catch (error) {
    await openTxSmtpCircuit(error, identity);
    throw error;
  }
}

export async function sendTxMail(mail: TxMail) {
  return sendSmtpMail(mail, loadSmtpConfig("transactional"));
}

/** Low-volume internal alerts, isolated from user-facing notifications. */
export async function sendMonitoringMail(mail: TxMail) {
  return sendSmtpMail(mail, loadSmtpConfig("monitoring"));
}
