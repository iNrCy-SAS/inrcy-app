import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { enforceRateLimit } from "@/lib/rateLimit";
import { tryDecryptToken, encryptToken } from "@/lib/oauthCrypto";
import { withApi } from "@/lib/observability/withApi";
import { downloadMailAttachmentRefs, parseMailAttachmentRefs } from "@/lib/mailAttachmentRefs";
import { applyAutoSignatureToHtml, applyAutoSignatureToText, buildInrSendSignature, textToSimpleHtml, type SupabaseLike } from "@/lib/inrsendSignature";
import { normalizeMailSubject } from "@/lib/mailEncoding";
import { stripTemplateSignatureBlock } from "@/lib/mailTemplateCleanup";
import { sanitizeRichMailHtml } from "@/lib/mailRichText";
import { inferInrSendFileRole, saveInrSendHistoryFiles } from "@/lib/inrsend/historyFiles";
import { getConnectionDisplayStatus } from "@/lib/connectionVersions";
import { normalizeMailDeliveryError } from "@/lib/mailDeliveryErrors";
import { markMailAccountReconnectRequired } from "@/lib/mailAccountReconnect";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}
function toBase64Url(str: string) {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function wrap76(b64: string) {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

type Attachment = { filename: string; mimeType: string; contentBase64: string };

function buildMimeMessage(opts: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: Attachment[];
}) {
  const text = opts.text ?? "";
  const html = opts.html ?? "";
  const atts = opts.attachments ?? [];

  const headers: string[] = [`To: ${opts.to}`, `Subject: ${opts.subject}`, "MIME-Version: 1.0"];

  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) headers.push(`References: ${opts.references}`);

  // 1) Simple text only
  if (!html && atts.length === 0) {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push("Content-Transfer-Encoding: 7bit");
    const raw = headers.join("\r\n") + "\r\n\r\n" + text;
    return toBase64Url(raw);
  }

  // 2) No attachment -> multipart/alternative (text + html)
  if (atts.length === 0) {
    const altBoundary = `inr_alt_${Date.now()}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);

    const parts = [
      `--${altBoundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 7bit",
      "",
      text || "",
      "",
      `--${altBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: 7bit",
      "",
      html || (text ? `<pre>${text}</pre>` : ""),
      "",
      `--${altBoundary}--`,
      "",
    ].join("\r\n");

    const raw = headers.join("\r\n") + "\r\n\r\n" + parts;
    return toBase64Url(raw);
  }

  // 3) Attachments -> multipart/mixed + (alternative inside)
  const mixedBoundary = `inr_mixed_${Date.now()}`;
  const altBoundary = `inr_alt_${Date.now()}`;

  headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);

  const firstPart = [
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    text || "",
    "",
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    html || (text ? `<pre>${text}</pre>` : ""),
    "",
    `--${altBoundary}--`,
    "",
  ].join("\r\n");

  const attachmentParts = atts
    .map((a) =>
      [
        `--${mixedBoundary}`,
        `Content-Type: ${a.mimeType}; name="${a.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${a.filename}"`,
        "",
        wrap76(a.contentBase64),
        "",
      ].join("\r\n")
    )
    .join("\r\n");

  const ending = `--${mixedBoundary}--\r\n`;

  const raw = headers.join("\r\n") + "\r\n\r\n" + firstPart + attachmentParts + ending;
  return toBase64Url(raw);
}

// ---- refresh helpers (identique à ce que tu as sur /list) ----
function isExpired(expires_at?: string | null, skewSeconds = 60) {
  if (!expires_at) return false;
  const t = Date.parse(expires_at);
  if (Number.isNaN(t)) return false;
  return t <= Date.now() + skewSeconds * 1000;
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  if (!clientId || !clientSecret) {
    return { ok: false, status: 500, data: { error: "Configuration Gmail incomplète côté serveur." } };
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function gmailSend(token: string, raw: string, threadId?: string) {
  const body: Record<string, unknown> = { raw };
  if (threadId) body.threadId = threadId;

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  return { res, data };
}

const handler = async (req: Request) => {
  const { supabase, activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;
  const userId = activeUserId;

  const rl = await enforceRateLimit({ name: "gmail_send", identifier: userId, limit: 30, window: "1 m" });
  if (rl) return rl;
// Support JSON ou multipart/form-data
  let to = "";
  let subject = "(sans objet)";
  let text = "";
  let html = "";
  let threadId = "";
  let accountId = "";
  let sendItemId = "";
  let sendType = "mail";
  let sourceDocSaveId = "";
  let sourceDocType = "";
  let sourceDocNumber = "";
  let inReplyTo = "";
  let references = "";
  const attachments: Attachment[] = [];
  let attachmentRefs: ReturnType<typeof parseMailAttachmentRefs> = [];

  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    accountId = String(fd.get("accountId") || "").trim();
    sendItemId = String(fd.get("sendItemId") || "").trim();
    sendType = String(fd.get("type") || "mail").trim() || "mail";
    sourceDocSaveId = String(fd.get("sourceDocSaveId") || "").trim();
    sourceDocType = String(fd.get("sourceDocType") || "").trim();
    sourceDocNumber = String(fd.get("sourceDocNumber") || "").trim();
    to = String(fd.get("to") || "").trim();
    subject = normalizeMailSubject(String(fd.get("subject") || "").trim() || "(sans objet)");
    text = String(fd.get("text") || "");
    html = String(fd.get("html") || "");
    threadId = String(fd.get("threadId") || "");
    inReplyTo = String(fd.get("inReplyTo") || "");
    references = String(fd.get("references") || "");

    const files = fd.getAll("files") as File[];
    for (const f of files) {
      const buf = Buffer.from(await f.arrayBuffer());
      attachments.push({
        filename: f.name,
        mimeType: f.type || "application/octet-stream",
        contentBase64: buf.toString("base64"),
      });
    }
  } else {
    const body = await req.json().catch(() => ({}));
    accountId = String(body.accountId || "").trim();
    sendItemId = String(body.sendItemId || "").trim();
    sendType = String(body.type || "mail").trim() || "mail";
    sourceDocSaveId = String(body.sourceDocSaveId || "").trim();
    sourceDocType = String(body.sourceDocType || "").trim();
    sourceDocNumber = String(body.sourceDocNumber || "").trim();
    to = String(body.to || "").trim();
    subject = String(body.subject || "").trim() || "(sans objet)";
    text = String(body.text || "");
    html = String(body.html || "");
    threadId = String(body.threadId || "");
    inReplyTo = String(body.inReplyTo || "");
    references = String(body.references || "");
    attachmentRefs = parseMailAttachmentRefs(body.attachments);
  }

  // A send action must always be tied to an explicit sending mailbox.
  // This prevents silent fallbacks to "first account" and avoids history rows with NULL integration_id.
  if (!accountId) {
    return NextResponse.json({ error: "Boîte d’envoi manquante." }, { status: 400 });
  }

  if (!to) return NextResponse.json({ error: "Destinataire manquant." }, { status: 400 });

  let q = supabase
    .from("integrations")
    .select("id,access_token_enc,refresh_token_enc,expires_at,status,created_at,account_email,provider,settings")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .eq("category", "mail");

  q = q.eq("id", accountId);

  const { data: accounts, error: accErr } = await q.order("created_at", { ascending: true }).limit(1);

  if (accErr) return NextResponse.json({ error: getSimpleFrenchErrorMessage(accErr, "Impossible de retrouver la boîte Gmail.") }, { status: 500 });

  const account = accounts?.[0];
  if (!account) return NextResponse.json({ error: "Aucun compte Gmail connecté." }, { status: 400 });
  if (getConnectionDisplayStatus(String(asRecord(account)["status"] || "") === "connected", "mail:gmail", asRecord(account)["settings"]) === "needs_update") {
    return NextResponse.json({ error: "Cette boîte Gmail doit être actualisée avant de pouvoir envoyer." }, { status: 400 });
  }

  const signatureSettings = await buildInrSendSignature({ supabase: supabase as SupabaseLike, userId, account });
  const cleanText = stripTemplateSignatureBlock(text || "");
  const finalText = applyAutoSignatureToText(cleanText, signatureSettings.signatureText);
  const finalHtml = applyAutoSignatureToHtml(sanitizeRichMailHtml(html) || textToSimpleHtml(cleanText), signatureSettings.signatureText, signatureSettings.imageUrl, signatureSettings.imageWidth);


  // ✅ tokens (chiffrés en DB)
  const accessTokenEnc: string | null = asString(asRecord(account)["access_token_enc"]);
  const accessTokenPlain = tryDecryptToken(accessTokenEnc);

  const refreshTokenEnc: string | null = asString(asRecord(account)["refresh_token_enc"]);
  const refreshTokenPlain = tryDecryptToken(refreshTokenEnc);

  if (!accessTokenPlain) {
    await markMailAccountReconnectRequired({ userId, accountId: String(account.id), reason: "mailbox_access_token_missing" });
    return NextResponse.json({ error: "Jeton d’accès manquant." }, { status: 400 });
  }

  // on utilise un token en clair uniquement en mémoire
  let accessToken: string = accessTokenPlain;
  const refreshToken: string | null = refreshTokenPlain;

  // refresh proactif
  if (refreshToken && isExpired(account.expires_at)) {
    const r = await refreshAccessToken(refreshToken);
    if (r.ok && r.data?.access_token) {
      accessToken = String(r.data.access_token);

      const expiresAt =
        r.data.expires_in != null
          ? new Date(Date.now() + Number(r.data.expires_in) * 1000).toISOString()
          : null;

      await supabase
        .from("integrations")
        .update({ access_token_enc: encryptToken(accessToken), expires_at: expiresAt, status: "connected" })
        .eq("id", account.id)
        .eq("user_id", userId);
    }
  }

  if (attachmentRefs.length > 0) {
    const downloaded = await downloadMailAttachmentRefs(supabase, attachmentRefs);
    for (const item of downloaded) {
      attachments.push({
        filename: item.filename,
        mimeType: item.mimeType || "application/octet-stream",
        contentBase64: item.content.toString("base64"),
      });
    }
  }

  const raw = buildMimeMessage({
    to,
    subject,
    text: finalText,
    html: finalHtml,
    inReplyTo: inReplyTo || undefined,
    references: references || undefined,
    attachments,
  });

  // ✅ accessToken est string ici
  let { res: sendRes, data: sendData } = await gmailSend(accessToken, raw, threadId || undefined);

  if ((sendRes.status === 401 || sendRes.status === 403) && refreshToken) {
    const r = await refreshAccessToken(refreshToken);
    if (r.ok && r.data?.access_token) {
      accessToken = String(r.data.access_token);

      const expiresAt =
        r.data.expires_in != null
          ? new Date(Date.now() + Number(r.data.expires_in) * 1000).toISOString()
          : null;

      await supabase
        .from("integrations")
        .update({ access_token_enc: encryptToken(accessToken), expires_at: expiresAt, status: "connected" })
        .eq("id", account.id)
        .eq("user_id", userId);

      const retry = await gmailSend(accessToken, raw, threadId || undefined);
      sendRes = retry.res;
      sendData = retry.data;
    }
  }

  if (!sendRes.ok) {
    if (sendRes.status === 401 || sendRes.status === 403) {
      await supabase.from("integrations").update({ status: "expired" }).eq("id", account.id).eq("user_id", userId);
    }
    const normalized = normalizeMailDeliveryError(sendData || `Envoi Gmail impossible (${sendRes.status})`, "gmail", sendRes.status);
    return NextResponse.json(
      {
        error: normalized.message,
        user_message: normalized.message,
        error_title: normalized.title,
        error_action: normalized.action,
        error_kind: normalized.kind,
      },
      { status: normalized.accountLevel ? 400 : 502 }
    );
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
    provider: "gmail",
    provider_message_id: sendData?.id || null,
    source_doc_save_id: sourceDocSaveId || null,
    source_doc_type: sourceDocType || null,
    source_doc_number: sourceDocNumber || null,
    provider_thread_id: sendData?.threadId || null,
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
      provider: "gmail",
      source_doc_save_id: sourceDocSaveId || null,
      source_doc_type: sourceDocType || null,
      source_doc_number: sourceDocNumber || null,
    },
  });


  return NextResponse.json({
    ok: true,
    id: sendData?.id || null,
    threadId: sendData?.threadId || null,
  });
};

export const POST = withApi(handler, { route: "/api/inbox/gmail/send" });
