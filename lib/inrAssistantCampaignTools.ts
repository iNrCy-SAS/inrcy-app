import "server-only";

import { createHash } from "node:crypto";
import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { requireUser } from "./requireUser";

type Row = Record<string, unknown>;
type Segment = "clients" | "prospects" | "all_contacts";
type Options = { request: Request; accountId: string; actorUserId: string; edition: DashboardEdition; supabase: Pick<SupabaseClient, "from">; currentUserMessage: string; actionRequestId: string; canStartWork?: () => boolean };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const LINK = { label: "Campagnes mails", href: "/dashboard/mails?folder=propulsions&boxView=drafts" };
const DRAFT_FIELDS = "id,user_id,type,status,subject,body_text,body_html,to_emails,integration_id,folder,track_kind,track_type,template_key,attachments,draft_state,updated_at";
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clean = (value: unknown, max = 200) => typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").slice(0, max) : "";
const failure = (status = "unavailable") => ({ ok: false, status, nextAction: LINK, message: status === "preview_changed" ? "Le brouillon ou l’aperçu a changé. Demandez un nouvel aperçu avant l’envoi." : status === "needs_confirmation" ? "Vérifiez l’aperçu, puis demandez l’envoi avec sa référence exacte. Aucun envoi n’a été effectué." : "L’opération ne peut pas être confirmée. Aucun envoi réussi n’est annoncé." });
function currentOrder(message: string, quote: string, verbs: RegExp) {
  if (!quote || !message.includes(quote)) return false;
  const unquoted = message.replace(/```[\s\S]*?(?:```|$)|`[^`]*`|«[^»]*»|“[^”]*”|"[^"]*"|^>.*$/gm, " ");
  if (!unquoted.includes(quote)) return false;
  const command = normalize(unquoted);
  return verbs.test(normalize(quote)) && verbs.test(command) && !/\b(?:comment|pourquoi|explique|imagine|suppose|si je|si on|ne pas|never|do not)\b|\bne\b.{0,40}\bpas\b|\bsans\s+(?:envoi|envoyer|modifier)|\b(?:envoie|envoyer)\s+pas\b/.test(command);
}
function nativeRequest(source: Request, path: string, body: unknown) {
  const headers = new Headers({ accept: "application/json", "content-type": "application/json" });
  for (const name of ["cookie", "authorization"]) { const value = source.headers.get(name); if (value) headers.set(name, value); }
  return new Request(new URL(path, source.url), { method: "POST", headers, signal: source.signal, body: JSON.stringify(body) });
}
function fingerprint(draft: Row) {
  return hash([draft.id, draft.user_id, draft.integration_id, draft.subject, draft.body_text, draft.body_html, draft.template_key, draft.attachments, draft.track_kind, draft.track_type, draft.folder]);
}

/** A persisted preview scopes consent to one account, actor, draft, sender and frozen audience. */
export function createInrAssistantCampaignTools(options: Options) {
  const { supabase, request, accountId, actorUserId, currentUserMessage } = options;
  if (!UUID.test(accountId) || !UUID.test(actorUserId) || !options.actionRequestId) throw new Error("Périmètre campagne invalide.");
  const scope = async () => {
    if (options.edition !== "premium" && options.edition !== "founder" || request.signal.aborted || options.canStartWork?.() === false) return false;
    const auth = await requireUser();
    return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId;
  };
  const readDraft = async (draftId: string) => {
    if (!UUID.test(draftId) || !await scope()) return null;
    const result = await supabase.from("send_items").select(DRAFT_FIELDS).eq("user_id", accountId).eq("id", draftId).eq("type", "mail").eq("status", "draft").maybeSingle();
    const item = row(result.data);
    return !result.error && item.id === draftId && item.user_id === accountId && item.type === "mail" && item.status === "draft" && ["propulser", "fideliser"].includes(String(item.track_kind)) ? item : null;
  };
  const mailbox = async (mailboxId: string) => {
    if (!UUID.test(mailboxId)) return null;
    const result = await supabase.from("integrations").select("id,user_id,category,status,provider,account_email").eq("user_id", accountId).eq("id", mailboxId).eq("category", "mail").eq("status", "connected").maybeSingle();
    const item = row(result.data);
    return !result.error && item.user_id === accountId && item.id === mailboxId && item.category === "mail" && item.status === "connected" && EMAIL.test(String(item.account_email)) ? item : null;
  };
  const saveDraft = async (draft: Row, changes: { selectedAccountId?: string; preview?: Row }) => {
    if (!await scope() || typeof draft.updated_at !== "string" || !Number.isFinite(Date.parse(draft.updated_at))) return false;
    const state = row(draft.draft_state), payload = row(state.trackPayload);
    const { POST } = await import("@/app/api/mails/workflow-draft/route");
    const response = await POST(nativeRequest(request, "/api/mails/workflow-draft", {
      draftId: draft.id, kind: draft.track_kind, folder: draft.folder, trackType: draft.track_type,
      expectedUpdatedAt: draft.updated_at,
      subject: draft.subject, bodyText: draft.body_text, bodyHtml: draft.body_html, toEmails: draft.to_emails,
      selectedAccountId: changes.selectedAccountId ?? draft.integration_id, templateKey: draft.template_key,
      attachments: Array.isArray(draft.attachments) ? draft.attachments : [], aiEngine: state.aiEngine, stage: state.stage,
      templateCategory: state.templateCategory, recipientHints: state.recipientHints,
      trackPayload: { ...payload, assistantAudiencePreview: changes.preview ?? null },
    }));
    return response.ok && row(await response.json()).draftId === draft.id;
  };
  const operations = new Map<string, Promise<unknown>>();
  const once = (identity: string, work: () => Promise<unknown>) => {
    if (!operations.has(identity)) operations.set(identity, work().catch(() => failure()));
    return operations.get(identity)!;
  };
  return {
    readCampaignDeliveryStatus: tool({ strict: true,
      description: "Lire uniquement le statut et les compteurs enregistrés d’une campagne par son campaignId réel, dans l’établissement actif. Aucun envoi, reprise, recalcul ou rapport persisté. completed signifie traitement d’envoi terminé et sent_count acceptés par le fournisseur : cela ne prouve ni livraison en boîte de réception ni lecture. Les compteurs manquants restent inconnus.",
      inputSchema: jsonSchema<{ campaignId: string }>({ type: "object", properties: { campaignId: { type: "string", format: "uuid" } }, required: ["campaignId"], additionalProperties: false }),
      execute: async input => {
        if (!input || Object.keys(input).length !== 1 || typeof input.campaignId !== "string" || !UUID.test(input.campaignId)) return failure("invalid_input");
        if (!await scope()) return failure("blocked");
        try {
          const result = await supabase.from("mail_campaigns").select("id,user_id,status,total_count,queued_count,processing_count,sent_count,failed_count,finished_at,updated_at,resume_at").eq("user_id", accountId).eq("id", input.campaignId).maybeSingle();
          const campaign = row(result.data);
          if (result.error || campaign.id !== input.campaignId || campaign.user_id !== accountId) return failure("unavailable");
          const count = (key: string) => typeof campaign[key] === "number" && Number.isSafeInteger(campaign[key]) && Number(campaign[key]) >= 0 ? Number(campaign[key]) : null;
          const counters = { total: count("total_count"), queued: count("queued_count"), processing: count("processing_count"), acceptedByProvider: count("sent_count"), failed: count("failed_count") };
          const recordedStatus = String(campaign.status);
          const complete = recordedStatus === "completed" && counters.total !== null && counters.total > 0 && counters.queued === 0 && counters.processing === 0 && counters.acceptedByProvider === counters.total && counters.failed === 0;
          const status = complete ? "completed" : recordedStatus === "completed" ? "unknown" : ["queued", "processing", "paused", "partial", "failed"].includes(recordedStatus) ? recordedStatus : "unknown";
          return { ok: status !== "unknown", status, recordedStatus, campaignId: input.campaignId, counters, deliveryVerified: false, readOnly: true, updatedAt: clean(campaign.updated_at, 40), finishedAt: clean(campaign.finished_at, 40), resumeAt: clean(campaign.resume_at, 40), nextAction: LINK,
            message: complete ? "Traitement de la campagne terminé : les messages sont enregistrés comme acceptés par le fournisseur. La livraison en boîte de réception et la lecture ne sont pas confirmées." : "Statut et compteurs enregistrés de la campagne, sans nouvelle exécution. Aucun message livré ou lu n’est déduit de ces compteurs." };
        } catch { return failure("unavailable"); }
      },
    }),
    listCampaignMailboxes: tool({ strict: true,
      description: "Lister les boîtes d’envoi connectées de l’établissement actif (identifiant, fournisseur, adresse professionnelle seulement). N’expose aucun secret et ne choisit aucune boîte. Utiliser selectCampaignMailbox sur le choix explicite du pro avant l’aperçu de campagne.",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }),
      execute: async () => {
        try {
          if (!await scope()) return failure("blocked");
          const result = await supabase.from("integrations").select("id,user_id,category,status,provider,account_email").eq("user_id", accountId).eq("category", "mail").eq("status", "connected").order("account_email", { ascending: true }).limit(21);
          if (result.error || !Array.isArray(result.data)) return failure();
          const items = result.data.map(row).filter(item => item.user_id === accountId && item.category === "mail" && item.status === "connected" && UUID.test(String(item.id)) && EMAIL.test(String(item.account_email)));
          return { ok: true, status: "read", mailboxes: items.slice(0, 20).map(item => ({ id: item.id, provider: clean(item.provider, 40), email: item.account_email })), moreItemsMayExist: items.length > 20, untrustedContent: true, nextAction: LINK };
        } catch { return failure(); }
      },
    }),
    selectCampaignMailbox: tool({ strict: true,
      description: "Choisir l’expéditeur d’un brouillon de campagne existant sur ordre explicite. mailboxId provient de listCampaignMailboxes et son adresse doit être citée par le pro. Préserve texte, pièces, destinataires et modèle ; invalide l’ancien aperçu, ne diffuse rien.",
      inputSchema: jsonSchema<{ draftId: string; mailboxId: string; instructionQuote: string }>({ type: "object", properties: { draftId: { type: "string", format: "uuid" }, mailboxId: { type: "string", format: "uuid" }, instructionQuote: { type: "string", maxLength: 1200 } }, required: ["draftId", "mailboxId", "instructionQuote"], additionalProperties: false }),
      execute: async input => once(`mailbox:${input.draftId}:${input.mailboxId}`, async () => {
        if (!currentOrder(currentUserMessage, input.instructionQuote, /\b(?:choisis|choisir|selectionne|utilise|mets|modifie|change|envoie|envoyer|send|select|use)\b/)) return failure("needs_instruction");
        const draft = await readDraft(input.draftId), sender = draft ? await mailbox(input.mailboxId) : null;
        if (!draft || !sender || !normalize(input.instructionQuote).includes(normalize(String(sender.account_email)))) return failure("needs_instruction");
        if (!await saveDraft(draft, { selectedAccountId: input.mailboxId })) return failure();
        const saved = await readDraft(input.draftId);
        return saved?.integration_id === input.mailboxId ? { ok: true, status: "updated", draftId: input.draftId, sender: sender.account_email, message: "Expéditeur enregistré et relu. Aucun envoi.", nextAction: LINK } : failure("saved_unconfirmed");
      }),
    }),
    previewCampaignAudience: tool({ strict: true,
      description: "Préparer un aperçu vérifiable d’un brouillon pour le segment CRM demandé : clients, prospects ou tous les contacts. Fige au plus 500 adresses uniques, filtre les exclusions natives, conserve une référence valable 15 minutes liée au texte/pièces/expéditeur. Afficher référence, objet, expéditeur, effectifs et échantillon avant de demander confirmation. Ne déclenche aucun envoi. Une audience trop grande doit être précisée, jamais tronquée silencieusement.",
      inputSchema: jsonSchema<{ draftId: string; segment: Segment; instructionQuote: string }>({ type: "object", properties: { draftId: { type: "string", format: "uuid" }, segment: { type: "string", enum: ["clients", "prospects", "all_contacts"] }, instructionQuote: { type: "string", maxLength: 1200 } }, required: ["draftId", "segment", "instructionQuote"], additionalProperties: false }),
      execute: async input => once(`preview:${input.draftId}:${input.segment}`, async () => {
        const requested = { clients: /\bclients?\b/, prospects: /\bprospects?\b/, all_contacts: /\btous (?:mes |les )?contacts\b/ }[input.segment];
        if (!requested || !currentOrder(currentUserMessage, input.instructionQuote, /\b(?:prepare|preparer|apercu|montre|verifie|envoie|envoyer|diffuse|preview|send)\b/) || !requested.test(normalize(input.instructionQuote))) return failure("needs_instruction");
        const draft = await readDraft(input.draftId), sender = draft ? await mailbox(String(draft.integration_id)) : null;
        if (!draft || !sender) return { ...failure("mailbox_required"), message: "Choisissez d’abord une boîte d’envoi connectée pour ce brouillon." };
        let query = supabase.from("crm_contacts").select("id,user_id,first_name,last_name,company_name,email,contact_type").eq("user_id", accountId);
        if (input.segment !== "all_contacts") query = query.eq("contact_type", input.segment === "clients" ? "client" : "prospect");
        const result = await query.order("id", { ascending: true }).limit(501);
        if (result.error || !Array.isArray(result.data)) return failure();
        if (result.data.length > 500) return { ...failure("audience_too_large"), message: "Ce segment dépasse 500 fiches. Précisez une sélection dans le CRM ; aucun destinataire n’a été tronqué ni envoyé." };
        const contacts = result.data.map(row).filter(item => item.user_id === accountId && UUID.test(String(item.id)) && (input.segment === "all_contacts" || item.contact_type === (input.segment === "clients" ? "client" : "prospect")));
        const unique = new Map<string, Row>(); let invalid = 0;
        for (const contact of contacts) { const email = clean(contact.email, 254).trim().toLowerCase(); if (!EMAIL.test(email)) { invalid++; continue; } if (!unique.has(email)) unique.set(email, contact); }
        const { fetchSuppressedEmailsByUser } = await import("@/lib/mailSuppression");
        const suppressed = await fetchSuppressedEmailsByUser(accountId, [...unique.keys()]);
        const recipients = [...unique.keys()].filter(email => !suppressed.get(email)?.reason).sort();
        if (!recipients.length) return { ...failure("empty_audience"), message: "Aucun destinataire éligible dans ce segment. Aucun envoi." };
        const previous = row(row(row(draft.draft_state).trackPayload).assistantAudiencePreview), digest = fingerprint(draft), audienceHash = hash(recipients);
        const reusable = previous.actorUserId === actorUserId && previous.fingerprint === digest && previous.audienceHash === audienceHash && previous.segment === input.segment && Number(previous.expiresAt) > Date.now();
        const reference = reusable ? String(previous.reference) : `AP-${hash([accountId, actorUserId, options.actionRequestId, input.draftId, digest, audienceHash]).slice(0, 12).toUpperCase()}`;
        const preview: Row = { version: 1, reference, accountId, actorUserId, draftId: input.draftId, fingerprint: digest, segment: input.segment, audienceHash, recipients, expiresAt: reusable ? previous.expiresAt : Date.now() + 15 * 60_000 };
        if (!await saveDraft(draft, { preview })) return failure();
        const saved = await readDraft(input.draftId);
        if (!saved || fingerprint(saved) !== digest || row(row(row(saved.draft_state).trackPayload).assistantAudiencePreview).reference !== reference) return failure("preview_changed");
        return { ok: true, status: "preview_ready", draftId: input.draftId, reference, expiresAt: new Date(Number(preview.expiresAt)).toISOString(), sender: sender.account_email, subject: clean(draft.subject, 220), contentPreview: clean(draft.body_text, 1000), attachmentCount: Array.isArray(draft.attachments) ? draft.attachments.length : 0, segment: input.segment, recipientCount: recipients.length, invalidEmailCount: invalid, duplicateEmailCount: contacts.length - invalid - unique.size, suppressedCount: unique.size - recipients.length, sample: recipients.slice(0, 10).map(email => ({ email, name: clean([unique.get(email)?.first_name, unique.get(email)?.last_name, unique.get(email)?.company_name].filter(Boolean).join(" "), 120) })), sampleOnly: recipients.length > 10, untrustedContent: true, message: `Aucun envoi. Après vérification, demandez « Envoie la campagne ${reference} » pour autoriser cet aperçu exact. Les désinscriptions seront revérifiées à l’envoi.`, nextAction: LINK };
      }),
    }),
    dispatchCampaignAudience: tool({ strict: true,
      description: "Envoyer maintenant l’audience figée d’un aperçu de campagne. Le DERNIER ordre doit demander l’envoi et citer littéralement la référence AP- affichée. Refuse aperçu expiré, acteur/établissement changé, texte/pièce/expéditeur modifié. Exécute les contrôles natifs et revérifie les exclusions ; même référence ne crée jamais un second envoi. queued signifie pris en charge, jamais livré. Ne programme pas une demande future.",
      inputSchema: jsonSchema<{ draftId: string; reference: string; instructionQuote: string }>({ type: "object", properties: { draftId: { type: "string", format: "uuid" }, reference: { type: "string", pattern: "^AP-[A-F0-9]{12}$" }, instructionQuote: { type: "string", maxLength: 1200 } }, required: ["draftId", "reference", "instructionQuote"], additionalProperties: false }),
      execute: async input => once(`dispatch:${input.reference}`, async () => {
        if (!/^AP-[A-F0-9]{12}$/.test(input.reference) || !currentOrder(currentUserMessage, input.instructionQuote, /\b(?:envoie|envoyer|envoyez|diffuse|diffuser|send)\b/) || !input.instructionQuote.includes(input.reference) || /\b(?:demain|programme\w*|planifi\w*|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|plus tard)\b|\b\d{1,2}\s*(?:h|:[0-5]\d)\b|\d{4}-\d{2}-\d{2}/.test(normalize(currentUserMessage))) return failure("needs_confirmation");
        const draft = await readDraft(input.draftId); if (!draft) return failure();
        const preview = row(row(row(draft.draft_state).trackPayload).assistantAudiencePreview);
        if (preview.reference !== input.reference || preview.accountId !== accountId || preview.actorUserId !== actorUserId || preview.draftId !== input.draftId || preview.version !== 1) return failure("needs_confirmation");
        const operationId = `assistant-audience:${hash([accountId, actorUserId, input.draftId, input.reference])}`;
        const previous = await supabase.from("mail_campaigns").select("id,user_id,status").eq("user_id", accountId).contains("metadata", { idempotencyKey: operationId }).limit(2);
        if (previous.error || !Array.isArray(previous.data) || previous.data.length > 1) return failure();
        const existing = row(previous.data[0]);
        if (existing.id && existing.user_id === accountId) return { ok: true, status: "already_processed", campaignId: existing.id, savedStatus: clean(existing.status, 40), nextAction: LINK, message: "Cette référence a déjà été prise en charge. Aucun nouvel envoi." };
        if (Number(preview.expiresAt) <= Date.now() || preview.fingerprint !== fingerprint(draft) || !Array.isArray(preview.recipients) || !preview.recipients.length || preview.recipients.length > 500 || preview.recipients.some(email => typeof email !== "string" || !EMAIL.test(email)) || hash(preview.recipients) !== preview.audienceHash || !await mailbox(String(draft.integration_id))) return failure("preview_changed");
        if (!await scope()) return failure("blocked");
        const { POST } = await import("@/app/api/crm/campaigns/route");
        const response = await POST(nativeRequest(request, "/api/crm/campaigns", { accountId: draft.integration_id, type: "mail", folder: draft.folder, trackKind: draft.track_kind, trackType: draft.track_type, subject: draft.subject, text: draft.body_text ?? "", html: draft.body_html ?? "", templateKey: draft.template_key ?? undefined, attachments: draft.attachments ?? [], recipients: preview.recipients.map(email => ({ email })), metadata: { source: "manual", assistantPreviewReference: input.reference, idempotencyKey: operationId }, idempotencyKey: operationId }));
        const result = row(await response.json());
        if (!response.ok || result.success !== true || !UUID.test(String(result.campaignId)) || !["queued", "paused"].includes(String(result.campaignStatus))) return failure("unknown");
        return { ok: true, status: result.campaignStatus, campaignId: result.campaignId, recipientCount: typeof result.queued === "number" ? result.queued : null, nextAction: LINK, message: result.campaignStatus === "paused" ? "Campagne enregistrée en pause par les contrôles natifs. Aucun envoi terminé n’est annoncé." : "Campagne mise en file. Sa livraison n’est pas encore confirmée." };
      }),
    }),
  };
}
