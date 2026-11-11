import { AI_MEDIA_IMAGE_MODELS, AI_MEDIA_VIDEO_MODELS } from "./aiMediaModelCatalog.ts";
import { inrAssistantRequestClauses } from "./inrAssistantRequestClauses.ts";

/** Public pricing evidence only: no prompt, account, quote token or private URL. */
export type InrAssistantMediaQuote = {
  version: 1;
  source: "native_studio_credit_quote";
  mediaType: "image" | "video";
  engine: string;
  modelLabel: string;
  format: "square" | "portrait" | "story" | "landscape";
  durationSeconds: number | null;
  resolution: string | null;
  sceneMode: "single" | "multi" | null;
  referenceImagesCount: number;
  withNarration: boolean;
  totalCredits: number;
  availableCredits: number | null;
  tariffVersion: string;
};
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").replace(/[’‘]/g, "'").toLowerCase();
const formats = ["square", "portrait", "story", "landscape"];
const integer = (value: unknown, maximum: number) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;

export function parseInrAssistantMediaQuote(value: unknown): InrAssistantMediaQuote | null {
  const input = row(value), kind = input.mediaType;
  if (input.version !== 1 || input.source !== "native_studio_credit_quote" || (kind !== "image" && kind !== "video")) return null;
  const model = (kind === "image" ? AI_MEDIA_IMAGE_MODELS : AI_MEDIA_VIDEO_MODELS).find(model => model.id === input.engine);
  if (!model || input.modelLabel !== model.label || !formats.includes(String(input.format))
    || !integer(input.totalCredits, 1_000_000) || Number(input.totalCredits) < 1 || !integer(input.referenceImagesCount, 5)
    || typeof input.withNarration !== "boolean" || input.availableCredits !== null && !integer(input.availableCredits, 1_000_000_000)
    || typeof input.tariffVersion !== "string" || !/^[a-zA-Z0-9_.-]{1,100}$/.test(input.tariffVersion)) return null;
  if (kind === "image" ? input.durationSeconds !== null || input.resolution !== null || input.sceneMode !== null
    : !integer(input.durationSeconds, 30) || Number(input.durationSeconds) < 4 || typeof input.resolution !== "string"
      || !AI_MEDIA_VIDEO_MODELS.find(model => model.id === input.engine)?.resolutions.some(resolution => resolution === input.resolution)
      || !["single", "multi"].includes(String(input.sceneMode))) return null;
  return { version: 1, source: "native_studio_credit_quote", mediaType: kind, engine: model.id, modelLabel: model.label,
    format: input.format as InrAssistantMediaQuote["format"], durationSeconds: input.durationSeconds as number | null,
    resolution: input.resolution as string | null, sceneMode: input.sceneMode as InrAssistantMediaQuote["sceneMode"],
    referenceImagesCount: Number(input.referenceImagesCount), withNarration: input.withNarration,
    totalCredits: Number(input.totalCredits), availableCredits: input.availableCredits === null ? null : Number(input.availableCredits),
    tariffVersion: input.tariffVersion };
}

/** Build only from the route's validated tariff plus the exact normalized payload
 * sent to that route. Creative prose never changes an image's tariff identity. */
export function createInrAssistantMediaQuote(nativeQuote: unknown, normalizedPayload: unknown, available: unknown): InrAssistantMediaQuote | null {
  const quote = row(nativeQuote), input = row(normalizedPayload);
  const kind = input.kind, format = kind === "image" ? quote.imageFormat : input.format;
  if (kind !== "image" && kind !== "video" || quote.engine !== (kind === "image" ? input.imageEngine : input.videoEngine)
    || kind === "image" && format !== input.format
    || kind === "video" && (quote.durationSeconds !== input.durationSeconds || quote.resolution !== input.videoResolution)) return null;
  return parseInrAssistantMediaQuote({ version: 1, source: "native_studio_credit_quote", mediaType: kind,
    engine: quote.engine, modelLabel: quote.modelLabel, format, durationSeconds: quote.durationSeconds,
    resolution: quote.resolution, sceneMode: quote.sceneMode, referenceImagesCount: input.inspirationImagesCount,
    withNarration: input.withNarration === true, totalCredits: quote.totalCredits,
    availableCredits: integer(available, 1_000_000_000) ? available : null, tariffVersion: quote.tariffVersion });
}

