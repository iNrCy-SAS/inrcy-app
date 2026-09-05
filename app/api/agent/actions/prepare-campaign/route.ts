import { NextResponse } from "next/server";
import { getTemplates, type TemplateAction } from "@/lib/messageTemplates";
import { textToRichMailHtml } from "@/lib/mailRichText";
import { normalizeMailSubject } from "@/lib/mailEncoding";
import { stripTemplateSignatureBlock } from "@/lib/mailTemplateCleanup";
import { resolveInrAgentActionRequest } from "@/lib/inrAgentRequest";
import { enforceRateLimit } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decodeBusinessSector } from "@/lib/activitySectors";
import { getJobLabel } from "@/lib/activityCatalog";
import {
  sanitizeInrAgentAutomationSettings,
  type InrAgentAutomationKey,
  type InrAgentAutomationSettings,
  type InrAgentRecipientScope,
  type InrAgentTheme,
  type InrAgentValidationMode,
} from "@/lib/inrAgentSettings";
import { rowToInrAgentAction } from "@/lib/inrAgentActions";
import { generateTemplateAiContent, TemplateAiGenerationError } from "@/lib/templateAiGeneration";
import { getAiProfessionalGenerationContext } from "@/lib/aiProfessionalGenerationContext";
import { buildInrAgentCampaignValidationEmail } from "@/lib/inrAgentCampaignValidationEmail";
import { getInrcyBrandInlineAttachments } from "@/lib/txEmailAssets";
import { sendTxMail } from "@/lib/txMailer";
import { optionalEnv } from "@/lib/env";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import {
  getDashboardEditionForAuthUser,
  getDashboardEditionsForAccountIds,
  premiumRequiredApiResponse,
} from "@/lib/dashboardEditionServer";

export const maxDuration = 120;
export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;
type CampaignAutomationKey = Extract<InrAgentAutomationKey, "grow" | "loyalty">;

type AutomationDbRow = {
  enabled?: boolean | null;
  frequency?: string | null;
  day_of_week?: number | null;
  time?: string | null;
  validation_mode?: string | null;
  allowed_channels?: string[] | null;
  allowed_themes?: string[] | null;
  use_image_bank?: boolean | null;
  image_required?: boolean | null;
  recipient_scope?: string | null;
  source_strategy?: string | null;
  last_prepared_at?: string | null;
  last_executed_at?: string | null;
  next_run_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

type CampaignRecipient = {
  contact_id: string | null;
  display_name: string | null;
  email: string;
  contact_type?: string | null;
  company_name?: string | null;
};

const ACTION_SELECT =
  "id, automation_key, action_type, target_tool, title, summary, preview_text, target_channels, target_themes, recipients, image_assets, payload, validation_required, execution_policy, status, scheduled_for, prepared_at, validated_at, refused_at, completed_at, last_error, created_at, updated_at";

const campaignThemeMap = {
  grow: {
    validThemes: ["valoriser", "recolter", "offrir"],
    tool: "propulser",
    trackKind: "propulser",
    defaultScope: "all_crm",
    themes: {
      valoriser: {
        label: "Valoriser",
        templateAction: "valoriser",
        templateModule: "propulser",
        folder: "propulsions",
        trackType: "valorize",
      },
      recolter: {
        label: "Récolter",
        templateAction: "avis",
        templateModule: "propulser",
        folder: "propulsions",
        trackType: "review_mail",
      },
      offrir: {
        label: "Offrir",
        templateAction: "offres",
        templateModule: "propulser",
        folder: "propulsions",
        trackType: "promo_mail",
      },
    },
  },
  loyalty: {
    validThemes: ["informer", "enqueter", "suivre"],
    tool: "fideliser",
    trackKind: "fideliser",
    defaultScope: "clients",
    themes: {
      informer: {
        label: "Informer",
        templateAction: "informations",
        templateModule: "fideliser",
        folder: "fidelisations",
        trackType: "newsletter_mail",
      },
      enqueter: {
        label: "Enquêter",
        templateAction: "enquetes",
        templateModule: "fideliser",
        folder: "fidelisations",
        trackType: "satisfaction_mail",
      },
      suivre: {
        label: "Suivre",
        templateAction: "suivis",
        templateModule: "fideliser",
        folder: "fidelisations",
        trackType: "thanks_mail",
      },
    },
  },
} as const;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function cleanEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email) ? email : "";
}

