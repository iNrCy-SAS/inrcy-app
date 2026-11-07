import type { AiMediaSubjectSource, AiMediaOutputFormat, AiMediaImageStyle, AiMediaImagePurpose, AiMediaVisualDirection, AiMediaLogoMode, AiMediaTextMode, AiMediaPeopleCriterion, AiMediaSettingCriterion, AiMediaFocusCriterion, AiMediaTeamVideoSpeechMode } from "./aiMediaGenerationContracts.ts";
import { AI_MEDIA_FREE_PROMPT_MAX_CHARS, AI_MEDIA_SPOKEN_SCRIPT_MAX_CHARS } from "./aiMediaGenerationContracts.ts";
import { getAiMediaVisualBriefMaxChars, getAiMediaVideoSpeechState } from "./aiMediaVideoSpeechBudget.ts";
import type { AiMediaVideoEngine, AiMediaVideoResolution } from "./aiMediaModelCatalog.ts";
import { isAiMediaNarrationVoiceVariantForGender, type AiMediaNarrationVoiceVariant } from "./aiMediaNarrationVoices.ts";
import { inrAssistantRequestClauses, inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";

type Values = {
  activeTab: string; subjectSource: AiMediaSubjectSource; creativeBrief: string; sourceMode: "ai" | "criteria" | "real";
  people: AiMediaPeopleCriterion; setting: AiMediaSettingCriterion; focus: AiMediaFocusCriterion;
  imagePurpose: AiMediaImagePurpose; format: AiMediaOutputFormat; imageStyle: AiMediaImageStyle; visualDirection: AiMediaVisualDirection;
  useBrandColors: boolean; logoMode: AiMediaLogoMode; textMode: AiMediaTextMode; exactText: string; textKeywords: string[]; textKeywordDraft: string;
  speechMode: AiMediaTeamVideoSpeechMode | "silent"; narrationVoice: "female" | "male"; narrationVoiceVariant: AiMediaNarrationVoiceVariant;
  voiceMode: "ai" | "provided"; voiceReferenceId: string | null;
  withMusic: boolean; durationScene: { seconds: number; sceneMode: "single" | "multi" };
  prompt: string; useBusinessDna: boolean; spokenScript: string; spokenScriptOpen: boolean; withSubtitles: boolean;
};
export type InrAssistantStudioFormSelection = { [K in keyof Values]: { field: K; value: Values[K] } }[keyof Values];
export type InrAssistantStudioFormSnapshot = Partial<Values> & {
  mode: "guided" | "free"; kind: "image" | "video"; locked: boolean; editorVisible: boolean;
  transformMode?: boolean; publicationAvailable?: boolean; fixedFormat?: string; maxPromptLength?: number;
  videoEngine?: AiMediaVideoEngine | null; videoResolution?: AiMediaVideoResolution | null; language?: string;
  voiceReferences?: Array<{ id: string; name: string; voiceMode: "ai" | "provided"; referenceIndex?: number }>;
};
const choices: Partial<Record<keyof Values, readonly unknown[]>> = {
  subjectSource: ["profile", "publication", "custom"], sourceMode: ["ai", "criteria", "real"],
  people: ["auto", "none", "one", "two", "three", "group"], setting: ["auto", "interior", "exterior", "studio", "neutral"], focus: ["auto", "people", "product", "environment"],
  imagePurpose: ["auto", "simple", "social", "flyer", "product_sheet", "poster", "banner", "infographic"], format: ["square", "portrait", "story", "landscape"],
  imageStyle: ["photo", "illustration", "three_d", "graphic"], visualDirection: ["auto", "clean", "premium", "warm", "dynamic", "bold"],
  logoMode: ["discreet", "visible", "none"], textMode: ["none", "ai", "exact"], narrationVoice: ["female", "male"], voiceMode: ["ai", "provided"],
};
const guided = ["activeTab", "subjectSource", "creativeBrief", "sourceMode", "people", "setting", "focus", "imagePurpose", "format", "imageStyle", "visualDirection", "useBrandColors", "logoMode", "textMode", "exactText", "textKeywords", "textKeywordDraft", "speechMode", "narrationVoice", "narrationVoiceVariant", "withMusic", "durationScene"];
const free = ["activeTab", "prompt", "useBusinessDna", "format", "durationScene", "speechMode", "spokenScript", "spokenScriptOpen", "narrationVoice", "narrationVoiceVariant", "withMusic", "withSubtitles", "voiceMode", "voiceReferenceId"];
const videoOnly = ["speechMode", "narrationVoice", "narrationVoiceVariant", "withMusic", "durationScene", "spokenScript", "spokenScriptOpen", "withSubtitles", "voiceMode", "voiceReferenceId"];
/** One finite native field at a time. No submit, identity consent, source URL,
 * job mutation, preference write or executable payload enters this interface. */
export function parseInrAssistantStudioFormSelection(value: string | null, state: InrAssistantStudioFormSnapshot, durationAllowed?: (seconds: number, mode: "single" | "multi") => boolean): InrAssistantStudioFormSelection | null {
  if (!value || value.length > 25000 || state.locked || !state.editorVisible) return null;
  let input: unknown; try { input = JSON.parse(value); } catch { return null; }
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>, field = row.field as keyof Values, next = row.value;
  if (Object.keys(row).length !== 2 || !(state.mode === "guided" ? guided : free).includes(field)) return null;
  if (videoOnly.includes(field) && state.kind !== "video") return null;
  if (field === "voiceMode" || field === "voiceReferenceId") {
    if (state.mode !== "free" || !["voiceover", "characters"].includes(state.speechMode ?? "")) return null;
    if (field === "voiceReferenceId" && state.speechMode !== "characters") return null;
    const references = state.voiceReferences ?? [];
    if (references.length > 5 || references.some(reference => !/^[A-Za-z0-9_-]{1,160}$/.test(reference.id)) || new Set(references.map(reference => reference.id)).size !== references.length) return null;
    if (field === "voiceReferenceId") {
      if (typeof next !== "string") return null;
      const index = /^reference:([0-4])$/.exec(next);
      const matches = references.filter(reference => index ? reference.referenceIndex === Number(index[1]) : reference.id === next);
      return matches.length === 1 ? { field, value: matches[0].id } : null;
    }
    const targeted = state.voiceReferenceId ? references.some(reference => reference.id === state.voiceReferenceId) : references.length === 1;
    if (field === "voiceMode" && state.speechMode === "characters" && (!targeted && (references.length > 1 || next === "provided" || !!state.voiceReferenceId))) return null;
  }
  if (field === "activeTab") return (state.mode === "guided" ? ["subject", "selection", "direction", "finish"] : ["prompt", "criteria"]).includes(String(next)) ? row as InrAssistantStudioFormSelection : null;
  if (field === "subjectSource" && (state.transformMode || next === "publication" && !state.publicationAvailable)) return null;
  if (field === "sourceMode" && state.transformMode) return null;
  if (["people", "setting", "focus"].includes(field) && state.sourceMode !== "criteria" || field === "focus" && next === "people" && state.people === "none") return null;
  if (field === "imagePurpose" && state.kind !== "image" || field === "format" && state.fixedFormat && next !== state.fixedFormat) return null;
  if (field === "exactText" && state.textMode !== "exact" || ["textKeywords", "textKeywordDraft"].includes(field) && state.textMode !== "ai") return null;
  if (field === "speechMode" && (state.mode === "guided" ? !["voiceover", "characters"].includes(String(next)) : !["voiceover", "characters", "silent"].includes(String(next)) || next === "silent" && !!state.spokenScript?.trim())) return null;
  if (["narrationVoice", "narrationVoiceVariant"].includes(field) && state.speechMode !== "voiceover") return null;
  if (field === "narrationVoiceVariant" && !isAiMediaNarrationVoiceVariantForGender(next, state.narrationVoice || "female")) return null;
  if (field === "spokenScript" && (!state.spokenScriptOpen || state.speechMode === "silent") || field === "spokenScriptOpen" && next === true && state.speechMode === "silent") return null;
  if (field === "withSubtitles" && state.speechMode === "silent") return null;
  if (choices[field] && !choices[field]!.includes(next)) return null;
  if (["useBrandColors", "useBusinessDna", "withMusic", "withSubtitles", "spokenScriptOpen"].includes(field) && typeof next !== "boolean") return null;
  const textLimits: Partial<Record<keyof Values, number>> = { creativeBrief: getAiMediaVisualBriefMaxChars(state.kind, "guided"), exactText: 600, textKeywordDraft: 160, prompt: Math.min(getAiMediaVisualBriefMaxChars(state.kind, "free"), state.maxPromptLength ?? AI_MEDIA_FREE_PROMPT_MAX_CHARS), spokenScript: AI_MEDIA_SPOKEN_SCRIPT_MAX_CHARS };
  if (textLimits[field] !== undefined && (typeof next !== "string" || next.length > textLimits[field]!)) return null;
  if (field === "textKeywords" && (!Array.isArray(next) || next.length > 6 || next.some(item => typeof item !== "string" || item.length < 2 || item.length > 48 || /[,;\n\r\t]|\s{2,}|^#|#$/.test(item) || item !== item.trim()) || new Set(next.map(item => item.toLocaleLowerCase())).size !== next.length)) return null;
  if (field === "durationScene") {
    if (!next || typeof next !== "object" || Array.isArray(next)) return null;
    const pair = next as Record<string, unknown>;
    if (Object.keys(pair).length !== 2 || !Object.hasOwn(pair, "seconds") || !Object.hasOwn(pair, "sceneMode") || typeof pair.seconds !== "number" || !Number.isInteger(pair.seconds) || !["single", "multi"].includes(String(pair.sceneMode)) || !durationAllowed?.(pair.seconds, pair.sceneMode as "single" | "multi")) return null;
  }
  if (state.kind === "video" && state.mode === "free" && ["spokenScript", "durationScene", "speechMode"].includes(field)) {
    const durationScene = field === "durationScene" ? next as Values["durationScene"] : state.durationScene;
    const speechMode = field === "speechMode" ? next as Values["speechMode"] : state.speechMode;
    const speech = getAiMediaVideoSpeechState({ kind: "video", creationMode: "free", freePrompt: state.prompt,
      spokenScript: field === "spokenScript" ? next as string : state.spokenScriptOpen ? state.spokenScript : undefined,
      withNarration: speechMode === "voiceover", teamVideoSpeechMode: speechMode === "characters" ? "characters" : "voiceover",
      durationSeconds: durationScene?.seconds, sceneMode: durationScene?.sceneMode, videoEngine: state.videoEngine,
      videoResolution: state.videoResolution, language: state.language });
    if (speech.issue) return null;
  }
  return row as InrAssistantStudioFormSelection;
}
/** Match committed React state, never the invocation's intended value alone. */
export function isInrAssistantStudioFormSelectionApplied(snapshot: unknown, encoded: string | null): boolean {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !encoded) return false;
  let parsed: unknown; try { parsed = JSON.parse(encoded); } catch { return false; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const row = parsed as Record<string, unknown>, state = snapshot as Record<string, unknown>;
  if (row.field === "voiceReferenceId") {
    const references = state.voiceReferences;
    if (typeof row.value !== "string" || !Array.isArray(references) ||
      references.filter(reference => reference && typeof reference === "object" && reference.id === row.value).length !== 1) return false;
  }
  return typeof row.field === "string" && Object.hasOwn(state, row.field) && JSON.stringify(state[row.field]) === JSON.stringify(row.value);
}

/** Server authorization vocabulary complements the mounted native validator.
 * A valid enum alone cannot substitute portrait for a requested square. */
export function isInrAssistantStudioFormSelectionRequested(message: string, encoded: string | null): boolean {
  if (!encoded || encoded.length > 25000) return false;
  if (inrAssistantRequestClauses(message).filter(clause => /\b(?:mets|mettez|choisis|selectionne\w*|modifi\w*|chang\w*|regl\w*|activ\w*|desactiv\w*|ajout\w*|coupe|ouvre\w*|affich\w*|appliqu\w*|enregistr\w*)\b/.test(clause)).length > 1) return false;
  let input: unknown; try { input = JSON.parse(encoded); } catch { return false; }
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2) return false;
  const { field, value } = input as { field?: string; value?: unknown }, text = inrAssistantUnquotedRequest(message);
  if (field === "voiceMode" || field === "voiceReferenceId") {
    if (!/\b(?:choisis\w*|selectionne\w*|mets|mettez|utilis\w*|passe\w*)\b/.test(text) ||
      /\b(?:pas|jamais|ne|non|si|comment|pourquoi|ou|soit)\b|\bn['’]|\?/.test(text)) return false;
    if (field === "voiceReferenceId") {
      if (typeof value !== "string") return false;
      const index = /^reference:([0-4])$/.exec(value);
      if (index) {
        const numbers = [...text.matchAll(/\b(?:photo|image|reference)\s*(?:n(?:o|umero)?\s*)?([1-5])\b/g)].map(match => Number(match[1]));
        return numbers.length === 1 && numbers[0] === Number(index[1]) + 1;
      }
      return /^[A-Za-z0-9_-]{1,160}$/.test(value) && /photo|personnage|reference/.test(text) &&
        new RegExp(`(?:^|[^A-Za-z0-9_-])${value}(?:$|[^A-Za-z0-9_-])`).test(message);
    }
    const ai = /\b(?:ia|synthetiqu\w*|artifici\w*)\b/.test(text);
    const provided = /(?:voix|vocal).{0,20}(?:reell?e?|fourni\w*|personnel\w*|propre)|(?:ma|mon|notre|sa|leur|vraie|propre).{0,15}(?:voix|vocal)/.test(text);
    return ai !== provided && (value === "ai" ? ai : value === "provided" && provided);
  }
  const fields: Record<string, RegExp> = { activeTab: /onglet|section|etape/, subjectSource: /source.{0,15}sujet|sujet.{0,15}source/, creativeBrief: /consigne|sujet|brief|instruction|idee/, sourceMode: /source|references?|selection/, people: /personnes?|personnages?/, setting: /decor|lieu|environnement/, focus: /priorite|focus|accent|mise? en avant/, imagePurpose: /composition|usage|objectif|flyer|affiche|banniere|infographie|fiche produit/, format: /format|carre|portrait|paysage|horizontal|vertical|story|1\s*:\s*1|4\s*:\s*5|9\s*:\s*16|16\s*:\s*9/, imageStyle: /style|photo|illustration|3d|graphique/, visualDirection: /direction|ambiance|intention visuelle/, useBrandColors: /couleurs?.{0,20}(?:marque|entreprise|adn)|charte/, logoMode: /logo/, textMode: /mode.{0,20}texte|texte.{0,20}(?:mode|exact|fourni|aucun|automati)/, exactText: /texte.{0,20}(?:exact|fourni)|(?:exact|fourni).{0,20}texte/, textKeywords: /mots.?(?:cles|dieses)|tags?/, textKeywordDraft: /mot.?(?:cle|diese)|tag/, speechMode: /paroles?|mode.{0,15}(?:audio|voix)|voix off|narration|silenc/, narrationVoice: /voix|narration/, narrationVoiceVariant: /voix|variante/, withMusic: /musique|bande.son/, durationScene: /duree|secondes?|\bsec\b|scenes?/, prompt: /prompt|consigne|instruction|brief/, useBusinessDna: /adn|dna/, spokenScript: /script|paroles?.{0,20}(?:exact|fourni)/, spokenScriptOpen: /script|paroles?.{0,20}(?:exact|fourni)/, withSubtitles: /sous.titres?/ };
  if (!field || !(field === "spokenScriptOpen" ? /script|paroles?.{0,20}(?:exact|fourni|automati)/ : fields[field])?.test(text)) return false;
  if (field === "spokenScriptOpen") {
    const automatic = /(?:script|paroles?).{0,20}automati/.test(text);
    const exact = /(?:script|paroles?).{0,20}(?:exact|fourni)/.test(text);
    const choose = /\b(?:choisis\w*|selectionne\w*|mets|mettez)\b/.test(text);
    if (automatic || choose) return typeof value === "boolean" && choose && exact !== automatic &&
      !/\b(?:pas|jamais|non|sans|ne)\b|\bn['’]/.test(text) && value === exact;
  }
  if (field === "withSubtitles" && /\b(?:coche\w*|decoche\w*)\b/.test(text)) {
    if (typeof value !== "boolean" || /\b(?:ne|pas|jamais|si|comment|pourquoi|ou|soit)\b|\bn['’]|\?/.test(text)) return false;
    const check = /\bcoche\w*\b/.test(text), uncheck = /\bdecoche\w*\b/.test(text);
    return check !== uncheck && value === check;
  }
  if (["exactText", "spokenScript", "textKeywordDraft"].includes(field)) return typeof value === "string" && message.includes(value);
  if (field === "textKeywords") return Array.isArray(value) && value.every(item => typeof item === "string" && message.includes(item));
  if (field === "narrationVoiceVariant") return typeof value === "string" && message.toLowerCase().includes(value.toLowerCase());
  if (field === "durationScene") { const pair = value as { seconds?: unknown; sceneMode?: unknown } | null; return !!pair && typeof pair.seconds === "number" && new RegExp(`\\b${pair.seconds}\\s*(?:s\\b|sec|second)`).test(text) && (pair.sceneMode === "multi" ? /multi|plusieurs scenes?/.test(text) : pair.sceneMode === "single" && /unique|une (?:seule )?scene|mono/.test(text)); }
  if (["useBrandColors", "useBusinessDna", "withMusic", "withSubtitles", "spokenScriptOpen"].includes(field)) return typeof value === "boolean" && (value ? /activ\w*|ajout\w*|utilis\w*|avec|mets|oui|ouvre\w*/.test(text) && !/desactiv|retir|sans|coupe|non\b/.test(text) : /desactiv|retir|sans|coupe|non\b|ferme\w*/.test(text));
  const values: Record<string, Record<string, RegExp>> = {
    format: { square: /carre|square|1\s*:\s*1/, portrait: /portrait|4\s*:\s*5/, story: /story|9\s*:\s*16|vertical/, landscape: /paysage|horizontal|landscape|16\s*:\s*9/ },
    activeTab: { subject: /sujet|subject/, selection: /selection|references?/, direction: /direction/, finish: /finition|finish/, prompt: /prompt|consigne/, criteria: /criteres|criteria/ },
    subjectSource: { profile: /profil|entreprise|adn/, publication: /publication/, custom: /personnalise|libre|custom/ }, sourceMode: { ai: /\bia\b|automati/, criteria: /criteres|criteria/, real: /reel|references?|inspiration/ },
    people: { auto: /auto/, none: /aucun|sans personne/, one: /une personne|un personnage|\b1\b/, two: /deux|\b2\b/, three: /trois|\b3\b/, group: /groupe|group/ },
    setting: { auto: /auto/, interior: /interieur|interior/, exterior: /exterieur|exterior/, studio: /decor.{0,15}studio|studio.{0,15}decor/, neutral: /neutre|neutral/ }, focus: { auto: /auto/, people: /personnes?|personnages?|people/, product: /produit|product/, environment: /environnement|decor|environment/ },
    imagePurpose: { auto: /auto/, simple: /simple/, social: /social|reseaux/, flyer: /flyer|tract/, product_sheet: /fiche.{0,10}produit/, poster: /affiche|poster/, banner: /banniere|banner/, infographic: /infographie|infographic/ }, imageStyle: { photo: /photo/, illustration: /illustration/, three_d: /3d|trois dimensions/, graphic: /graphique|graphic/ },
    visualDirection: { auto: /auto/, clean: /epure|clean/, premium: /premium|haut de gamme/, warm: /chaleureu|warm/, dynamic: /dynamique|dynamic/, bold: /audacieu|bold/ }, logoMode: { discreet: /discret|discreet/, visible: /visible/, none: /aucun|sans logo|retire.{0,10}logo/ }, textMode: { none: /aucun|sans texte|retire.{0,10}texte/, ai: /\bia\b|auto/, exact: /exact|fourni/ }, speechMode: { voiceover: /voix off|narration|voiceover/, characters: /personnages?|dialogue|characters/, silent: /silenc|muet|silent/ }, narrationVoice: { female: /feminin|femme|female/, male: /masculin|homme|\bmale\b/ },
  };
  const enums = values[field]; if (!enums) return ["creativeBrief", "prompt"].includes(field) && typeof value === "string";
  if (typeof value !== "string" || !Object.hasOwn(enums, value)) return false;
  const found = Object.entries(enums).filter(([, pattern]) => pattern.test(text)).map(([key]) => key);
  if (found.length) return found.length === 1 && found[0] === value;
  // A quoted enum is data after an unquoted field request. A wholly quoted
  // command has no unquoted field and was rejected above.
  for (const match of message.matchAll(/«([^»]*)»|"([^"]*)"|“([^”]*)”/g)) {
    const prefix = inrAssistantUnquotedRequest(message.slice(Math.max(0, match.index! - 65), match.index));
    const literal = (match[1] ?? match[2] ?? match[3]).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    if (fields[field].test(prefix) && enums[value].test(literal) && Object.values(enums).filter(pattern => pattern.test(literal)).length === 1) return true;
  }
  return false;
}
