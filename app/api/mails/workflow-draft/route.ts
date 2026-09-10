import { NextResponse } from "next/server";
import { normalizeCampaignRecipients, normalizeRecipientEmails } from "@/lib/crmRecipients";
import { requireUser } from "@/lib/requireUser";
import { normalizeRichMailHtmlForSend } from "@/lib/mailRichText";

const ALLOWED_FOLDERS = new Set(["propulsions", "fidelisations", "informations", "suivis", "enquetes"]);
const ALLOWED_KINDS = new Set(["propulser", "fideliser"]);
const ALLOWED_STAGES = new Set(["editor", "compose"]);
const ALLOWED_ENGINES = new Set([
  "openai",
  "anthropic",
  "google",
  "mistral",
  "xai",
  "perplexity",
  "deepseek",
  "meta",
]);

const TRACK_TARGETS = {
  valorize: { kind: "propulser", action: "valorize", folder: "propulsions", label: "Valoriser" },
  review_mail: { kind: "propulser", action: "reviews", folder: "propulsions", label: "Récolter" },
  promo_mail: { kind: "propulser", action: "promo", folder: "propulsions", label: "Offrir" },
  newsletter_mail: { kind: "fideliser", action: "inform", folder: "fidelisations", label: "Informer" },
  thanks_mail: { kind: "fideliser", action: "thanks", folder: "fidelisations", label: "Suivre" },
  satisfaction_mail: { kind: "fideliser", action: "satisfaction", folder: "fidelisations", label: "Enquêter" },
} as const;

const FULL_SELECT = "id,integration_id,type,status,to_emails,subject,body_text,body_html,provider,folder,track_kind,track_type,template_key,attachments,draft_state,created_at,updated_at";
const METADATA_SELECT = "id,integration_id,type,status,to_emails,subject,body_text,body_html,provider,folder,track_kind,track_type,template_key,attachments,created_at,updated_at";
const LEGACY_SELECT = "id,integration_id,type,status,to_emails,subject,body_text,body_html,provider,created_at,updated_at";

function clean(value: unknown, max = 6000) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanContent(value: unknown, max = 200_000) {
  return String(value ?? "").slice(0, max);
}

function cleanAttachment(item: unknown) {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  const bucket = clean(raw.bucket, 120);
  const path = clean(raw.path, 500);
  if (!bucket || !path) return null;
  return {
    bucket,
    path,
    name: clean(raw.name, 240) || path.split("/").pop() || "piece-jointe",
    type: clean(raw.type, 140) || "application/octet-stream",
    size: typeof raw.size === "number" && Number.isFinite(raw.size) ? raw.size : null,
  };
}

function cleanAttachments(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(cleanAttachment).filter(Boolean).slice(0, 10);
}

function cleanRecord(value: unknown, maxBytes = 128_000) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > maxBytes) return {};
    return JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function errorMessage(error: any) {
  return String(error?.message || error?.details || error?.hint || "").toLowerCase();
}

function isMissingColumn(error: any, column: string) {
  const message = errorMessage(error);
  return error?.code === "PGRST204" || message.includes(column.toLowerCase());
}

function isMissingDraftMetadataColumn(error: any) {
  const message = errorMessage(error);
  return (
    error?.code === "PGRST204" ||
    message.includes("folder") ||
    message.includes("track_kind") ||
    message.includes("track_type") ||
    message.includes("template_key") ||
    message.includes("attachments")
  );
}

function targetFor(kindValue: unknown, trackTypeValue: unknown) {
  const kind = clean(kindValue, 40).toLowerCase();
  const trackType = clean(trackTypeValue, 80).toLowerCase();
  const exact = TRACK_TARGETS[trackType as keyof typeof TRACK_TARGETS];
  if (exact && exact.kind === kind) return { ...exact, trackType };
  return kind === "fideliser"
    ? { ...TRACK_TARGETS.newsletter_mail, trackType: "newsletter_mail" }
    : { ...TRACK_TARGETS.valorize, trackType: "valorize" };
}

