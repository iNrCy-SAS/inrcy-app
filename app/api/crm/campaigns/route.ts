import { NextResponse } from "next/server";
import { evaluateCampaignDispatchState } from "@/lib/crmCampaigns";
import { getMailCampaignDeliveryConfig } from "@/lib/mailCampaignPacing";
import { estimateCampaignDurationMs } from "@/lib/mailCampaignReport";
import { resolveMailboxReputationPolicy } from "@/lib/mailboxReputation";
import { requireUser } from "@/lib/requireUser";
import { getCronUserIdFromRequest, isAuthorizedCronRequest } from "@/lib/cronAuth";
import { normalizeCampaignRecipients } from "@/lib/crmRecipients";
import { fetchSuppressedEmailsByUser } from "@/lib/mailSuppression";
import { normalizeMailSubject } from "@/lib/mailEncoding";
import { getConnectionDisplayStatus, mailConnectionKind } from "@/lib/connectionVersions";
import { enforceRateLimit } from "@/lib/rateLimit";
import { inferInrSendFileRole, saveInrSendHistoryFiles } from "@/lib/inrsend/historyFiles";
import { parseMailAttachmentRefs } from "@/lib/mailAttachmentRefs";
import { stripTemplateSignatureBlock } from "@/lib/mailTemplateCleanup";
import { sanitizeRichMailHtml } from "@/lib/mailRichText";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { findSimilarUpcomingScheduledCampaign } from "@/lib/scheduledCampaignDedupe";
import {
  acquireExecutionIdempotencyLock,
  buildCompletedExecutionResponse,
  buildRunningExecutionResponse,
  cleanExecutionIdempotencyKey,
  completeExecutionIdempotencyLock,
  failExecutionIdempotencyLock,
} from "@/lib/executionIdempotency";
import { withApi } from "@/lib/observability/withApi";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";

export const runtime = "nodejs";

const CAMPAIGN_IDEMPOTENCY_SCOPE = "mail_campaign_create";
const CAMPAIGN_IDEMPOTENCY_TTL_MS = 30 * 60 * 1000;

type CampaignRecipientRow = {
  campaign_id: string;
  user_id: string;
  contact_id: string | null;
  display_name: string | null;
  email: string;
  dispatch_key: string;
  status: "queued";
};

type CampaignFolder =
  | "mails"
  | "factures"
  | "devis"
  | "publications"
  | "recoltes"
  | "offres"
  | "informations"
  | "suivis"
  | "enquetes"
  | "propulsions"
  | "fidelisations";

const ALLOWED_FOLDERS = new Set<CampaignFolder>([
  "mails",
  "factures",
  "devis",
  "publications",
  "recoltes",
  "offres",
  "informations",
  "suivis",
  "enquetes",
  "propulsions",
  "fidelisations",
]);

function normalizeCampaignFolder(input: unknown, fallback: CampaignFolder): CampaignFolder {
  const value = String(input || "").trim().toLowerCase() as CampaignFolder;
  return ALLOWED_FOLDERS.has(value) ? value : fallback;
}

const CAMPAIGN_ORIGIN_LABELS: Record<string, string> = {
  inr_agent: "iNr'Agent",
  inrsend_scheduled: "Mail programmé",
  propulser_scheduled: "Propulser programmé",
  fideliser_scheduled: "Fidéliser programmé",
  booster_scheduled: "Booster programmé",
  booster_manual: "Booster",
  manual: "Manuel",
};