function rowToAutomationSettings(
  key: CampaignAutomationKey,
  row: AutomationDbRow | null,
): InrAgentAutomationSettings {
  return sanitizeInrAgentAutomationSettings(key, {
    enabled: row?.enabled ?? undefined,
    frequency: row?.frequency as InrAgentAutomationSettings["frequency"],
    dayOfWeek: row?.day_of_week ?? undefined,
    time: row?.time ?? undefined,
    validationMode: row?.validation_mode as InrAgentAutomationSettings["validationMode"],
    allowedChannels: row?.allowed_channels as InrAgentAutomationSettings["allowedChannels"],
    allowedThemes: row?.allowed_themes as InrAgentAutomationSettings["allowedThemes"],
    useImageBank: row?.use_image_bank ?? undefined,
    imageRequired: row?.image_required ?? undefined,
    recipientScope: row?.recipient_scope as InrAgentAutomationSettings["recipientScope"],
    sourceStrategy: row?.source_strategy as InrAgentAutomationSettings["sourceStrategy"],
    lastPreparedAt: row?.last_prepared_at ?? null,
    lastExecutedAt: row?.last_executed_at ?? null,
    nextRunAt: row?.next_run_at ?? null,
    metadata: row?.metadata ?? {},
  });
}

async function loadCampaignAutomationSettings(
  userId: string,
  key: CampaignAutomationKey,
) {
  const { data } = await supabaseAdmin
    .from("inr_agent_automation_settings")
    .select(
      "enabled, frequency, day_of_week, time, validation_mode, allowed_channels, allowed_themes, use_image_bank, image_required, recipient_scope, source_strategy, last_prepared_at, last_executed_at, next_run_at, metadata",
    )
    .eq("user_id", userId)
    .eq("automation_key", key)
    .maybeSingle();

  return rowToAutomationSettings(key, (data as AutomationDbRow | null) ?? null);
}

function chooseTheme(
  key: CampaignAutomationKey,
  allowedThemes: InrAgentTheme[],
): InrAgentTheme {
  const map = campaignThemeMap[key];
  const available = allowedThemes.filter((theme) =>
    (map.validThemes as readonly string[]).includes(theme),
  );
  const fallback = map.validThemes[0];
  return (available[Math.floor(Math.random() * available.length)] || fallback) as InrAgentTheme;
}

type CampaignThemeConfig = {
  label: string;
  templateAction: TemplateAction;
  templateModule: string;
  folder: string;
  trackType: string;
};

function getCampaignThemeConfig(
  key: CampaignAutomationKey,
  theme: InrAgentTheme,
): CampaignThemeConfig {
  const map = campaignThemeMap[key] as unknown as {
    validThemes: readonly string[];
    themes: Record<string, CampaignThemeConfig>;
  };
  return map.themes[theme] || map.themes[map.validThemes[0]];
}

function getExecutionPolicy(validationMode: InrAgentValidationMode) {
  if (validationMode === "draft_only") return "draft_only";
  return "manual_validation";
}

function getInitialStatus(validationMode: InrAgentValidationMode) {
  return validationMode === "draft_only" ? "draft" : "pending_validation";
}

function buildDisplayName(row: JsonRecord) {
  const firstName = cleanText(row.first_name, 80);
  const lastName = cleanText(row.last_name, 100);
  const company = cleanText(row.company_name, 140);
  const person = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (person && company) return `${person} · ${company}`;
  return person || company || cleanText(row.email, 160);
}