function supplementalDraftState(body: any, canonical: {
  kind: string;
  action: string;
  folder: string;
  trackType: string;
  selectedAccountId: string | null;
  provider: string | null;
  toEmails: string;
}) {
  const aiEngine = clean(body?.aiEngine || body?.ai_engine, 40).toLowerCase();
  const stage = clean(body?.stage, 20).toLowerCase();
  return {
    version: 1,
    kind: canonical.kind,
    action: canonical.action,
    folder: canonical.folder,
    trackKind: canonical.kind,
    trackType: canonical.trackType,
    templateCategory: clean(body?.templateCategory || body?.template_category, 160) || null,
    aiEngine: ALLOWED_ENGINES.has(aiEngine) ? aiEngine : null,
    stage: ALLOWED_STAGES.has(stage) ? stage : "editor",
    selectedAccountId: canonical.selectedAccountId,
    provider: canonical.provider,
    toEmails: canonical.toEmails,
    recipientHints: normalizeCampaignRecipients(body?.recipientHints || body?.recipient_hints).slice(0, 500),
    trackPayload: cleanRecord(body?.trackPayload || body?.track_payload, 128_000),
  };
}

function rowToWorkflowDraft(row: Record<string, any>) {
  const supplemental = cleanRecord(row?.draft_state, 512_000);
  const kind = ALLOWED_KINDS.has(clean(row?.track_kind, 40).toLowerCase())
    ? clean(row?.track_kind, 40).toLowerCase()
    : clean(supplemental.kind, 40).toLowerCase();
  if (!ALLOWED_KINDS.has(kind)) return null;
  const target = targetFor(kind, row?.track_type || supplemental.trackType);
  const toEmails = normalizeRecipientEmails(row?.to_emails).join(", ");
  return {
    version: 1,
    kind,
    action: target.action,
    folder: clean(row?.folder, 80) || target.folder,
    trackKind: kind,
    trackType: target.trackType,
    templateKey: clean(row?.template_key, 160) || null,
    templateCategory: clean(supplemental.templateCategory, 160) || null,
    subject: clean(row?.subject, 220),
    bodyText: cleanContent(row?.body_text, 200_000),
    bodyHtml: cleanContent(row?.body_html, 500_000),
    attachments: cleanAttachments(row?.attachments),
    aiEngine: ALLOWED_ENGINES.has(clean(supplemental.aiEngine, 40).toLowerCase())
      ? clean(supplemental.aiEngine, 40).toLowerCase()
      : null,
    stage: supplemental.stage === "compose" ? "compose" : "editor",
    selectedAccountId: clean(row?.integration_id, 120) || clean(supplemental.selectedAccountId, 120) || null,
    provider: clean(row?.provider, 80) || clean(supplemental.provider, 80) || null,
    toEmails,
    recipientHints: normalizeCampaignRecipients(supplemental.recipientHints).slice(0, 500),
    trackPayload: cleanRecord(supplemental.trackPayload),
    draftId: clean(row?.id, 120) || null,
    createdAt: new Date(String(row?.created_at || row?.updated_at || Date.now())).getTime(),
    updatedAt: new Date(String(row?.updated_at || row?.created_at || Date.now())).getTime(),
  };
}

async function selectDraftRows(
  supabase: any,
  activeUserId: string,
  options: { draftId?: string; kind?: string; limit?: number },
) {
  const run = (columns: string, filterByKind = true) => {
    let query = supabase
      .from("send_items")
      .select(columns)
      .eq("user_id", activeUserId)
      .eq("type", "mail")
      .eq("status", "draft");
    if (options.draftId) query = query.eq("id", options.draftId);
    if (options.kind && filterByKind) query = query.eq("track_kind", options.kind);
    return query.order("updated_at", { ascending: false }).limit(options.limit || 20);
  };

  let result = await run(FULL_SELECT);
  if (result.error && isMissingColumn(result.error, "draft_state")) {
    result = await run(METADATA_SELECT);
  }
  if (result.error && isMissingDraftMetadataColumn(result.error)) {
    result = await run(LEGACY_SELECT, false);
  }
  return result;
}

