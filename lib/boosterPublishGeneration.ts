import {
  aiGenerateJSON,
  type AiGenerationFeature,
  type AiJsonResponseSchema,
} from "@/lib/aiGatewayClient";
import { createAiOperationBudget, type AiOperationBudget } from "@/lib/aiGatewayPolicy";
import {
  getAiGenerationFallbackInfo,
  type AiGenerationFallbackInfo,
} from "@/lib/aiGenerationFallback";
import {
  buildNormalizedAiGenerationProfile,
  type NormalizedAiGenerationProfile,
} from "@/lib/aiGenerationProfile";
import {
  compileBoosterGenerationPrompt,
  pickBoosterHiddenAngle,
  type BoosterChannels,
  type BoosterHiddenAngle,
  type BoosterRecentPublication,
  type BoosterStyle,
  type BoosterTheme,
} from "@/lib/boosterPrompt";
import { sanitizeGmbGeneratedPost } from "@/lib/googleBusinessCompliance";
import { getAiEngineTemperature, getAiLanguageLabel } from "@/lib/aiWritingProfile";
import { prepareMediaForSelectedWriter } from "@/lib/aiMediaUnderstanding";
import { hasAiLanguageMismatch } from "@/lib/aiLanguageValidation";
import {
  applyAiEngineOutputTokenCalibration,
  applyAiEngineTimeoutCalibration,
} from "@/lib/aiEngineCalibration";
import type { AiPreferredEngine } from "@/lib/aiEnginePreference";
import {
  sanitizeBoosterSiteText,
  stripSiteTextFormatting,
  stripSiteTextFormattingPreserveLayout,
} from "@/lib/boosterFormatting";
import {
  limitBoosterGeneratedContent,
} from "@/lib/boosterChannelRules";
import {
  hasAiGeneratedCitationArtifacts,
  sanitizeAiGeneratedEditorialText,
} from "@/lib/aiGeneratedTextSafety";

export type JsonRecord = Record<string, unknown>;

export type BoosterAiImage = {
  dataUrl: string;
  detail: "low" | "high" | "auto";
};

export type ChannelPost = {
  title: string;
  content: string;
  cta: string;
  hashtags: string[];
};

type BoosterGenResponse = {
  versions?: Partial<Record<BoosterChannels, Partial<ChannelPost>>>;
};

const allowedChannels: BoosterChannels[] = [
  "inrcy_site",
  "site_web",
  "inr_search",
  "gmb",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube_shorts",
  "pinterest",
];

const siteChannels = new Set<BoosterChannels>(["inrcy_site", "site_web", "inr_search"]);

// Seuils anti-réponse cassée uniquement. Ils sont volontairement très inférieurs
// aux objectifs éditoriaux du prompt : une IA concise mais pertinente doit passer.
// Ces valeurs détectent surtout une sortie vide/tronquée, jamais un simple écart de style.
const CHANNEL_MIN_CONTENT_LENGTH: Record<BoosterChannels, number> = {
  inrcy_site: 180,
  site_web: 220,
  inr_search: 12,
  gmb: 80,
  facebook: 100,
  instagram: 80,
  linkedin: 120,
  tiktok: 45,
  youtube_shorts: 120,
  pinterest: 70,
};

// Planchers éditoriaux utilisés uniquement quand le pro choisit « Détaillé ».
// Ils restent volontairement conservateurs par rapport aux plages préférentielles :
// la nouvelle grille ne doit pas multiplier les secondes passes IA ni rallonger la
// génération. Ils peuvent déclencher l'unique enrichissement historique, mais ne
// rendent jamais le résultat final invalide.
const CHANNEL_DETAILED_ENRICHMENT_MIN: Record<BoosterChannels, number> = {
  inrcy_site: 1300,
  site_web: 1600,
  inr_search: 0,
  gmb: 650,
  facebook: 750,
  instagram: 500,
  linkedin: 900,
  tiktok: 250,
  youtube_shorts: 900,
  // 280 est le bas de la nouvelle plage Détaillé Pinterest : ne pas
  // déclencher une réparation IA sur un contenu déjà conforme.
  pinterest: 280,
};

const CHANNEL_DYNAMIC_EMOJI_MIN: Record<BoosterChannels, number> = {
  inrcy_site: 0,
  site_web: 0,
  inr_search: 0,
  gmb: 1,
  facebook: 6,
  instagram: 8,
  linkedin: 2,
  tiktok: 8,
  youtube_shorts: 4,
  pinterest: 4,
};

const CHANNEL_LABELS: Record<BoosterChannels, string> = {
  inrcy_site: "Site iNrCy",
  site_web: "Site web",
  inr_search: "iNr'Search",
  gmb: "Google Business",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube_shorts: "YouTube",
  pinterest: "Pinterest",
};

export function buildBoosterResponseSchema(
  channels: BoosterChannels[],
): AiJsonResponseSchema {
  const uniqueChannels = Array.from(new Set(channels)).filter((channel) =>
    allowedChannels.includes(channel),
  );

  const postSchema = {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      cta: { type: "string" },
      hashtags: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["title", "content", "cta", "hashtags"],
    additionalProperties: false,
  };

  const versionProperties = Object.fromEntries(
    uniqueChannels.map((channel) => [channel, postSchema]),
  );

  return {
    name: "booster_versions",
    strict: true,
    schema: {
      type: "object",
      properties: {
        versions: {
          type: "object",
          properties: versionProperties,
          required: uniqueChannels,
          additionalProperties: false,
        },
      },
      required: ["versions"],
      additionalProperties: false,
    },
  };
}

function shouldAbortAiRecovery(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  if ([
    "ai_operation_budget_exceeded",
    "ai_operation_deadline_exceeded",
    "ai_gateway_account_limit_reached",
    "ai_gateway_guard_unavailable",
    "ai_gateway_rate_limit",
    "ai_gateway_auth",
    "ai_gateway_unavailable",
  ].includes(code)) {
    return true;
  }

  const message = generationErrorMessage(error);
  return (
    /(?:AI Gateway error\s*\(|HTTP\s+)(?:400|401|403|404|409|422|429|500|502|503|504)\b/i.test(message) ||
    /limite de sécurité IA|nombre maximal de reprises|budget maximal de sortie|durée de sécurité|deadline|aborterror|timed out|fetch failed|network error|econnreset|econnrefused|enotfound|socket hang up/i.test(message)
  );
}

function rethrowIfRecoveryMustStop(error: unknown): void {
  if (shouldAbortAiRecovery(error)) throw error;
}

const MAX_BOOSTER_EXTRA_INSTRUCTIONS_CHARS = 8_000;

function compactPromptContext(value: unknown, maxChars = MAX_BOOSTER_EXTRA_INSTRUCTIONS_CHARS) {
  const text = String(value || "").trim();
  if (!text || text.length <= maxChars) return text;

  // Les consignes média peuvent contenir des transcriptions longues. On garde le
  // début (contexte principal) et la fin (souvent les dernières précisions utiles)
  // au lieu de laisser grossir le prompt jusqu'au rejet par la politique Gateway.
  const marker = "\n\n[… contexte compacté automatiquement par iNrCy …]\n\n";
  const available = Math.max(0, maxChars - marker.length);
  const headLength = Math.ceil(available * 0.7);
  const tailLength = Math.max(0, available - headLength);
  return `${text.slice(0, headLength)}${marker}${text.slice(-tailLength)}`;
}

function generationErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Erreur IA inconnue");
}

function elapsedMs(startedAt: number) {
  return Date.now() - startedAt;
}