function cleanCampaignMetadataString(value: unknown, maxLength = 180) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeCampaignMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const source = cleanCampaignMetadataString(raw.source, 80);
  if (!source || !CAMPAIGN_ORIGIN_LABELS[source]) return {};
  return {
    source,
    label:
      cleanCampaignMetadataString(raw.label, 120) ||
      CAMPAIGN_ORIGIN_LABELS[source],
    agentActionId: cleanCampaignMetadataString(raw.agentActionId, 120) || null,
    scheduledActionId:
      cleanCampaignMetadataString(raw.scheduledActionId, 120) || null,
    automationKey: cleanCampaignMetadataString(raw.automationKey, 80) || null,
    targetTool: cleanCampaignMetadataString(raw.targetTool, 80) || null,
    actionType: cleanCampaignMetadataString(raw.actionType, 80) || null,
    workflowTool: cleanCampaignMetadataString(raw.workflowTool, 80) || null,
    workflowAction: cleanCampaignMetadataString(raw.workflowAction, 80) || null,
    theme: cleanCampaignMetadataString(raw.theme, 120) || null,
    runMode: cleanCampaignMetadataString(raw.runMode, 80) || null,
    idempotencyKey:
      cleanCampaignMetadataString(raw.idempotencyKey || raw.idempotency_key, 180) ||
      null,
  };
}

function isMissingMetadataColumnError(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42703" && message.includes("metadata");
}

function isMissingStep4CampaignColumnError(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42703" && (
    message.includes("progress_percent")
    || message.includes("estimated_completion_at")
    || message.includes("report_summary")
    || message.includes("completion_email_status")
  );
}

const HARD_MAX_CAMPAIGN_RECIPIENTS = 300;

function getMaxCampaignRecipients() {
  const raw = Number(process.env.CRM_CAMPAIGN_MAX_RECIPIENTS || String(HARD_MAX_CAMPAIGN_RECIPIENTS));
  if (!Number.isFinite(raw) || raw <= 0) return HARD_MAX_CAMPAIGN_RECIPIENTS;
  return Math.max(1, Math.min(HARD_MAX_CAMPAIGN_RECIPIENTS, Math.floor(raw)));
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

async function resolveCampaignRequestUser(req: Request) {
  const cronUserId = isAuthorizedCronRequest(req) ? getCronUserIdFromRequest(req) : "";
  if (cronUserId) {
    return {
      supabase: supabaseAdmin as any,
      user: { id: cronUserId },
      authUserId: cronUserId,
      activeUserId: cronUserId,
      errorResponse: null as NextResponse | null,
      isCron: true,
    };
  }

  const auth = await requireUser();
  return { ...auth, isCron: false };
}

function parseCampaignRecipientStats(input: unknown) {
  const values = Array.isArray(input) ? input : [];
  let invalidCount = 0;
  let duplicateCount = 0;
  const seen = new Set<string>();

  for (const item of values) {
    if (typeof item === "string") {
      for (const part of item.split(/[;,\n\r]+/g)) {
        const email = part.trim();
        if (!email) continue;
        const lower = email.toLowerCase();
        if (!SIMPLE_EMAIL_RE.test(email)) {
          invalidCount += 1;
          continue;
        }
        if (seen.has(lower)) {
          duplicateCount += 1;
          continue;
        }
        seen.add(lower);
      }
      continue;
    }

    if (!item || typeof item !== "object") {
      invalidCount += 1;
      continue;
    }

    const email = String((item as any).email || "").trim();
    const lower = email.toLowerCase();
    if (!email || !SIMPLE_EMAIL_RE.test(email)) {
      invalidCount += 1;
      continue;
    }
    if (seen.has(lower)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(lower);
  }

  return { duplicateCount, invalidCount };
}

function buildCampaignIdempotencyKey(args: {
  body: any;
  metadata: Record<string, unknown>;
}) {
  return cleanExecutionIdempotencyKey(
    args.body.idempotencyKey ||
      args.body.idempotency_key ||
      args.metadata.idempotencyKey ||
      args.metadata.idempotency_key,
  );
}

function buildCampaignIdempotencyMetadata(args: {
  accountId: string;
  subject: string;
  folder: CampaignFolder;
  trackKind: string | null;
  trackType: string;
  recipientCount: number;
  source: string | null;
}) {
  return {
    workflow: "mail_campaign_create",
    accountId: args.accountId,
    subject: args.subject,
    folder: args.folder,
    trackKind: args.trackKind,
    trackType: args.trackType || null,
    recipientCount: args.recipientCount,
    source: args.source || null,
  };
}

function formatCampaignDuplicateScheduledAt(value?: string | null) {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) return "prochainement";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(time));
}

