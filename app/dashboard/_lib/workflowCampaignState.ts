import type {
  ComposeAttachmentRef,
  ComposeCrmRecipientHint,
} from "@/app/dashboard/mails/_lib/mailboxPhase1";
import {
  normalizeAiPreferredEngine,
  type AiPreferredEngine,
} from "@/lib/aiEnginePreference";

export type WorkflowCampaignKind = "propulser" | "fideliser";

export type WorkflowCampaignState = {
  version: 1;
  kind: WorkflowCampaignKind;
  action: string;
  folder: string;
  trackKind: WorkflowCampaignKind;
  trackType: string;
  templateKey?: string | null;
  templateCategory?: string | null;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachments: ComposeAttachmentRef[];
  aiEngine?: AiPreferredEngine | null;
  stage: "editor" | "compose";
  selectedAccountId?: string | null;
  provider?: string | null;
  toEmails?: string;
  recipientHints?: ComposeCrmRecipientHint[];
  trackPayload?: Record<string, unknown>;
  draftId?: string | null;
  createdAt: number;
  updatedAt?: number;
};

const STORAGE_PREFIX = "inrcy_workflow_campaign_state:";
const MAX_STATE_AGE_MS = 6 * 60 * 60 * 1000;

function safeNow() {
  return Date.now();
}

export function makeWorkflowCampaignStateKey(kind: WorkflowCampaignKind, action: string) {
  const suffix = Math.random().toString(36).slice(2, 9);
  return `${kind}_${action}_${safeNow()}_${suffix}`;
}

function normalizeAttachment(item: unknown): ComposeAttachmentRef | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  const bucket = String(raw.bucket || "").trim();
  const path = String(raw.path || "").trim();
  if (!bucket || !path) return null;
  return {
    bucket,
    path,
    name: String(raw.name || path.split("/").pop() || "piece-jointe").trim(),
    type: String(raw.type || "application/octet-stream").trim(),
    size: typeof raw.size === "number" && Number.isFinite(raw.size) ? raw.size : null,
  };
}

function normalizeRecipientHint(item: unknown): ComposeCrmRecipientHint | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  const email = String(raw.email || "").trim();
  if (!email) return null;
  const contactId = String(raw.contact_id || raw.contactId || "").trim();
  const displayName = String(raw.display_name || raw.displayName || "").trim();
  return {
    email,
    contact_id: contactId || null,
    display_name: displayName || null,
  };
}