function logGenerationAttemptFailure(args: {
  stage: string;
  channels: BoosterChannels[];
  aiFeature: AiGenerationFeature;
  accountId?: string;
  durationMs?: number;
  error: unknown;
}) {
  console.warn("[booster-generation] generation attempt failed", {
    stage: args.stage,
    channels: args.channels,
    aiFeature: args.aiFeature,
    accountId: args.accountId || undefined,
    durationMs: args.durationMs,
    message: generationErrorMessage(args.error),
  });
}

const ideaStopWords = new Set([
  "avec",
  "afin",
  "alors",
  "apres",
  "avant",
  "avoir",
  "cette",
  "celui",
  "celle",
  "chez",
  "comme",
  "dans",
  "dire",
  "donc",
  "elle",
  "elles",
  "faire",
  "fais",
  "fait",
  "faut",
  "realise",
  "realisee",
  "realiser",
  "cree",
  "creee",
  "creer",
  "presente",
  "presenter",
  "montre",
  "montrer",
  "leur",
  "leurs",
  "mais",
  "meme",
  "nous",
  "pour",
  "post",
  "publication",
  "publier",
  "quand",
  "quel",
  "quelle",
  "sans",
  "sont",
  "sujet",
  "tous",
  "toute",
  "tres",
  "vous",
  "votre",
  "veux",
  "veut",
]);

const similarityStopWords = new Set([
  ...ideaStopWords,
  "actualité",
  "actualite",
  "besoin",
  "client",
  "clients",
  "contact",
  "contenu",
  "efficace",
  "essentiel",
  "information",
  "local",
  "locale",
  "message",
  "objectif",
  "professionnel",
  "solution",
  "solutions",
]);

export type GenerateSharedBoosterPostsArgs = {
  idea: string;
  publicationInstruction?: string;
  theme: BoosterTheme;
  style?: BoosterStyle;
  preferredEngine?: AiPreferredEngine;
  channels: BoosterChannels[];
  profile: JsonRecord | null;
  business: JsonRecord | null;
  recentPublications?: BoosterRecentPublication[];
  hiddenAngle?: BoosterHiddenAngle;
  imagesForAI?: BoosterAiImage[];
  mediaContext?: string;
  extraInstructions?: string;
  mediaType?: "images" | "video";
  forceNonBlocking?: boolean;
  allowLocalFallback?: boolean;
  aiFeature?: "booster.publish" | "agent.publish";
  accountId?: string;
  skipMediaVisionAnalysis?: boolean;
  /** Deadline absolue de la route appelante, incluant son travail préalable. */
  deadlineAt?: number;
};

export type GenerateSharedBoosterPostsResult = {
  versions: Partial<Record<BoosterChannels, ChannelPost>>;
  recoveredChannels: BoosterChannels[];
  aiFallback?: AiGenerationFallbackInfo;
  performance?: {
    mediaPrepMs: number;
    primaryGenerationMs: number;
    repairMs: number;
    totalMs: number;
    selectedChannels: number;
    primaryCompliantChannels: number;
    repairRequestedChannels: number;
    recoveredChannels: number;
    qualityIssueCounts: Record<string, number>;
  };
};