function buildCampaignDuplicateMessage(
  duplicate: Awaited<ReturnType<typeof findSimilarUpcomingScheduledCampaign>>,
) {
  const dateLabel = formatCampaignDuplicateScheduledAt(duplicate.existingScheduledAt);
  const recipientLabel = duplicate.recipientCount
    ? ` pour ${duplicate.recipientCount} destinataire${duplicate.recipientCount > 1 ? "s" : ""}`
    : "";
  return `Cette campagne semble déjà programmée${recipientLabel} pour ${dateLabel}. Pour éviter un double envoi, annulez la programmation existante ou modifiez le contenu avant d’envoyer maintenant.`;
}

async function createCampaignHandler(req: Request) {
  const { supabase, activeUserId, errorResponse, isCron } = await resolveCampaignRequestUser(req);
  if (errorResponse) return errorResponse;

  if (!isCron) {
    const rateLimited = await enforceRateLimit({
      name: "crm_campaign_create",
      identifier: activeUserId,
      limit: 10,
      window: "10 m",
      failClosed: false,
    });
    if (rateLimited) return rateLimited;
  }

  const body = await req.json().catch(() => ({}));
  const accountId = String(body.accountId || "").trim();
  const type = String(body.type || "mail").trim() || "mail";
  const subject = normalizeMailSubject(String(body.subject || "").trim() || "(sans objet)");
  const text = stripTemplateSignatureBlock(String(body.text || ""));
  const html = sanitizeRichMailHtml(String(body.html || ""));
  const sourceDocSaveId = String(body.sourceDocSaveId || "").trim();
  const sourceDocType = String(body.sourceDocType || "").trim();
  const sourceDocNumber = String(body.sourceDocNumber || "").trim();
  const trackKindRaw = String(body.trackKind || "").trim().toLowerCase();
  const trackType = String(body.trackType || "").trim();
  const templateKey = String(body.templateKey || "").trim();
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  const metadata = normalizeCampaignMetadata(body.metadata);
  const normalizedRecipients = normalizeCampaignRecipients(body.recipients);
  const recipientStats = parseCampaignRecipientStats(body.recipients);

  if (!accountId) {
    return NextResponse.json({ error: "Boîte d’envoi manquante." }, { status: 400 });
  }
  if (normalizedRecipients.length === 0) {
    return NextResponse.json({ error: "Aucun destinataire valide." }, { status: 400 });
  }

  const maxRecipients = getMaxCampaignRecipients();
  if (normalizedRecipients.length > maxRecipients) {
    return NextResponse.json(
      { error: `Campagne trop volumineuse. Maximum autorisé : ${maxRecipients} destinataires.` },
      { status: 413 },
    );
  }

  const defaultFolder: CampaignFolder = type === "facture" ? "factures" : type === "devis" ? "devis" : "mails";
  const folder = normalizeCampaignFolder(body.folder, defaultFolder);
  const trackKind = trackKindRaw === "booster" || trackKindRaw === "propulser" || trackKindRaw === "fideliser" ? trackKindRaw : null;

  const { data: account, error: accountError } = await supabase
    .from("integrations")
    .select("id,user_id,provider,category,status,account_email,settings")
    .eq("id", accountId)
    .eq("user_id", activeUserId)
    .eq("category", "mail")
    .eq("status", "connected")
    .maybeSingle();

  if (accountError) {
    return NextResponse.json({ error: getSimpleFrenchErrorMessage(accountError, "Impossible de retrouver la boîte d’envoi.") }, { status: 500 });
  }
  if (!account?.id || !account?.provider) {
    return NextResponse.json({ error: "La boîte d’envoi sélectionnée est introuvable." }, { status: 404 });
  }

  const mailKind = mailConnectionKind(account.provider);
  const mailConnectionStatus = mailKind
    ? getConnectionDisplayStatus(true, mailKind, account.settings)
    : "connected";
  if (mailConnectionStatus === "needs_update") {
    return NextResponse.json({ error: "Cette boîte d’envoi doit être actualisée avant de pouvoir envoyer." }, { status: 400 });
  }

  const suppressedByEmail = await fetchSuppressedEmailsByUser(
    activeUserId,
    normalizedRecipients.map((recipient) => recipient.email),
  );

  let blockedOptOut = 0;
  let blockedBlacklist = 0;
  let blockedHardBounce = 0;
  let blockedComplaint = 0;

  const recipients = normalizedRecipients.filter((recipient) => {
    const suppression = suppressedByEmail.get(recipient.email.toLowerCase());
    if (!suppression?.reason) return true;
    if (suppression.reason === "opt_out") blockedOptOut += 1;
    else if (suppression.reason === "blacklist") blockedBlacklist += 1;
    else if (suppression.reason === "hard_bounce") blockedHardBounce += 1;
    else if (suppression.reason === "complaint") blockedComplaint += 1;
    return false;
  });

  if (recipients.length === 0) {
    const blockedParts = [
      blockedOptOut > 0 ? `${blockedOptOut} désinscription${blockedOptOut > 1 ? "s" : ""}` : null,
      blockedBlacklist > 0 ? `${blockedBlacklist} blacklist` : null,
      blockedHardBounce > 0 ? `${blockedHardBounce} rebond${blockedHardBounce > 1 ? "s" : ""} dur${blockedHardBounce > 1 ? "s" : ""}` : null,
      blockedComplaint > 0 ? `${blockedComplaint} plainte${blockedComplaint > 1 ? "s" : ""}` : null,
    ].filter(Boolean);
    return NextResponse.json(
      { error: blockedParts.length ? `Tous les destinataires sont bloqués (${blockedParts.join(", ")}).` : "Aucun destinataire autorisé." },
      { status: 400 },
    );
  }
  const campaignIdempotencyKey = buildCampaignIdempotencyKey({
    body,
    metadata,
  });
  const isScheduledCampaignExecution =
    isCron ||
    campaignIdempotencyKey.startsWith("scheduled_campaign:") ||
    body.skipScheduledDuplicateCheck === true ||
    body.allowDuplicateCampaignSend === true;

  if (!isScheduledCampaignExecution) {
    const duplicate = await findSimilarUpcomingScheduledCampaign({
      supabase: supabaseAdmin,
      userId: activeUserId,
      payload: {
        accountId,
        type,
        subject,
        text,
        html,
        recipients,
        folder,
        trackKind,
        trackType,
        attachments,
      },
    });

    if (duplicate.duplicate) {
      const message = buildCampaignDuplicateMessage(duplicate);
      return NextResponse.json(
        {
          ok: false,
          success: false,
          error: message,
          user_message: message,
          code: "scheduled_campaign_duplicate",
          duplicate,
        },
        { status: 409 },
      );
    }
  }

  const campaignIdempotency = campaignIdempotencyKey
    ? await acquireExecutionIdempotencyLock({
        supabase: supabaseAdmin,
        userId: activeUserId,
        scope: CAMPAIGN_IDEMPOTENCY_SCOPE,
        idempotencyKey: campaignIdempotencyKey,
        ttlMs: CAMPAIGN_IDEMPOTENCY_TTL_MS,
        metadata: buildCampaignIdempotencyMetadata({
          accountId,
          subject,
          folder,
          trackKind,
          trackType,
          recipientCount: recipients.length,
          source: String(metadata.source || "").trim() || null,
        }),
      })
    : { state: "acquired" as const, lock: null };

  if (campaignIdempotency.state === "completed") {
    return NextResponse.json(
      buildCompletedExecutionResponse(campaignIdempotency.lock),
    );
  }

  if (campaignIdempotency.state === "running") {
    return NextResponse.json(
      buildRunningExecutionResponse(campaignIdempotency.lock),
      {
        status: 425,
        headers: { "Retry-After": "60" },
      },
    );
  }

  const campaignIdempotencyLockId = campaignIdempotency.lock?.id || null;
  const campaignMetadata: Record<string, unknown> = {
    ...metadata,
    ...(campaignIdempotencyKey
      ? {
          idempotencyKey: campaignIdempotencyKey,
          idempotencyScope: CAMPAIGN_IDEMPOTENCY_SCOPE,
        }
      : {}),
  };

  const reputationPolicy = await resolveMailboxReputationPolicy({
    userId: activeUserId,
    integrationId: accountId,
    provider: account.provider,
    accountEmail: String(account.account_email || "").trim() || null,
    settings: account.settings && typeof account.settings === "object" ? account.settings as Record<string, unknown> : null,
  });
  const deliveryConfig = reputationPolicy.config || getMailCampaignDeliveryConfig();
  const dispatchState = reputationPolicy.blocked
    ? {
        state: "paused" as const,
        reason: reputationPolicy.blockedReason,
        pauseReason: "mailbox_reputation_paused",
        resumeAt: reputationPolicy.resumeAt,
      }
    : await evaluateCampaignDispatchState({
        userId: activeUserId,
        integrationId: accountId,
        config: deliveryConfig,
      });
  const now = new Date().toISOString();
  campaignMetadata.mailboxReputation = {
    mode: reputationPolicy.mode,
    healthStatus: reputationPolicy.healthStatus,
    domain: reputationPolicy.domainAudit?.domain || null,
    spf: reputationPolicy.domainAudit?.spf || null,
    dkim: reputationPolicy.domainAudit?.dkim || null,
    dmarc: reputationPolicy.domainAudit?.dmarc || null,
    warnings: reputationPolicy.domainAudit?.warnings || [],
  };
  const initialStatus = dispatchState.state === "paused" ? "paused" : "queued";
  const initialLastError = dispatchState.state === "ready" ? null : dispatchState.reason;
  const estimatedDurationMs = estimateCampaignDurationMs({
    remaining: recipients.length,
    config: deliveryConfig,
    resumeAt: dispatchState.resumeAt,
  });
  const estimatedCompletionAt = new Date(Date.now() + estimatedDurationMs).toISOString();

  const campaignInsertPayload: Record<string, unknown> = {
    user_id: activeUserId,
    integration_id: accountId,
    provider: account.provider,
    type,
    subject,
    body_text: text,
    body_html: html || null,
    attachments,
    metadata: campaignMetadata,
    status: initialStatus,
    total_count: recipients.length,
    queued_count: recipients.length,
    sent_count: 0,
    failed_count: 0,
    source_doc_save_id: sourceDocSaveId || null,
    source_doc_type: sourceDocType || null,
    source_doc_number: sourceDocNumber || null,
    folder,
    track_kind: trackKind,
    track_type: trackType || null,
    template_key: templateKey || null,
    started_at: null,
    finished_at: null,
    last_error: initialLastError,
    pause_reason: dispatchState.pauseReason,
    resume_at: dispatchState.resumeAt,
    progress_percent: 0,
    estimated_completion_at: estimatedCompletionAt,
    report_summary: {},
    report_updated_at: now,
    completion_email_status: "pending",
    created_at: now,
    updated_at: now,
    last_activity_at: now,
  };

  let { data: campaign, error: campaignError } = await supabase
    .from("mail_campaigns")
    .insert(campaignInsertPayload)
    .select("id,status")
    .single();

  if (campaignError && (isMissingMetadataColumnError(campaignError) || isMissingStep4CampaignColumnError(campaignError))) {
    // Repli de déploiement : une migration optionnelle manquante ne bloque pas
    // la création de la campagne. Les fonctions avancées s'activent après SQL.
    const legacyCampaignInsertPayload = { ...campaignInsertPayload };
    if (isMissingMetadataColumnError(campaignError)) delete legacyCampaignInsertPayload.metadata;
    delete legacyCampaignInsertPayload.progress_percent;
    delete legacyCampaignInsertPayload.estimated_completion_at;
    delete legacyCampaignInsertPayload.report_summary;
    delete legacyCampaignInsertPayload.report_updated_at;
    delete legacyCampaignInsertPayload.completion_email_status;
    const legacyInsert = await supabase
      .from("mail_campaigns")
      .insert(legacyCampaignInsertPayload)
      .select("id,status")
      .single();
    campaign = legacyInsert.data;
    campaignError = legacyInsert.error;
  }

  if (campaignError || !campaign?.id) {
    const errorMessage = campaignError?.message || "Création de campagne impossible.";
    await failExecutionIdempotencyLock({
      supabase: supabaseAdmin,
      lockId: campaignIdempotencyLockId,
      error: errorMessage,
      result: { success: false, error: errorMessage },
      metadata: { stage: "campaign_insert" },
    });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }

  await saveInrSendHistoryFiles(supabase, {
    userId: activeUserId,
    historySource: "mail_campaigns",
    historyId: campaign.id,
    category: folder,
    fileRole: inferInrSendFileRole({ sourceDocType }),
    files: parseMailAttachmentRefs(attachments),
    metadata: {
      provider: account.provider || null,
      source_doc_save_id: sourceDocSaveId || null,
      source_doc_type: sourceDocType || null,
      source_doc_number: sourceDocNumber || null,
      ...(campaignMetadata.source ? { origin: campaignMetadata } : {}),
    },
  });

  const rows: CampaignRecipientRow[] = recipients.map((recipient) => ({
    campaign_id: campaign.id,
    user_id: activeUserId,
    contact_id: recipient.contact_id || null,
    display_name: recipient.display_name || null,
    email: recipient.email,
    dispatch_key: `${campaign.id}:${recipient.email.trim().toLowerCase()}`,
    status: "queued",
  }));

  for (const chunk of chunkArray(rows, 500)) {
    const { error } = await supabase
      .from("mail_campaign_recipients")
      .upsert(chunk, { onConflict: "dispatch_key", ignoreDuplicates: true });
    if (error) {
      const safeErrorMessage = getSimpleFrenchErrorMessage(error, "Impossible de préparer les destinataires de la campagne.");
      await supabase.from("mail_campaigns").delete().eq("id", campaign.id).eq("user_id", activeUserId);
      await failExecutionIdempotencyLock({
        supabase: supabaseAdmin,
        lockId: campaignIdempotencyLockId,
        error: safeErrorMessage,
        result: { success: false, error: safeErrorMessage, campaignId: campaign.id },
        metadata: { stage: "recipients_insert" },
      });
      return NextResponse.json({ error: safeErrorMessage }, { status: 500 });
    }
  }

  const responsePayload = {
    success: true,
    campaignId: campaign.id,
    campaignStatus: initialStatus,
    distributionState: dispatchState.state,
    deferredReason: dispatchState.reason,
    resumeAt: dispatchState.resumeAt,
    queued: recipients.length,
    blockedDuplicates: recipientStats.duplicateCount,
    ignoredInvalid: recipientStats.invalidCount,
    blockedOptOut,
    blockedBlacklist,
    blockedHardBounce,
    blockedComplaint,
    batchSize: dispatchState.state === "ready" ? Math.max(1, dispatchState.availableNow) : deliveryConfig.batchSize,
    hourlyLimit: deliveryConfig.hourlyLimit,
    dailyLimit: deliveryConfig.dailyLimit,
    activeLimit: deliveryConfig.maxActivePerIntegration,
    mailboxHealthStatus: reputationPolicy.healthStatus,
    mailboxPacingMode: reputationPolicy.mode,
    domainAuthentication: reputationPolicy.domainAudit,
    estimatedDurationMs,
    estimatedCompletionAt,
    pacing: {
      delayMs: deliveryConfig.sendDelayMs,
      batchPauseMs: deliveryConfig.batchPauseMs,
    },
    queuedForBackgroundDispatch: true,
    idempotencyKey: campaignIdempotencyKey || null,
    idempotencyLockId: campaignIdempotencyLockId || null,
  };

  await completeExecutionIdempotencyLock({
    supabase: supabaseAdmin,
    lockId: campaignIdempotencyLockId,
    result: responsePayload,
    metadata: {
      campaignId: campaign.id,
      status: initialStatus,
      recipientCount: recipients.length,
    },
  });

  return NextResponse.json(responsePayload);
}

export const POST = withApi(createCampaignHandler, { route: "/api/crm/campaigns" });
