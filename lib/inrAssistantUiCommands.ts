import { getAssistantInternalDestination } from "./inrAssistantNavigation.ts";

/** Shared public destinations. These commands navigate; they never grant business permissions. */
export const INR_ASSISTANT_NAVIGATION = {
  home: "/dashboard", channels: "/dashboard?action=channels", crm: "/dashboard/crm",
  calendar: "/dashboard/agenda", studio: "/dashboard/generer-media", media: "/dashboard/mediatheque",
  booster: "/dashboard?action=publish", campaigns: "/dashboard?action=campaigns",
  reputation: "/dashboard/e-reputation", stats: "/dashboard?stats=1", mail: "/dashboard/mails",
  ads: "/dashboard/ads", quotes: "/dashboard/devis", invoices: "/dashboard/factures",
  dna: "/dashboard/adn-entreprise", ai: "/dashboard/configuration-ia",
  account: "/dashboard?panel=compte", subscription: "/dashboard?panel=abonnement",
  preferences: "/dashboard?panel=preferences", notifications: "/dashboard?panel=notifications",
  calendar_settings: "/dashboard?panel=agenda", mail_settings: "/dashboard?panel=mails",
  document_settings: "/dashboard?panel=documents", badge: "/dashboard?panel=inrbadge",
  google_business: "/dashboard?panel=gmb", facebook: "/dashboard?panel=facebook",
  instagram: "/dashboard?panel=instagram", threads: "/dashboard?panel=threads",
  linkedin: "/dashboard?panel=linkedin", tiktok: "/dashboard?panel=tiktok",
  youtube: "/dashboard?panel=youtube_shorts", pinterest: "/dashboard?panel=pinterest",
  x: "/dashboard?panel=x", website: "/dashboard?panel=site_web", search: "/dashboard?panel=inr_search",
  publication_agent: "/dashboard/agent/publications", email_agent: "/dashboard/agent/campagnes-mails",
  stats_agent: "/dashboard/agent/stats", help: "/dashboard?help=1", contact: "/dashboard?panel=contact",
  credits: "/dashboard/boutique/recharges", cash: "/dashboard?action=cash",
} as const;
export const INR_ASSISTANT_NAVIGATION_DESTINATIONS = Object.keys(INR_ASSISTANT_NAVIGATION) as (keyof typeof INR_ASSISTANT_NAVIGATION)[];
export type InrAssistantNavigation = { destination: string; href: string; label: string; documentId?: string };
export type InrAssistantUiCommand = { command: "export_document_pdf"; selection: { kind: "quote" | "invoice"; id: string } };
export function parseInrAssistantUiCommand(value: unknown): InrAssistantUiCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const selection = row.selection && typeof row.selection === "object" ? row.selection as Record<string, unknown> : {};
  return row.command === "export_document_pdf" && (selection.kind === "quote" || selection.kind === "invoice") && typeof selection.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(selection.id)
    ? { command: "export_document_pdf", selection: { kind: selection.kind, id: selection.id } } : null;
}

export function getInrAssistantNavigation(destination: unknown, documentId?: unknown): InrAssistantNavigation | null {
  if (typeof destination !== "string" || !Object.hasOwn(INR_ASSISTANT_NAVIGATION, destination)) return null;
  if (documentId !== undefined && documentId !== null) {
    if (typeof documentId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(documentId) || !["quotes", "invoices"].includes(destination)) return null;
    return { destination, documentId, href: `/dashboard/${destination === "quotes" ? "devis" : "factures"}/new?saveId=${documentId}`, label: destination === "quotes" ? "Ouvrir le devis" : "Ouvrir la facture" };
  }
  const href = INR_ASSISTANT_NAVIGATION[destination as keyof typeof INR_ASSISTANT_NAVIGATION];
  const target = getAssistantInternalDestination(href);
  return target ? { destination, href: target.href, label: target.label } : null;
}

export function parseInrAssistantNavigation(value: unknown): InrAssistantNavigation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const target = getInrAssistantNavigation(input.destination, input.documentId);
  // Do not accept provider/browser supplied URLs or labels, even for known keys.
  return target && input.href === target.href && input.label === target.label ? target : null;
}

