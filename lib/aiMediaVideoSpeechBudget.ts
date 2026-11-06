import { getAiMediaVideoSegmentDurations } from './aiMediaVideoTimeline.ts';
import { splitAiMediaSpokenScript } from './aiMediaSpokenScript.ts';
import type { AiMediaVideoEngine, AiMediaVideoResolution, AiMediaVideoSceneMode } from './aiMediaModelCatalog.ts';

export const AI_MEDIA_VIDEO_VISUAL_BRIEF_MAX_CHARS = 500;
export const AI_MEDIA_VIDEO_SPOKEN_SCRIPT_MAX_CHARS = 4_000;

export function getAiMediaVisualBriefMaxChars(kind: 'image' | 'video', mode: 'free' | 'guided' = 'free') {
  return kind === 'video' ? AI_MEDIA_VIDEO_VISUAL_BRIEF_MAX_CHARS : mode === 'free' ? 4_000 : 1_600;
}

export type AiMediaVideoSpeechIssue = { code: string; message: string };
export type AiMediaVideoSpeechBudgetInput = {
  kind: 'image' | 'video'; creationMode?: 'guided' | 'free'; operation?: 'generate' | 'modify';
  spokenScript?: string; freePrompt?: string; withNarration?: boolean; teamVideoSpeechMode?: 'voiceover' | 'characters';
  durationSeconds?: number | null; videoEngine?: AiMediaVideoEngine | null; videoResolution?: AiMediaVideoResolution | null;
  sceneMode?: AiMediaVideoSceneMode | null; language?: string;
};
export type AiMediaVideoSpeechSegmentBudget = {
  durationSeconds: number; script: string; units: number; maxUnits: number; characters: number; maxCharacters: number;
  excess: number; issue: AiMediaVideoSpeechIssue | null;
};

function countUnits(text: string, unit: string) {
  return unit === 'caractères prononcés' ? Array.from(text.replace(/[^\p{L}\p{N}]/gu, '')).length : text.split(/\s+/u).filter(Boolean).length;
}

/** Exact scripts remain byte-for-byte intact; budgets are estimates for a
 * natural reading, not a provider promise or a reason to shorten user copy. */