function requestedScope(message: string): string {
  return normalize(message)
    .split(/(?:\s+(?:puis|ensuite|et|then|and)\s+|[.!?;]\s+)(?=(?:explique|compare|conseille|recommande|analyse|quels?|quelles?|which|what|why|how|explain)\b)/)[0]
    .replace(/\b(?:conserve|garde|laisse|keep)\b[^.!?;]*(?:formulaire|studio|ecran|page|form)[^.!?;]*/g, " ");
}

/** Check explicit pricing axes, never the creative subject or a similarity score. */
export function matchInrAssistantMediaQuote(quote: InrAssistantMediaQuote, instruction: string): { matches: boolean; missingAxes: string[] } {
  const text = requestedScope(instruction), missing = new Set<string>();
  const image = /\b(?:images?|photos?|visuels?|illustrations?)\b/.test(text), video = /\b(?:videos?|clips?|films?)\b/.test(text);
  const kind = video ? "video" : image ? "image" : null;
  if (kind && kind !== quote.mediaType) missing.add("type de média");
  const catalogue = kind === "image" ? AI_MEDIA_IMAGE_MODELS : kind === "video" ? AI_MEDIA_VIDEO_MODELS
    : quote.mediaType === "image" ? AI_MEDIA_IMAGE_MODELS : AI_MEDIA_VIDEO_MODELS;
  let engines = catalogue.filter(model => {
    const tokens = normalize(model.label).match(/[a-z0-9]+/g) ?? [];
    return new RegExp("\\b" + tokens.join("[\\s._-]*") + "\\b").test(text);
  }).map(model => model.id as string);
  if (!engines.length) engines = catalogue.filter(model => new RegExp("\\b" + model.id.replace(/-/g, "[- ]") + "\\b(?![ ._-]*[0-9])").test(text)).map(model => model.id as string);
  if (engines.length && (engines.length !== 1 || engines[0] !== quote.engine)) missing.add("moteur");
  const requestedFormats = [
    [/\b(?:carree?s?|square)\b|\b1\s*:\s*1\b/, "square"],
    [/\bportrait\b|\b4\s*:\s*5\b/, "portrait"],
    [/\bstor(?:y|ies)\b|\b9\s*:\s*16\b/, "story"],
    [/\b(?:paysage|landscape|horizontale?)\b|\b16\s*:\s*9\b/, "landscape"],
    [/\bverticale?\b/, kind === "video" ? "story" : "portrait"],
  ] as const;
  const selectedFormats = [...new Set(requestedFormats.filter(([pattern]) => pattern.test(text)).map(([, format]) => format))];
  if (selectedFormats.length && (selectedFormats.length !== 1 || selectedFormats[0] !== quote.format)) missing.add("format");
  const durations = [...text.matchAll(/\b(\d{1,2})\s*(?:s|sec|secondes?|seconds?)\b/g)].map(match => Number(match[1]));
  if (kind === "video" && durations.length && (new Set(durations).size !== 1 || durations[0] !== quote.durationSeconds)) missing.add("durée");
  const resolutions = [...text.matchAll(/\b(?:480p|540p|720p|768p|1080p)\b/g)].map(match => match[0]);
  if (resolutions.length && (new Set(resolutions).size !== 1 || resolutions[0] !== quote.resolution)) missing.add("résolution");
  const referenceCount = text.match(/\b([0-5])\s+(?:(?:images?|photos?)\s+de\s+)?references?\b/);
  const noReferences = /\b(?:sans|aucune?|zero|0)\s+(?:(?:image|photo)s?\s+de\s+)?references?\b/.test(text);
  const referencesMentioned = /\breferences?\b|\b(?:a partir|depuis)\b|\b(?:images?|photos?|pieces?)\s+joint(?:e|es|s)?\b/.test(text);
  const expectedReferences = noReferences ? 0 : referenceCount ? Number(referenceCount[1]) : !referencesMentioned ? 0 : undefined;
  if (expectedReferences === undefined || expectedReferences !== quote.referenceImagesCount) missing.add("références");
  if (/\b(?:sans|aucune?|pas de)\s+(?:voix|narration)\b/.test(text) && quote.withNarration) missing.add("narration");
  if (/\bavec\s+(?:une?\s+)?(?:voix|narration)\b/.test(text) && !quote.withNarration) missing.add("narration");
  if (/\b(?:plusieurs|multi(?:ples)?)\s*[- ]?scenes?\b/.test(text) && quote.sceneMode!=="multi") missing.add("scènes");
  return { matches: missing.size === 0, missingAxes: [...missing] };
}