export function normalizeWorkflowCampaignRecipientHints(value: unknown): ComposeCrmRecipientHint[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map(normalizeRecipientHint)
    .filter((item): item is ComposeCrmRecipientHint => {
      if (!item) return false;
      const key = item.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function normalizeWorkflowCampaignAttachments(value: unknown): ComposeAttachmentRef[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeAttachment).filter((item): item is ComposeAttachmentRef => Boolean(item));
}

export function workflowCampaignTargetFromTrack(kind: WorkflowCampaignKind, trackType: string) {
  const key = String(trackType || "").trim().toLowerCase();
  const targets = {
    valorize: { kind: "propulser", action: "valorize", folder: "propulsions", trackType: "valorize" },
    review_mail: { kind: "propulser", action: "reviews", folder: "propulsions", trackType: "review_mail" },
    promo_mail: { kind: "propulser", action: "promo", folder: "propulsions", trackType: "promo_mail" },
    newsletter_mail: { kind: "fideliser", action: "inform", folder: "fidelisations", trackType: "newsletter_mail" },
    thanks_mail: { kind: "fideliser", action: "thanks", folder: "fidelisations", trackType: "thanks_mail" },
    satisfaction_mail: { kind: "fideliser", action: "satisfaction", folder: "fidelisations", trackType: "satisfaction_mail" },
  } as const;
  const target = targets[key as keyof typeof targets];
  if (target && target.kind === kind) return target;
  return kind === "propulser" ? targets.valorize : targets.newsletter_mail;
}

function normalizeTrackPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

export function normalizeWorkflowCampaignState(
  value: Partial<WorkflowCampaignState> | null | undefined,
): WorkflowCampaignState | null {
  if (!value) return null;
  const kind = value.kind === "propulser" || value.kind === "fideliser" ? value.kind : null;
  if (!kind || !value.action) return null;
  const createdAtRaw = value.createdAt;
  const createdAt =
    typeof createdAtRaw === "number"
      ? createdAtRaw
      : new Date(String(createdAtRaw || "")).getTime();
  const aiEngineRaw = String(value.aiEngine || "").trim();
  return {
    version: 1,
    kind,
    action: String(value.action || ""),
    folder: String(value.folder || ""),
    trackKind:
      value.trackKind === "propulser" || value.trackKind === "fideliser"
        ? value.trackKind
        : kind,
    trackType: String(value.trackType || ""),
    templateKey: value.templateKey || null,
    templateCategory: value.templateCategory || null,
    subject: String(value.subject || ""),
    bodyText: String(value.bodyText || ""),
    bodyHtml: String(value.bodyHtml || ""),
    attachments: normalizeWorkflowCampaignAttachments(value.attachments),
    aiEngine: aiEngineRaw ? normalizeAiPreferredEngine(aiEngineRaw) : null,
    stage: value.stage === "compose" ? "compose" : "editor",
    selectedAccountId: String(value.selectedAccountId || "").trim() || null,
    provider: String(value.provider || "").trim() || null,
    toEmails: String(value.toEmails || ""),
    recipientHints: normalizeWorkflowCampaignRecipientHints(value.recipientHints),
    trackPayload: normalizeTrackPayload(value.trackPayload),
    draftId: value.draftId || null,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : safeNow(),
    updatedAt: Number(value.updatedAt || 0) || undefined,
  };
}

export function saveWorkflowCampaignState(state: Omit<WorkflowCampaignState, "createdAt"> & { createdAt?: number }, key?: string | null) {
  if (typeof window === "undefined") return "";
  const resolvedKey = key || makeWorkflowCampaignStateKey(state.kind, state.action);
  const payload = normalizeWorkflowCampaignState({
    ...state,
    version: 1,
    templateKey: state.templateKey || null,
    templateCategory: state.templateCategory || null,
    draftId: state.draftId || null,
    subject: String(state.subject || ""),
    bodyText: String(state.bodyText || ""),
    bodyHtml: String(state.bodyHtml || ""),
    attachments: normalizeWorkflowCampaignAttachments(state.attachments),
    createdAt: Number(state.createdAt || safeNow()),
    updatedAt: safeNow(),
  });
  if (!payload) return "";
  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${resolvedKey}`, JSON.stringify(payload));
  } catch {
    // sessionStorage peut être indisponible : dans ce cas le retour arrière garde l'URL mais pas l'état riche.
  }
  return resolvedKey;
}

export function readWorkflowCampaignState(key: string | null | undefined): WorkflowCampaignState | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = normalizeWorkflowCampaignState(
      JSON.parse(raw) as Partial<WorkflowCampaignState>,
    );
    if (!parsed) return null;
    const createdAt = Number(parsed.createdAt || 0);
    if (!createdAt || safeNow() - createdAt > MAX_STATE_AGE_MS) {
      window.sessionStorage.removeItem(`${STORAGE_PREFIX}${key}`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveWorkflowCampaignDraft(input: {
  draftId?: string | null;
  kind: WorkflowCampaignKind;
  folder: string;
  trackType: string;
  templateKey?: string | null;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachments: ComposeAttachmentRef[];
  aiEngine?: AiPreferredEngine | null;
  stage?: "editor" | "compose";
  selectedAccountId?: string | null;
  provider?: string | null;
  toEmails?: string;
  recipientHints?: ComposeCrmRecipientHint[];
  templateCategory?: string | null;
  trackPayload?: Record<string, unknown>;
}) {
  const response = await fetch("/api/mails/workflow-draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.error || "Impossible d’enregistrer le brouillon."));
  return { draftId: String(payload?.draftId || "") };
}

export async function loadWorkflowCampaignDraft(draftId: string) {
  const id = String(draftId || "").trim();
  if (!id) throw new Error("Brouillon invalide.");
  const response = await fetch(
    `/api/mails/workflow-draft?draftId=${encodeURIComponent(id)}`,
    { cache: "no-store", credentials: "include" },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error || "Impossible d’ouvrir le brouillon."));
  }
  const draft = normalizeWorkflowCampaignState(payload?.draft);
  if (!draft) throw new Error("Ce brouillon est incomplet ou incompatible.");
  return draft;
}