function cleanHashtags(channel: BoosterChannels, input: unknown) {
  if (channel === "gmb" || siteChannels.has(channel)) return [];
  const limit = channel === "instagram" || channel === "tiktok" || channel === "youtube_shorts" || channel === "pinterest" ? 8 : channel === "linkedin" ? 3 : 2;
  return Array.isArray(input)
    ? input
        .map((h) => sanitizeAiGeneratedEditorialText(h).trim().replace(/^#+/, ""))
        .filter(Boolean)
        .slice(0, limit)
    : [];
}

function normalizePost(channel: BoosterChannels, raw: Partial<ChannelPost> | undefined): ChannelPost {
  const generatedTitle = sanitizeAiGeneratedEditorialText(raw?.title);
  const generatedContent = sanitizeAiGeneratedEditorialText(raw?.content);
  const generatedCta = sanitizeAiGeneratedEditorialText(raw?.cta);

  if (channel === "gmb") {
    const safe = sanitizeGmbGeneratedPost({
      title: generatedTitle,
      content: generatedContent,
      cta: generatedCta,
      hashtags: [],
    });
    return {
      title: safe.title,
      content: limitBoosterGeneratedContent(channel, safe.content),
      cta: safe.cta,
      hashtags: [],
    };
  }

  const siteChannel = siteChannels.has(channel);

  return {
    title: (siteChannel ? sanitizeBoosterSiteText(generatedTitle) : stripSiteTextFormatting(generatedTitle)).slice(0, 90),
    content: limitBoosterGeneratedContent(
      channel,
      siteChannel
        ? sanitizeBoosterSiteText(generatedContent)
        : stripSiteTextFormattingPreserveLayout(generatedContent),
    ),
    cta: stripSiteTextFormatting(generatedCta).slice(0, 180),
    hashtags: cleanHashtags(channel, raw?.hashtags),
  };
}



const CHANNEL_OUTPUT_ALIASES: Record<BoosterChannels, string[]> = {
  inrcy_site: ["inrcy_site", "inrcysite", "site_inrcy", "siteinrcy"],
  site_web: ["site_web", "siteweb", "website", "web_site"],
  inr_search: ["inr_search", "inrsearch", "search_page", "public_page"],
  gmb: ["gmb", "google_business", "googlebusiness", "google_business_profile"],
  facebook: ["facebook", "fb"],
  instagram: ["instagram", "insta"],
  linkedin: ["linkedin", "linked_in"],
  tiktok: ["tiktok", "tik_tok"],
  youtube_shorts: [
    "youtube_shorts",
    "youtubeshorts",
    "youtube_short",
    "youtube",
    "youtube_video",
    "youtubevideo",
  ],
  pinterest: ["pinterest", "pin"],
};

function asJsonRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function normalizeOutputKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function firstTextField(record: JsonRecord | null, keys: string[]) {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function coerceHashtagField(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  return value
    .split(/[\s,;]+/g)
    .map((item) => item.trim().replace(/^#+/, ""))
    .filter(Boolean);
}

function coerceGeneratedPost(value: unknown): Partial<ChannelPost> | undefined {
  let record = asJsonRecord(value);
  if (!record) return undefined;

  // Certains modèles enveloppent encore l'objet final dans post/data/result.
  for (const key of ["post", "data", "result", "version"]) {
    const nested = asJsonRecord(record[key]);
    if (nested) {
      record = nested;
      break;
    }
  }

  const title = firstTextField(record, [
    "title",
    "titre",
    "headline",
    "name",
  ]);
  const content = firstTextField(record, [
    "content",
    "description",
    "body",
    "text",
    "caption",
    "copy",
  ]);
  const cta = firstTextField(record, [
    "cta",
    "call_to_action",
    "callToAction",
    "action",
    "button_text",
    "buttonText",
  ]);
  const hashtags =
    record.hashtags ?? record.tags ?? record.keywords ?? record.hash_tags ?? [];

  if (!title && !content && !cta) return undefined;
  return {
    title,
    content,
    cta,
    hashtags: coerceHashtagField(hashtags) as string[],
  };
}

function extractGeneratedChannelVersion(
  output: unknown,
  channel: BoosterChannels,
): Partial<ChannelPost> | undefined {
  const root = asJsonRecord(output);
  if (!root) return undefined;

  const candidateContainers = [
    asJsonRecord(root.versions),
    asJsonRecord(root.data),
    asJsonRecord(root.result),
    root,
  ].filter((value): value is JsonRecord => Boolean(value));

  const aliases = new Set(
    CHANNEL_OUTPUT_ALIASES[channel].map((key) => normalizeOutputKey(key)),
  );

  for (const container of candidateContainers) {
    for (const [key, value] of Object.entries(container)) {
      if (aliases.has(normalizeOutputKey(key))) {
        const post = coerceGeneratedPost(value);
        if (post) return post;
      }
    }
  }

  // Pour un appel canal unique, certains modèles renvoient directement
  // {title, description, cta, hashtags} sans l'enveloppe versions.
  return coerceGeneratedPost(root);
}

function hasCorePublishableContent(channel: BoosterChannels, post: ChannelPost | undefined) {
  if (!post) return false;
  if (!post.title.trim() || !post.content.trim()) return false;
  const minContentLength = CHANNEL_MIN_CONTENT_LENGTH[channel] ?? 80;
  return post.content.trim().length >= minContentLength;
}

function hasRequiredContent(channel: BoosterChannels, post: ChannelPost | undefined) {
  // Étape 6 ter : un CTA séparé est une préférence éditoriale, pas un motif de
  // normalisation. Un bon texte doit rester intact même si le moteur juge qu'un
  // CTA serait artificiel. La clé cta existe toujours dans le JSON et peut être vide.
  return hasCorePublishableContent(channel, post);
}

function hasPublishableText(post: ChannelPost | undefined) {
  return Boolean(post?.content?.trim());
}

function normalizeIdeaToken(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function stemIdeaToken(token: string) {
  if (token.length > 5 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function extractIdeaKeywords(idea: string) {
  const tokens = (idea.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9']+/g) || [])
    .map(normalizeIdeaToken)
    .map(stemIdeaToken)
    .filter((token) => token.length >= 4 && !ideaStopWords.has(token));
  return Array.from(new Set(tokens)).slice(0, 8);
}

function getSearchablePostText(post: ChannelPost | undefined) {
  if (!post) return "";
  return normalizeIdeaToken([post.title, post.content, post.cta, ...(Array.isArray(post.hashtags) ? post.hashtags : [])].join(" "));
}

function isPostAnchoredToIdea(ideaKeywords: string[], post: ChannelPost | undefined) {
  if (!ideaKeywords.length) return true;
  const text = getSearchablePostText(post);
  if (!text) return false;
  const matches = ideaKeywords.filter((keyword) => text.includes(keyword));

  // Une phrase libre courte contient souvent un lieu + un sujet + un verbe générique.
  // Exiger deux mots exacts rejetait de bonnes reformulations IA (ex. “flyer réalisé à Harnes”
  // reformulé en “création d’un support de communication à Harnes”).
  // On garde un ancrage réel, mais sans punir les synonymes naturels.
  const requiredMatches = ideaKeywords.length >= 5 ? 2 : 1;
  return matches.length >= requiredMatches;
}

const HARD_EDITORIAL_META_PATTERNS = [
  /\bla description doit rester\b/i,
  /\b(?:cette|la) publication peut (?:servir|être utilisée|etre utilisee|utiliser)\b/i,
  /\bpeut utiliser cette publication pour\b/i,
  /\bune description (?:youtube )?(?:claire|utile|recherchable|naturelle) pour (?:présenter|presenter|expliquer|donner)\b/i,
  /\bl['’]idée est de présenter un message\b/i,
  /\bthe description should remain\b/i,
  /\bthis publication can be used to\b/i,
  /\besta publicación puede utilizarse para\b/i,
  /\bla descripción debe seguir siendo\b/i,
  /\bdiese beschreibung sollte\b/i,
  /\bquesta descrizione dovrebbe\b/i,
  /\besta descrição deve\b/i,
];

const SOFT_EDITORIAL_META_PATTERNS = [
  /\b(?:la|cette|une) description\s+(?:doit|devrait|peut|permet de|sert à|sert a)\b/i,
  /\b(?:le|ce|un) (?:texte|contenu|message|post)\s+(?:doit|devrait|peut|permet de|sert à|sert a)\b/i,
  /\b(?:cette|la) publication\s+(?:doit|devrait|peut|permet de|sert à|sert a)\b/i,
  /\b(?:l['’]objectif|le but|l['’]idée)\s+(?:est|consiste)\s+(?:de|à|a)\s+(?:présenter|presenter|produire|rédiger|rediger|écrire|ecrire|créer|creer|transmettre)\s+(?:un|une)\s+(?:message|contenu|texte|publication|description)\b/i,
  /\b(?:the|this) (?:description|content|text|post|publication|message)\s+(?:should|must|can|needs to)\b/i,
  /\b(?:el|este|esta) (?:contenido|texto|mensaje|publicación|publicacion|descripción|descripcion)\s+(?:debe|debería|deberia|puede)\b/i,
  /\b(?:der|dieser|diese) (?:inhalt|text|beitrag|beschreibung)\s+(?:sollte|muss|kann)\b/i,
  /\b(?:il|questo|questa) (?:contenuto|testo|post|pubblicazione|descrizione)\s+(?:dovrebbe|deve|può|puo)\b/i,
  /\b(?:o|este|esta) (?:conteúdo|conteudo|texto|post|publicação|publicacao|descrição|descricao)\s+(?:deve|deveria|pode)\b/i,
];

function hasEditorialMetaLeak(post: ChannelPost | undefined) {
  if (!post) return false;
  const text = [post.title, post.content, post.cta].filter(Boolean).join("\n");
  if (!text.trim()) return false;
  if (HARD_EDITORIAL_META_PATTERNS.some((pattern) => pattern.test(text))) return true;
  const softMatches = SOFT_EDITORIAL_META_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0,
  );
  return softMatches >= 2;
}

function getPostSimilarityTokens(post: ChannelPost | undefined) {
  const raw = [post?.title, post?.content, post?.cta].filter(Boolean).join(" ");
  const tokens = (raw.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9']+/g) || [])
    .map(normalizeIdeaToken)
    .map(stemIdeaToken)
    .filter((token) => token.length >= 4 && !similarityStopWords.has(token));
  return Array.from(new Set(tokens)).slice(0, 80);
}

function computeJaccardSimilarity(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const left = new Set(a);
  const right = new Set(b);
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function normalizeComparablePostText(post: ChannelPost | undefined) {
  return [post?.title, post?.content, post?.cta]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/#[a-z0-9_]+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findOverSimilarChannels(channels: BoosterChannels[], versions: Partial<Record<BoosterChannels, ChannelPost>>) {
  const duplicateChannels = new Set<BoosterChannels>();
  const candidates = channels.filter((channel) => hasCorePublishableContent(channel, versions[channel]));

  for (let index = 0; index < candidates.length; index += 1) {
    const left = candidates[index]!;
    const leftPost = versions[left];
    const leftComparable = normalizeComparablePostText(leftPost);
    const leftTokens = getPostSimilarityTokens(leftPost);

    for (let rightIndex = index + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex]!;
      const rightPost = versions[right];
      const rightComparable = normalizeComparablePostText(rightPost);
      const rightTokens = getPostSimilarityTokens(rightPost);
      const exactSame = Boolean(leftComparable && leftComparable === rightComparable);
      const jaccard = computeJaccardSimilarity(leftTokens, rightTokens);
      const lengthRatio = Math.min(leftComparable.length, rightComparable.length) / Math.max(leftComparable.length || 1, rightComparable.length || 1);

      // On ne régénère plus une bonne variation simplement parce qu'elle partage
      // naturellement le vocabulaire du même sujet. Seules les copies quasi
      // identiques déclenchent une reprise anti-duplication.
      if (exactSame || (jaccard >= 0.92 && lengthRatio >= 0.86)) {
        duplicateChannels.add(right);
      }
    }
  }

  return Array.from(duplicateChannels);
}

function hasLanguageMismatch(languageCode: string, post: ChannelPost | undefined) {
  if (!post) return false;
  return hasAiLanguageMismatch(
    languageCode,
    [post.title, post.content, post.cta, ...(Array.isArray(post.hashtags) ? post.hashtags : [])].join("\n"),
  );
}

function countEmojis(input: unknown) {
  return String(input || "").match(/\p{Extended_Pictographic}/gu)?.length || 0;
}

function countPostEmojis(post: ChannelPost | undefined) {
  if (!post) return 0;
  return countEmojis([post.title, post.content, post.cta].filter(Boolean).join("\n"));
}

function getDynamicEmojiMinimum(channel: BoosterChannels) {
  return CHANNEL_DYNAMIC_EMOJI_MIN[channel] || 0;
}

function hasSufficientDynamicEmojiPresence(args: {
  channel: BoosterChannels;
  post: ChannelPost | undefined;
  emojiLevel: NormalizedAiGenerationProfile["preferences"]["emojiLevel"];
}) {
  if (args.emojiLevel !== "dynamic") return true;
  const minimum = getDynamicEmojiMinimum(args.channel);
  if (minimum <= 0) return true;
  return countPostEmojis(args.post) >= minimum;
}

function buildLanguageRetryInstructions(languageCode: string, channels: BoosterChannels[]) {
  if (!channels.length) return "";
  const languageLabel = getAiLanguageLabel({ ai_language: languageCode });
  return [
    `ERREUR LANGUE À CORRIGER : les canaux suivants ont été détectés dans une autre langue que la langue configurée : ${channels.map((channel) => CHANNEL_LABELS[channel]).join(", ")}.`,
    `Regénère ces canaux exclusivement en ${languageLabel}.`,
    `Vérifie title, content et cta : chaque texte destiné au lecteur doit être en ${languageLabel}.`,
    `Conserve uniquement les noms propres, marques, adresses, URLs, références techniques et hashtags de marque qui doivent rester tels quels.`,
  ].join("\n");
}


function computeMaxOutputTokens(
  channels: BoosterChannels[],
  mode: "primary" | "repair" = "primary",
  engine?: string | null,
) {
  const uniqueChannels = Array.from(new Set(channels));
  const expectedPerChannel: Record<BoosterChannels, number> = {
    inrcy_site: 950,
    site_web: 1100,
    inr_search: 220,
    gmb: 450,
    facebook: 550,
    instagram: 450,
    linkedin: 750,
    tiktok: 300,
    youtube_shorts: 950,
    pinterest: 350,
  };

  const contentBudget = uniqueChannels.reduce(
    (sum, channel) => sum + expectedPerChannel[channel],
    mode === "repair" ? 500 : 750,
  );

  // Un seul appel principal peut contenir tous les canaux. Le plafond reste une
  // marge de sortie, pas une dépense automatique : seuls les tokens réellement
  // générés sont consommés. La réparation ne reçoit que les canaux invalides.
  const minimum = uniqueChannels.includes("youtube_shorts") ? 3200 : 2200;
  const baseBudget = Math.min(10_000, Math.max(minimum, contentBudget));
  return Math.min(
    10_000,
    applyAiEngineOutputTokenCalibration(baseBudget, engine),
  );
}

function computeGenerationTimeoutMs(args: {
  mode: "primary" | "repair";
  hasImages: boolean;
  engine?: string | null;
}) {
  const baseTimeout =
    args.mode === "repair"
      ? args.hasImages
        ? 42_000
        : 34_000
      : args.hasImages
        ? 64_000
        : 50_000;

  // La QA live peut ajuster légèrement la marge par moteur sans jamais dépasser
  // la politique de route. L'override est borné dans aiEngineCalibration.ts.
  return Math.min(70_000, applyAiEngineTimeoutCalibration(baseTimeout, args.engine));
}

async function generateVersions(args: {
  idea: string;
  publicationInstruction?: string;
  theme: BoosterTheme;
  style: BoosterStyle;
  channels: BoosterChannels[];
  profile: JsonRecord | null;
  business: JsonRecord | null;
  generationProfile: NormalizedAiGenerationProfile;
  recentPublications?: BoosterRecentPublication[];
  mediaContext?: string;
  extraInstructions?: string;
  hiddenAngle?: BoosterHiddenAngle;
  imagesForAI?: BoosterAiImage[];
  aiFeature: AiGenerationFeature;
  accountId?: string;
  budget?: AiOperationBudget;
  deadlineAt?: number;
  mode?: "primary" | "repair";
}) {
  const mode = args.mode || "primary";
  const compiledPrompt = compileBoosterGenerationPrompt({
    idea: args.idea,
    publicationInstruction: args.publicationInstruction,
    theme: args.theme,
    style: args.style,
    channels: args.channels,
    profile: args.profile,
    business: args.business,
    generationProfile: args.generationProfile,
    hiddenAngle: args.hiddenAngle,
    recentPublications: args.recentPublications,
    imageCount: args.generationProfile.request.media.count || args.imagesForAI?.length || 0,
    mediaContext:
      args.mediaContext || args.generationProfile.request.media.context,
    extraInstructions: args.extraInstructions,
  });

  return aiGenerateJSON<BoosterGenResponse>({
    feature: args.aiFeature,
    accountId: args.accountId,
    budget: args.budget,
    engine: args.generationProfile.preferences.engine,
    responseSchema: buildBoosterResponseSchema(args.channels),
    system: compiledPrompt.system,
    input: compiledPrompt.input,
    images: args.imagesForAI,
    maxOutputTokens: computeMaxOutputTokens(
      args.channels,
      mode,
      args.generationProfile.preferences.engine,
    ),
    temperature: getAiEngineTemperature(
      args.generationProfile,
      args.generationProfile.preferences.engine,
      "content",
    ),
    // Étape 3 V2 : un appel principal pour 1 à 10 canaux, puis au maximum
    // une réparation ciblée. Les délais restent sous la fenêtre de route de 120 s.
    timeoutMs: computeGenerationTimeoutMs({
      mode,
      hasImages: Boolean(args.imagesForAI?.length),
      engine: args.generationProfile.preferences.engine,
    }),
    deadlineAt: args.deadlineAt,
    // Avec des médias, une nouvelle tentative du même fournisseur consomme la
    // fenêtre Vercel sans améliorer la fiabilité. On bascule immédiatement vers
    // un autre moteur ; sans média, l'unique reprise historique reste autorisée.
    retries: mode === "repair" || Boolean(args.imagesForAI?.length) ? 0 : 1,
  });
}

function isGeneratedPostSafe(args: {
  channel: BoosterChannels;
  post: ChannelPost | undefined;
  languageCode: string;
}) {
  return Boolean(
    hasCorePublishableContent(args.channel, args.post) &&
      !hasLanguageMismatch(args.languageCode, args.post) &&
      !hasEditorialMetaLeak(args.post),
  );
}

type ChannelQualityIssue =
  | "missing"
  | "off_topic"
  | "meta_leak"
  | "language_mismatch"
  | "too_similar"
  | "too_short_editorial"
  | "emoji_under_target";

// Une seconde passe reste unique et ciblée. Les défauts de sécurité réparent une
// vraie sortie cassée ; longueur détaillée et niveau emoji Beaucoup déclenchent
// seulement un enrichissement non bloquant. Si la passe échoue, le contenu
// initial publiable est conservé.
// L'ancrage lexical et la similarité inter-canaux restent purement consultatifs.
const REPAIR_TRIGGER_ISSUES = new Set<ChannelQualityIssue>([
  "missing",
  "meta_leak",
  "language_mismatch",
  "too_short_editorial",
  "emoji_under_target",
]);

function collectChannelQualityIssues(args: {
  channels: BoosterChannels[];
  versions: Partial<Record<BoosterChannels, ChannelPost>>;
  ideaKeywords: string[];
  languageCode: string;
  lengthPreference: NormalizedAiGenerationProfile["preferences"]["length"];
  emojiLevel: NormalizedAiGenerationProfile["preferences"]["emojiLevel"];
}) {
  const duplicateChannels = new Set(findOverSimilarChannels(args.channels, args.versions));
  const issues = new Map<BoosterChannels, ChannelQualityIssue[]>();

  for (const channel of args.channels) {
    const post = args.versions[channel];
    const channelIssues: ChannelQualityIssue[] = [];

    if (!hasCorePublishableContent(channel, post)) channelIssues.push("missing");

    if (hasCorePublishableContent(channel, post) && !isPostAnchoredToIdea(args.ideaKeywords, post)) {
      channelIssues.push("off_topic");
    }
    if (hasEditorialMetaLeak(post)) channelIssues.push("meta_leak");
    if (hasLanguageMismatch(args.languageCode, post)) channelIssues.push("language_mismatch");
    if (duplicateChannels.has(channel)) channelIssues.push("too_similar");
    if (
      args.lengthPreference === "detailed" &&
      hasCorePublishableContent(channel, post) &&
      (post?.content?.trim().length || 0) < CHANNEL_DETAILED_ENRICHMENT_MIN[channel]
    ) {
      channelIssues.push("too_short_editorial");
    }
    if (
      hasCorePublishableContent(channel, post) &&
      !hasSufficientDynamicEmojiPresence({
        channel,
        post,
        emojiLevel: args.emojiLevel,
      })
    ) {
      channelIssues.push("emoji_under_target");
    }

    if (channelIssues.length) issues.set(channel, channelIssues);
  }

  return issues;
}

function buildSingleRepairInstructions(args: {
  channels: BoosterChannels[];
  issues: Map<BoosterChannels, ChannelQualityIssue[]>;
  idea: string;
  languageCode: string;
  validVersions: Partial<Record<BoosterChannels, ChannelPost>>;
}) {
  const reasonLabels: Record<ChannelQualityIssue, string> = {
    missing: "contenu manquant ou inexploitable",
    off_topic: "ancrage insuffisant dans la phrase libre",
    meta_leak: "commentaire éditorial/méta visible",
    language_mismatch: "mauvaise langue",
    too_similar: "trop proche d'un autre canal",
    too_short_editorial: "contenu trop court pour la préférence Détaillé",
    emoji_under_target: "pas assez d'emojis pour le niveau Beaucoup",
  };

  const diagnostics = args.channels
    .map((channel) => {
      const reasons = args.issues.get(channel) || ["missing"];
      return `- ${CHANNEL_LABELS[channel]} : ${reasons.map((reason) => reasonLabels[reason]).join(", ")}`;
    })
    .join("\n");

  const referenceSnippets = Object.entries(args.validVersions)
    .filter(([channel, post]) => !args.channels.includes(channel as BoosterChannels) && Boolean(post?.content?.trim()))
    .slice(0, 4)
    .map(([channel, post]) => {
      const typedChannel = channel as BoosterChannels;
      const excerpt = String(post?.content || "").replace(/\s+/g, " ").trim().slice(0, 180);
      return `- ${CHANNEL_LABELS[typedChannel]} : ${excerpt}`;
    })
    .join("\n");

  const languageMismatchChannels = args.channels.filter((channel) =>
    args.issues.get(channel)?.includes("language_mismatch"),
  );
  const detailedLengthTargets = args.channels
    .filter((channel) => args.issues.get(channel)?.includes("too_short_editorial"))
    .map(
      (channel) =>
        `- ${CHANNEL_LABELS[channel]} : au moins ${CHANNEL_DETAILED_ENRICHMENT_MIN[channel]} caractères de contenu utile`,
    )
    .join("\n");
  const dynamicEmojiTargets = args.channels
    .filter((channel) => args.issues.get(channel)?.includes("emoji_under_target"))
    .map((channel) => {
      const minimum = getDynamicEmojiMinimum(channel);
      const current = countPostEmojis(args.validVersions[channel]);
      return `- ${CHANNEL_LABELS[channel]} : minimum ${minimum} emojis visibles, actuellement ${current}. Répartis-les naturellement dans title/content/cta.`;
    })
    .join("\n");

  return [
    `RÉPARATION CIBLÉE UNIQUE iNrCy. Regénère uniquement les canaux demandés dans cette passe.`,
    `Sujet obligatoire et prioritaire : "${args.idea}".`,
    `Diagnostics locaux à corriger :\n${diagnostics}`,
    buildLanguageRetryInstructions(args.languageCode, languageMismatchChannels),
    detailedLengthTargets
      ? `ENRICHISSEMENT DE LONGUEUR — préférence DÉTAILLÉ :\n${detailedLengthTargets}\nDéveloppe avec contexte, explication, bénéfice, méthode, étapes ou portée du sujet selon le canal. Ne remplis pas artificiellement et n'invente aucun fait.`
      : "",
    dynamicEmojiTargets
      ? `RENFORCEMENT EMOJIS — niveau BEAUCOUP :\n${dynamicEmojiTargets}\nAjoute de vrais emojis pertinents pour le métier, le sujet et le canal. Ne les regroupe pas tous à la fin ; fais-les vivre dans le texte. Ne mets aucun emoji sur les canaux site.`
      : "",
    `Retourne uniquement des contenus finaux prêts à publier. Aucun commentaire sur la rédaction, aucune explication technique.`,
    `Relis silencieusement chaque title, content et cta avant le JSON final : orthographe, grammaire, conjugaison, accords, ponctuation et typographie doivent être irréprochables dans la langue configurée.`,
    `N'ajoute aucune citation, note, référence, bibliographie ni bloc Sources. Les marqueurs comme [1], [2][4], [1, 2] ou 【1†source】 sont strictement interdits.`,
    `Conserve la personnalité native du moteur choisi et toutes les préférences du pro. Ne transforme pas la réparation en texte standardisé.`,
    `Chaque canal doit rester réellement adapté à son usage et distinct des autres.`,
    referenceSnippets
      ? `Exemples des canaux déjà valides, uniquement pour éviter les doublons — ne les copie pas :\n${referenceSnippets}`
      : "",
  ].filter(Boolean).join("\n\n");
}

async function repairChannelsOnce(args: {
  channels: BoosterChannels[];
  issues: Map<BoosterChannels, ChannelQualityIssue[]>;
  versions: Partial<Record<BoosterChannels, ChannelPost>>;
  idea: string;
  publicationInstruction?: string;
  theme: BoosterTheme;
  style: BoosterStyle;
  profile: JsonRecord | null;
  business: JsonRecord | null;
  generationProfile: NormalizedAiGenerationProfile;
  recentPublications?: BoosterRecentPublication[];
  hiddenAngle?: BoosterHiddenAngle;
  imagesForAI?: BoosterAiImage[];
  mediaContext?: string;
  extraInstructions?: string;
  languageCode: string;
  aiFeature: AiGenerationFeature;
  accountId?: string;
  budget?: AiOperationBudget;
  deadlineAt?: number;
}) {
  if (!args.channels.length) {
    return { recoveredChannels: [] as BoosterChannels[], aiFallback: undefined };
  }

  const out = await generateVersions({
    idea: args.idea,
    publicationInstruction: args.publicationInstruction,
    theme: args.theme,
    style: args.style,
    channels: args.channels,
    profile: args.profile,
    business: args.business,
    generationProfile: args.generationProfile,
    recentPublications: args.recentPublications,
    hiddenAngle: args.hiddenAngle,
    // Une seule réparation est autorisée. On garde les médias lorsque disponibles
    // pour que la phrase libre + le contexte visuel restent fiables, y compris
    // lorsque le pro a fourni très peu de texte.
    imagesForAI: args.imagesForAI,
    aiFeature: args.aiFeature,
    accountId: args.accountId,
    budget: args.budget,
    deadlineAt: args.deadlineAt,
    mode: "repair",
    mediaContext: args.mediaContext,
    extraInstructions: [
      args.extraInstructions,
      buildSingleRepairInstructions({
        channels: args.channels,
        issues: args.issues,
        idea: args.idea,
        languageCode: args.languageCode,
        validVersions: args.versions,
      }),
    ].filter(Boolean).join("\n\n"),
  });
  const aiFallback = getAiGenerationFallbackInfo(out);

  const recovered: BoosterChannels[] = [];
  for (const channel of args.channels) {
    const candidate = normalizePost(channel, extractGeneratedChannelVersion(out, channel));
    // Après une réparation ciblée, on ne conserve que les règles de sécurité réelles.
    // L'ancrage lexical exact est volontairement non bloquant : un moteur peut utiliser
    // des synonymes, reformuler un lieu/sujet ou choisir un angle éditorial naturel.
    const safeCandidate = isGeneratedPostSafe({
      channel,
      post: candidate,
      languageCode: args.languageCode,
    });
    const channelIssues = args.issues.get(channel) || [];
    const hasSafetyRepairIssue = channelIssues.some((issue) =>
      issue === "missing" || issue === "meta_leak" || issue === "language_mismatch",
    );
    const isLengthEnrichment =
      channelIssues.includes("too_short_editorial") && !hasSafetyRepairIssue;
    const isEmojiEnrichment =
      channelIssues.includes("emoji_under_target") && !hasSafetyRepairIssue;
    const originalLength = args.versions[channel]?.content?.trim().length || 0;
    const candidateLength = candidate.content.trim().length;
    const improvesLength = candidateLength > originalLength;
    const originalEmojiCount = countPostEmojis(args.versions[channel]);
    const candidateEmojiCount = countPostEmojis(candidate);
    const reachesEmojiTarget = hasSufficientDynamicEmojiPresence({
      channel,
      post: candidate,
      emojiLevel: args.generationProfile.preferences.emojiLevel,
    });
    const improvesEmoji = candidateEmojiCount > originalEmojiCount;

    // Les enrichissements de style ne doivent jamais dégrader un contenu déjà
    // publiable : on conserve l'original si la passe ne progresse pas.
    if (
      safeCandidate &&
      (!isLengthEnrichment || improvesLength) &&
      (!isEmojiEnrichment || reachesEmojiTarget || improvesEmoji)
    ) {
      args.versions[channel] = candidate;
      recovered.push(channel);
    }
  }

  return { recoveredChannels: recovered, aiFallback };
}


function normalizeInstructionForDetection(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function removeNegatedInstructionSegments(value: string) {
  return value
    .replace(
      /\b(?:ne\s+)?(?:pas|jamais)\b[^.!?;]{0,48}\b(?:en|in)\s+(?:francais|anglais|espagnol|italien|allemand|neerlandais|portugais|thai|thailandais|chinois|chinois\s+simplifie|french|english|spanish|italian|german|dutch|portuguese|simplified\s+chinese)\b/g,
      " ",
    )
    .replace(
      /\b(?:ne\s+)?(?:pas|jamais)\b[^.!?;]{0,36}\b(?:court|courte|long|longue|detaille|detaillee|developpe|developpee|approfondi|approfondie)\b/g,
      " ",
    )
    .replace(/\bni\s+trop\s+court\s+ni\s+trop\s+long\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectPublicationInstructionLanguage(
  instruction: string | undefined,
): NormalizedAiGenerationProfile["preferences"]["language"] | null {
  const value = removeNegatedInstructionSegments(
    normalizeInstructionForDetection(instruction),
  );
  if (!value) return null;

  const rules: Array<[
    NormalizedAiGenerationProfile["preferences"]["language"],
    RegExp,
  ]> = [
    ["fr", /\b(?:en|in)\s+francais\b|\bfrench\b/],
    ["en", /\b(?:en|in)\s+anglais\b|\benglish\b/],
    ["es", /\b(?:en|in)\s+espagnol\b|\bspanish\b|\bcastillan\b/],
    ["it", /\b(?:en|in)\s+italien\b|\bitalian\b/],
    ["de", /\b(?:en|in)\s+allemand\b|\bgerman\b/],
    ["nl", /\b(?:en|in)\s+neerlandais\b|\bdutch\b/],
    ["pt", /\b(?:en|in)\s+portugais\b|\bportuguese\b/],
    ["th", /\b(?:en|in)\s+(?:thai|thailandais)\b|\bthai\b|ภาษาไทย/u],
    ["zh", /\b(?:en|in)\s+chinois(?:\s+simplifie)?\b|\b(?:simplified\s+)?chinese\b|简体中文|中文/u],
  ];

  for (const [language, pattern] of rules) {
    if (pattern.test(value)) return language;
  }
  return null;
}

function detectPublicationInstructionLength(
  instruction: string | undefined,
): NormalizedAiGenerationProfile["preferences"]["length"] | null {
  const value = removeNegatedInstructionSegments(
    normalizeInstructionForDetection(instruction),
  );
  if (!value) return null;
  if (
    /\b(?:texte|contenu|publication|format|version)\s+(?:tres\s+)?(?:court|courte|bref|breve|concis|concise|synthetique)\b/.test(value) ||
    /\b(?:redige|ecris|produis|genere|fais)\b[^.!?;]{0,28}\b(?:court|courte|bref|breve|concis|concise|synthetique)\b/.test(value)
  ) {
    return "short";
  }
  if (
    /\b(?:texte|contenu|publication|format|version)\s+(?:tres\s+)?(?:detaille|detaillee|developpe|developpee|approfondi|approfondie|long|longue)\b/.test(value) ||
    /\b(?:redige|ecris|produis|genere|fais)\b[^.!?;]{0,28}\b(?:detaille|detaillee|developpe|developpee|approfondi|approfondie|long|longue)\b/.test(value)
  ) {
    return "detailed";
  }
  if (/\b(?:longueur|format)\s+moyen(?:ne)?\b/.test(value)) {
    return "medium";
  }
  return null;
}

function detectPublicationInstructionEmojiLevel(
  instruction: string | undefined,
): NormalizedAiGenerationProfile["preferences"]["emojiLevel"] | null {
  const value = normalizeInstructionForDetection(instruction);
  if (!value) return null;
  if (
    /\bsans\s+(?:aucun\s+)?emoji(?:s)?\b|\baucun\s+emoji(?:s)?\b|\b0\s*emoji(?:s)?\b|\bne\s+(?:mets|mettez|utilise|utilisez)\s+pas\s+d['’]?emoji(?:s)?\b/.test(
      value,
    )
  ) {
    return "none";
  }
  const positiveValue = value
    .replace(/\b(?:pas|jamais)\b[^.!?;]{0,28}\bemoji(?:s)?\b/g, " ")
    .replace(/\bpas\s+trop\s+d['’]?emoji(?:s)?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /\b(?:beaucoup|plein|plusieurs|davantage|max(?:imum)?|nombreux|nombreuses)\s+d['’]?emoji(?:s)?\b/.test(positiveValue) ||
    /\bplus\s+d['’]?emoji(?:s)?\b/.test(positiveValue) ||
    /\bemojis?\s+(?:tres\s+)?(?:visibles?|nombreux|nombreuses|partout)\b/.test(positiveValue) ||
    /\bemojis?\s+(?:a|à)\s+chaque\s+phrase\b/.test(positiveValue) ||
    /\b(?:mets|mettez|ajoute|ajoutez|utilise|utilisez|insere|inserez|parseme|parsemez)\b[^.!?;]{0,44}\b(?:beaucoup\s+d['’]?)?emoji(?:s)?\b/.test(positiveValue)
  ) {
    return "dynamic";
  }
  if (/\b(?:peu|quelques|un\s+peu)\s+d['’]?emoji(?:s)?\b|\bemojis?\s+(?:legers?|discrets?)\b/.test(value)) {
    return "light";
  }
  return null;
}

function applyPublicationInstructionOverrides(
  profile: NormalizedAiGenerationProfile,
  instruction: string | undefined,
): NormalizedAiGenerationProfile {
  const language = detectPublicationInstructionLanguage(instruction);
  const length = detectPublicationInstructionLength(instruction);
  const emojiLevel = detectPublicationInstructionEmojiLevel(instruction);
  if (!language && !length && !emojiLevel) return profile;

  return {
    ...profile,
    preferences: {
      ...profile.preferences,
      ...(language ? { language } : {}),
      ...(length ? { length } : {}),
      ...(emojiLevel ? { emojiLevel } : {}),
    },
  };
}

export async function generateSharedBoosterPosts(args: GenerateSharedBoosterPostsArgs): Promise<GenerateSharedBoosterPostsResult> {
  const generationStartedAt = Date.now();
  const timing = {
    mediaPrepMs: 0,
    primaryGenerationMs: 0,
    repairMs: 0,
  };
  const aiFeature = args.aiFeature || "booster.publish";
  const budget = createAiOperationBudget(aiFeature);
  // Deadline absolue partagée entre préanalyse média, appel principal, retry réseau
  // et éventuelle réparation. La route Vercel garde ainsi une marge de fermeture.
  const requestedDeadlineAt = Number(args.deadlineAt || 0);
  const operationDeadlineAt = Math.min(
    budget.startedAt + budget.maxDurationMs,
    Number.isFinite(requestedDeadlineAt) && requestedDeadlineAt > 0
      ? requestedDeadlineAt
      : Number.POSITIVE_INFINITY,
  );
  const style = args.style || "equilibre";
  const baseGenerationProfile = buildNormalizedAiGenerationProfile({
    profile: args.profile,
    business: args.business,
    preferences: args.preferredEngine
      ? { engine: args.preferredEngine }
      : undefined,
    idea: args.idea,
    theme: args.theme,
    style,
    media: {
      type: args.mediaType || (args.imagesForAI?.length ? "images" : "none"),
      count: args.imagesForAI?.length || 0,
      hasVisualContext: Boolean(args.imagesForAI?.length),
      hasAudioTranscript: /transcription audio/i.test(String(args.mediaContext || "")),
      context: compactPromptContext(args.mediaContext),
    },
  });
  const instructionAdjustedGenerationProfile =
    applyPublicationInstructionOverrides(
      baseGenerationProfile,
      args.publicationInstruction,
    );
  // Étape 7 : une seule graine créative par opération. Le primaire et l'unique
  // réparation ciblée partagent exactement le même angle discret.
  const operationHiddenAngle =
    args.hiddenAngle ||
    pickBoosterHiddenAngle(
      instructionAdjustedGenerationProfile.preferences.preferredAngle,
    );

  const channels = Array.from(new Set(args.channels)).filter(
    (channel): channel is BoosterChannels => allowedChannels.includes(channel),
  );

  if (!channels.length) {
    return { versions: {}, recoveredChannels: [] };
  }

  // V2 Étape 4 : le moteur choisi reste toujours l'auteur final.
  // Pour un moteur sans vision (ex. DeepSeek), une passe visuelle neutre extrait
  // des faits puis l'auteur sélectionné rédige sans recevoir les images brutes.
  const mediaPrepStartedAt = Date.now();
  let preparedMedia: Awaited<ReturnType<typeof prepareMediaForSelectedWriter>>;
  try {
    preparedMedia = await prepareMediaForSelectedWriter({
      engine: baseGenerationProfile.preferences.engine,
      images: args.imagesForAI,
      idea: args.idea,
      existingContext: args.mediaContext,
      accountId: args.accountId,
      feature:
        aiFeature === "agent.publish"
          ? "agent.media-understanding"
          : "booster.media-understanding",
      deadlineAt: operationDeadlineAt,
      skipMediaVisionAnalysis: args.skipMediaVisionAnalysis,
    });
  } catch (error) {
    timing.mediaPrepMs = elapsedMs(mediaPrepStartedAt);
    console.warn("[booster-generation] media prep failed", {
      aiFeature,
      accountId: args.accountId || undefined,
      engine: baseGenerationProfile.preferences.engine,
      mediaType: baseGenerationProfile.request.media.type,
      mediaCount: baseGenerationProfile.request.media.count,
      mediaPrepMs: timing.mediaPrepMs,
      totalMs: elapsedMs(generationStartedAt),
      message: generationErrorMessage(error),
    });
    throw error;
  } finally {
    timing.mediaPrepMs = elapsedMs(mediaPrepStartedAt);
  }

  const generationProfile: NormalizedAiGenerationProfile = {
    ...instructionAdjustedGenerationProfile,
    request: {
      ...instructionAdjustedGenerationProfile.request,
      media: {
        ...instructionAdjustedGenerationProfile.request.media,
        hasVisualContext:
          instructionAdjustedGenerationProfile.request.media.hasVisualContext ||
          preparedMedia.visionAnalysisAvailable,
        context: compactPromptContext(preparedMedia.writerContext),
      },
    },
  };

  console.info("[booster-generation] writer/media routing", {
    aiFeature,
    accountId: args.accountId || undefined,
    writerEngine: generationProfile.preferences.engine,
    selectedImages: args.imagesForAI?.length || 0,
    imagesSentToWriter: preparedMedia.imagesForWriter?.length || 0,
    skipMediaVisionAnalysis: Boolean(args.skipMediaVisionAnalysis),
    usedNeutralVisionAnalysis: preparedMedia.usedNeutralVisionAnalysis,
    visionAnalysisAvailable: preparedMedia.visionAnalysisAvailable,
    visionModel: preparedMedia.visionModel,
    visionCacheSource: preparedMedia.visionCacheSource,
  });

  const languageCode = generationProfile.preferences.language;
  const ideaKeywords = extractIdeaKeywords(args.idea);
  const recoveredChannels = new Set<BoosterChannels>();
  let aiFallback: AiGenerationFallbackInfo | undefined;
  let initialGenerationError: unknown = null;

  // V2 Étape 3 : 1 appel principal quel que soit le nombre de canaux sélectionnés.
  // Le schéma JSON dynamique contient exactement ces canaux.
  let rawVersions: Partial<Record<BoosterChannels, Partial<ChannelPost>>> = {};
  const primaryGenerationStartedAt = Date.now();
  try {
    const out = await generateVersions({
      idea: args.idea,
      publicationInstruction: args.publicationInstruction,
      theme: args.theme,
      style,
      channels,
      profile: args.profile,
      business: args.business,
      generationProfile,
      recentPublications: args.recentPublications,
      hiddenAngle: operationHiddenAngle,
      imagesForAI: preparedMedia.imagesForWriter,
      mediaContext: preparedMedia.writerContext,
      extraInstructions: args.extraInstructions,
      aiFeature,
      accountId: args.accountId,
      budget,
      deadlineAt: operationDeadlineAt,
      mode: "primary",
    });
    aiFallback = getAiGenerationFallbackInfo(out) || aiFallback;
    rawVersions = out?.versions && typeof out.versions === "object" ? out.versions : {};
  } catch (error) {
    initialGenerationError = error;
    logGenerationAttemptFailure({
      stage: "primary-single-pass",
      channels,
      aiFeature,
      accountId: args.accountId,
      durationMs: elapsedMs(primaryGenerationStartedAt),
      error,
    });
    rethrowIfRecoveryMustStop(error);
    rawVersions = {};
  } finally {
    timing.primaryGenerationMs = elapsedMs(primaryGenerationStartedAt);
  }

  const safeVersions: Partial<Record<BoosterChannels, ChannelPost>> = {};
  for (const channel of channels) {
    safeVersions[channel] = normalizePost(channel, rawVersions[channel]);
  }

  // Validation locale gratuite. On distingue désormais :
  // - défauts bloquants : sortie cassée, fuite méta, mauvaise langue ;
  // - signaux souples : ancrage lexical faible, contenus trop proches.
  // Les signaux souples ne déclenchent plus de réparation et ne peuvent plus faire
  // échouer une génération créative simplement parce que le moteur reformule.
  const repairIssues = collectChannelQualityIssues({
    channels,
    versions: safeVersions,
    ideaKeywords,
    languageCode,
    lengthPreference: generationProfile.preferences.length,
    emojiLevel: generationProfile.preferences.emojiLevel,
  });
  const repairChannels = channels.filter((channel) =>
    (repairIssues.get(channel) || []).some((issue) => REPAIR_TRIGGER_ISSUES.has(issue)),
  );
  const advisoryChannels = channels.filter((channel) =>
    (repairIssues.get(channel) || []).some((issue) => !REPAIR_TRIGGER_ISSUES.has(issue)),
  );
  const qualityIssueCounts = Object.fromEntries(
    (["missing", "off_topic", "meta_leak", "language_mismatch", "too_similar", "too_short_editorial", "emoji_under_target"] as ChannelQualityIssue[])
      .map((issue) => [
        issue,
        channels.filter((channel) => (repairIssues.get(channel) || []).includes(issue)).length,
      ]),
  );

  console.info("[booster-generation] v2 orchestrator", {
    aiFeature,
    accountId: args.accountId || undefined,
    engine: generationProfile.preferences.engine,
    selectedChannels: channels.length,
    repairChannels: repairChannels.length,
    advisoryChannels: advisoryChannels.length,
    qualityIssueCounts,
    primarySucceeded: !initialGenerationError,
    aiFallbackStage: aiFallback?.stage,
    aiFallbackModel: aiFallback?.finalModel,
  });

  // Une seule réparation ciblée, regroupée dans un unique appel. Jamais de boucle
  // canal par canal, jamais de lots de 3, jamais de rescue YouTube séparé.
  if (repairChannels.length) {
    const repairStartedAt = Date.now();
    try {
      const repaired = await repairChannelsOnce({
        channels: repairChannels,
        issues: repairIssues,
        versions: safeVersions,
        idea: args.idea,
        publicationInstruction: args.publicationInstruction,
        theme: args.theme,
        style,
        profile: args.profile,
        business: args.business,
        generationProfile,
        recentPublications: args.recentPublications,
        hiddenAngle: operationHiddenAngle,
        imagesForAI: preparedMedia.imagesForWriter,
        mediaContext: preparedMedia.writerContext,
        extraInstructions: args.extraInstructions,
        languageCode,
        aiFeature,
        accountId: args.accountId,
        budget,
        deadlineAt: operationDeadlineAt,
      });
      aiFallback = repaired.aiFallback || aiFallback;
      repaired.recoveredChannels.forEach((channel) => recoveredChannels.add(channel));
    } catch (error) {
      logGenerationAttemptFailure({
        stage: "targeted-repair-once",
        channels: repairChannels,
        aiFeature,
        accountId: args.accountId,
        durationMs: elapsedMs(repairStartedAt),
        error,
      });
      rethrowIfRecoveryMustStop(error);
    } finally {
      timing.repairMs = elapsedMs(repairStartedAt);
    }
  }

  // Après l'unique réparation/enrichissement, seuls les défauts réellement dangereux
  // bloquent. Une longueur éditoriale encore inférieure à la cible ne provoque jamais
  // de 502 : le contenu publiable est conservé afin de préserver la robustesse.
  const unsafeChannels = channels.filter(
    (channel) =>
      !isGeneratedPostSafe({
        channel,
        post: safeVersions[channel],
        languageCode,
      }),
  );
  const totalDurationMs = elapsedMs(generationStartedAt);

  if (unsafeChannels.length) {
    console.error("[booster-generation] unsafe channels after single repair", {
      aiFeature,
      accountId: args.accountId || "",
      engine: generationProfile.preferences.engine,
      channels: unsafeChannels,
      selectedChannels: channels.length,
      mediaPrepMs: timing.mediaPrepMs,
      primaryGenerationMs: timing.primaryGenerationMs,
      repairMs: timing.repairMs,
      totalMs: totalDurationMs,
      diagnostics: unsafeChannels.map((channel) => ({
        channel,
        hasPost: Boolean(safeVersions[channel]),
        titleLength: safeVersions[channel]?.title?.trim().length || 0,
        contentLength: safeVersions[channel]?.content?.trim().length || 0,
        languageMismatch: hasLanguageMismatch(languageCode, safeVersions[channel]),
        editorialMetaLeak: hasEditorialMetaLeak(safeVersions[channel]),
      })),
      initialError: initialGenerationError
        ? generationErrorMessage(initialGenerationError)
        : undefined,
    });

    if (initialGenerationError && unsafeChannels.length === channels.length) {
      throw initialGenerationError;
    }

    throw new Error(
      `La génération IA n'a pas pu finaliser un contenu publiable pour ${unsafeChannels
        .map((channel) => CHANNEL_LABELS[channel])
        .join(", ")}. Merci de relancer la génération.`,
    );
  }

  console.info("[booster-generation] timing", {
    aiFeature,
    accountId: args.accountId || undefined,
    engine: generationProfile.preferences.engine,
    selectedChannels: channels.length,
    repairRequestedChannels: repairChannels.length,
    primaryCompliantChannels: channels.length - repairChannels.length,
    recoveredChannels: recoveredChannels.size,
    mediaType: baseGenerationProfile.request.media.type,
    mediaCount: baseGenerationProfile.request.media.count,
    mediaPrepMs: timing.mediaPrepMs,
    primaryGenerationMs: timing.primaryGenerationMs,
    repairMs: timing.repairMs,
    totalMs: totalDurationMs,
    qualityIssueCounts,
    primarySucceeded: !initialGenerationError,
    aiFallbackStage: aiFallback?.stage,
    aiFallbackModel: aiFallback?.finalModel,
  });

  console.info("[booster-generation] quality outcome", {
    aiFeature,
    accountId: args.accountId || undefined,
    engine: generationProfile.preferences.engine,
    selectedChannels: channels.length,
    repairRequestedChannels: repairChannels.length,
    recoveredChannels: recoveredChannels.size,
    repairUsed: repairChannels.length > 0,
    durationMs: totalDurationMs,
    mediaType: baseGenerationProfile.request.media.type,
    mediaCount: baseGenerationProfile.request.media.count,
    language: generationProfile.preferences.language,
    creativity: generationProfile.preferences.creativity,
    aiFallbackStage: aiFallback?.stage,
    aiFallbackModel: aiFallback?.finalModel,
  });

  return {
    versions: safeVersions,
    recoveredChannels: Array.from(recoveredChannels),
    ...(aiFallback ? { aiFallback } : {}),
    performance: {
      mediaPrepMs: timing.mediaPrepMs,
      primaryGenerationMs: timing.primaryGenerationMs,
      repairMs: timing.repairMs,
      totalMs: totalDurationMs,
      selectedChannels: channels.length,
      primaryCompliantChannels: channels.length - repairChannels.length,
      repairRequestedChannels: repairChannels.length,
      recoveredChannels: recoveredChannels.size,
      qualityIssueCounts,
    },
  };
}