async function fetchRecipients(args: {
  userId: string;
  scope: InrAgentRecipientScope;
}): Promise<CampaignRecipient[]> {
  let query = supabaseAdmin
    .from("crm_contacts")
    .select("id,first_name,last_name,company_name,email,contact_type,created_at")
    .eq("user_id", args.userId)
    .not("email", "is", null)
    .limit(args.scope === "recent_contacts" ? 80 : 500);

  if (args.scope === "clients") query = query.eq("contact_type", "client");
  if (args.scope === "prospects") query = query.eq("contact_type", "prospect");

  query = query.order("created_at", {
    ascending: args.scope === "inactive_contacts",
  });

  const { data, error } = await query;
  if (error || !Array.isArray(data)) return [];

  const seen = new Set<string>();
  const recipients: CampaignRecipient[] = [];

  for (const raw of data) {
    const row = asRecord(raw);
    if (!row) continue;
    const email = cleanEmail(row.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    recipients.push({
      contact_id: cleanText(row.id, 120) || null,
      display_name: buildDisplayName(row),
      email,
      contact_type: cleanText(row.contact_type, 80) || null,
      company_name: cleanText(row.company_name, 140) || null,
    });
  }

  return recipients;
}

async function fetchMailAccount(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select("id,provider,account_email,email_address,display_name,resource_label,status,settings")
    .eq("user_id", userId)
    .eq("category", "mail")
    .eq("status", "connected")
    .limit(1);

  if (error || !Array.isArray(data) || !data[0]?.id) return null;
  const row = data[0] as JsonRecord;
  const settings = asRecord(row.settings) || {};
  const accountEmail = cleanText(row.account_email || row.email_address || settings.email || settings.account_email, 180);
  const displayName = cleanText(row.display_name || settings.display_name, 180);
  return {
    id: cleanText(row.id, 120),
    provider: cleanText(row.provider, 80),
    email_address: accountEmail || null,
    account_email: accountEmail || null,
    email: accountEmail || null,
    display_name: displayName || null,
    label: accountEmail || cleanText(row.resource_label || row.provider || "Boîte mail", 180),
  };
}

function pickTemplate(args: {
  templateAction: TemplateAction;
  sectorCategory: unknown;
  profession: unknown;
}) {
  const templates = getTemplates(
    args.templateAction,
    undefined,
    (args.sectorCategory || null) as never,
    cleanText(args.profession, 120) || null,
  );
  const categoryMap = new Map<string, (typeof templates)[number]>();
  for (const template of templates) {
    if (!categoryMap.has(template.category)) categoryMap.set(template.category, template);
  }
  const candidates = Array.from(categoryMap.values());
  return candidates[Math.floor(Math.random() * candidates.length)] || templates[0] || null;
}

async function generateCampaignContent(args: {
  supabase: any;
  userId: string;
  quotaUserId: string;
  actorUserId: string;
  templateModule: string;
  mission: string;
  templateKey: string;
  templateTitle: string;
  templateCategory: string;
  subject: string;
  body: string;
}) {
  const payload = await generateTemplateAiContent({
    supabase: args.supabase,
    userId: args.userId,
    quotaUserId: args.quotaUserId,
    actorUserId: args.actorUserId,
    aiFeature: "agent.campaign",
    input: {
      module: args.templateModule,
      mission: args.mission,
      template_key: args.templateKey,
      template_title: args.templateTitle,
      template_category: args.templateCategory,
      subject: args.subject,
      body: args.body,
      attachments: [],
      automatic_campaign: true,
    },
  });

  return {
    subject: normalizeMailSubject(cleanText(payload.subject, 220) || args.subject),
    bodyText: stripTemplateSignatureBlock(
      cleanText(payload.body_text, 6000) || args.body,
    ),
  };
}

function buildPreviewText(subject: string, bodyText: string, recipients: CampaignRecipient[]) {
  return [
    `Objet : ${subject}`,
    bodyText,
    `Destinataires proposés : ${recipients.length} contact${recipients.length > 1 ? "s" : ""} CRM`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildSummary(args: {
  automationKey: CampaignAutomationKey;
  mission: string;
  templateTitle: string;
  recipients: CampaignRecipient[];
  accountLabel: string;
}) {
  const toolLabel = args.automationKey === "grow" ? "Propulser" : "Fidéliser";
  return `${toolLabel} · ${args.mission} préparé depuis le modèle “${args.templateTitle}” avec ${args.recipients.length} destinataire${args.recipients.length > 1 ? "s" : ""} CRM via ${args.accountLabel}.`;
}

function getAppOrigin() {
  return optionalEnv(
    "NEXT_PUBLIC_APP_URL",
    optionalEnv("NEXT_PUBLIC_SITE_URL", "https://app.inrcy.com"),
  ).replace(/\/$/, "");
}

function hasTransactionalSmtpConfig() {
  return Boolean(
    optionalEnv("TX_SMTP_HOST") &&
      optionalEnv("TX_SMTP_PORT") &&
      optionalEnv("TX_SMTP_USER") &&
      optionalEnv("TX_SMTP_PASS"),
  );
}

function getProfileContactEmail(profile: JsonRecord | null, fallback?: string | null) {
  return (
    cleanEmail(profile?.contact_email) ||
    cleanEmail(profile?.admin_email) ||
    cleanEmail(profile?.email) ||
    cleanEmail(fallback)
  );
}

async function getNotificationPreferences(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("notification_preferences")
    .select("in_app_enabled,email_enabled,action_enabled")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("agent/prepare-campaign notification preferences", error);
    return { inAppEnabled: true, emailEnabled: true, actionEnabled: true };
  }

  const row = asRecord(data);
  return {
    inAppEnabled: row?.in_app_enabled !== false,
    emailEnabled: row?.email_enabled !== false,
    actionEnabled: row?.action_enabled !== false,
  };
}

type CampaignPreparedNotificationResult = {
  emailSent: boolean;
  emailSkippedReason: string | null;
};

async function notifyCampaignPrepared(args: {
  userId: string;
  userEmail?: string | null;
  actionId: string;
  automationKey: CampaignAutomationKey;
  missionLabel: string;
  campaignSubject: string;
  campaignBody: string;
  recipientsCount: number;
  accountLabel: string;
  profile: JsonRecord | null;
  movedDraftsCount: number;
  now: string;
}): Promise<CampaignPreparedNotificationResult> {
  const preferences = await getNotificationPreferences(args.userId);
  const automationLabel = args.automationKey === "loyalty" ? "Fidéliser" : "Propulser";
  const actionUrl = `${getAppOrigin()}/dashboard/agent?action=${encodeURIComponent(args.actionId)}&automation=${encodeURIComponent(args.automationKey)}`;

  let emailSent = false;
  let emailSkippedReason: string | null = null;
  if (!preferences.emailEnabled || !preferences.actionEnabled) {
    emailSkippedReason = "notification_preferences_disabled";
  } else if (!hasTransactionalSmtpConfig()) {
    emailSkippedReason = "tx_smtp_not_configured";
  } else {
    const to = getProfileContactEmail(args.profile, args.userEmail);
    if (!to) {
      emailSkippedReason = "missing_pro_email";
    } else {
      try {
        const mail = buildInrAgentCampaignValidationEmail({
          firstName: cleanText(args.profile?.first_name, 80),
          companyName: cleanText(
            args.profile?.company_legal_name || args.profile?.company_name,
            160,
          ),
          automationLabel,
          missionLabel: args.missionLabel,
          campaignSubject: args.campaignSubject,
          campaignBody: args.campaignBody,
          recipientCount: args.recipientsCount,
          accountLabel: args.accountLabel,
          ctaUrl: actionUrl,
          movedPreviousDrafts: args.movedDraftsCount,
        });
        await sendTxMail({
          to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          attachments: await getInrcyBrandInlineAttachments(),
        });
        emailSent = true;
      } catch (error) {
        emailSkippedReason = "send_failed";
        console.warn("agent/prepare-campaign validation email", error);
      }
    }
  }

  return { emailSent, emailSkippedReason };
}

const DRAFTABLE_CAMPAIGN_ACTION_STATUSES = [
  "prepared",
  "pending_validation",
  "pending",
  "draft",
];

function isMissingDraftMetadataColumn(error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined) {
  const msg = String(error?.message || error?.details || error?.hint || "").toLowerCase();
  return (
    error?.code === "PGRST204" ||
    msg.includes("folder") ||
    msg.includes("track_kind") ||
    msg.includes("track_type") ||
    msg.includes("template_key") ||
    msg.includes("attachments")
  );
}

function cleanDraftAttachment(item: unknown) {
  const record = asRecord(item);
  if (!record) return null;

  const bucket = cleanText(record.bucket, 120);
  const path = cleanText(record.path || record.storagePath || record.storage_path, 500);
  if (!bucket || !path) return null;

  return {
    bucket,
    path,
    name: cleanText(record.name || record.filename || record.fileName, 240) || path.split("/").pop() || "piece-jointe",
    type: cleanText(record.type || record.mimeType || record.mime_type, 140) || "application/octet-stream",
    size: typeof record.size === "number" && Number.isFinite(record.size) ? record.size : null,
  };
}

function cleanDraftAttachments(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(cleanDraftAttachment).filter(Boolean).slice(0, 10);
}

function recipientsToEmails(value: unknown) {
  const recipients = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const emails: string[] = [];

  for (const item of recipients) {
    const record = asRecord(item);
    const email = cleanEmail(record?.email || item);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }

  return emails;
}

function buildDraftPayloadFromAction(args: {
  actionRow: JsonRecord;
  userId: string;
  automationKey: CampaignAutomationKey;
}) {
  const { actionRow, automationKey } = args;
  const action = rowToInrAgentAction(actionRow as any);
  const payload = action.payload || {};
  const mailAccount = asRecord(payload.mailAccount) || {};
  const recipients = recipientsToEmails(payload.recipients || action.recipients);
  const subject = normalizeMailSubject(
    cleanText(payload.campaignSubject || payload.subject || action.title, 220) ||
      "(sans objet)",
  );
  const bodyText = cleanText(
    payload.campaignBody || payload.bodyText || payload.text || action.previewText,
    6000,
  );
  const bodyHtml = cleanText(payload.bodyHtml || payload.html, 10000) || textToRichMailHtml(bodyText);
  const folder =
    cleanText(payload.folder, 80) ||
    (automationKey === "loyalty" ? "fidelisations" : "propulsions");
  const trackKind =
    cleanText(payload.trackKind, 80) ||
    (automationKey === "loyalty" ? "fideliser" : "propulser");
  const trackType = cleanText(payload.trackType || payload.theme || action.targetThemes[0], 80);
  const templateKey = cleanText(payload.templateKey, 160);
  const accountId = cleanText(payload.accountId || payload.mailAccountId || mailAccount.id, 120);
  const provider = cleanText(mailAccount.provider || payload.provider || payload.mailProvider, 80);

  const draftPayload = {
    user_id: args.userId,
    integration_id: accountId || null,
    type: "mail",
    status: "draft",
    to_emails: recipients.join("; "),
    subject,
    body_text: bodyText || null,
    body_html: bodyHtml || null,
    provider: provider || null,
    source_doc_save_id: null,
    source_doc_type: null,
    source_doc_number: null,
    folder,
    track_kind: trackKind,
    track_type: trackType || null,
    template_key: templateKey || null,
    attachments: cleanDraftAttachments(payload.attachments),
  };

  const legacyPayload = {
    user_id: draftPayload.user_id,
    integration_id: draftPayload.integration_id,
    type: draftPayload.type,
    status: draftPayload.status,
    to_emails: draftPayload.to_emails,
    subject: draftPayload.subject,
    body_text: draftPayload.body_text,
    body_html: draftPayload.body_html,
    provider: draftPayload.provider,
    source_doc_save_id: draftPayload.source_doc_save_id,
    source_doc_type: draftPayload.source_doc_type,
    source_doc_number: draftPayload.source_doc_number,
  };

  return { action, payload, draftPayload, legacyPayload };
}

async function movePendingCampaignActionsToInrSendDrafts(args: {
  userId: string;
  automationKey: CampaignAutomationKey;
  now: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("inr_agent_actions")
    .select(ACTION_SELECT)
    .eq("user_id", args.userId)
    .eq("automation_key", args.automationKey)
    .in("status", DRAFTABLE_CAMPAIGN_ACTION_STATUSES)
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    throw new Error(error.message || "Lecture des campagnes iNr’Agent en attente impossible.");
  }

  const rows = Array.isArray(data) ? data : [];
  const movedDrafts: Array<{ actionId: string; draftId: string | null }> = [];

  for (const row of rows) {
    const { action, payload, draftPayload, legacyPayload } = buildDraftPayloadFromAction({
      actionRow: row as JsonRecord,
      userId: args.userId,
      automationKey: args.automationKey,
    });

    let { data: draft, error: draftError } = await supabaseAdmin
      .from("send_items")
      .insert(draftPayload as any)
      .select("id")
      .single();

    if (draftError && isMissingDraftMetadataColumn(draftError)) {
      const legacyInsert = await supabaseAdmin
        .from("send_items")
        .insert(legacyPayload)
        .select("id")
        .single();
      draft = legacyInsert.data;
      draftError = legacyInsert.error;
    }

    if (draftError) {
      throw new Error(draftError.message || "Impossible de conserver l’ancienne campagne en brouillon iNrSend.");
    }

    const draftId = cleanText((draft as JsonRecord | null)?.id, 120) || null;
    const { error: updateError } = await supabaseAdmin
      .from("inr_agent_actions")
      .update({
        status: "cancelled",
        completed_at: args.now,
        last_error: null,
        summary: `${action.summary} Ancienne proposition conservée en brouillon dans iNrSend.`,
        payload: {
          ...payload,
          movedToInrSendDraft: {
            ok: true,
            draftId,
            movedAt: args.now,
            reason: "new_automatic_campaign_generation",
          },
        },
        updated_at: args.now,
      })
      .eq("id", action.id)
      .eq("user_id", args.userId);

    if (updateError) {
      throw new Error(updateError.message || "Impossible d’archiver l’ancienne action iNr’Agent.");
    }

    movedDrafts.push({ actionId: action.id, draftId });
  }

  return movedDrafts;
}

export async function POST(request: Request) {
  const context = await resolveInrAgentActionRequest(request);
  if (context.errorResponse) return context.errorResponse;

  const { supabase, user, userId, authUserId, isCron } = context;
  const edition = isCron
    ? (await getDashboardEditionsForAccountIds([userId])).get(userId)
    : await getDashboardEditionForAuthUser(authUserId);
  if (edition === "standard") return premiumRequiredApiResponse();
  const actorUserId = isCron ? userId : authUserId;
  const quotaUserId = userId;
  const body = context.body as {
    automationKey?: unknown;
  } | null;
  const automationKeyRaw = cleanText(body?.automationKey, 40);
  const automationKey: CampaignAutomationKey =
    automationKeyRaw === "loyalty" ? "loyalty" : "grow";

  const rl = await enforceRateLimit({
    name: `inr_agent_prepare_${automationKey}`,
    identifier: actorUserId,
    limit: 4,
    window: "1 m",
    failClosed: false,
  });
  if (rl) return rl;

  const automation = await loadCampaignAutomationSettings(userId, automationKey);
  if (!automation.enabled) {
    return NextResponse.json(
      {
        error:
          automationKey === "grow"
            ? "L’automatisation Propulser est désactivée."
            : "L’automatisation Fidéliser les contacts est désactivée.",
      },
      { status: 400 },
    );
  }

  const mailAllowed = automation.allowedChannels.includes("mails");
  if (!mailAllowed) {
    return NextResponse.json(
      { error: "Le canal Mails doit être autorisé pour cette automatisation." },
      { status: 400 },
    );
  }

  const [professionalContext, mailAccount] = await Promise.all([
    getAiProfessionalGenerationContext({
      supabase,
      userId,
      edition,
    }),
    fetchMailAccount(userId),
  ]);

  if (!mailAccount?.id) {
    return NextResponse.json(
      {
        error:
          "Aucune boîte mail connectée. Connecte une boîte dans Mails avant de laisser iNr’Agent préparer une campagne.",
      },
      { status: 400 },
    );
  }

  const business = asRecord(professionalContext.business);
  const decodedSector = decodeBusinessSector(String(business?.sector || ""));
  const professionLabel =
    getJobLabel(decodedSector.sectorCategory, decodedSector.profession) ||
    decodedSector.profession;
  const profile = asRecord(professionalContext.profile);

  const theme = chooseTheme(automationKey, automation.allowedThemes);
  const themeConfig = getCampaignThemeConfig(automationKey, theme);
  const template = pickTemplate({
    templateAction: themeConfig.templateAction,
    sectorCategory: decodedSector.sectorCategory,
    profession: decodedSector.profession,
  });

  if (!template) {
    return NextResponse.json(
      { error: "Aucun template d’origine n’a été trouvé pour cette campagne." },
      { status: 400 },
    );
  }

  const scope =
    automation.recipientScope === "none" || automation.recipientScope === "manual_selection"
      ? (campaignThemeMap[automationKey].defaultScope as InrAgentRecipientScope)
      : automation.recipientScope;
  const recipients = await fetchRecipients({ userId, scope });
  if (!recipients.length) {
    return NextResponse.json(
      {
        error:
          automationKey === "loyalty"
            ? "Aucun client avec email n’est disponible dans le CRM pour préparer cette campagne Fidéliser."
            : "Aucun contact avec email n’est disponible dans le CRM pour préparer cette campagne Propulser.",
      },
      { status: 400 },
    );
  }

  let generated: Awaited<ReturnType<typeof generateCampaignContent>>;
  try {
    generated = await generateCampaignContent({
      supabase,
      userId,
      quotaUserId,
      actorUserId,
      templateModule: themeConfig.templateModule,
      mission: themeConfig.label,
      templateKey: template.key,
      templateTitle: template.title,
      templateCategory: template.category,
      subject: template.subject,
      body: template.body,
    });
  } catch (error) {
    if (error instanceof TemplateAiGenerationError) {
      return NextResponse.json(
        {
          error: getSimpleFrenchErrorMessage(error, "La génération IA de la campagne a échoué."),
          ...(error.code ? { code: error.code } : {}),
        },
        { status: error.status, headers: error.headers },
      );
    }
    console.error("agent/prepare-campaign generate", error);
    return NextResponse.json(
      { error: "La génération IA de la campagne a échoué." },
      { status: 500 },
    );
  }

  const now = new Date().toISOString();
  let movedDrafts: Array<{ actionId: string; draftId: string | null }> = [];
  try {
    movedDrafts = await movePendingCampaignActionsToInrSendDrafts({
      userId,
      automationKey,
      now,
    });
  } catch (error) {
    console.error("agent/prepare-campaign move pending draft", error);
    return NextResponse.json(
      {
        error:
          getSimpleFrenchErrorMessage(
            error,
            "Impossible de conserver l’ancienne campagne en brouillon iNrSend.",
          ),
      },
      { status: 500 },
    );
  }

  const bodyHtml = textToRichMailHtml(generated.bodyText);
  const title = `Campagne ${themeConfig.label} prête`;
  const summary = buildSummary({
    automationKey,
    mission: themeConfig.label,
    templateTitle: template.title,
    recipients,
    accountLabel: mailAccount.label,
  });
  const signatureAutomatic = automation.metadata?.signatureAutomatic !== false;

  const payload = {
    version: 1,
    source: "inr_agent_campaign_preparer",
    executionTarget: "crm_campaign",
    automationKey,
    mission: themeConfig.label,
    theme,
    templateModule: themeConfig.templateModule,
    templateAction: themeConfig.templateAction,
    sourceTemplate: {
      key: template.key,
      title: template.title,
      category: template.category,
      subject: template.subject,
      body: template.body,
      profession: professionLabel || null,
      sectorCategory: decodedSector.sectorCategory || null,
    },
    subject: generated.subject,
    campaignSubject: generated.subject,
    bodyText: generated.bodyText,
    campaignBody: generated.bodyText,
    bodyHtml,
    folder: themeConfig.folder,
    trackKind: campaignThemeMap[automationKey].trackKind,
    trackType: themeConfig.trackType,
    templateKey: template.key,
    signatureAutomatic,
    accountId: mailAccount.id,
    mailAccount: mailAccount,
    recipientScope: scope,
    recipientCount: recipients.length,
    recipients,
    profile: {
      company: cleanText(
        profile?.company_legal_name || profile?.company_name || business?.company_name,
        160,
      ),
      city: cleanText(profile?.hq_city || profile?.hqCity, 100),
    },
  };

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("inr_agent_actions")
    .insert({
      user_id: userId,
      automation_key: automationKey,
      action_type: automationKey === "loyalty" ? "loyalty" : "campaign",
      target_tool: campaignThemeMap[automationKey].tool,
      title,
      summary,
      preview_text: buildPreviewText(generated.subject, generated.bodyText, recipients),
      target_channels: ["mails"],
      target_themes: [theme],
      recipients,
      image_assets: [],
      payload,
      validation_required: automation.validationMode !== "draft_only",
      execution_policy: getExecutionPolicy(automation.validationMode),
      status: getInitialStatus(automation.validationMode),
      scheduled_for: null,
      prepared_at: now,
      metadata: {
        automationFrequency: automation.frequency,
        preparedManually: !isCron,
        preparedByCron: isCron,
        templateKey: template.key,
        recipientCount: recipients.length,
        signatureAutomatic,
        movedPreviousDrafts: movedDrafts.length,
      },
      created_at: now,
      updated_at: now,
    })
    .select(ACTION_SELECT)
    .single();

  if (insertError) {
    return NextResponse.json(
      {
        error: "Impossible d’enregistrer la campagne préparée iNr’Agent.",
      },
      { status: 500 },
    );
  }

  await supabaseAdmin
    .from("inr_agent_automation_settings")
    .update({ last_prepared_at: now, updated_at: now })
    .eq("user_id", userId)
    .eq("automation_key", automationKey);

  const actionId = cleanText((inserted as JsonRecord | null)?.id, 120);
  const notification = actionId
    ? await notifyCampaignPrepared({
        userId,
        userEmail: user.email,
        actionId,
        automationKey,
        missionLabel: themeConfig.label,
        campaignSubject: generated.subject,
        campaignBody: generated.bodyText,
        recipientsCount: recipients.length,
        accountLabel: mailAccount.label,
        profile,
        movedDraftsCount: movedDrafts.length,
        now,
      })
    : { emailSent: false, emailSkippedReason: "missing_action_id" };

  return NextResponse.json({
    action: rowToInrAgentAction(inserted as any),
    prepared: true,
    movedDrafts,
    notification,
  });
}
