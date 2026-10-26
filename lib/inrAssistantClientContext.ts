import { getAssistantInternalDestination } from "./inrAssistantNavigation.ts";

export type InrAssistantClientError = { code?: string; requestId?: string; occurredAt: string };
export type InrAssistantClientScreen = {
  pathname: string; tool: string; action?: string; panel?: string; channel?: string; step?: string;
};
/** Browser hints only: never an authenticated scope, entitlement or confirmed diagnosis. */
export type InrAssistantClientContext = {
  source: "untrusted_client"; screen?: InrAssistantClientScreen; visibleError?: InrAssistantClientError;
};

const ACTIONS = new Set(["channels", "publish", "campaigns", "cash", "help", "generator", "stats"]);
const PANELS = new Set(["contact", "profil", "preferences", "inrbadge", "compte", "activite", "ia", "ai_memory", "abonnement", "factures", "mails", "agenda", "site_web", "site_inrcy", "instagram", "threads", "linkedin", "x", "gmb", "inr_search", "facebook", "tiktok", "youtube_shorts", "pinterest", "legal", "rgpd", "inertie", "boutique", "parrainage", "documents", "trustpilot"]);
const CHANNELS = new Set(["site_web", "gmb", "facebook", "instagram", "threads", "linkedin", "tiktok", "youtube_shorts", "pinterest", "x", "inr_search", "mails", "meta", "google", "openai"]);
const STEPS = new Set(["mode", "channels", "intention", "content", "media", "control", "validation", "publication", "results", "project", "analysis", "foundations", "budget", "geography", "targeting", "bidding", "creative", "review", "launch"]);
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
    if (destination) screen = { pathname: rawScreen.pathname, tool: destination.label, ...(action ? { action } : {}), ...(panel ? { panel } : {}), ...(channel ? { channel } : {}), ...(step ? { step } : {}) };
  }
  const rawError = record(input.visibleError);
  const requestId = parseInrAssistantRequestId(rawError.requestId);
  const code = typeof rawError.code === "string" && /^[a-z][a-z0-9_.-]{0,79}$/i.test(rawError.code) ? rawError.code : undefined;
  const timestamp = typeof rawError.occurredAt === "string" && rawError.occurredAt.length <= 30 ? Date.parse(rawError.occurredAt) : NaN;
  const visibleError = (code || requestId) && Number.isFinite(timestamp) && timestamp <= now + 5_000 && now - timestamp <= 300_000
    ? { ...(code ? { code } : {}), ...(requestId ? { requestId } : {}), occurredAt: new Date(timestamp).toISOString() } : undefined;
  const context: InrAssistantClientContext = { source: "untrusted_client", ...(screen ? { screen } : {}), ...(visibleError ? { visibleError } : {}) };
  return (screen || visibleError) && JSON.stringify(context).length <= 800 ? context : null;
}

/** Read only known query values; OAuth, drafts, names and free text never leave the browser here. */
export function getInrAssistantClientScreen(pathname: string, params: { get: (key: string) => string | null }): InrAssistantClientScreen | undefined {
  const action = params.get("action") || (["help", "generator", "stats"].find(key => params.get(key) === "1"));
  return parseInrAssistantClientContext({ screen: { pathname, action, panel: params.get("panel"), channel: params.get("channel"), step: params.get("step") } })?.screen;
}
