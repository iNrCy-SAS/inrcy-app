import { parseInrAssistantContentReportHint, type InrAssistantContentReportHint } from "./inrAssistantContentReport.ts";
import { INR_ASSISTANT_BUSINESS_FORM_TABS, isInrAssistantBusinessFormUiCommandAvailable } from "./inrAssistantBusinessFormUiCommands.ts";
import { isInrAssistantMediaUiCommandAvailable, type InrAssistantMediaUiCommandName } from "./inrAssistantMediaUiCommands.ts";
import { inrAssistantStudioUiCommandAvailable, type InrAssistantStudioUiCommandName } from "./inrAssistantStudioUiCommands.ts";
import { isInrAssistantStatsUiCommandAvailable, type InrAssistantStatsUiCommandName } from "./inrAssistantStatsUiCommands.ts";
import { inrAssistantBadgeUiCommandAvailable } from "./inrAssistantBadgeUiCommands.ts";
import { inrAssistantWebsiteUiCommandAvailable, type InrAssistantWebsiteUiCommand } from "./inrAssistantWebsiteUiCommands.ts";
import { getAssistantInternalDestination } from "./inrAssistantNavigation.ts";
import { parseInrAssistantDocumentPrefill, type InrAssistantDocumentPrefill } from "./inrAssistantDocumentUiCommands.ts";

import { parseInrAssistantLocalInterfaceHints, type InrAssistantLocalInterfaceHint } from "./inrAssistantLocalInterface.ts";
export type InrAssistantClientError = { code?: string; requestId?: string; occurredAt: string };
export type InrAssistantClientScreen = {
  pathname: string; tool: string; action?: string; panel?: string; channel?: string; step?: string;
  selection?: { kind: "contact" | "publication" | "campaign" | "event" | "quote" | "invoice" | "media" | "mail" | "stats" | "channel" | "business_form"; id: string };
  pendingChanges?: boolean;
  agentSettings?: 'publish' | 'stats';
  revision?: string;
  documentVersion?: string;
  documentPrefill?: InrAssistantDocumentPrefill;
  /** Only explicitly checked library items, never arbitrary DOM or ownership claims. */
  selectedMediaIds?: string[];
  selectionOverflow?: boolean;
  availableCommands?: ("configure_business_form" | "export_document_pdf" | "configure_ads_draft" | "save_ads_draft" | "configure_video_retouch" | "configure_mail_draft" | "save_mail_draft" | "send_mail_draft" | "open_mail_schedule" | "prepare_document_mail" | "create_document_template" | InrAssistantMediaUiCommandName | InrAssistantStudioUiCommandName | InrAssistantStatsUiCommandName | "download_badge_qr" | InrAssistantWebsiteUiCommand["command"])[];
};
/** Browser hints only: never an authenticated scope, entitlement or confirmed diagnosis. */
export type InrAssistantClientContext = {
  mediaPreview?: {requestId:string;mediaId:string};
  interfaces?: InrAssistantLocalInterfaceHint[];
  contentReport?: InrAssistantContentReportHint;
  source: "untrusted_client"; screen?: InrAssistantClientScreen; visibleError?: InrAssistantClientError;
};

const ACTIONS = new Set(["channels", "publish", "campaigns", "cash", "help", "generator", "stats"]);
const PANELS = new Set(["contact", "profil", "preferences", "notifications", "inrbadge", "compte", "activite", "ia", "ai_memory", "abonnement", "factures", "mails", "agenda", "site_web", "site_inrcy", "instagram", "threads", "linkedin", "x", "gmb", "inr_search", "inr_directory", "facebook", "tiktok", "youtube_shorts", "pinterest", "legal", "rgpd", "inertie", "boutique", "parrainage", "documents", "trustpilot"]);
const CHANNELS = new Set(["site_web", "gmb", "facebook", "instagram", "threads", "linkedin", "tiktok", "youtube_shorts", "pinterest", "x", "inr_search", "inr_directory", "inrbadge", "mails", "meta", "google", "openai"]);
const STEPS = new Set([...INR_ASSISTANT_BUSINESS_FORM_TABS,"mode", "channels", "intention", "content", "media", "control", "validation", "publication", "results", "project", "analysis", "foundations", "budget", "geography", "targeting", "bidding", "creative", "review", "launch", "keywords", "pinterest_format", "identity", "delivery"]);
const member = (value: unknown, values: Set<string>) => typeof value === "string" && values.has(value) ? value : undefined;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function parseInrAssistantRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{7,127}$/i.test(value) ? value : undefined;
}

