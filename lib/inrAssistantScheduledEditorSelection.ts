import { inrAssistantRequestClauses, inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";

export type InrAssistantScheduledTextDraft = { channel: string | null; title: string; body: string; hashtags: string; cta: string; ctaMode: string; ctaUrl: string; ctaPhone: string; ctaAction: string };
export type InrAssistantScheduledTextChange = { field: "title" | "body" | "hashtags" | "cta" | "ctaUrl" | "ctaPhone"; value: string } | { field: "ctaChoice"; value: string } | { field: "websiteChoice"; value: "site_web" } | { field: "apply"; value: "channel" | "all_channels" };
type Context = { enabled: boolean; open: boolean; busy: boolean; draft: InrAssistantScheduledTextDraft; ctaChoice: string; ctaMode: string; ctaChoices: readonly string[]; websiteUrl: string; supportsHashtags: boolean };
export function parseInrAssistantScheduledTextSelection(encoded: unknown, context: Context): InrAssistantScheduledTextChange | null {
  if (!context.enabled || !context.open || context.busy || !context.draft.channel || typeof encoded !== "string" || encoded.length > 40000) return null;
  let input: unknown; try { input = JSON.parse(encoded); } catch { return null; }
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2) return null;
  const row = input as Record<string, unknown>; if (typeof row.field !== "string" || typeof row.value !== "string") return null;
  if (row.field === "apply") return (row.value === "channel" || row.value === "all_channels") && !!context.draft.body.trim() ? row as InrAssistantScheduledTextChange : null;
  if (row.field === "ctaChoice") return context.ctaChoices.includes(row.value) ? row as InrAssistantScheduledTextChange : null;
  if (row.field === "websiteChoice") return row.value === "site_web" && context.ctaMode === "website" && /^https?:\/\//i.test(context.websiteUrl) ? row as InrAssistantScheduledTextChange : null;
  const limits: Record<string, number> = { title: 180, body: 6000, hashtags: 280, cta: 180, ctaUrl: 320, ctaPhone: 40 };
  if (!Object.hasOwn(limits, row.field) || row.value.length > limits[row.field]) return null;
  if (row.field === "hashtags" && !context.supportsHashtags) return null;
  if (row.field === "ctaUrl" && (!(context.ctaMode === "website" || context.ctaMode === "custom" && context.ctaChoice !== "whatsapp") || row.value !== "" && !/^https?:\/\/[^\s]+$/i.test(row.value))) return null;
  if (row.field === "cta" && context.ctaMode !== "website" && context.ctaMode !== "custom") return null;
  if (row.field === "ctaPhone" && (!(context.ctaMode === "call" || context.ctaChoice === "whatsapp") || row.value !== "" && !/^\+?[\d\s().-]+$/.test(row.value))) return null;
  return row as InrAssistantScheduledTextChange;
}
export type InrAssistantScheduledOptionChange = { field: "placement" | "threadsMode" | "pinterestBoard"; value: string };
export function parseInrAssistantScheduledOptionSelection(encoded: unknown, context: { enabled: boolean; busy: boolean; channel: string | null; placements: readonly string[]; storyEnabled: boolean; hasUsableMedia: boolean; threadsModes: readonly string[]; pinterestBoardIds: readonly string[] }): InrAssistantScheduledOptionChange | null {
  if (!context.enabled || context.busy || typeof encoded !== "string" || encoded.length > 1200) return null;
  let input: unknown; try { input = JSON.parse(encoded); } catch { return null; }
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2) return null;
  const row = input as Record<string, unknown>; if (typeof row.field !== "string" || typeof row.value !== "string") return null;
  if (row.field === "placement" && ["facebook", "instagram"].includes(context.channel ?? "")) {
    const placement = row.value.replace(/_story$/, ""), story = row.value.endsWith("_story");
    return ["classic", "reel", "story", "classic_story", "reel_story"].includes(row.value) && context.placements.includes(placement) && (!story || context.storyEnabled) && (row.value === "classic" || context.hasUsableMedia) ? row as InrAssistantScheduledOptionChange : null;
  }
  if (row.field === "threadsMode") return context.channel === "threads" && context.threadsModes.includes(row.value) ? row as InrAssistantScheduledOptionChange : null;
  if (row.field === "pinterestBoard") return context.channel === "pinterest" && !!row.value && context.pinterestBoardIds.includes(row.value) ? row as InrAssistantScheduledOptionChange : null;
  return null;
}

