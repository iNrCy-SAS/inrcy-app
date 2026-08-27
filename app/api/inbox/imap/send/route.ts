import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import nodemailer from "nodemailer";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - nodemailer exposes this internal helper and it's stable in practice
import MailComposer from "nodemailer/lib/mail-composer";
import { loadImapAccount } from "@/lib/imapAccount";
import { appendRawMessage, type ImapConfig } from "@/lib/imapClient";
import { withApi } from "@/lib/observability/withApi";
import { asRecord, asString, asHttpStatus, safeErrorMessage } from "@/lib/tsSafe";
import { downloadMailAttachmentRefs, parseMailAttachmentRefs } from "@/lib/mailAttachmentRefs";
import { applyAutoSignatureToHtml, applyAutoSignatureToText, buildInrSendSignature, textToSimpleHtml, type SupabaseLike } from "@/lib/inrsendSignature";
import { normalizeMailSubject } from "@/lib/mailEncoding";
import { stripTemplateSignatureBlock } from "@/lib/mailTemplateCleanup";
import { sanitizeRichMailHtml } from "@/lib/mailRichText";
import { inferInrSendFileRole, saveInrSendHistoryFiles } from "@/lib/inrsend/historyFiles";
import { enforceRateLimit } from "@/lib/rateLimit";
import { normalizeMailDeliveryError } from "@/lib/mailDeliveryErrors";
import { isMailAuthenticationFailure, markMailAccountReconnectRequired } from "@/lib/mailAccountReconnect";


// IMAP + SMTP require Node.js runtime (Edge runtime can't open raw TCP sockets)
export const runtime = "nodejs";

