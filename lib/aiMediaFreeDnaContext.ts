import type { NormalizedAiGenerationProfile } from "./aiGenerationProfile.ts";

/** Public business facts only, assembled on the server for the active account. */
export type AiMediaFreeDnaContext = {
  coordonnees: Record<string, string>;
  liens: Record<string, string>;
  informations_demandees: string[];
};

export const AI_MEDIA_FREE_DNA_MAX_CHARS = 4_800;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown, maximum = 600) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, maximum)
    : "";
}

/** Do not shorten a URL or transmit signed URLs, credentials or query tokens. */
export function normalizeAiMediaBusinessUrl(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > 600) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
      !url.hostname.includes(".") || /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname) ||
      /^\d+(?:\.\d+){3}$/.test(url.hostname) || url.pathname.includes("/object/sign/") ||
      [...url.searchParams.keys()].some((key) => /token|secret|signature|api.?key|credential|authorization|code/i.test(key))) return "";
    return url.href;
  } catch { return ""; }
}

function terms(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .match(/[a-z0-9]{3,}/g)?.filter((word) => !/^(?:une|des|les|avec|pour|dans|mon|mes|notre|nos|sur|par|que|qui|video|image|affiche|creer|realise|montre)$/.test(word)) || [];
}

/** Retrieve relevant intact facts from all saved ADN fields and document extracts. */
export function selectAiMediaFreeDnaEvidence(profile: NormalizedAiGenerationProfile, prompt: string, serviceDetails: unknown = {}) {
  const memory = record(profile.memory);
  const entries: Array<{ label: string; content: string }> = [];
  for (const key of ["detailedDescription", "mission", "specialties", "targetAudiences", "customerNeeds", "differentiators", "values", "brandPersonality", "commitments", "preferredVocabulary", "forbiddenVocabulary", "recentNewsItems"]) {
    const value = memory[key];
    for (const item of Array.isArray(value) ? value : [value]) {
      const content = text(item, 6_000);
      if (content) entries.push({ label: key, content });
    }
  }
  if (profile.preferences.premiumEnabled) {
    for (const key of ["offersAndArguments", "keyArguments", "proofsAndObjections", "objectionResponses", "editorialStrategy", "campaignCalendar"]) {
      const content = text(memory[key], 6_000);
      if (content) entries.push({ label: key, content });
    }
  }
  for (const [label, value] of Object.entries(record(serviceDetails)).slice(0, 100)) {
    const content = text(value, 6_000);
    if (content) entries.push({ label: text(label, 140), content });
  }
  for (const value of Array.isArray(memory.referenceDocuments) ? memory.referenceDocuments : []) {
    const document = record(value);
    const content = text(document.extractedText || document.note, 6_000);
    if (content) entries.push({ label: text(document.name, 180) || "Document ADN", content });
  }
  const keywords = new Set(terms(prompt));
  const wantsPrice = /\b(?:prix|tarif|cout|price|pricing|rate|cost|offer|offre|promotion)\w*\b/.test(terms(prompt).join(" "));
  const candidates = entries.flatMap(({ label, content }, order) => content.split(/\n+|(?<=[.!?])\s+/u)
    .map((line) => ({ line: `${label} : ${line.trim()}`, score: terms(`${label} ${line}`).reduce((sum, word) => sum + (keywords.has(word) ? 1 : 0), 0) + (wantsPrice && /\d[\d\s.,]*(?:€|EUR|euros?|USD|\$|£|%)/i.test(line) ? 3 : 0), order }))
    .filter(({ line, score }) => score > 0 && line.length <= 1_300));
  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
  const selected: string[] = [];
  for (const { line } of candidates) {
    if (selected.includes(line)) continue;
    if (JSON.stringify([...selected, line]).length <= 1_600) selected.push(line);
  }
  return selected;
}

export function buildAiMediaFreeDnaContext(args: {
  profile: NormalizedAiGenerationProfile;
  publicProfile: Record<string, unknown> | null;
  publicLinks: Record<string, unknown>;
  serviceDetails?: unknown;
  prompt: string;
}): AiMediaFreeDnaContext {
  const source = args.publicProfile || {};
  const contacts = {
    entreprise: text(source.company_legal_name || args.profile.business.companyName, 180),
    telephone: text(source.phone || args.profile.business.phone, 80),
    // An authentication email is not necessarily a public business contact.
    email: text(source.contact_email, 180),
    adresse: text(source.hq_address, 240),
    code_postal: text(source.hq_zip || args.profile.business.postalCode, 30),
    ville: text(source.hq_city || args.profile.business.city, 120),
    pays: text(source.hq_country, 80),
  };
  return {
    coordonnees: Object.fromEntries(Object.entries(contacts).filter(([, value]) => value)),
    liens: Object.fromEntries(Object.entries(args.publicLinks).map(([key, value]) => [key, normalizeAiMediaBusinessUrl(value)]).filter(([, value]) => value)),
    informations_demandees: selectAiMediaFreeDnaEvidence(args.profile, args.prompt, args.serviceDetails),
  };
}