export function renderInrAssistantMediaQuote(quote: InrAssistantMediaQuote): string {
  const format = { square: "carré", portrait: "portrait (4:5)", story: "vertical (9:16)", landscape: "paysage (16:9)" }[quote.format];
  const axes = [quote.modelLabel, quote.mediaType === "image" ? "image" : "vidéo", "format " + format,
    ...(quote.durationSeconds === null ? [] : [quote.durationSeconds + " s"]), ...(quote.resolution ? [quote.resolution] : []),
    ...(quote.sceneMode ? [quote.sceneMode === "multi" ? "plusieurs scènes" : "une scène", quote.withNarration ? "avec narration" : "sans narration"] : []),
    quote.referenceImagesCount + " image" + (quote.referenceImagesCount === 1 ? "" : "s") + " de référence"];
  return "Devis Studio natif : **" + quote.totalCredits + " crédits média**.\n\n" + axes.join(" · ") + ".\n\n"
    + (quote.availableCredits === null ? "Solde disponible non communiqué par le serveur." : "Crédits disponibles : " + quote.availableCredits + "." + (quote.availableCredits < quote.totalCredits ? " Ce solde ne couvre pas le devis." : ""))
    + "\n\nCe devis n’a lancé aucune génération, réservation de crédits ni sauvegarde. Il ne modifie pas le formulaire Studio ; il sera revérifié avant une éventuelle création.";
}

export function hasInrAssistantMediaQuoteAdvice(message: string): boolean {
  return inrAssistantRequestClauses(message).some(clause => {
    const question=clause.match(/(?:^|[.!?;]\s+|\b(?:et|puis|ensuite|and|then)\s+)((?:quels?|quelles?|which|what)\b.*)/)?.[1];
    return /^(?:explique\w*|compare\w*|conseille\w*|recommande\w*|analyse\w*|comment|pourquoi|why|how|explain)\b/.test(clause)
    || /\b(?:puis|ensuite|et|then|and)\s+(?:explique\w*|compare\w*|conseille\w*|recommande\w*|analyse\w*|explain)\b/.test(clause)
    || Boolean(question && !/\b(?:devis|cout\w*|tarif\w*|prix|credits?|solde|quote|cost|price|balance)\b/.test(question));
  });
}

/** Native pricing is rendered separately. Provider prose may contribute only
 * the independent advice, never redefine the attested cost or execution state. */
export function independentInrAssistantMediaQuoteAdvice(message: string): string {
  return message.split(/(?<=[.!?])\s+|\n{2,}/).map(part => part.trim()).filter(part => part
    && !/\b(?:devis|cout\w*|tarif\w*|credits?|solde|reserv\w*|sauvegard\w*|enregistr\w*|generation|quote|cost|pricing|balance)\b/.test(normalize(part))).join("\n\n");
}