/** Strip all arbitrary text, URLs, account identifiers, stacks and unknown fields. */
export function parseInrAssistantClientContext(value: unknown, now = Date.now()): InrAssistantClientContext | null {
  const input = record(value);
  const rawScreen = record(input.screen);
  let screen: InrAssistantClientScreen | undefined;
  if (typeof rawScreen.pathname === "string" && /^\/dashboard(?:\/[a-z0-9-]+)*$/.test(rawScreen.pathname) && rawScreen.pathname.length <= 100) {
    const action = member(rawScreen.action, ACTIONS);
    const panel = member(rawScreen.panel, PANELS);
    const channel = member(rawScreen.channel, CHANNELS);
    const step = member(rawScreen.step, STEPS);
    const params = new URLSearchParams();
    if (action) params.set(["help", "generator", "stats"].includes(action) ? action : "action", ["help", "generator", "stats"].includes(action) ? "1" : action);
    if (panel) params.set("panel", panel);
    const destination = getAssistantInternalDestination(`${rawScreen.pathname}${params.size ? `?${params}` : ""}`);
    const rawSelection = record(rawScreen.selection);
    const kinds = ["contact", "publication", "campaign", "event", "quote", "invoice", "media", "mail", "stats", "channel", "business_form"];
    const selection = typeof rawSelection.kind === "string" && kinds.includes(rawSelection.kind) && typeof rawSelection.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(rawSelection.id)
      ? { kind: rawSelection.kind as NonNullable<InrAssistantClientScreen["selection"]>["kind"], id: rawSelection.id } : undefined;
    const availableCommands = Array.isArray(rawScreen.availableCommands) && selection ? rawScreen.availableCommands.filter((command): command is NonNullable<InrAssistantClientScreen["availableCommands"]>[number] =>
      isInrAssistantBusinessFormUiCommandAvailable(command, rawScreen.pathname, selection.kind)
      || isInrAssistantMediaUiCommandAvailable(command, rawScreen.pathname, selection.kind)
      || inrAssistantWebsiteUiCommandAvailable(command, rawScreen.pathname, selection.kind, panel)
      || inrAssistantBadgeUiCommandAvailable(command, rawScreen.pathname, selection.kind, panel)
      || inrAssistantStudioUiCommandAvailable(command, rawScreen.pathname, selection.kind)
      || isInrAssistantStatsUiCommandAvailable(command, rawScreen.pathname, selection.kind)
      || command === "export_document_pdf" && ["quote", "invoice"].includes(selection.kind)
      || command === "create_document_template" && ["quote", "invoice"].includes(selection.kind) && rawScreen.pathname === `/dashboard/${selection.kind === "quote" ? "devis" : "factures"}/new`
      || command === "prepare_document_mail" && ["quote", "invoice"].includes(selection.kind) && rawScreen.pathname === `/dashboard/${selection.kind === "quote" ? "devis" : "factures"}/new` && rawScreen.pendingChanges === false
      || (command === "configure_ads_draft" || command === "save_ads_draft") && selection.kind === "campaign" && rawScreen.pathname === "/dashboard/ads"
      || ["configure_mail_draft", "save_mail_draft", "send_mail_draft", "open_mail_schedule"].includes(String(command)) && selection.kind === "mail" && rawScreen.pathname === "/dashboard/mails"
      || command === "configure_video_retouch" && selection.kind === "media" && rawScreen.pathname === "/dashboard/generer-media") : undefined;
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    const selectedMediaIds = rawScreen.pathname === "/dashboard/mediatheque" && Array.isArray(rawScreen.selectedMediaIds) && rawScreen.selectedMediaIds.length > 0 && rawScreen.selectedMediaIds.length <= 25 && rawScreen.selectedMediaIds.every(id => typeof id === "string" && uuid.test(id)) && new Set(rawScreen.selectedMediaIds).size === rawScreen.selectedMediaIds.length ? [...rawScreen.selectedMediaIds] as string[] : undefined;
    const selectionOverflow = rawScreen.pathname === "/dashboard/mediatheque" && rawScreen.selectionOverflow === true;
    const agentSettings = rawScreen.agentSettings === 'publish' && rawScreen.pathname === '/dashboard/agent/publications' && selection?.kind === 'publication' && selection.id === 'agent_publish' ? 'publish' as const
      : rawScreen.agentSettings === 'stats' && rawScreen.pathname === '/dashboard/agent/stats' && selection?.kind === 'stats' && selection.id === 'agent_stats' ? 'stats' as const : undefined;
    const revision = typeof rawScreen.revision === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(rawScreen.revision) ? rawScreen.revision : undefined;
    const documentVersion = selection && ["quote", "invoice"].includes(selection.kind) && typeof rawScreen.documentVersion === "string" && rawScreen.documentVersion.length <= 40 && Number.isFinite(Date.parse(rawScreen.documentVersion)) ? rawScreen.documentVersion : undefined;
    const prefill = parseInrAssistantDocumentPrefill(rawScreen.documentPrefill);
    const documentPrefill = prefill && selection?.kind === prefill.kind && rawScreen.pathname === `/dashboard/${prefill.kind === "quote" ? "devis" : "factures"}/new` ? prefill : undefined;
    if (destination) screen = { pathname: rawScreen.pathname, tool: destination.label, ...(action ? { action } : {}), ...(panel ? { panel } : {}), ...(channel ? { channel } : {}), ...(step ? { step } : {}), ...(selection ? { selection } : {}), ...(agentSettings ? { agentSettings } : {}), ...(revision ? { revision } : {}), ...(documentVersion ? { documentVersion } : {}), ...(documentPrefill ? { documentPrefill } : {}), ...(typeof rawScreen.pendingChanges === "boolean" ? { pendingChanges: rawScreen.pendingChanges } : {}), ...(availableCommands?.length ? { availableCommands } : {}), ...(selectedMediaIds && !selectionOverflow ? { selectedMediaIds } : {}), ...(selectionOverflow ? { selectionOverflow: true } : {}) };
  }
  const rawError = record(input.visibleError);
  const requestId = parseInrAssistantRequestId(rawError.requestId);
  const code = typeof rawError.code === "string" && /^[a-z][a-z0-9_.-]{0,79}$/i.test(rawError.code) ? rawError.code : undefined;
  const timestamp = typeof rawError.occurredAt === "string" && rawError.occurredAt.length <= 30 ? Date.parse(rawError.occurredAt) : NaN;
  const visibleError = (code || requestId) && Number.isFinite(timestamp) && timestamp <= now + 5_000 && now - timestamp <= 300_000
    ? { ...(code ? { code } : {}), ...(requestId ? { requestId } : {}), occurredAt: new Date(timestamp).toISOString() } : undefined;
  const rawPreview=record(input.mediaPreview);
  const mediaPreview=typeof rawPreview.requestId === "string" && /^[a-z0-9_-]{8,180}$/i.test(rawPreview.requestId) && typeof rawPreview.mediaId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(rawPreview.mediaId) ? {requestId:rawPreview.requestId,mediaId:rawPreview.mediaId} : undefined;
  const interfaces = parseInrAssistantLocalInterfaceHints(input.interfaces);
  const contentReport = parseInrAssistantContentReportHint(input.contentReport);
  const context: InrAssistantClientContext = { ...(contentReport ? { contentReport } : {}), ...(interfaces ? { interfaces } : {}), source: "untrusted_client", ...(mediaPreview ? {mediaPreview} : {}), ...(screen ? { screen } : {}), ...(visibleError ? { visibleError } : {}) };
  return (screen || visibleError || mediaPreview || interfaces || contentReport) && JSON.stringify(context).length <= 4_800 ? context : null;
}

/** Read only known query values; OAuth, drafts, names and free text never leave the browser here. */
export function getInrAssistantClientScreen(pathname: string, params: { get: (key: string) => string | null }): InrAssistantClientScreen | undefined {
  const action = params.get("action") || (["help", "generator", "stats"].find(key => params.get(key) === "1"));
  return parseInrAssistantClientContext({ screen: { pathname, action, panel: params.get("panel"), channel: params.get("channel"), step: params.get("step") } })?.screen;
}

/** Prefer the mounted entity/channel over its containing page. Ignore stale routes. */
export function selectInrAssistantClientScreen(base: InrAssistantClientScreen | undefined, overrides: InrAssistantClientScreen[]): InrAssistantClientScreen | undefined {
  if (!base) return undefined;
  const priority = (screen: InrAssistantClientScreen) => (screen.selection || screen.selectedMediaIds?.length || screen.selectionOverflow ? 50 : 0) + (screen.channel ? 20 : 0) + (screen.panel ? 10 : 0) + (screen.action ? 5 : 0) + (screen.step ? 2 : 0) + (screen.pendingChanges ? 1 : 0);
  return overrides.filter(screen => screen.pathname === base.pathname).sort((left, right) => priority(left) - priority(right)).at(-1) || base;
}