/** Shared server guard: local CTA bytes and the requested field cannot be invented. */
export function isInrAssistantScheduledEditorValueRequested(message: string, target: string, value: string | null): boolean {
  const text = inrAssistantUnquotedRequest(message);
  if (inrAssistantRequestClauses(message).filter(clause => /\b(?:mets|mettez|choisis|selectionne\w*|modifi\w*|chang\w*|regl\w*|activ\w*|desactiv\w*|ajout\w*|coupe|ouvre\w*|affich\w*|appliqu\w*|enregistr\w*)\b/.test(clause)).length > 1) return false;
  if (!/\b(?:programm\w*|planifi\w*|planning)\b/.test(text) || /par defaut|preferences?|global\w*|automati\w*/.test(text)) return false;
  if (value === null) return true;
  if (target === "scheduled_publication_channel") {
    const channels: Record<string, RegExp> = { siteWeb: /site web|site internet/, inrSearch: /inr.?search/, gmb: /google|gmb/, facebook: /facebook/, instagram: /instagram|insta/, threads: /threads/, linkedin: /linkedin/, x: /\bx\b|twitter/, tiktok: /tiktok/, youtube: /youtube/, pinterest: /pinterest/ };
    return /canal/.test(text) && !!channels[value]?.test(text);
  }
  if (target === "scheduled_publication_text_form") {
    let input: { field?: string; value?: unknown }; try { input = JSON.parse(value); } catch { return false; }
    if (typeof input.value !== "string") return false;
    const fields: Record<string, RegExp> = { title: /\btitre\b/, body: /\b(?:contenu|texte|corps)\b/, hashtags: /hashtags?|mots.?(?:cles|dieses)/, cta: /texte.{0,20}(?:cta|bouton|appel)|(?:cta|bouton|appel).{0,20}(?:texte|libelle)/, ctaUrl: /url|lien|destination|adresse/, ctaPhone: /telephone|numero|whatsapp/, ctaChoice: /cta|bouton|appel.{0,10}action/, websiteChoice: /site\s+(?:web|enregistre|pre.*rempli)|url.{0,20}(?:catalogue|profil|enregistree)/, apply: /appliqu\w*|valid\w*|enregistr\w*/ };
    if (!fields[input.field ?? ""]?.test(text)) return false;
    if (["ctaUrl", "ctaPhone", "cta"].includes(input.field ?? "") && !message.includes(input.value)) return false;
    if (input.field === "body" && /cta|bouton|appel.{0,10}action/.test(text) && !/contenu|corps/.test(text)) return false;
    if (input.field === "apply") { const all = /tous?.{0,15}canaux|ensemble.{0,15}canaux/.test(text); return input.value === "all_channels" ? all : input.value === "channel" && !all; }
    if (input.field === "ctaChoice") {
      const choices: Record<string, RegExp> = { none: /aucun|desactiv|retir|sans.{0,15}(?:bouton|cta)/, site: /site|visiter/, devis: /devis/, appeler: /appeler|appel|telephone/, message: /message|\bmp\b/, whatsapp: /whatsapp/, custom: /personnalis|custom/, reserver: /reserv/, commander: /commander|commande/, acheter: /acheter|achat/, inscrire: /inscri/ };
      return !!choices[input.value]?.test(text);
    }
    return true;
  }
  if (target === "scheduled_publication_media") {
    if (!/media|image|video|photo|studio/.test(text)) return false;
    if (value === "apply_to_all") return /tous?.{0,15}canaux|ensemble.{0,15}canaux/.test(text);
    if (value === "studio_generate") return /gener\w*|creer|cree\w*/.test(text) && !/retouch|recadr|modifier|modifie/.test(text);
    if (value === "studio_modify") return /modifi\w*/.test(text) && !/retouch|recadr/.test(text);
    if (value === "studio_retouch") return /retouch|recadr|cadrage|adapter|adaptation/.test(text);
    if (/^index:(?:0|[1-9]\d?)$/.test(value)) {
      const index = Number(value.slice(6)), ordinal = ["premier(?:e)?", "deuxieme|seconde", "troisieme", "quatrieme", "cinquieme"][index];
      return !!ordinal && (new RegExp(`\\b(?:la|le|l')\\s*(?:${ordinal})\\b`).test(text) || new RegExp(`\\b(?:image|photo|media)\\s*(?:n[°o]\\s*)?${index + 1}\\b`).test(text));
    }
    return false;
  }
  if (target === "scheduled_publication_options") {
    let input: { field?: string; value?: unknown }; try { input = JSON.parse(value); } catch { return false; }
    if (input.field === "placement") {
      const reel = /\breels?\b/.test(text), story = /\bstor(?:y|ies)\b/.test(text), classic = /classique|classic/.test(text);
      return reel ? input.value === (story ? "reel_story" : "reel") : classic ? input.value === (story ? "classic_story" : "classic") : story && input.value === "story";
    }
    if (input.field === "threadsMode") return /threads/.test(text) && (input.value === "ghost" ? /\bghost\b/.test(text) && !/classique|classic/.test(text) : input.value === "classic" && /classique|classic/.test(text) && !/\bghost\b/.test(text));
    return input.field === "pinterestBoard" && /pinterest/.test(text) && /tableau/.test(text);
  }
  return true;
}