export async function GET(req: Request) {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const url = new URL(req.url);
  const draftId = clean(url.searchParams.get("draftId"), 120);
  const kind = clean(url.searchParams.get("kind"), 40).toLowerCase();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 50);

  if (kind && !ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: "Module de campagne invalide." }, { status: 400 });
  }

  const { data, error } = await selectDraftRows(supabase, activeUserId, {
    draftId: draftId || undefined,
    kind: kind || undefined,
    limit: draftId ? 1 : limit,
  });
  if (error) {
    return NextResponse.json({ error: "Impossible de charger les brouillons." }, { status: 500 });
  }

  const rows = Array.isArray(data) ? data : [];
  if (draftId) {
    const draft = rows[0] ? rowToWorkflowDraft(rows[0]) : null;
    if (!draft) return NextResponse.json({ error: "Brouillon introuvable." }, { status: 404 });
    return NextResponse.json({ draft }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const drafts = rows
    .map((row: Record<string, any>) => {
      const draft = rowToWorkflowDraft(row);
      if (!draft) return null;
      const target = targetFor(draft.kind, draft.trackType);
      const recipients = normalizeRecipientEmails(draft.toEmails).length;
      return {
        id: draft.draftId,
        title: draft.subject || `Brouillon ${target.label}`,
        preview: draft.bodyText,
        channels: [target.label, recipients ? `${recipients} destinataire${recipients > 1 ? "s" : ""}` : "À cibler"],
        savedAt: new Date(draft.updatedAt || draft.createdAt).toISOString(),
      };
    })
    .filter(Boolean);
  return NextResponse.json({ drafts }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: Request) {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = await req.json().catch(() => ({}));
  const kind = clean(body?.kind, 40).toLowerCase();
  const folder = clean(body?.folder, 80).toLowerCase();
  const trackType = clean(body?.trackType || body?.track_type, 80).toLowerCase();
  const draftId = clean(body?.draftId || body?.draft_id, 120);
  const subject = clean(body?.subject, 220);
  const bodyText = cleanContent(body?.bodyText || body?.body_text, 200_000);
  const bodyHtml = cleanContent(body?.bodyHtml || body?.body_html, 500_000);
  const templateKey = clean(body?.templateKey || body?.template_key, 160);
  const attachments = cleanAttachments(body?.attachments);
  const selectedAccountId = clean(body?.selectedAccountId || body?.selected_account_id, 120) || null;
  const toEmails = normalizeRecipientEmails(body?.toEmails || body?.to_emails).slice(0, 500).join(", ");

  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: "Module de campagne invalide." }, { status: 400 });
  }
  if (!ALLOWED_FOLDERS.has(folder)) {
    return NextResponse.json({ error: "Dossier iNrSend invalide." }, { status: 400 });
  }
  const target = targetFor(kind, trackType);
  if (target.trackType !== trackType) {
    return NextResponse.json({ error: "Type de campagne invalide." }, { status: 400 });
  }
  if (target.folder !== folder) {
    return NextResponse.json({ error: "Dossier de campagne invalide." }, { status: 400 });
  }
  if (!subject && !bodyText && !bodyHtml && !attachments.length) {
    return NextResponse.json({ error: "Aucun contenu à enregistrer." }, { status: 400 });
  }

  let provider: string | null = null;
  if (selectedAccountId) {
    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("id,provider")
      .eq("id", selectedAccountId)
      .eq("user_id", activeUserId)
      .maybeSingle();
    if (integrationError || !integration?.id) {
      return NextResponse.json({ error: "Compte d’envoi inaccessible." }, { status: 400 });
    }
    provider = clean(integration.provider, 80) || null;
  }

  const draftState = supplementalDraftState(body, {
    kind,
    action: target.action,
    folder,
    trackType,
    selectedAccountId,
    provider,
    toEmails,
  });
  const draftPayload = {
    user_id: activeUserId,
    integration_id: selectedAccountId,
    type: "mail",
    status: "draft",
    to_emails: toEmails,
    subject: subject || null,
    body_text: bodyText || null,
    body_html: normalizeRichMailHtmlForSend(bodyText, bodyHtml),
    provider,
    source_doc_save_id: null,
    source_doc_type: null,
    source_doc_number: null,
    folder,
    track_kind: kind,
    track_type: trackType,
    template_key: templateKey || null,
    attachments,
    draft_state: draftState,
  };
  const metadataPayload = { ...draftPayload } as Record<string, unknown>;
  delete metadataPayload.draft_state;
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

  const write = async (payload: Record<string, unknown>) => {
    if (draftId) {
      return supabase
        .from("send_items")
        .update(payload)
        .eq("id", draftId)
        .eq("user_id", activeUserId)
        .eq("type", "mail")
        .eq("status", "draft")
        .select("id")
        .maybeSingle();
    }
    return supabase.from("send_items").insert(payload).select("id").single();
  };

  let { data, error } = await write(draftPayload);
  if (error && isMissingColumn(error, "draft_state")) {
    ({ data, error } = await write(metadataPayload));
  }
  if (error && isMissingDraftMetadataColumn(error)) {
    ({ data, error } = await write(legacyPayload));
  }
  if (error) {
    return NextResponse.json({ error: "Impossible d’enregistrer le brouillon." }, { status: 500 });
  }
  if (draftId && !data?.id) {
    return NextResponse.json({ error: "Brouillon introuvable." }, { status: 404 });
  }
  return NextResponse.json({ draftId: data?.id || draftId || null });
}
