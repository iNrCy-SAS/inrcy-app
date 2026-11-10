import type { NormalizedAiGenerationProfile } from "./aiGenerationProfile.ts";
import { buildAiContentLocationPromptPayload } from "./aiContentLocation.ts";

/** Public business facts only, assembled on the server for the active account. */
export type AiMediaFreeDnaContext = {
  coordonnees: Record<string, string>;
  liens: Record<string, string>;
  informations_demandees: string[];
  localisation_editoriale?: Record<string, string>;
};

type AiMediaPublicationDna = {
  identite: Record<string, string>;
  prestations_pertinentes?: string[];
  atouts_pertinents?: string[];
  coordonnees?: Record<string, string>;
  liens?: Record<string, string>;
  informations_demandees?: string[];
  localisation_editoriale?: Record<string, string>;
  horaires?: string;
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

/** Small publication context; the complete saved ADN stays on the server. */
export function selectAiMediaFreePublicationDna(args: {
  profile: NormalizedAiGenerationProfile;
  prompt: string;
  context?: AiMediaFreeDnaContext;
}): AiMediaPublicationDna {
  const { business, memory } = args.profile;
  const wanted = args.prompt.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const keywords = new Set(terms(args.prompt));
  const companyTerms = new Set(terms(business.companyName));
  const topicKeywords = new Set([...keywords].filter(word => !companyTerms.has(word)
    && !/^(?:photo\w*|visuel\w*|publication\w*|texte\w*|logo|charte|couleurs?|sans|flyer|accroche\w*|original\w*|telephone|site|lien\w*|prix|tarif\w*|cout\w*|price\w*|pricing|offre\w*|offer\w*|promotion\w*)$/.test(word)));
  const presentation = /\b(?:present\w*|decouvr\w*|introduc\w*|about us)\b/.test(wanted);
  const relevant = (values: readonly string[] | undefined, maximum: number) => {
    const ranked = [...new Set((values || []).map(value => text(value, 180)).filter(Boolean))]
      .map((value, order) => ({ value, order, score: terms(value).filter(word => keywords.has(word)).length }))
      .filter(item => item.score > 0 || presentation)
      .sort((a, b) => b.score - a.score || a.order - b.order);
    return ranked.slice(0, maximum).map(item => item.value);
  };
  const identity = Object.fromEntries(Object.entries({
    entreprise: text(business.companyName, 180), metier: text(business.professionLabel, 140), secteur: text(business.sectorLabel, 120),
    ...(!business.professionLabel && business.description ? { activite: text(business.description, 280) } : {}),
  }).filter(([, value]) => value));
  const services = relevant(business.services, 3);
  const strengths = relevant([...(business.strengths || []), ...(memory.differentiators || [])], 2);
  const base: AiMediaPublicationDna = {
    identite: identity,
    ...(services.length ? { prestations_pertinentes: services } : {}),
    ...(strengths.length ? { atouts_pertinents: strengths } : {}),
  };
  const context = args.context;
  if (!context) return base;

  const excluded = (topic: string) => new RegExp(`(?:^|\\s)(?:sans|without|no|aucune?s?|pas|без|بدون)\\s+(?:(?:afficher|ajouter|mettre|indiquer|inclure|utiliser)\\s+)?(?:(?:mon|ma|mes|notre|nos|le|la|les|de|du|my|our|the|any|d['’])\\s*){0,3}(?:${topic})`, "u").test(wanted);

  const allContacts = !excluded("coordonnees|contact details|contact information|contact info|kontaktdaten|datos de contacto|contatti|контакт|بيانات الاتصال") && /coordonnees|contact details|contact information|contact info|kontaktdaten|datos de contacto|contatti|контактные данные|بيانات الاتصال/.test(wanted);
  const phone = !excluded("telephon|telefon|phone|tel\\b|numero|nummer|телефон|هاتف") && (allContacts || /telephon|telefon|\bphone\b|\btel\b|numero|nummer|call us|appelez|appeler|телефон|هاتف/.test(wanted));
  const email = !excluded("e.?mail|courriel|correo|posta elettronica|электронн|بريد") && (allContacts || /e.?mail|courriel|correo|posta elettronica|электронн|بريد/.test(wanted));
  const address = !excluded("adresse|address|direccion|endereco|indirizzo|anschrift|adres|адрес|عنوان") && (allContacts || /adresse|address|direccion|endereco|indirizzo|anschrift|\badres\b|адрес|عنوان/.test(wanted));
  const hours = !excluded("horaire|opening hours|horario|orari|offnungszeiten|openingstijden|часы|ساعات") && /horaire|opening hours|horarios?|orari|offnungszeiten|openingstijden|часы работы|مواعيد|ساعات العمل/.test(wanted);
  const price = !excluded("prix|tarif|cout|price|pricing|rate|cost|offre|offer|promotion|preis|precio|preco|prezz|цена|стоим|سعر|اسعار")
    && (/\b(?:prix|tarif\w*|cout\w*|price\w*|pricing|rate\w*|cost\w*|offre\w*|offer\w*|promotion\w*|preis\w*|precio\w*|preco\w*|prezz\w*)\b|цена|стоим|سعر|اسعار/.test(wanted)
      || /\d[\d\s.,]*(?:€|EUR|euros?|USD|\$|£|%)/i.test(args.prompt));
  const contacts = Object.fromEntries(Object.entries(context.coordonnees).filter(([key]) =>
    key === "telephone" ? phone : key === "email" ? email : ["adresse", "code_postal", "ville", "pays"].includes(key) ? address : false));
  const allSocial = !excluded("reseaux|social|redes|социальн|شبكات") && /reseaux sociaux|social (?:networks|media|links)|redes sociais|redes sociales|социальн|شبكات اجتماعية/.test(wanted);
  const namedSocial = /facebook|instagram|threads|linkedin|tiktok|pinterest|youtube|google business|google maps|\bx\b/.test(wanted);
  const website = !excluded("site|website|webseite|sito|sitio|pagina|lien|url|link|сайт|موقع") && (/\b(?:site|site_web|website|webseite|sito|sitio|pagina)\b|сайт|موقع/.test(wanted)
    || (!namedSocial && /\b(?:lien|liens|url|link|links|reservation)\b/.test(wanted)));
  const links = Object.fromEntries(Object.entries(context.liens).filter(([key]) => !excluded("lien|url|link") && !excluded(key === "google_business" ? "google business|google maps" : key)
    && (key === "site_web" || key === "site" ? website : allSocial || (key === "google_business" ? /google business|google maps/.test(wanted) : key === "x" ? /\bx\b|twitter/.test(wanted) : wanted.includes(key)))));
  const evidence = context.informations_demandees.filter(value => {
    // Relevant source extracts can mention tariffs without being a price request.
    if (!price && /\d[\d\s.,]*(?:€|EUR|euros?|USD|\$|£|%)/i.test(value)) return false;
    if (!hours && /horaire|opening hours|horarios?|orari/i.test(value)) return false;
    if (!email && /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(value)) return false;
    if (!Object.keys(links).length && /https?:\/\//i.test(value)) return false;
    if (!phone && /(?:telephone|telefon|phone|\btel\b)[^\n]{0,40}\d/i.test(value.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""))) return false;
    if (!/histoire|historique|mission|valeurs?|strategie|story|history|values|strategy/.test(wanted)
      && /^(?:mission|values|brandPersonality|commitments|preferredVocabulary|forbiddenVocabulary|editorialStrategy|campaignCalendar)\s*:/.test(value)) return false;
    if (topicKeywords.size && !terms(value).some(word => topicKeywords.has(word))) return false;
    return true;
  }).slice(0, /\b(?:tous|toutes|all|complete|complet)\b/.test(wanted) ? context.informations_demandees.length : 4);
  return {
    ...base,
    ...(context.localisation_editoriale ? { localisation_editoriale: context.localisation_editoriale } : {}),
    ...(Object.keys(contacts).length ? { coordonnees: contacts } : {}),
    ...(Object.keys(links).length ? { liens: links } : {}),
    ...(hours && business.openingHours ? { horaires: business.openingHours } : {}),
    ...(evidence.length ? { informations_demandees: evidence } : {}),
  };
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
  const contentLocation = buildAiContentLocationPromptPayload(args.profile);
  return {
    ...(contentLocation ? { localisation_editoriale: contentLocation } : {}),
    coordonnees: Object.fromEntries(Object.entries(contacts).filter(([, value]) => value)),
    liens: Object.fromEntries(Object.entries(args.publicLinks).map(([key, value]) => [key, normalizeAiMediaBusinessUrl(value)]).filter(([, value]) => value)),
    informations_demandees: selectAiMediaFreeDnaEvidence(args.profile, args.prompt, args.serviceDetails),
  };
}