export function isInrAssistantNavigationRequest(message: string): boolean {
  const text = message.replace(/```[\s\S]*?(?:```|$)|«[^»]*»|"[^"]*"|^>.*$/gm, " ")
    .normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  if (/^(?:comment|pourquoi|explique|how|why|what|si |imagine|suppose)\b/.test(text)) return false;
  if (/\b(?:ne |n['’]|sans |do not |don't ).{0,25}(?:ouvr|ouvre|affich|montr|emmene|amene|navig|open|show)/.test(text)) return false;
  return /\b(?:ouvre|ouvrez|ouvrir|affiche|affichez|montre|montrez|emmene|amene|navigate|open|show)\b|\b(?:va|aller|go)\s+(?:dans|sur|a|au|aux|to)\b/.test(text);
}

export function isInrAssistantScreenCommandRequest(message: string): boolean {
  const text = message.replace(/```[\s\S]*?(?:```|$)|«[^»]*»|"[^"]*"|^>.*$/gm, " ")
    .normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  return /\bpdf\b/.test(text) && /\b(?:telecharge\w*|exporte\w*|gener\w*|prepare\w*|download|export|generate)\b/.test(text)
    && !/^(?:comment|pourquoi|explique|how|why|si |imagine)\b|\b(?:ne |n['’]|sans |do not |don't ).{0,30}(?:telecharg|export|gener|prepar|download)/.test(text);
}

/** Resolve only an explicit module opening at the start of the current request.
 * Record-specific and ambiguous destinations still require the normal tools. */
export function getDirectInrAssistantNavigationRequest(message: string): { destination: string; instructionQuote: string } | null {
  if (message.length > 1200 || !isInrAssistantNavigationRequest(message)) return null;
  const text = message.replace(/```[\s\S]*?(?:```|$)|«[^»]*»|"[^"]*"|^>.*$/gm, " ")
    .normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const opening = text.match(/^(?:ouvre|ouvrez|affiche|affichez|open|show)\s+(?:(?:les|le|la|mon|ma|mes|the|my)\s+|l['’]\s*)?(?:(?:module|panneau|page|ecran)\s+)?/);
  if (!opening) return null;
  const remainder = text.slice(opening[0].length);
  const aliases: Array<[string, RegExp]> = [
    ["preferences", /^preferences\b/], ["notifications", /^notifications\b/],
    ["crm", /^(?:inr['’]?\s*)?crm\b/], ["calendar", /^(?:agenda|(?:inr['’]?\s*)?calendar)\b/],
    ["channels", /^(?:mes\s+)?canaux\b/], ["studio", /^(?:inr['’]?\s*)?studio\b/],
    ["media", /^(?:mediatheque|medias)\b/], ["stats", /^(?:inr['’]?\s*)?stats\b/],
    ["account", /^compte\b/], ["subscription", /^abonnement\b/],
    ["home", /^(?:accueil|tableau de bord)\b/], ["dna", /^adn(?: de l['’]entreprise)?\b/],
    ["ai", /^configuration ia\b/], ["reputation", /^reputation\b/],
  ];
  for (const [destination, pattern] of aliases) {
    const match = remainder.match(pattern);
    if (!match) continue;
    const after = remainder.slice(match[0].length);
    if (!/^(?:\s+(?:de l['’]application|de mon application))?(?:$|[.!?,;]|\s+(?:et|puis|pour moi|sans|seulement)\b)/.test(after)) return null;
    if (/\b(?:ouvre|ouvrez|affiche|affichez|ouvrir|open|show|va dans)\b/.test(after)) return null;
    return { destination, instructionQuote: message };
  }
  return null;
}

export type InrAssistantTaskProgress = {
  outcome: "completed" | "partial" | "needs_input" | "processing" | "blocked" | "failed";
  completed: string[]; remaining: string[];
};
export function parseInrAssistantTaskProgress(value: unknown): InrAssistantTaskProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!["completed", "partial", "needs_input", "processing", "blocked", "failed"].includes(String(row.outcome))) return null;
  const list = (value: unknown): string[] | null => Array.isArray(value) && value.length <= 24 && value.every(item => typeof item === "string" && item.length > 0 && item.length <= 160 && !/[\u0000-\u001f\u007f]/.test(item)) ? [...new Set(value as string[])] : null;
  const completed = list(row.completed), remaining = list(row.remaining);
  return completed && remaining ? { outcome: row.outcome as InrAssistantTaskProgress["outcome"], completed, remaining } : null;
}
