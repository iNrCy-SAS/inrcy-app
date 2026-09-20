import type { BoosterChannels } from "./boosterPrompt.ts";

type JsonRecord = Record<string, unknown>;

type NormalizedStructuredPost = {
  title: string;
  content: string;
  cta: string;
  hashtags: string[];
};

const CHANNEL_OUTPUT_ALIASES: Record<BoosterChannels, string[]> = {
  inrcy_site: ["inrcy_site", "inrcysite", "site_inrcy", "siteinrcy"],
  site_web: ["site_web", "siteweb", "website", "web_site"],
  inr_search: ["inr_search", "inrsearch", "search_page", "public_page"],
  gmb: ["gmb", "google_business", "googlebusiness", "google_business_profile"],
  facebook: ["facebook", "fb"],
  instagram: ["instagram", "insta"],
  linkedin: ["linkedin", "linked_in"],
  x: ["x", "twitter", "twitter_x", "x_twitter"],
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

const RESPONSE_WRAPPER_KEYS = [
  "versions",
  "data",
  "result",
  "output",
  "response",
  "payload",
] as const;

const POST_WRAPPER_KEYS = ["post", "data", "result", "version", "output"] as const;

function asJsonRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function normalizeOutputKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function collectResponseContainers(root: JsonRecord) {
  const containers: JsonRecord[] = [];
  const queue: Array<{ value: JsonRecord; depth: number }> = [{ value: root, depth: 0 }];
  const seen = new Set<JsonRecord>();

  while (queue.length > 0 && containers.length < 24) {
    const current = queue.shift();
    if (!current || seen.has(current.value)) continue;
    seen.add(current.value);
    containers.push(current.value);
    if (current.depth >= 3) continue;

    for (const key of RESPONSE_WRAPPER_KEYS) {
      const nested = asJsonRecord(current.value[key]);
      if (nested) queue.push({ value: nested, depth: current.depth + 1 });
    }
  }

  return containers;
}

function firstTextField(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeHashtags(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === "string")
      ? value.map((item) => item.trim().replace(/^#+/, "")).filter(Boolean)
      : null;
  }
  if (typeof value === "string") {
    return value
      .split(/[\s,;]+/g)
      .map((item) => item.trim().replace(/^#+/, ""))
      .filter(Boolean);
  }
  return value == null ? [] : null;
}

function unwrapPostRecord(value: unknown) {
  let record = asJsonRecord(value);
  if (!record) return null;

  for (let depth = 0; depth < 3; depth += 1) {
    const wrapperKey = POST_WRAPPER_KEYS.find((key) => asJsonRecord(record?.[key]));
    if (!wrapperKey) break;
    record = asJsonRecord(record[wrapperKey]);
    if (!record) return null;
  }
  return record;
}

function coerceStructuredPost(value: unknown): NormalizedStructuredPost | null {
  const record = unwrapPostRecord(value);
  if (!record) return null;

  const title = firstTextField(record, ["title", "titre", "headline", "name"]);
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
  const hashtags = normalizeHashtags(
    record.hashtags ?? record.tags ?? record.keywords ?? record.hash_tags,
  );

  if ((!title && !content && !cta) || !hashtags) return null;
  return { title, content, cta, hashtags };
}

function findChannelPost(
  containers: JsonRecord[],
  channel: BoosterChannels,
): NormalizedStructuredPost | null {
  const aliases = new Set(
    CHANNEL_OUTPUT_ALIASES[channel].map((key) => normalizeOutputKey(key)),
  );

  for (const container of containers) {
    for (const [key, value] of Object.entries(container)) {
      if (!aliases.has(normalizeOutputKey(key))) continue;
      const post = coerceStructuredPost(value);
      if (post) return post;
    }
  }
  return null;
}

/**
 * Convertit uniquement les variantes fournisseur connues vers le contrat
 * canonique Booster. Une réponse groupée partielle conserve ses canaux valides
 * et matérialise les canaux manquants avec un post vide : le contrôle qualité
 * déclenche alors leur réparation ciblée. Une réponse entièrement illisible
 * reste invalide et doit toujours être refusée par le JSON Schema.
 */
export function normalizeBoosterStructuredResponse(
  output: JsonRecord,
  channels: BoosterChannels[],
): JsonRecord {
  const uniqueChannels = Array.from(new Set(channels));
  const containers = collectResponseContainers(output);
  const versions: JsonRecord = {};

  for (const channel of uniqueChannels) {
    const post = findChannelPost(containers, channel);
    if (post) versions[channel] = post;
  }

  if (uniqueChannels.length === 1 && !versions[uniqueChannels[0]!]) {
    for (const container of containers) {
      const directPost = coerceStructuredPost(container);
      if (directPost) {
        versions[uniqueChannels[0]!] = directPost;
        break;
      }
    }
  }

  const recoveredChannelCount = Object.keys(versions).length;
  if (uniqueChannels.length > 1 && recoveredChannelCount > 0) {
    for (const channel of uniqueChannels) {
      if (versions[channel]) continue;
      versions[channel] = {
        title: "",
        content: "",
        cta: "",
        hashtags: [],
      } satisfies NormalizedStructuredPost;
    }
  }

  return { versions };
}