export function getAiMediaVideoSpeechState(request: AiMediaVideoSpeechBudgetInput, exact?: { dialogueLines?: readonly string[]; narrationScript?: string }) {
  const explicit = typeof request.spokenScript === 'string';
  const characterMode = request.teamVideoSpeechMode === 'characters';
  const mode: 'silent' | 'voiceover' | 'characters' = request.kind !== 'video' || request.operation === 'modify' || explicit && !request.spokenScript!.trim()
    ? 'silent' : characterMode ? 'characters' : request.withNarration ? 'voiceover' : 'silent';
  const legacyNarration = exact?.narrationScript ?? request.freePrompt?.match(/(?:voix\s*off|narration|texte\s+(?:prononc[ée]|[àa]\s+dire))\s*(?:exacte?\s*)?[:=]\s*[«“"]([^»”"]+)[»”"]/i)?.[1]?.trim();
  const legacyLines = characterMode ? exact?.dialogueLines ?? getAiMediaFreeRequestedDialogue(request.freePrompt || '') : [];
  const script = explicit ? request.spokenScript! : mode === 'characters' ? legacyLines.join('\n') : mode === 'voiceover' ? legacyNarration || '' : '';
  const language = resolveAiMediaFreeSpeechLanguage(request.freePrompt || '', script, request.language || 'fr');
  const totalBudget = getAiMediaFreeSpeechBudget(request.durationSeconds ?? 8, language, script);
  let issue: AiMediaVideoSpeechIssue | null = null;
  let durations: readonly number[] = [];
  if (request.kind === 'video' && request.operation !== 'modify') {
    try { durations = getAiMediaVideoSegmentDurations(request.durationSeconds ?? 8, request.videoEngine, request.videoResolution, request.sceneMode); }
    catch { issue = { code: 'AI_MEDIA_VIDEO_DURATION_INVALID', message: 'Choisissez une durée et un nombre de plans disponibles pour ce moteur.' }; }
  }
  if (script.length > AI_MEDIA_VIDEO_SPOKEN_SCRIPT_MAX_CHARS) issue = { code: 'AI_MEDIA_SPOKEN_SCRIPT_TOO_LONG', message: 'Les paroles ne peuvent pas dépasser 4 000 caractères. Votre texte a été conservé.' };
  else if (script.trim() && mode === 'silent') issue = { code: 'AI_MEDIA_INVALID_SPEECH_MODE', message: 'Choisissez une voix off ou des personnages parlants pour utiliser les paroles.' };
  const lines = durations.length ? explicit || mode === 'voiceover' ? splitAiMediaSpokenScript(script, durations) : [...legacyLines] : [];
  const code = mode === 'characters' ? 'AI_MEDIA_EXACT_DIALOGUE_TOO_LONG' : 'AI_MEDIA_EXACT_NARRATION_TOO_LONG';
  const segmentBudgets: AiMediaVideoSpeechSegmentBudget[] = durations.map((durationSeconds, index) => {
    const budget = getAiMediaFreeSpeechBudget(durationSeconds, language, script);
    const line = lines[index] || '';
    const units = countUnits(line, totalBudget.unit);
    const excess = Math.max(0, units - budget.maxUnits, line.length - budget.maxCharacters);
    return { durationSeconds, script: line, units, maxUnits: budget.maxUnits, characters: line.length, maxCharacters: budget.maxCharacters, excess,
      issue: mode !== 'silent' && excess > 0 ? { code, message: `Les paroles du plan ${index + 1} dépassent le budget de ${budget.maxUnits} ${budget.unit} ou ${budget.maxCharacters} caractères pour ${durationSeconds} secondes. Raccourcissez-les ou choisissez une durée supérieure.` } : null };
  });
  const maxUnits = mode === 'silent' ? 0 : segmentBudgets.reduce((sum, budget) => sum + budget.maxUnits, 0);
  const maxCharacters = mode === 'silent' ? 0 : mode === 'voiceover'
    ? Math.min(totalBudget.maxCharacters, segmentBudgets.reduce((sum, budget) => sum + budget.maxCharacters, 0))
    : segmentBudgets.reduce((sum, budget) => sum + budget.maxCharacters, 0);
  const units = countUnits(script, totalBudget.unit);
  const excess = mode === 'silent' ? script.trim() ? units : 0 : Math.max(0, units - maxUnits, script.length - maxCharacters);
  if (!issue && mode === 'characters' && !explicit && legacyLines.length > durations.length) issue = { code, message: 'Il y a plus de répliques que de plans disponibles. Réduisez le nombre de répliques ou choisissez davantage de plans.' };
  if (!issue && mode !== 'silent') issue = segmentBudgets.find(segment => segment.issue)?.issue ?? (excess > 0 ? { code, message: `Les paroles dépassent le budget de ${maxUnits} ${totalBudget.unit} ou ${maxCharacters} caractères pour cette vidéo. Raccourcissez-les ou choisissez une durée supérieure.` } : null);
  return { mode, script, language, unit: totalBudget.unit, units, maxUnits, characters: script.length, maxCharacters, excess, issue, segmentBudgets };
}

/** A quote used as a sign/slogan remains visual. Pronunciation guides do not
 * become extra speech. This detector never moves or rewrites either field. */
export function detectAiMediaVideoVisualBriefSpeech(brief: string): { script: string | null; mode: 'voiceover' | 'characters' } | null {
  const audioQuotes = new Set(splitAiMediaFreeQuotedSpeech(brief).audioOnlyQuotes);
  const lines = getAiMediaFreeRequestedDialogue(brief).filter(line => audioQuotes.has(line));
  const narration = brief.match(/(?:voix\s*off|narration|texte\s+(?:prononc[ée]|[àa]\s+dire))\s*(?:exacte?\s*)?[:=]\s*[«“"]([^»”"]+)[»”"]/i)?.[1];
  if (narration) return { script: narration, mode: 'voiceover' };
  if (lines.length) return { script: lines.join('\n'), mode: 'characters' };
  const outsideQuotes = brief.replace(/[«“"][^»”"]*[»”"]/gu, ' ').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\b(?:voix\s*off|narration|replique|paroles?\s+exactes?)\s*[:=]\s*\S/u.test(outsideQuotes)) return { script: null, mode: /voix\s*off|narration/u.test(outsideQuotes) ? 'voiceover' : 'characters' };
  if (/\b(?:personnage|presentateur|presentatrice|homme|femme|il|elle)\s+(?:dit|declare|repond|prononce)\s*[:=]?\s+\p{L}/u.test(outsideQuotes) && !/\b(?:pancarte|panneau|enseigne|titre|slogan|ecran)\b/u.test(outsideQuotes)) return { script: null, mode: 'characters' };
  return null;
}

export const detectExplicitSpeechInVisualPrompt = detectAiMediaVideoVisualBriefSpeech;

export function getAiMediaFreeRequestedDialogue(prompt: string) {
  // A first-person presentation followed by a colon is an explicit script,
  // just like "dit". Keep it out of the planner's visual protected literals.
  // Requiring a human subject avoids treating a sign/title's presentation as speech.
  const pattern = /(?:(?:\b(?:dit|dis|disent|dire|dira|déclare|déclarent|répond|répondent|prononce|prononcent|récite|récitent|says?|speak|speaks|reply|replies|dice|diga|dicono|sagt|zegt|diz)\b|\b(?:réplique|dialogue|dialog|phrase\s+(?:exacte|à\s+(?:dire|prononcer))))[^«“"]{0,90}|(\b(?:je|tu|il|elle|on|nous|vous|ils|elles|personnage|présentateur|présentatrice|professionnel|professionnelle|homme|femme)\s+(?:pr[ée]sent(?:e|es|ent|ons|ez|era|eront)|expliqu(?:e|es|ent|ons|ez|era|eront))\b[^«“"\n]{0,90}:\s*))[«“"]([^»”"]+)[»”"]/giu;
  return Array.from(prompt.matchAll(pattern)).flatMap((match) => {
    const before = prompt.slice(Math.max(0, (match.index || 0) - 80), match.index);
    // A pronunciation guide specifies how a name sounds, not an extra line.
    if (/\bse\s*$/iu.test(before) && /^prononc/iu.test(match[0])) return [];
    if (/^(?:prononce|prononcent)\b/iu.test(match[0]) && /\b(?:marque|nom|mot|sigle)\b[^.!?\n]{0,50}$/iu.test(before)) return [];
    const presentation = match[1]?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (presentation) {
      const visualLabel = /\b(?:texte|titre|inscription|message|mots?|slogan|legende)\s*(?:exact(?:e|s)?\s*)?[:=]\s*$/.test(presentation);
      const visualSupport = /\b(?:pancarte|panneau|affiche|ecran|enseigne|etiquette|support|tshirt|t-shirt)\b/.test(presentation);
      const displayAction = /\b(?:affichant|affiche|affichent|afficher|portant|porte|portent|inscrit|inscrite|ecrit|ecrite)\b/.test(presentation);
      // Presenting a labelled sign or screen describes visible wording. Only
      // this new presentation shortcut is filtered; explicit "dit" stays oral.
      if (visualLabel && (visualSupport || displayAction)) return [];
    }
    return [match[2]!.replace(/\s+/g, " ").trim()];
  });
}

export function splitAiMediaFreeQuotedSpeech(prompt: string) {
  const audioOnlyQuotes = new Set<string>();
  const visualPrompt = prompt.replace(/[«“"]([^»”"]+)[»”"]/g, (quote: string, line: string, offset: number) => {
    const before = prompt.slice(0, offset);
    // A previous quotation cannot lend its speech verb to a later visual text.
    const boundary = Math.max(before.lastIndexOf("»"), before.lastIndexOf("”"), before.lastIndexOf('"'));
    const context = before.slice(boundary + 1) + quote;
    // A sign that "says" something still explicitly requests visual wording.
    if (/(?:^|[^\p{L}])(?:pancartes?|panneaux?|affiches?|titres?|écrans?|textes?|signs?|posters?|titles?|screens?|captions?|subtitles?)\s+(?:(?:qui|that)\s+)?(?:dit|disent|déclare|déclarent|says?)\s*[:=]?\s*[«“"]/iu.test(context)) return quote;
    const dialogue = getAiMediaFreeRequestedDialogue(context);
    const narration = context.match(/(?:voix\s*off|narration|texte\s+(?:prononc[ée]|[àa]\s+dire))\s*(?:exacte?\s*)?[:=]\s*[«“"]([^»”"]+)[»”"]/i)?.[1];
    const pronunciation = /\b(?:se\s+prononce|prononciation\s+de\s+[\p{L}\p{N}_'-]+)\s*[:=]?\s*[«“"]/iu.test(context);
    if (!dialogue.length && narration === undefined && !pronunciation) return quote;
    audioOnlyQuotes.add(line.replace(/\u0000/g, "").replace(/\s+/g, " ").trim());
    // The complete speech span includes prices, URLs and dates that are only spoken.
    return "";
  });
  return { visualPrompt, audioOnlyQuotes: [...audioOnlyQuotes] };
}

export function getAiMediaFreeSpeechBudget(durationSeconds = 8, language = "fr", text = "") {
  const nonSpaceScript = /^(?:zh|ja|th)(?:-|$)/i.test(language) || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(text);
  const maxWords = Math.max(1, Math.floor((Math.max(2, durationSeconds) - 1) * 2));
  return {
    maxUnits: maxWords * (nonSpaceScript ? 3 : 1),
    maxCharacters: Math.min(620, maxWords * (nonSpaceScript ? 4 : 10)),
    unit: nonSpaceScript ? "caractères prononcés" : "mots",
    units: nonSpaceScript ? Array.from(text.replace(/[^\p{L}\p{N}]/gu, "")).length : text.split(/\s+/u).filter(Boolean).length,
  };
}

export function getAiMediaFreeRequestedLanguage(prompt: string): string | undefined {
  const normalized = prompt.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const languages: Array<[string, string]> = [["fr", "francais|french"], ["en", "anglais|english"], ["es", "espagnol|spanish"], ["de", "allemand|german"], ["it", "italien|italian"], ["pt", "portugais|portuguese"], ["nl", "neerlandais|dutch"], ["zh", "chinois|mandarin|chinese"], ["ja", "japonais|japanese"], ["ko", "coreen|korean"], ["th", "thai|thaï"], ["ar", "arabe|arabic"]];
  return languages.find(([, names]) => new RegExp(`\\b(?:en|in|langue|language)\\s*(?:[:=]\\s*)?(?:${names})\\b`).test(normalized))?.[0];
}

export function resolveAiMediaFreeSpeechLanguage(prompt: string, script: string, fallbackLanguage = "fr", generatedLanguage?: string): string {
  const explicit = getAiMediaFreeRequestedLanguage(prompt);
  if (explicit) return explicit;
  if (/^[a-z]{2}(?:-[A-Z]{2})?$/.test(generatedLanguage || "")) return generatedLanguage!;
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(script)) return "ja";
  if (/\p{Script=Han}/u.test(script)) return "zh";
  if (/\p{Script=Thai}/u.test(script)) return "th";
  if (/\p{Script=Hangul}/u.test(script)) return "ko";
  // Conservative inference for exact quotations; ambiguous short wording keeps
  // the profile language. No paid language-identification call is introduced.
  const words = script.toLowerCase().match(/[\p{L}]+/gu) || [];
  const markers: Record<string, string[]> = { en: ["the", "our", "your", "with", "and", "this", "you", "we", "for", "welcome", "discover"], fr: ["le", "la", "les", "notre", "votre", "avec", "et", "vous", "nous", "pour", "bonjour"], es: ["el", "los", "nuestro", "nuestra", "con", "bienvenidos", "descubre", "para"], de: ["der", "die", "das", "unser", "unsere", "mit", "und", "willkommen"], it: ["il", "gli", "nostro", "nostra", "benvenuti", "scopri", "della"] };
  const scores = Object.entries(markers).map(([language, tokens]) => ({ language, score: words.filter((word) => tokens.includes(word)).length })).sort((a, b) => b.score - a.score);
  return scores[0].score >= 2 && scores[0].score > scores[1].score ? scores[0].language : fallbackLanguage || "fr";
}