const handler = async (req: Request) => {
  let scopedUserId = "";
  let scopedAccountId = "";
  try {
    const { supabase, activeUserId, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;
    const userId = activeUserId;
    scopedUserId = userId;

    const rateLimited = await enforceRateLimit({
      name: "imap_send",
      identifier: userId,
      limit: 30,
      window: "1 m",
      failClosed: true,
    });
    if (rateLimited) return rateLimited;
    const ct = req.headers.get("content-type") || "";
    let accountId = "";
    let sendItemId = "";
    let sendType = "mail";
    let sourceDocSaveId = "";
    let sourceDocType = "";
    let sourceDocNumber = "";
    let to = "";
    let subject = "(sans objet)";
    let text = "";
    let html = "";
    let attachmentRefs: ReturnType<typeof parseMailAttachmentRefs> = [];
    let attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [];

    if (ct.includes("multipart/form-data")) {
      const formData = await req.formData();
      accountId = String(formData.get("accountId") || "").trim();
      sendItemId = String(formData.get("sendItemId") || "").trim();
      sendType = String(formData.get("type") || "mail").trim() || "mail";
      sourceDocSaveId = String(formData.get("sourceDocSaveId") || "").trim();
      sourceDocType = String(formData.get("sourceDocType") || "").trim();
      sourceDocNumber = String(formData.get("sourceDocNumber") || "").trim();
      to = String(formData.get("to") || "").trim();
      subject = normalizeMailSubject(String(formData.get("subject") || "(sans objet)"));
      text = String(formData.get("text") || "");
      html = String(formData.get("html") || "").trim();

      const files = formData.getAll("files") as File[];
      attachments = await Promise.all(
        (files || [])
          .filter((f) => f && typeof asRecord(f)["arrayBuffer"] === "function")
          .map(async (f) => {
            const ab = await f.arrayBuffer();
            return {
              filename: f.name || "piece-jointe",
              content: Buffer.from(ab),
              contentType: f.type || undefined,
            };
          })
      );
    } else {
      const body = await req.json().catch(() => ({}));
      accountId = String(body.accountId || "").trim();
      sendItemId = String(body.sendItemId || "").trim();
      sendType = String(body.type || "mail").trim() || "mail";
    sourceDocSaveId = String(body.sourceDocSaveId || "").trim();
    sourceDocType = String(body.sourceDocType || "").trim();
    sourceDocNumber = String(body.sourceDocNumber || "").trim();
      to = String(body.to || "").trim();
      subject = normalizeMailSubject(String(body.subject || "(sans objet)"));
      text = String(body.text || "");
      html = String(body.html || "").trim();
      attachmentRefs = parseMailAttachmentRefs(body.attachments);
    }

    if (!accountId) {
      return NextResponse.json({ error: "Boîte d’envoi manquante." }, { status: 400 });
    }
    scopedAccountId = accountId;
    if (!to) {
      return NextResponse.json({ error: "Destinataire manquant." }, { status: 400 });
    }

    const acc: unknown = await loadImapAccount(accountId);
    const accRec = asRecord(acc);
    if (!accRec["ok"]) {
      return NextResponse.json(
        { error: asString(accRec["error"]) || "Accès non autorisé." },
        { status: asHttpStatus(accRec["status"], 401) }
      );
    }


    const signatureSettings = await buildInrSendSignature({ supabase: supabase as SupabaseLike, userId, account: accRec });
    const cleanText = stripTemplateSignatureBlock(text || "");
    const finalText = applyAutoSignatureToText(cleanText, signatureSettings.signatureText);
    const finalHtml = applyAutoSignatureToHtml(sanitizeRichMailHtml(html) || textToSimpleHtml(cleanText), signatureSettings.signatureText, signatureSettings.imageUrl, signatureSettings.imageWidth);

    if (attachmentRefs.length > 0) {
      const downloaded = await downloadMailAttachmentRefs(supabase, attachmentRefs);
      attachments = downloaded.map((item) => ({
        filename: item.filename,
        content: item.content,
        contentType: item.mimeType || undefined,
      }));
    }

    // loadImapAccount() returns { smtp: { user, password, host, port, secure, starttls } }
    const smtp = asRecord(accRec["smtp"]);
    const imap = asRecord(accRec["imap"]);

    const imapCfg: ImapConfig = {
      user: String(imap.user || ""),
      password: String(imap.password || ""),
      host: String(imap.host || ""),
      port: Number(imap.port || 0),
      secure: typeof imap.secure === "boolean" ? imap.secure : Number(imap.port) === 993,
    };

    // Strict validation: IMAP alone is not enough, SMTP is required to send
    if (!smtp?.host || !smtp?.port || !smtp?.user || !smtp?.password) {
      return NextResponse.json(
        { error: "La configuration d'envoi de la messagerie est incomplète." },
        { status: 400 }
      );
    }

    const secure = typeof smtp.secure === "boolean" ? smtp.secure : Number(smtp.port) === 465;

    const transporter = nodemailer.createTransport({
      host: String(smtp.host),
      port: Number(smtp.port),
      secure,
      auth: { user: String(smtp.user), pass: String(smtp.password) },

      // STARTTLS (usually port 587)
      requireTLS: !!smtp.starttls,

      // DEV only: avoid self-signed certificate issues on some providers
      tls:
        process.env.NODE_ENV === "development"
          ? { rejectUnauthorized: false }
          : undefined,
    });

    const fromName = String(imapCfg.user || smtp.user);
    const from = `"${fromName}" <${String(smtp.user)}>`;

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: finalText,
      html: finalHtml,
      attachments,
    });

    // IMPORTANT: SMTP send does NOT automatically create a copy in IMAP "Sent" on many providers (OVH/SFR/...)
    // So we build a raw MIME and append it to the Sent mailbox through IMAP.
    try {
      const raw = await new Promise<Buffer>((resolve, reject) => {
        const mc = new MailComposer({
          from,
          to,
          subject,
          text: finalText,
          html: finalHtml,
          attachments,
          // Keep a simple, widely supported encoding
          date: new Date(),
        });
        mc.compile().build((err: unknown, message: Buffer) => {
          if (err) return reject(err);
          resolve(message);
        });
      });

      // Best-effort: do not fail the whole request if append fails
      // Only attempt IMAP append when the config looks valid
      if (imapCfg.host && imapCfg.port && imapCfg.user && imapCfg.password) {
        await appendRawMessage(imapCfg, "sent", raw);
      }
    } catch {
      // ignore
    }

    // --- iNr'Send history (Supabase) ---
    const historyPayload = {
      user_id: userId,
      integration_id: accountId,
      type: (sendType as unknown) || "mail",
      status: "sent",
      to_emails: to,
      subject: subject || null,
      body_text: finalText || null,
      body_html: finalHtml || null,
      provider: "imap",
      provider_message_id: info?.messageId || null,
      source_doc_save_id: sourceDocSaveId || null,
      source_doc_type: sourceDocType || null,
      source_doc_number: sourceDocNumber || null,
      provider_thread_id: null,
      sent_at: new Date().toISOString(),
      error: null,
    };

    let historyId = sendItemId || "";
    if (sendItemId) {
      await supabase.from("send_items").update(historyPayload).eq("id", sendItemId).eq("user_id", userId);
    } else {
      const { data: insertedHistory } = await supabase.from("send_items").insert(historyPayload).select("id").single();
      historyId = String(insertedHistory?.id || "");
    }

    await saveInrSendHistoryFiles(supabase, {
      userId,
      historySource: "send_items",
      historyId,
      category: sendType === "facture" ? "factures" : sendType === "devis" ? "devis" : "mails",
      fileRole: inferInrSendFileRole({ sourceDocType }),
      files: attachmentRefs,
      metadata: {
        provider: "imap",
        source_doc_save_id: sourceDocSaveId || null,
        source_doc_type: sourceDocType || null,
        source_doc_number: sourceDocNumber || null,
      },
    });

    return NextResponse.json({ success: true, id: info.messageId });
  } catch (e: unknown) {
    if (scopedUserId && scopedAccountId && isMailAuthenticationFailure(e)) {
      await markMailAccountReconnectRequired({
        userId: scopedUserId,
        accountId: scopedAccountId,
        reason: "mailbox_authentication_failed",
      }).catch(() => undefined);
    }
    const normalized = normalizeMailDeliveryError(safeErrorMessage(e) || e || "Impossible d'envoyer le message pour le moment.", "imap");
    return NextResponse.json(
      {
        error: normalized.message,
        user_message: normalized.message,
        error_title: normalized.title,
        error_action: normalized.action,
        error_kind: normalized.kind,
      },
      { status: normalized.accountLevel ? 400 : 500 }
    );
  }
};

export const POST = withApi(handler, { route: "/api/inbox/imap/send" });
