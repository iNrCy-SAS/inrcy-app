import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { withApi } from "@/lib/observability/withApi";
import { fetchWithRetry } from "@/lib/observability/fetch";
import { asRecord, asString, asHttpStatus, safeErrorMessage } from "@/lib/tsSafe";
import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { downloadMailAttachmentRefs, parseMailAttachmentRefs } from "@/lib/mailAttachmentRefs";
import { applyAutoSignatureToHtml, applyAutoSignatureToText, buildInrSendSignature, textToSimpleHtml, type SupabaseLike } from "@/lib/inrsendSignature";
import { normalizeMailSubject } from "@/lib/mailEncoding";
import { stripTemplateSignatureBlock } from "@/lib/mailTemplateCleanup";
import { sanitizeRichMailHtml } from "@/lib/mailRichText";
import { inferInrSendFileRole, saveInrSendHistoryFiles } from "@/lib/inrsend/historyFiles";
import { getConnectionDisplayStatus } from "@/lib/connectionVersions";
import { enforceRateLimit } from "@/lib/rateLimit";
import { normalizeMailDeliveryError } from "@/lib/mailDeliveryErrors";
import { markMailAccountReconnectRequired } from "@/lib/mailAccountReconnect";

// Microsoft Graph mail send requires Node.js runtime in most deployments.
export const runtime = "nodejs";
function isExpired(expires_at?: string | null, skewSeconds = 60) {
  if (!expires_at) return false;
  const t = Date.parse(expires_at);
  if (Number.isNaN(t)) return false;
  return t <= Date.now() + skewSeconds * 1000;
}

async function refreshAccessToken(refreshToken: string, scope?: string | null) {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, status: 500, data: { error: "Configuration Outlook incomplète côté serveur." } };
  }

  const fallbackScope = [
    "openid",
    "profile",
    "email",
    "offline_access",
    "Mail.Read",
    "Mail.ReadWrite",
    "Mail.Send",
  ].join(" ");

  const res = await fetchWithRetry("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: scope || fallbackScope,
    }),
    retries: 2,
    timeoutMs: 15_000,
  });

  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}


const handler = async (req: Request) => {
  try {
    const { supabase, activeUserId, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;
    const userId = activeUserId;

    const rateLimited = await enforceRateLimit({
      name: "microsoft_send",
      identifier: userId,
      limit: 30,
      window: "1 m",
      failClosed: false,
      fallbackLimit: 10,
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
      html = String(formData.get("html") || "");
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
      html = String(body.html || "");
      attachmentRefs = parseMailAttachmentRefs(body.attachments);
    }

    if (!accountId) {
      return NextResponse.json({ error: "Boîte d’envoi manquante." }, { status: 400 });
    }
    if (!to) {
      return NextResponse.json({ error: "Destinataire manquant." }, { status: 400 });
    }

    const { data: account, error: accErr } = await supabase
      .from("integrations")
      .select("id,user_id,provider,account_email,access_token_enc,refresh_token_enc,expires_at,status,settings")
      .eq("id", accountId)
      .eq("user_id", userId)
      .eq("provider", "microsoft")
      .eq("category", "mail")
      .eq("status", "connected")
      .single();

    if (accErr || !account) {
      return NextResponse.json({ error: "La boîte Outlook sélectionnée est introuvable." }, { status: 404 });
    }

    if (getConnectionDisplayStatus(String(asRecord(account)["status"] || "") === "connected", "mail:microsoft", asRecord(account)["settings"]) === "needs_update") {
      return NextResponse.json({ error: "Cette boîte Outlook doit être actualisée avant de pouvoir envoyer." }, { status: 400 });
    }

    const signatureSettings = await buildInrSendSignature({ supabase: supabase as SupabaseLike, userId, account });
    const cleanText = stripTemplateSignatureBlock(text || "");
    const finalText = applyAutoSignatureToText(cleanText, signatureSettings.signatureText);
    const finalHtml = applyAutoSignatureToHtml(sanitizeRichMailHtml(html) || textToSimpleHtml(cleanText), signatureSettings.signatureText, signatureSettings.imageUrl, signatureSettings.imageWidth);

    // Supabase row typing may be '{}' depending on generated types.
    // Parse defensively from unknown to avoid Next.js build-time type errors.
    const accRec = asRecord(account);
    const accountRowId = asString(accRec["id"]) || accountId;
    const expiresAt = asString(accRec["expires_at"]);
    const refreshTokenEnc = asString(accRec["refresh_token_enc"]);
    const accessTokenEnc = asString(accRec["access_token_enc"]);
    const refreshToken: string | null = refreshTokenEnc ? tryDecryptToken(refreshTokenEnc) : null;
    let accessToken: string | null = accessTokenEnc ? tryDecryptToken(accessTokenEnc) : null;

    const settingsRec = asRecord(accRec["settings"]);
    const scopesRaw = asString(settingsRec["scopes_raw"]);

    if (!accessToken) {
      await markMailAccountReconnectRequired({ userId, accountId: accountRowId, reason: "mailbox_access_token_missing" });
      return NextResponse.json({ error: "Jeton d’accès manquant." }, { status: 500 });
    }

    // refresh si expiré
    if (refreshToken && isExpired(expiresAt)) {
      const r = await refreshAccessToken(refreshToken, scopesRaw ?? null);
      if (r.ok && r.data?.access_token) {
        accessToken = String(r.data.access_token);
        const newExpiresAt = r.data?.expires_in
          ? new Date(Date.now() + Number(r.data.expires_in) * 1000).toISOString()
          : null;

        await supabase
          .from("integrations")
          .update({ access_token_enc: encryptToken(accessToken), expires_at: newExpiresAt, status: "connected" })
          .eq("id", accountRowId)
          .eq("user_id", userId);
      }
    }

    const graphAttachments = attachmentRefs.length > 0
      ? (await downloadMailAttachmentRefs(supabase, attachmentRefs)).map((item) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: item.filename,
          contentType: item.mimeType || "application/octet-stream",
          contentBytes: item.content.toString("base64"),
        }))
      : [];

    const graphRes = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: {
            contentType: "HTML",
            content: finalHtml,
          },
          toRecipients: [{ emailAddress: { address: to } }],
          ...(graphAttachments.length > 0 ? { attachments: graphAttachments } : {}),
        },
        saveToSentItems: true,
      }),
    });

    if (!graphRes.ok) {
      const details = await graphRes.text().catch(() => "");
      if (graphRes.status === 401 || graphRes.status === 403) {
        await markMailAccountReconnectRequired({ userId, accountId: accountRowId, reason: "mailbox_oauth_invalid" });
      }
      const normalized = normalizeMailDeliveryError(details || `Envoi Outlook impossible (${graphRes.status})`, "microsoft", graphRes.status);
      return NextResponse.json(
        {
          error: normalized.message,
          user_message: normalized.message,
          error_title: normalized.title,
          error_action: normalized.action,
          error_kind: normalized.kind,
        },
        { status: normalized.accountLevel ? 400 : 502 },
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
      provider: "microsoft",
      provider_message_id: null,
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
        provider: "microsoft",
        source_doc_save_id: sourceDocSaveId || null,
        source_doc_type: sourceDocType || null,
        source_doc_number: sourceDocNumber || null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const normalized = normalizeMailDeliveryError(safeErrorMessage(e) || e || "Impossible d'envoyer le message pour le moment.", "microsoft", asHttpStatus(asRecord(e)["status"], 500));
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

export const POST = withApi(handler, { route: "/api/inbox/microsoft/send" });
