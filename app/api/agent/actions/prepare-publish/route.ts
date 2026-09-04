import { NextResponse } from "next/server";
import { resolveInrAgentActionRequest } from "@/lib/inrAgentRequest";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { enforceRateLimit } from "@/lib/rateLimit";
import {
  commitAiCredits,
  computeBoosterAiCredits,
  reserveAiCredits,
  rollbackAiCredits,
  isAdminUserForAi,
  type AiCreditReservation,
} from "@/lib/aiUsageQuota";
import {
  type BoosterChannels,
  type BoosterRecentPublication,
  type BoosterTheme,
} from "@/lib/boosterPrompt";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { probeStorageObject } from "@/lib/safeStorageSignedUrl";
import { buildStorageContentUrl } from "@/lib/storageContentUrl";
import { getBoosterGenerationContext } from "@/lib/boosterGenerationContext";
import { INR_AGENT_VIDEO_AI_PREPARATION_VERSION } from "@/lib/inrAgentVideoPreparation";
import {
  getOrPrepareInrAgentVideoForAi,
  type InrAgentCachedVideoPreparationResult,
} from "@/lib/inrAgentVideoContextCache";
import { getAppBubbleAccessMapForUser } from "@/lib/appBubbleAccessServer";
import { isBubbleEnabled, type AppBubbleKey } from "@/lib/bubbleAccess";
import { isOfficialPublicationChannelConnected } from "@/lib/publicationChannelAvailability";
import { ensureSystemManagedInrSearch } from "@/lib/inrSearchProvisioning";
import { getInrSearchPublicStatus } from "@/lib/inrSearchPublic";
import { decodeBusinessSector } from "@/lib/activitySectors";
import {
  findJobValueByLabel,
  getJobLabel,
  getJobsForSector,
  isValidJobForSector,
} from "@/lib/activityCatalog";
import {
  INR_AGENT_PINTEREST_PUBLISH_MIGRATION_FLAG,
  sanitizeInrAgentAutomationSettings,
  type InrAgentAutomationSettings,
  type InrAgentChannel,
  type InrAgentPreferredMediaSource,
  type InrAgentTheme,
  type InrAgentTone,
  type InrAgentValidationMode,
} from "@/lib/inrAgentSettings";
import { rowToInrAgentAction } from "@/lib/inrAgentActions";
import {
  buildVideoAiContextReference,
  videoAiContextReferenceAliases,
} from "@/lib/videoAiContextReference";
import {
  generateSharedBoosterPosts,
  type BoosterAiImage,
} from "@/lib/boosterPublishGeneration";
import { generateInrAgentMedia } from "@/lib/inrAgentMediaGeneration";
import type { BoosterCtaMode } from "@/lib/boosterCta";
import { applySafePreferredCta } from "@/lib/boosterCtaPreferences";
import { loadBoosterCtaDefaults } from "@/lib/boosterCtaDefaultsServer";
import type {
  InrAgentEditorialMediaKind,
  InrAgentEditorialSlot,
} from "@/lib/inrAgentEditorialPlanning";

export const maxDuration = 800;
export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;

type EditorialPreparationTarget = {
  id: string;
  payload: JsonRecord;
  metadata: JsonRecord;
  plan: InrAgentEditorialSlot & { timezone?: string; state?: string };
};

type ChannelPost = {
  title: string;
  content: string;
  cta: string;
  hashtags: string[];
  ctaMode?: BoosterCtaMode;
  ctaUrl?: string;
  ctaPhone?: string;
};

type ImageBankAsset = {
  id: string;
  bucket: string;
  storagePath: string;
  url: string;
  title: string;
  sector: string;
  job: string;
  tags: string[];
  orientation: string;
  source: string;
  librarySource?: "pro_media_library" | "inrcy_image_bank";
  matchLevel?: string;
  mediaType?: "image" | "video";
  kind?: "image" | "video";
  mimeType?: string;
  size?: number | null;
  duration?: number | null;
};

type RecentMediaUsage = {
  cutoffIso: string;
  rowsScanned: number;
  proMediaIds: Set<string>;
  imageBankIds: Set<string>;
  storageKeys: Set<string>;
};

type MediaSelectionAttempt = {
  source: "pro_media_library" | "inrcy_image_bank";
  matchLevel: string;
  mediaType: "image" | "video";
  token?: string;
  sector?: string;
  job?: string;
  totalCandidates: number;
  excludedRecentlyUsed: number;
  eligibleCandidates: number;
  genericSectorCandidates?: number;
  excludedNonGenericSectorCount?: number;
  selected: boolean;
  selectedCandidateId?: string;
  selectedStoragePath?: string;
};

type AutomationDbRow = {
  enabled?: boolean | null;
  frequency?: string | null;
  day_of_week?: number | null;
  time?: string | null;
  validation_mode?: string | null;
  allowed_channels?: string[] | null;
  allowed_themes?: string[] | null;
  use_image_bank?: boolean | null;
  image_required?: boolean | null;
  recipient_scope?: string | null;
  source_strategy?: string | null;
  last_prepared_at?: string | null;
  last_executed_at?: string | null;
  next_run_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

const BUCKET = "inrcy-image-bank";
const PRO_MEDIA_BUCKET = "inrcy-pro-media";
const MEDIA_REUSE_EXCLUSION_DAYS = 60;
const RECENT_MEDIA_MEMORY_LIMIT = 80;
const IMAGE_BANK_DIVERSIFICATION_RATE = 0.3;

const agentToBoosterChannel: Partial<Record<InrAgentChannel, BoosterChannels>> =
  {
    site_inrcy: "inrcy_site",
    site_web: "site_web",
    inr_search: "inr_search",
    gmb: "gmb",
    facebook: "facebook",
    instagram: "instagram",
    linkedin: "linkedin",
    tiktok: "tiktok",
    youtube: "youtube_shorts",
    pinterest: "pinterest",
  };

const boosterToAgentChannel: Record<BoosterChannels, string> = {
  inrcy_site: "site_inrcy",
  site_web: "site_web",
  inr_search: "inr_search",
  gmb: "gmb",
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube_shorts: "youtube_shorts",
  pinterest: "pinterest",
};

const agentThemeToBoosterTheme: Partial<Record<InrAgentTheme, BoosterTheme>> = {
  conseils: "conseil",
  realisations: "realisation",
  offres: "promotion",
  actualites: "actualite",
  coulisses: "realisation",
  temoignages: "avis_client",
  services: "information",
  faq: "conseil",
  recrutement: "actualite",
};

const themeLabels: Partial<Record<InrAgentTheme, string>> = {
  conseils: "Conseil",
  realisations: "Réalisation",
  offres: "Offre",
  actualites: "Actualité",
  coulisses: "Coulisses",
  temoignages: "Avis client",
  services: "Service",
  faq: "Question fréquente",
  recrutement: "Recrutement",
};

const agentToneInstructions: Record<InrAgentTone, string> = {
  professional:
    "Ton professionnel, clair et crédible, sans jargon inutile ni emphase artificielle.",
  friendly:
    "Ton accessible, chaleureux et naturel, tout en restant professionnel.",
  premium:
    "Ton premium, sobre et confiant, avec une formulation élégante sans superlatifs creux.",
  local:
    "Ton local et proche du terrain, valorisant la proximité sans inventer de lieu ni de fait.",
  dynamic:
    "Ton dynamique, direct et rythmé, avec une accroche forte mais jamais agressive.",
};

const channelLabels: Record<string, string> = {
  site_inrcy: "Site iNrCy",
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

const siteChannels = new Set<BoosterChannels>(["inrcy_site", "site_web", "inr_search"]);
const allowedBoosterChannels = new Set<BoosterChannels>([
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
]);

const mediaRequiredChannels = new Set<BoosterChannels>([
  "instagram",
  "tiktok",
  "youtube_shorts",
  "pinterest",
]);

function channelRequiresVideo(channel: BoosterChannels) {
  return channel === "youtube_shorts";
}

function channelMediaReadiness(
  channel: BoosterChannels,
  media: ImageBankAsset | null,
) {
  const mediaKind = media?.mediaType || media?.kind || "image";

  if (channelRequiresVideo(channel) && mediaKind !== "video") {
    return {
      ready: false,
      publishable: false,
      status: "blocked",
      label: "Bloquant",
      reason: "YouTube nécessite une vidéo.",
      blockers: ["YouTube nécessite une vidéo."],
      warnings: [] as string[],
      canPublishTextOnly: false,
    };
  }

  if (mediaRequiredChannels.has(channel) && !media) {
    const reason =
      channel === "instagram"
        ? "Instagram nécessite au moins 1 image ou 1 vidéo."
        : channel === "pinterest"
          ? "Pinterest nécessite une image ou une vidéo."
          : "TikTok nécessite au moins 1 photo ou 1 vidéo.";
    return {
      ready: false,
      publishable: false,
      status: "blocked",
      label: "Bloquant",
      reason,
      blockers: [reason],
      warnings: [] as string[],
      canPublishTextOnly: false,
    };
  }

  const warnings = !media
    ? channel === "gmb"
      ? ["Google Business sera publié sans photo ni vidéo."]
      : ["Aucun média sélectionné."]
    : [];

  return {
    ready: true,
    publishable: true,
    status: media
      ? mediaKind === "video"
        ? "ready_with_video"
        : "ready_with_image"
      : "ready_text_only",
    label: "Prêt",
    reason: media
      ? mediaKind === "video"
        ? "Prêt à publier avec une vidéo."
        : "Prêt à publier avec une image."
      : "Prêt à publier en texte seul.",
    blockers: [] as string[],
    warnings,
    canPublishTextOnly: !media,
  };
}

function rowToAutomationSettings(
  row: AutomationDbRow | null,
): InrAgentAutomationSettings {
  return sanitizeInrAgentAutomationSettings("publish", {
    enabled: row?.enabled ?? undefined,
    frequency: row?.frequency as InrAgentAutomationSettings["frequency"],
    dayOfWeek: row?.day_of_week ?? undefined,
    time: row?.time ?? undefined,
    validationMode:
      row?.validation_mode as InrAgentAutomationSettings["validationMode"],
    allowedChannels:
      row?.allowed_channels as InrAgentAutomationSettings["allowedChannels"],
    allowedThemes:
      row?.allowed_themes as InrAgentAutomationSettings["allowedThemes"],
    useImageBank: row?.use_image_bank ?? undefined,
    imageRequired: row?.image_required ?? undefined,
    recipientScope:
      row?.recipient_scope as InrAgentAutomationSettings["recipientScope"],
    sourceStrategy:
      row?.source_strategy as InrAgentAutomationSettings["sourceStrategy"],
    lastPreparedAt: row?.last_prepared_at ?? null,
    lastExecutedAt: row?.last_executed_at ?? null,
    nextRunAt: row?.next_run_at ?? null,
    metadata: row?.metadata ?? {},
  });
}

function cleanText(value: unknown, maxLength = 220) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanLongContext(value: unknown, maxLength = 4_200) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength)
    .trim();
}

function cleanList(value: unknown, maxItems = 8, maxItemLength = 80) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/[,;\n]/)
        .map((item) => item.trim());

  return Array.from(
    new Set(
      rawItems.map((item) => cleanText(item, maxItemLength)).filter(Boolean),
    ),
  ).slice(0, maxItems);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function normalizeAgentTone(value: unknown): InrAgentTone {
  const tone = cleanText(value, 40) as InrAgentTone;
  return Object.hasOwn(agentToneInstructions, tone) ? tone : "professional";
}

function normalizeEditorialPlan(
  value: unknown,
): (InrAgentEditorialSlot & { timezone?: string; state?: string }) | null {
  const record = asRecord(value);
  const slotKey = cleanText(record.slotKey, 240);
  const scheduledFor = cleanText(record.scheduledFor, 80);
  const scheduledAt = Date.parse(scheduledFor);
  const mediaKind = cleanText(record.mediaKind, 20) as InrAgentEditorialMediaKind;
  const theme = cleanText(record.theme, 80) as InrAgentTheme;
  if (
    !slotKey ||
    !Number.isFinite(scheduledAt) ||
    !["image", "video", "existing"].includes(mediaKind)
  ) {
    return null;
  }
  const channels = (Array.isArray(record.channels) ? record.channels : [])
    .map((channel) => cleanText(channel, 80) as InrAgentChannel)
    .filter(Boolean);
  const rawImageCount = Math.round(Number(record.imageCount) || 0);
  return {
    slotKey,
    scheduledFor: new Date(scheduledAt).toISOString(),
    sequence: Math.max(1, Math.round(Number(record.sequence) || 1)),
    totalSlots: Math.max(1, Math.round(Number(record.totalSlots) || 1)),
    theme,
    tone: normalizeAgentTone(record.tone),
    mediaKind,
    imageCount:
      mediaKind === "image"
        ? rawImageCount >= 2
          ? 2
          : 1
        : 0,
    channels,
    scheduleSignature: cleanText(record.scheduleSignature, 2_000),
    criteriaSignature: cleanText(record.criteriaSignature, 2_000),
    timezone: cleanText(record.timezone, 100) || undefined,
    state: cleanText(record.state, 40) || undefined,
  };
}

async function loadEditorialPreparationTarget(args: {
  userId: string;
  isCron: boolean;
  body: JsonRecord | null;
}): Promise<EditorialPreparationTarget | null> {
  const targetActionId = cleanText(args.body?.targetActionId, 120);
  const triggeredBy = cleanText(args.body?.triggeredBy, 120);
  if (!targetActionId) return null;
  if (!args.isCron || triggeredBy !== "inr_agent_editorial_plan") {
    throw new Error("editorial_preparation_not_authorized");
  }

  const { data, error } = await supabaseAdmin
    .from("inr_agent_actions")
    .select("id,status,payload,metadata")
    .eq("id", targetActionId)
    .eq("user_id", args.userId)
    .eq("automation_key", "publish")
    .maybeSingle();
  if (error) throw error;
  const row = asRecord(data);
  const payload = asRecord(row.payload);
  const metadata = asRecord(row.metadata);
  const plan = normalizeEditorialPlan(payload.editorialPlan);
  if (
    !row.id ||
    row.status !== "executing" ||
    metadata.editorialPlan !== true ||
    !plan
  ) {
    throw new Error("editorial_preparation_target_invalid");
  }
  return {
    id: String(row.id),
    payload,
    metadata,
    plan,
  };
}

function normalizeMediaLibrarySource(record: JsonRecord) {
  const raw = cleanText(
    record.librarySource || record.library_source || record.source || "",
    80,
  );
  const bucket = cleanText(record.bucket || record.bucket_name || "", 100);

  if (raw === "pro_media_library" || bucket === PRO_MEDIA_BUCKET) {
    return "pro_media_library" as const;
  }
  if (raw === "inrcy_image_bank" || bucket === BUCKET) {
    return "inrcy_image_bank" as const;
  }
  return null;
}

function getMediaStoragePath(record: JsonRecord) {
  return cleanText(
    record.storagePath || record.storage_path || record.path || "",
    300,
  );
}

function getMediaSourceKey(
  source: "pro_media_library" | "inrcy_image_bank" | null,
  storagePath: string,
) {
  return source && storagePath ? `${source}:${storagePath}` : "";
}

function rememberMediaReference(usage: RecentMediaUsage, value: unknown) {
  const record = asRecord(value);
  if (!Object.keys(record).length) return;

  const source = normalizeMediaLibrarySource(record);
  const id = cleanText(record.id, 120);
  const storagePath = getMediaStoragePath(record);
  const storageKey = getMediaSourceKey(source, storagePath);

  if (source === "pro_media_library" && id) usage.proMediaIds.add(id);
  if (source === "inrcy_image_bank" && id) usage.imageBankIds.add(id);
  if (storageKey) usage.storageKeys.add(storageKey);
}

function rememberMediaReferences(usage: RecentMediaUsage, value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) rememberMediaReference(usage, item);
    return;
  }

  rememberMediaReference(usage, value);
}

function collectPayloadMediaUsage(usage: RecentMediaUsage, payload: unknown) {
  const record = asRecord(payload);
  if (!Object.keys(record).length) return;

  for (const key of [
    "media",
    "mediaAsset",
    "media_asset",
    "image",
    "imageAsset",
    "image_asset",
    "video",
    "videoAsset",
    "video_asset",
    "selectedMedia",
    "selected_media",
  ]) {
    rememberMediaReferences(usage, record[key]);
  }
}

async function loadRecentMediaUsage(userId: string): Promise<RecentMediaUsage> {
  const cutoff = new Date(
    Date.now() - MEDIA_REUSE_EXCLUSION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const usage: RecentMediaUsage = {
    cutoffIso: cutoff,
    rowsScanned: 0,
    proMediaIds: new Set<string>(),
    imageBankIds: new Set<string>(),
    storageKeys: new Set<string>(),
  };

  try {
    const { data } = await supabaseAdmin
      .from("inr_agent_actions")
      .select("image_assets,payload,created_at,prepared_at")
      .eq("user_id", userId)
      .eq("automation_key", "publish")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(RECENT_MEDIA_MEMORY_LIMIT);

    const rows = Array.isArray(data) ? data : [];
    usage.rowsScanned = rows.length;
    for (const row of rows) {
      const record = asRecord(row);
      rememberMediaReferences(usage, record.image_assets);
      collectPayloadMediaUsage(usage, record.payload);
    }
  } catch {
    // Non bloquant : si la mémoire récente est indisponible, la sélection média
    // reste fonctionnelle avec les règles métier strictes de l'étape 1.
  }

  return usage;
}

function isRecentlyUsedMediaRow(
  row: any,
  source: "pro_media_library" | "inrcy_image_bank",
  usage: RecentMediaUsage,
) {
  const id = cleanText(row?.id, 120);
  const storagePath = cleanText(row?.storage_path, 300);
  const storageKey = getMediaSourceKey(source, storagePath);

  if (source === "pro_media_library" && id && usage.proMediaIds.has(id)) {
    return true;
  }
  if (source === "inrcy_image_bank" && id && usage.imageBankIds.has(id)) {
    return true;
  }
  return Boolean(storageKey && usage.storageKeys.has(storageKey));
}

function filterRecentlyUsedRows<
  T extends { id?: unknown; storage_path?: unknown },
>(
  rows: T[],
  source: "pro_media_library" | "inrcy_image_bank",
  usage: RecentMediaUsage,
) {
  return rows.filter((row) => !isRecentlyUsedMediaRow(row, source, usage));
}

function pickRotatedCandidate<T>(rows: T[]) {
  if (!rows.length) return null;
  const pool = rows.slice(0, Math.min(rows.length, 6));
  return pool[Math.floor(Math.random() * pool.length)] || rows[0] || null;
}

function recordMediaSelectionAttempt(
  attempts: MediaSelectionAttempt[] | undefined,
  params: {
    source: "pro_media_library" | "inrcy_image_bank";
    matchLevel: string;
    mediaType: "image" | "video";
    token?: string;
    sector?: string;
    job?: string;
    rows: Array<{ id?: unknown; storage_path?: unknown }>;
    eligibleRows: Array<{ id?: unknown; storage_path?: unknown }>;
    genericSectorCandidates?: number;
    excludedNonGenericSectorCount?: number;
    selected: { id?: unknown; storage_path?: unknown } | null;
  },
) {
  if (!attempts) return;
  const totalCandidates = params.rows.length;
  const eligibleCandidates = params.eligibleRows.length;
  attempts.push({
    source: params.source,
    matchLevel: params.matchLevel,
    mediaType: params.mediaType,
    token: params.token ? cleanText(params.token, 80) : undefined,
    sector: params.sector ? cleanText(params.sector, 80) : undefined,
    job: params.job ? cleanText(params.job, 80) : undefined,
    totalCandidates,
    excludedRecentlyUsed: Math.max(
      0,
      (params.genericSectorCandidates ?? totalCandidates) - eligibleCandidates,
    ),
    eligibleCandidates,
    genericSectorCandidates: params.genericSectorCandidates,
    excludedNonGenericSectorCount: params.excludedNonGenericSectorCount,
    selected: Boolean(params.selected),
    selectedCandidateId: params.selected
      ? cleanText(params.selected.id, 120)
      : undefined,
    selectedStoragePath: params.selected
      ? cleanText(params.selected.storage_path, 300)
      : undefined,
  });
}

function getRecentMediaTrace(usage: RecentMediaUsage) {
  return {
    exclusionDays: MEDIA_REUSE_EXCLUSION_DAYS,
    cutoffIso: usage.cutoffIso,
    rowsScanned: usage.rowsScanned,
    excludedProMediaCount: usage.proMediaIds.size,
    excludedImageBankCount: usage.imageBankIds.size,
    excludedStoragePathCount: usage.storageKeys.size,
  };
}

function chooseTheme(
  allowedThemes: InrAgentTheme[],
  recentPublications: BoosterRecentPublication[],
): InrAgentTheme {
  const publishThemes = allowedThemes.filter((theme) =>
    Boolean(agentThemeToBoosterTheme[theme]),
  );
  if (!publishThemes.length) return "conseils";
  const patterns: Partial<Record<InrAgentTheme, RegExp>> = {
    conseils: /\b(conseil|astuce|guide|recommand|comment|bon geste|erreur a eviter)\b/i,
    realisations: /\b(realisation|chantier|projet|intervention|avant apres|resultat|coulisses)\b/i,
    offres: /\b(offre|promotion|service|prestation|devis|reservation|decouvr|profitez)\b/i,
    actualites: /\b(actualite|nouveaute|saison|evenement|information|agenda|lancement)\b/i,
    coulisses: /\b(coulisse|equipe|atelier|quotidien|methode|savoir faire|organisation)\b/i,
    temoignages: /\b(avis|temoignage|client|satisfaction|confiance|recommand)\b/i,
    services: /\b(service|prestation|solution|accompagnement|expertise|metier)\b/i,
    faq: /\b(question|reponse|faq|pourquoi|comment|combien|delai)\b/i,
    recrutement: /\b(recrut|poste|candidat|emploi|equipe|embauche|rejoindre)\b/i,
  };
  const normalizedHistory = recentPublications.slice(0, 5).map((publication) =>
    normalizeCatalogText(
      [publication.title, publication.idea, publication.content]
        .filter(Boolean)
        .join(" "),
    ),
  );
  const scored = publishThemes.map((theme, themeIndex) => {
    const pattern = patterns[theme];
    const repetitionScore = normalizedHistory.reduce(
      (total, text, historyIndex) =>
        total + (pattern?.test(text) ? Math.max(1, 6 - historyIndex) : 0),
      0,
    );
    return { theme, repetitionScore, themeIndex };
  });
  scored.sort(
    (a, b) =>
      a.repetitionScore - b.repetitionScore || a.themeIndex - b.themeIndex,
  );
  return scored[0]?.theme || "conseils";
}

function normalizeCatalogText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeCatalogSlug(value: unknown) {
  return normalizeCatalogText(value).replace(/\s+/g, "_");
}

function resolveKnownJobValue(sector: string, rawJob: unknown) {
  const candidate = cleanText(rawJob, 180);
  if (!sector || sector === "autre" || !candidate) return "";
  if (isValidJobForSector(sector, candidate)) return candidate;

  const exactLabelMatch = findJobValueByLabel(sector, candidate);
  if (exactLabelMatch) return exactLabelMatch;

  const normalizedCandidate = normalizeCatalogText(candidate);
  const slugCandidate = normalizeCatalogSlug(candidate);
  const jobs = getJobsForSector(sector);

  for (const job of jobs) {
    if (
      job.value === candidate ||
      job.value === slugCandidate ||
      normalizeCatalogText(job.value) === normalizedCandidate ||
      normalizeCatalogText(job.label) === normalizedCandidate
    ) {
      return job.value;
    }
  }

  for (const job of jobs) {
    const normalizedLabel = normalizeCatalogText(job.label);
    const normalizedValue = normalizeCatalogText(job.value);
    if (
      normalizedCandidate &&
      (normalizedLabel.includes(normalizedCandidate) ||
        normalizedCandidate.includes(normalizedLabel) ||
        normalizedValue.includes(normalizedCandidate) ||
        normalizedCandidate.includes(normalizedValue))
    ) {
      return job.value;
    }
  }

  return "";
}

function getBusinessProfession(business: JsonRecord | null) {
  const decoded = decodeBusinessSector(String(business?.sector || ""));
  const rawProfessionCandidates = [
    decoded.profession,
    business?.profession,
    business?.profession_label,
    business?.professionLabel,
    business?.job,
    business?.job_label,
    business?.jobLabel,
    business?.activity,
    business?.activity_label,
    business?.activityLabel,
  ];

  const profession =
    rawProfessionCandidates
      .map((candidate) =>
        resolveKnownJobValue(decoded.sectorCategory, candidate),
      )
      .find(Boolean) || "";

  const professionLabel =
    (profession ? getJobLabel(decoded.sectorCategory, profession) : "") ||
    cleanText(decoded.profession, 180) ||
    profession;

  return {
    sector: decoded.sectorCategory,
    profession,
    professionLabel,
    rawProfession: cleanText(decoded.profession, 180),
  };
}

function buildAgentIdea(args: {
  business: JsonRecord | null;
  profile: JsonRecord | null;
  theme: InrAgentTheme;
  recentPublications: BoosterRecentPublication[];
}) {
  const { sector, professionLabel } = getBusinessProfession(args.business);
  const company = cleanText(
    args.profile?.company_legal_name || args.profile?.companyLegalName || "",
    90,
  );
  const city = cleanText(
    args.profile?.hq_city || args.profile?.hqCity || "",
    80,
  );
  const services = cleanList(
    args.business?.services || args.business?.services_text,
    5,
    70,
  );
  const zones = cleanList(
    args.business?.intervention_zones || args.business?.intervention_zones_text,
    4,
    70,
  );
  const themeLabel = themeLabels[args.theme] || "Conseil";
  const servicesText = services.length
    ? ` autour de ${services.join(", ")}`
    : "";
  const cityText = city ? ` à ${city}` : "";
  const zonesText = zones.length
    ? ` et ses environs (${zones.join(", ")})`
    : "";
  const companyText = company ? ` pour ${company}` : "";
  const recentTopics = args.recentPublications
    .slice(0, 3)
    .map((publication) =>
      cleanText(publication.title || publication.idea || "", 90),
    )
    .filter(Boolean);
  const freshnessInstruction = recentTopics.length
    ? ` Choisir un angle nettement différent de ces sujets récents : ${recentTopics.join(" ; ")}.`
    : "";

  if (args.theme === "realisations") {
    return `Préparer une publication de type réalisation${companyText} : mettre en avant le sérieux, la méthode et le soin apporté par un professionnel ${professionLabel || sector}${servicesText}${cityText}${zonesText}, sans inventer de faux chantier ni de faux client.${freshnessInstruction}`;
  }

  if (args.theme === "offres") {
    return `Préparer une publication commerciale douce${companyText} : valoriser une prestation utile d'un professionnel ${professionLabel || sector}${servicesText}${cityText}${zonesText}, avec un appel à l'action naturel, sans inventer de remise, de prix ou de promesse.${freshnessInstruction}`;
  }

  if (args.theme === "actualites") {
    return `Préparer une publication d'actualité locale${companyText} pour un professionnel ${professionLabel || sector}${servicesText}${cityText}${zonesText} : parler d'un sujet utile ou saisonnier en lien avec l'activité, sans inventer d'événement précis.${freshnessInstruction}`;
  }

  if (args.theme === "coulisses") {
    return `Préparer une publication dans les coulisses${companyText} pour un professionnel ${professionLabel || sector}${servicesText}${cityText}${zonesText} : expliquer une méthode, une étape de travail, un geste métier ou l'organisation quotidienne de façon humaine et concrète, sans inventer d'équipe, de lieu, de matériel ni d'intervention.${freshnessInstruction}`;
  }

  if (args.theme === "temoignages") {
    return `Préparer une publication de preuve sociale${companyText} pour un professionnel ${professionLabel || sector}${servicesText}${cityText}${zonesText} : valoriser la confiance et la satisfaction uniquement à partir des éléments vérifiables fournis. Ne jamais inventer de client, de citation, de note, de chiffre ni de témoignage ; si aucun avis précis n'est fourni, parler de l'importance des retours clients ou inviter naturellement à consulter ou partager un avis.${freshnessInstruction}`;
  }

  if (args.theme === "services") {
    return `Préparer une publication de présentation de service${companyText} pour un professionnel ${professionLabel || sector}${servicesText}${cityText}${zonesText} : expliquer clairement un service réellement renseigné, son utilité et à qui il s'adresse, avec un appel à l'action naturel, sans inventer de prix, de délai, de garantie ni de promesse.${freshnessInstruction}`;
  }

  if (args.theme === "faq") {
    return `Préparer une publication de type question fréquente${companyText} pour un professionnel ${professionLabel || sector}${servicesText}${cityText}${zonesText} : répondre simplement à une vraie question générale que les clients peuvent se poser sur ce métier, sans inventer de règle, de tarif, de délai ni de condition propre à l'entreprise.${freshnessInstruction}`;
  }

  if (args.theme === "recrutement") {
    return `Préparer une publication autour du recrutement ou de la marque employeur${companyText} pour un professionnel ${professionLabel || sector}${servicesText}${cityText}${zonesText}. Ne jamais annoncer un poste, un contrat, un salaire, un avantage ou une embauche sans information explicite fournie ; à défaut, présenter les valeurs, les savoir-faire ou les métiers de l'entreprise sans faire croire qu'une offre est ouverte.${freshnessInstruction}`;
  }

  return `Préparer une publication de conseil utile${companyText} pour un professionnel ${professionLabel || sector}${servicesText}${cityText}${zonesText} : donner une astuce simple, concrète et rassurante en lien avec le métier, sans inventer de détail non fourni.${freshnessInstruction}`;
}

function cleanHashtags(channel: BoosterChannels, input: unknown) {
  if (channel === "gmb" || siteChannels.has(channel)) return [];
  const limit =
    channel === "instagram" ||
    channel === "tiktok" ||
    channel === "youtube_shorts"
      ? 8
      : channel === "pinterest"
        ? 6
        : channel === "linkedin"
          ? 3
          : 2;
  return Array.isArray(input)
    ? input
        .map((h) =>
          String(h || "")
            .trim()
            .replace(/^#+/, ""),
        )
        .filter(Boolean)
        .slice(0, limit)
    : [];
}

const AGENT_AI_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const AGENT_AI_IMAGE_FETCH_TIMEOUT_MS = 12_000;

async function prepareAgentSelectedImageForAI(
  media: ImageBankAsset | null,
): Promise<BoosterAiImage[]> {
  const mediaKind = media?.mediaType || media?.kind || "image";
  const sourceUrl = cleanText(media?.url, 4_000);
  const bucket = cleanText(media?.bucket, 120);
  const storagePath = cleanText(media?.storagePath, 1_000);
  if (!media || mediaKind !== "image" || (!sourceUrl && !storagePath)) return [];

  if (/^data:image\//i.test(sourceUrl)) {
    return [{ dataUrl: sourceUrl, detail: "low" }];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_AI_IMAGE_FETCH_TIMEOUT_MS);
  try {
    let buffer: Buffer;
    let mimeType: string;

    if (bucket && storagePath) {
      const probe = await probeStorageObject(bucket, storagePath);
      if (probe !== "exists") throw new Error(`image_storage_${probe}`);
      const download = await supabaseAdmin.storage.from(bucket).download(storagePath);
      if (download.error || !download.data) {
        throw new Error(download.error?.message || "image_storage_download");
      }
      buffer = Buffer.from(await download.data.arrayBuffer());
      mimeType = cleanText(
        download.data.type || media.mimeType || "image/jpeg",
        120,
      ).split(";")[0] || "image/jpeg";
    } else {
      const response = await fetch(sourceUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`image_download_${response.status}`);

      const declaredLength = Number(response.headers.get("content-length") || 0);
      if (Number.isFinite(declaredLength) && declaredLength > AGENT_AI_IMAGE_MAX_BYTES) {
        throw new Error("image_too_large");
      }

      mimeType = cleanText(
        response.headers.get("content-type") || media.mimeType || "image/jpeg",
        120,
      ).split(";")[0] || "image/jpeg";
      buffer = Buffer.from(await response.arrayBuffer());
    }

    if (!mimeType.startsWith("image/")) throw new Error("invalid_image_mime");

    if (!buffer.length || buffer.length > AGENT_AI_IMAGE_MAX_BYTES) {
      throw new Error(buffer.length ? "image_too_large" : "image_empty");
    }

    return [{
      dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
      detail: "low",
    }];
  } catch (error) {
    console.warn("[inr-agent] selected image unavailable for AI understanding", {
      mediaId: media.id || undefined,
      source: media.librarySource || media.source || undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function hasUsefulAgentMediaMetadata(media: ImageBankAsset | null) {
  if (!media) return false;
  return Boolean(
    cleanText(media.title, 160) ||
      cleanText(media.sector, 80) ||
      cleanText(media.job, 80) ||
      cleanList(media.tags, 8, 60).length,
  );
}

function shouldUseFastAgentMediaContext(media: ImageBankAsset | null) {
  if (!media) return false;
  // Un visuel fraîchement généré doit toujours être relu visuellement : ses
  // tags techniques ne suffisent pas à écrire une publication fidèle.
  if (media.source === "ai_media_generation") return false;
  const mediaKind = media.mediaType || media.kind || "image";
  const source = cleanText(media.librarySource || media.source || "", 80);
  const knownInternalSource =
    source === "pro_media_library" || source === "inrcy_image_bank";

  return mediaKind === "image" && knownInternalSource && hasUsefulAgentMediaMetadata(media);
}

function buildAgentSelectedMediaContext(
  media: ImageBankAsset | null,
  aiImageAvailable: boolean,
  fastMetadataOnly = false,
  videoPreparation: InrAgentCachedVideoPreparationResult | null = null,
) {
  if (!media) return "";
  const mediaKind = media.mediaType || media.kind || "image";
  const transcript =
    mediaKind === "video"
      ? cleanLongContext(videoPreparation?.transcript, 4_200)
      : "";
  const tags = cleanList(media.tags, 8, 60);
  const metadata = [
    media.title ? `titre interne: ${cleanText(media.title, 160)}` : "",
    media.sector ? `secteur: ${cleanText(media.sector, 80)}` : "",
    media.job ? `métier: ${cleanText(media.job, 80)}` : "",
    tags.length ? `tags: ${tags.join(", ")}` : "",
    media.orientation ? `orientation: ${cleanText(media.orientation, 40)}` : "",
  ].filter(Boolean);

  return [
    `MÉDIA SÉLECTIONNÉ PAR iNr’Agent : ${mediaKind}.`,
    metadata.length ? `Métadonnées internes factuelles : ${metadata.join(" | ")}.` : "",
    mediaKind === "image"
      ? fastMetadataOnly
        ? "Mode rapide iNr’Agent : l'image n'est pas transmise à l'analyse visuelle IA. Utilise uniquement la phrase libre et les métadonnées internes factuelles ; n'invente aucun détail visuel non fourni."
        : aiImageAvailable
          ? "L'image est effectivement transmise à l'analyse IA : utilise uniquement les éléments raisonnablement visibles, sans inventer."
          : "L'image n'a pas pu être chargée pour analyse visuelle : n'invente aucun détail visuel à partir du seul nom du fichier."
      : videoPreparation?.frames.length
        ? `Des captures de la vidéo sont transmises à l'analyse IA (${videoPreparation.frames.length} disponible${videoPreparation.frames.length > 1 ? "s" : ""}). Utilise uniquement les éléments raisonnablement visibles, sans inventer.`
        : "Les captures de la vidéo sont indisponibles : n'invente aucune observation visuelle à partir du seul nom du fichier.",
    mediaKind === "video" && transcript
      ? `Transcription audio détectée dans la vidéo :\n"""${transcript}"""\nLa phrase libre et le contexte métier restent prioritaires. Utilise la transcription uniquement comme contexte factuel complémentaire, sans inventer.`
      : mediaKind === "video"
        ? "La transcription audio de la vidéo est indisponible. Continue sans bloquer la génération."
        : "",
  ].filter(Boolean).join("\n");
}

function getVideoGenerationContextMode(
  videoPreparation: InrAgentCachedVideoPreparationResult | null,
) {
  const hasFrames = Boolean(videoPreparation?.frames.length);
  const hasTranscript = Boolean(cleanLongContext(videoPreparation?.transcript, 1));
  if (hasFrames && hasTranscript) return "full" as const;
  if (hasFrames) return "visual_only" as const;
  if (hasTranscript) return "audio_only" as const;
  return "metadata_only" as const;
}

async function generateBoosterPosts(args: {
  idea: string;
  theme: BoosterTheme;
  channels: BoosterChannels[];
  profile: JsonRecord | null;
  business: JsonRecord | null;
  recentPublications: BoosterRecentPublication[];
  mediaType?: "images" | "video";
  imagesForAI?: BoosterAiImage[];
  mediaContext?: string;
  accountId: string;
  agentTone: InrAgentTone;
  earlierEditorialAngles?: string[];
  skipMediaVisionAnalysis?: boolean;
}) {
  const editorialMemory = args.earlierEditorialAngles?.length
    ? `\nMémoire du mois déjà préparée (ne répète ni ces angles ni leurs accroches) :\n${args.earlierEditorialAngles.join("\n")}`
    : "";
  const { versions, recoveredChannels } = await generateSharedBoosterPosts({
    idea: args.idea,
    theme: args.theme,
    style: "equilibre",
    channels: args.channels,
    profile: args.profile,
    business: args.business,
    recentPublications: args.recentPublications,
    mediaType: args.mediaType || "images",
    imagesForAI: args.imagesForAI,
    forceNonBlocking: true,
    aiFeature: "agent.publish",
    accountId: args.accountId,
    skipMediaVisionAnalysis: args.skipMediaVisionAnalysis,
    mediaContext: args.mediaContext,
    extraInstructions: `CONTEXTE iNr’Agent : cette génération provient de l'automatisation Publier.
Objectif : produire exactement la même logique éditoriale que Booster / Publier manuel, avec un contenu réellement adapté à chaque canal.
TON CHOISI PAR LE PROFESSIONNEL : ${agentToneInstructions[args.agentTone]}
Ne fournis jamais des copies entre canaux. Adapte réellement l'angle, la profondeur, le vocabulaire et le rythme, sans imposer artificiellement une structure différente à chaque version.
Préserve la voix native du moteur IA choisi par l'établissement. Le titre et le contenu sont prioritaires ; un CTA séparé reste facultatif lorsqu'il serait artificiel.${editorialMemory}`,
  });

  return { versions, recoveredChannels };
}

async function selectConnectedChannels(args: {
  supabase: { from: (table: string) => any };
  userId: string;
  automation: InrAgentAutomationSettings;
}): Promise<BoosterChannels[]> {
  const [states, bubbleAccess, provisioned] = await Promise.all([
    getChannelConnectionStates(args.supabase, args.userId),
    getAppBubbleAccessMapForUser(args.supabase, args.userId),
    ensureSystemManagedInrSearch(args.supabase as any, args.userId),
  ]);
  const inrSearchStatus = await getInrSearchPublicStatus(provisioned.inrSearch.slug);

  const isAllowedBoosterChannel = (
    channel: BoosterChannels | undefined,
  ): channel is BoosterChannels => {
    return channel !== undefined && allowedBoosterChannels.has(channel);
  };

  const allowedAgentChannels: InrAgentChannel[] = [...args.automation.allowedChannels];
  if (
    states.pinterest.connected &&
    !states.pinterest.requiresUpdate &&
    !allowedAgentChannels.includes("pinterest") &&
    args.automation.metadata?.[INR_AGENT_PINTEREST_PUBLISH_MIGRATION_FLAG] !== true
  ) {
    allowedAgentChannels.push("pinterest");
  }

  const allowedChannels = allowedAgentChannels
    .map((channel) => agentToBoosterChannel[channel])
    .filter(isAllowedBoosterChannel);

  const bubbleKeyByChannel: Record<BoosterChannels, AppBubbleKey> = {
    inrcy_site: "site_inrcy",
    site_web: "site_web",
    inr_search: "inr_search",
    gmb: "gmb",
    facebook: "facebook",
    instagram: "instagram",
    linkedin: "linkedin",
    tiktok: "tiktok",
    youtube_shorts: "youtube_shorts",
    pinterest: "pinterest",
  };

  const connected: Record<BoosterChannels, boolean> = {
    inrcy_site: isOfficialPublicationChannelConnected(states.site_inrcy),
    site_web: isOfficialPublicationChannelConnected(states.site_web),
    inr_search:
      isOfficialPublicationChannelConnected(states.inr_search) &&
      inrSearchStatus.published,
    gmb: isOfficialPublicationChannelConnected(states.gmb),
    facebook: isOfficialPublicationChannelConnected(states.facebook),
    instagram: isOfficialPublicationChannelConnected(states.instagram),
    linkedin: isOfficialPublicationChannelConnected(states.linkedin),
    tiktok: isOfficialPublicationChannelConnected(states.tiktok),
    youtube_shorts: isOfficialPublicationChannelConnected(states.youtube_shorts),
    pinterest:
      isOfficialPublicationChannelConnected(states.pinterest) &&
      Boolean(states.pinterest.default_board_id),
  };

  const uniqueChannels: BoosterChannels[] = Array.from(
    new Set<BoosterChannels>(allowedChannels),
  );
  return uniqueChannels.filter(
    (channel) =>
      isBubbleEnabled(bubbleAccess, bubbleKeyByChannel[channel]) &&
      connected[channel],
  );
}

async function loadPublishAutomationSettings(userId: string) {
  const { data } = await supabaseAdmin
    .from("inr_agent_automation_settings")
    .select(
      "enabled, frequency, day_of_week, time, validation_mode, allowed_channels, allowed_themes, use_image_bank, image_required, recipient_scope, source_strategy, last_prepared_at, last_executed_at, next_run_at, metadata",
    )
    .eq("user_id", userId)
    .eq("automation_key", "publish")
    .maybeSingle();

  return rowToAutomationSettings((data as AutomationDbRow | null) ?? null);
}

async function loadInrAgentTone(userId: string) {
  const { data } = await supabaseAdmin
    .from("inr_agent_settings")
    .select("tone")
    .eq("user_id", userId)
    .maybeSingle();
  return normalizeAgentTone(data?.tone);
}

async function loadEarlierEditorialAngles(args: {
  userId: string;
  actionId: string;
  scheduledFor: string;
}) {
  const lookupSince = new Date(Date.now() - 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from("inr_agent_actions")
    .select(
      "id,title,preview_text,target_themes,scheduled_for,payload,metadata,status",
    )
    .eq("user_id", args.userId)
    .eq("automation_key", "publish")
    .gte("scheduled_for", lookupSince)
    .lt("scheduled_for", args.scheduledFor)
    .order("scheduled_for", { ascending: true })
    .limit(24);

  return (Array.isArray(data) ? data : [])
    .filter((row) => {
      const metadata = asRecord(row.metadata);
      const plan = asRecord(asRecord(row.payload).editorialPlan);
      return (
        String(row.id || "") !== args.actionId &&
        metadata.editorialPlan === true &&
        String(plan.state || metadata.editorialState || "") === "ready"
      );
    })
    .map((row) => {
      const theme = cleanList(row.target_themes, 1, 50)[0] || "thème libre";
      const angle = cleanText(row.preview_text || row.title, 260);
      return angle ? `- ${theme} : ${angle}` : "";
    })
    .filter(Boolean)
    .slice(-12);
}

async function resolveMediaGenerationActorAuthUserId(args: {
  accountId: string;
  requestAuthUserId: string;
  isCron: boolean;
}) {
  if (!args.isCron && args.requestAuthUserId) return args.requestAuthUserId;

  const { data } = await supabaseAdmin
    .from("inrcy_account_members")
    .select("auth_user_id,role")
    .eq("account_id", args.accountId)
    .limit(20);
  const rows = Array.isArray(data) ? data : [];
  const owner = rows.find(
    (row) => String(row?.role || "").trim().toLowerCase() === "owner",
  );
  const resolved = String(owner?.auth_user_id || rows[0]?.auth_user_id || "").trim();
  return resolved || args.requestAuthUserId || args.accountId;
}

function generatedPickerItemToAgentMedia(args: {
  item: NonNullable<Awaited<ReturnType<typeof generateInrAgentMedia>>["item"]>;
  business: JsonRecord | null;
}) {
  const profession = getBusinessProfession(args.business);
  const mediaType = args.item.media_type === "video" ? "video" : "image";
  const width = Number(args.item.width || 0);
  const height = Number(args.item.height || 0);
  const orientation =
    width > height ? "landscape" : height > width ? "portrait" : "square";

  return {
    id: args.item.id,
    bucket: String(args.item.bucket_name || PRO_MEDIA_BUCKET),
    storagePath: args.item.storage_path,
    url:
      buildStorageContentUrl(
        String(args.item.bucket_name || PRO_MEDIA_BUCKET),
        args.item.storage_path,
      ) || args.item.signed_url || "",
    title: cleanText(args.item.title, 180),
    sector: profession.sector,
    job: profession.profession,
    tags: cleanList(args.item.tags, 12, 60),
    orientation,
    source: "ai_media_generation",
    // Le média accepté est physiquement enregistré dans la médiathèque du pro.
    librarySource: "pro_media_library" as const,
    matchLevel: "ai_generated_for_current_publication",
    mediaType,
    kind: mediaType,
    mimeType:
      cleanText(args.item.mime_type, 120) ||
      (mediaType === "video" ? "video/mp4" : "image/jpeg"),
    size: Number(args.item.size_bytes || 0) || null,
    duration: Number(args.item.duration_seconds || 0) || null,
  } satisfies ImageBankAsset;
}

async function pickMediaFromProLibrary(args: {
  userId: string;
  business: JsonRecord | null;
  theme: InrAgentTheme;
  preferredTypes: Array<"image" | "video">;
  recentMediaUsage: RecentMediaUsage;
  attempts?: MediaSelectionAttempt[];
}): Promise<ImageBankAsset | null> {
  const { sector, profession, professionLabel } = getBusinessProfession(
    args.business,
  );
  const searchTokens = Array.from(
    new Set(
      [profession, professionLabel, sector]
        .map((item) => cleanText(item, 80))
        .filter(Boolean),
    ),
  );

  async function sign(
    row: any,
    matchLevel: "pro_library_business_match" | "pro_library_owned_fallback",
  ): Promise<ImageBankAsset | null> {
    if (!row?.storage_path) return null;
    const bucket = cleanText(row.bucket_name, 80) || PRO_MEDIA_BUCKET;
    const storagePath = String(row.storage_path);
    const contentUrl = buildStorageContentUrl(bucket, storagePath);
    const mediaType = row.media_type === "video" ? "video" : "image";
    const size = Number(row.size_bytes || 0);
    const duration = Number(row.duration_seconds || 0);

    return {
      id: String(row.id || ""),
      bucket,
      storagePath,
      url: contentUrl || "",
      title: cleanText(row.title, 180),
      sector: cleanText(sector, 80),
      job: cleanText(profession, 80),
      tags: Array.isArray(row.tags)
        ? row.tags.map((tag: unknown) => cleanText(tag, 60)).filter(Boolean)
        : [],
      orientation: "",
      source: "pro_media_library",
      librarySource: "pro_media_library",
      matchLevel,
      mediaType,
      kind: mediaType,
      mimeType:
        cleanText(row.mime_type, 120) ||
        (mediaType === "video" ? "video/mp4" : "image/jpeg"),
      size: Number.isFinite(size) && size > 0 ? size : null,
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    };
  }

  try {
    const select =
      "id,bucket_name,storage_path,media_type,mime_type,size_bytes,duration_seconds,title,tags,usage_count,last_used_at,created_at";
    const preferredTypes = args.preferredTypes.length
      ? args.preferredTypes
      : ["image"];

    for (const mediaType of preferredTypes) {
      for (const token of searchTokens) {
        const safeToken = token.replaceAll(",", " ");
        const { data } = await supabaseAdmin
          .from("pro_media_library")
          .select(select)
          .eq("user_id", args.userId)
          .eq("is_active", true)
          .eq("media_type", mediaType)
          .or(`title.ilike.%${safeToken}%,storage_path.ilike.%${safeToken}%`)
          .order("usage_count", { ascending: true })
          .order("created_at", { ascending: false })
          .limit(40);

        const originalRows = Array.isArray(data) ? data : [];
        const rows = filterRecentlyUsedRows(
          originalRows,
          "pro_media_library",
          args.recentMediaUsage,
        );
        const selected = pickRotatedCandidate(rows);
        recordMediaSelectionAttempt(args.attempts, {
          source: "pro_media_library",
          matchLevel: "pro_library_business_match",
          mediaType: mediaType as "image" | "video",
          token,
          sector,
          job: profession,
          rows: originalRows,
          eligibleRows: rows,
          selected,
        });
        if (selected) return sign(selected, "pro_library_business_match");
      }

      // La médiathèque du pro reste prioritaire : même sans tag métier explicite,
      // elle appartient au client. Le fallback global dangereux est interdit
      // uniquement pour la banque d'images iNrCy.
      const { data } = await supabaseAdmin
        .from("pro_media_library")
        .select(select)
        .eq("user_id", args.userId)
        .eq("is_active", true)
        .eq("media_type", mediaType)
        .order("usage_count", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(50);

      const originalRows = Array.isArray(data) ? data : [];
      const rows = filterRecentlyUsedRows(
        originalRows,
        "pro_media_library",
        args.recentMediaUsage,
      );
      const selected = pickRotatedCandidate(rows);
      recordMediaSelectionAttempt(args.attempts, {
        source: "pro_media_library",
        matchLevel: "pro_library_owned_fallback",
        mediaType: mediaType as "image" | "video",
        sector,
        job: profession,
        rows: originalRows,
        eligibleRows: rows,
        selected,
      });
      if (selected) return sign(selected, "pro_library_owned_fallback");
    }

    return null;
  } catch {
    return null;
  }
}

function isGenericImageBankJob(row: any) {
  const job = normalizeCatalogSlug(row?.job);
  const tags = Array.isArray(row?.tags)
    ? (row.tags as unknown[]).map((tag: unknown) => normalizeCatalogSlug(tag))
    : [];
  const genericMarkers = new Set([
    "",
    "all",
    "tous",
    "tous_metiers",
    "tous_les_metiers",
    "general",
    "generique",
    "generic",
    "secteur",
    "sector",
    "autre",
  ]);

  return (
    genericMarkers.has(job) ||
    tags.some((tag) => genericMarkers.has(tag))
  );
}

async function pickImageFromBank(args: {
  business: JsonRecord | null;
  theme: InrAgentTheme;
  recentMediaUsage: RecentMediaUsage;
  attempts?: MediaSelectionAttempt[];
}): Promise<ImageBankAsset | null> {
  const { sector, profession } = getBusinessProfession(args.business);

  async function sign(
    row: any,
    matchLevel: "image_bank_job_exact" | "image_bank_sector_generic",
  ): Promise<ImageBankAsset | null> {
    if (!row?.storage_path) return null;
    const storagePath = String(row.storage_path);
    const contentUrl = buildStorageContentUrl(BUCKET, storagePath);

    return {
      id: String(row.id || ""),
      bucket: BUCKET,
      storagePath,
      url: contentUrl || "",
      title: cleanText(row.title, 180),
      sector: cleanText(row.sector, 80),
      job: cleanText(row.job, 80),
      tags: Array.isArray(row.tags)
        ? row.tags.map((tag: unknown) => cleanText(tag, 60)).filter(Boolean)
        : [],
      orientation: cleanText(row.orientation, 40),
      source: cleanText(row.source, 80),
      librarySource: "inrcy_image_bank",
      matchLevel,
      mediaType: "image",
      kind: "image",
      mimeType: "image/jpeg",
      size: null,
      duration: null,
    };
  }

  try {
    const select =
      "id,storage_path,title,sector,job,tags,orientation,source,usage_count,created_at";

    // Sécurité métier stricte : la banque iNrCy ne doit jamais fournir une image
    // d'un autre métier au hasard. On accepte uniquement le métier exact. Le
    // fallback secteur est réservé aux médias explicitement génériques.
    if (sector && sector !== "autre" && profession) {
      const { data } = await supabaseAdmin
        .from("inrcy_image_bank")
        .select(select)
        .eq("is_active", true)
        .eq("sector", sector)
        .eq("job", profession)
        .order("usage_count", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(40);

      const originalRows = Array.isArray(data) ? data : [];
      const rows = filterRecentlyUsedRows(
        originalRows,
        "inrcy_image_bank",
        args.recentMediaUsage,
      );
      const selected = pickRotatedCandidate(rows);
      recordMediaSelectionAttempt(args.attempts, {
        source: "inrcy_image_bank",
        matchLevel: "image_bank_job_exact",
        mediaType: "image",
        sector,
        job: profession,
        rows: originalRows,
        eligibleRows: rows,
        selected,
      });
      if (selected) return sign(selected, "image_bank_job_exact");
    }

    if (sector && sector !== "autre") {
      const { data } = await supabaseAdmin
        .from("inrcy_image_bank")
        .select(select)
        .eq("is_active", true)
        .eq("sector", sector)
        .order("usage_count", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(50);

      const originalRows = Array.isArray(data) ? data : [];
      const genericRows = originalRows.filter(isGenericImageBankJob);
      const rows = filterRecentlyUsedRows(
        genericRows,
        "inrcy_image_bank",
        args.recentMediaUsage,
      );
      const selected = pickRotatedCandidate(rows);
      recordMediaSelectionAttempt(args.attempts, {
        source: "inrcy_image_bank",
        matchLevel: "image_bank_sector_generic",
        mediaType: "image",
        sector,
        job: "generic",
        rows: originalRows,
        eligibleRows: rows,
        genericSectorCandidates: genericRows.length,
        excludedNonGenericSectorCount: Math.max(
          0,
          originalRows.length - genericRows.length,
        ),
        selected,
      });
      if (selected) return sign(selected, "image_bank_sector_generic");
    }

    return null;
  } catch {
    return null;
  }
}

type MediaDiversificationTrace = {
  policyVersion: string;
  policy: string;
  imageBankDiversificationRate: number;
  sourceCandidates: {
    proMediaLibrary: boolean;
    imageBank: boolean;
  };
  proCandidateMatchLevel: string;
  imageBankCandidateMatchLevel: string;
  selectedByDiversification: boolean;
  roll: number | null;
  decisionReason: string;
  attempts: MediaSelectionAttempt[];
  preferredSource: InrAgentPreferredMediaSource;
};

function getCandidateSummary(media: ImageBankAsset | null) {
  return media
    ? {
        id: media.id,
        source: media.librarySource || media.source || "",
        matchLevel: media.matchLevel || "",
        mediaType: media.mediaType || media.kind || "image",
        sector: media.sector || "",
        job: media.job || "",
      }
    : null;
}

function buildMediaDiversificationTrace(params: {
  proMedia: ImageBankAsset | null;
  imageBankMedia: ImageBankAsset | null;
  selected: ImageBankAsset | null;
  roll: number | null;
  decisionReason: string;
  preferredSource?: InrAgentPreferredMediaSource;
  attempts?: MediaSelectionAttempt[];
}): MediaDiversificationTrace {
  const {
    proMedia,
    imageBankMedia,
    selected,
    roll,
    decisionReason,
    preferredSource = "media_library",
    attempts = [],
  } = params;
  return {
    policyVersion: "media_selection_v5_strict_generic_sector_trace",
    policy:
      "pro_library_first_with_30_percent_relevant_image_bank_diversification_strict_generic_sector_fallback",
    imageBankDiversificationRate: IMAGE_BANK_DIVERSIFICATION_RATE,
    sourceCandidates: {
      proMediaLibrary: Boolean(proMedia),
      imageBank: Boolean(imageBankMedia),
    },
    proCandidateMatchLevel: proMedia?.matchLevel || "none",
    imageBankCandidateMatchLevel: imageBankMedia?.matchLevel || "none",
    selectedByDiversification: Boolean(
      selected &&
        proMedia &&
        imageBankMedia &&
        selected.librarySource === "inrcy_image_bank",
    ),
    roll,
    decisionReason,
    attempts,
    preferredSource,
  };
}

async function pickDiversifiedMedia(args: {
  userId: string;
  business: JsonRecord | null;
  theme: InrAgentTheme;
  preferredTypes: Array<"image" | "video">;
  preferredSource: InrAgentPreferredMediaSource;
  recentMediaUsage: RecentMediaUsage;
}): Promise<{
  media: ImageBankAsset | null;
  diversificationTrace: MediaDiversificationTrace;
  proCandidate: ReturnType<typeof getCandidateSummary>;
  imageBankCandidate: ReturnType<typeof getCandidateSummary>;
}> {
  const attempts: MediaSelectionAttempt[] = [];
  const proMedia = await pickMediaFromProLibrary({ ...args, attempts });
  const imageBankMedia = await pickImageFromBank({
    business: args.business,
    theme: args.theme,
    recentMediaUsage: args.recentMediaUsage,
    attempts,
  });

  let selected: ImageBankAsset | null = null;
  const roll: number | null = null;
  let decisionReason = "no_relevant_media_available";

  if (args.preferredSource === "image_bank" && imageBankMedia) {
    selected = imageBankMedia;
    decisionReason = "preferred_image_bank_selected";
  } else if (args.preferredSource === "media_library" && proMedia) {
    selected = proMedia;
    decisionReason = "preferred_media_library_selected";
  } else if (args.preferredSource === "ai_generation") {
    selected = proMedia || imageBankMedia;
    decisionReason = selected
      ? "ai_generation_preferred_existing_fallback_prepared"
      : "ai_generation_preferred_without_existing_fallback";
  } else if (proMedia && !imageBankMedia) {
    selected = proMedia;
    decisionReason = "preferred_source_unavailable_pro_library_fallback";
  } else if (!proMedia && imageBankMedia) {
    selected = imageBankMedia;
    decisionReason = "preferred_source_unavailable_image_bank_fallback";
  } else if (proMedia && imageBankMedia) {
    selected = proMedia;
    decisionReason = "deterministic_pro_library_fallback";
  }

  return {
    media: selected,
    diversificationTrace: buildMediaDiversificationTrace({
      proMedia,
      imageBankMedia,
      selected,
      roll,
      decisionReason,
      preferredSource: args.preferredSource,
      attempts,
    }),
    proCandidate: getCandidateSummary(proMedia),
    imageBankCandidate: getCandidateSummary(imageBankMedia),
  };
}

function getExecutionPolicy(validationMode: InrAgentValidationMode) {
  void validationMode;
  return "manual_validation";
}

function getInitialStatus(validationMode: InrAgentValidationMode) {
  void validationMode;
  return "pending_validation";
}

function requiresManualValidation(validationMode: InrAgentValidationMode) {
  void validationMode;
  return true;
}

function hasUsefulContent(post: ChannelPost | undefined) {
  return Boolean(
    post?.title?.trim() || post?.content?.trim() || post?.cta?.trim(),
  );
}

function buildPreviewText(
  versions: Partial<Record<BoosterChannels, ChannelPost>>,
) {
  const preferredOrder: BoosterChannels[] = [
    "facebook",
    "instagram",
    "gmb",
    "linkedin",
    "inrcy_site",
    "site_web",
    "inr_search",
    "tiktok",
    "youtube_shorts",
  ];
  const first = preferredOrder
    .map((channel) => versions[channel])
    .find(hasUsefulContent);
  if (!first) return "";
  return [first.title, first.content, first.cta].filter(Boolean).join("\n\n");
}

function buildSummary(
  channels: BoosterChannels[],
  media: ImageBankAsset | null,
  mediaCount = media ? 1 : 0,
) {
  const labels = channels
    .map((channel) => channelLabels[boosterToAgentChannel[channel]] || channel)
    .join(", ");
  const mediaSentence =
    media?.source === "ai_media_generation"
      ? media.mediaType === "video" || media.kind === "video"
        ? " Vidéo IA créée et ajoutée à la médiathèque."
        : mediaCount > 1
          ? ` ${mediaCount} visuels IA complémentaires créés et ajoutés à la médiathèque.`
          : " Visuel IA créé et ajouté à la médiathèque."
      : media
        ? media.mediaType === "video" || media.kind === "video"
          ? " Vidéo ajoutée depuis la médiathèque du pro."
          : " Visuel ajouté depuis la médiathèque ou la banque d’images."
        : " Aucun média disponible : les canaux compatibles seront préparés en texte seul.";
  return `Publication préparée pour ${labels}.${mediaSentence}`;
}

export async function POST(request: Request) {
  const routeStartedAt = Date.now();
  let mediaSelectionMs = 0;
  let imagePreparationMs = 0;
  let videoPreparationMs = 0;
  let aiGenerationMs = 0;
  let persistenceMs = 0;
  let generationContextMs = 0;
  let professionalContextSource: "hit" | "database" | "disabled" | "not_loaded" =
    "not_loaded";
  let publicationsContextSource: "hit" | "database" | "disabled" | "not_loaded" =
    "not_loaded";
  const context = await resolveInrAgentActionRequest(request);
  if (context.errorResponse) return context.errorResponse;

  const { supabase, userId, authUserId, isCron, body } = context;
  let editorialTarget: EditorialPreparationTarget | null = null;
  try {
    editorialTarget = await loadEditorialPreparationTarget({
      userId,
      isCron,
      body,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Le créneau éditorial à préparer est invalide ou n’est plus disponible.",
        code: error instanceof Error ? error.message : "editorial_target_invalid",
      },
      { status: 409 },
    );
  }
  const actorUserId = await resolveMediaGenerationActorAuthUserId({
    accountId: userId,
    requestAuthUserId: authUserId,
    isCron,
  });
  const quotaAccountId = userId;
  const isAdmin = await isAdminUserForAi(supabase, actorUserId);

  if (!isAdmin) {
    const rl = await enforceRateLimit({
      name: "inr_agent_prepare_publish",
      identifier: actorUserId,
      limit: 4,
      window: "1 m",
    });
    if (rl) return rl;
  }

  const [automation, storedAgentTone] = await Promise.all([
    loadPublishAutomationSettings(userId),
    loadInrAgentTone(userId),
  ]);
  if (!automation.enabled) {
    return NextResponse.json(
      { error: "L’automatisation Publier est désactivée." },
      { status: 400 },
    );
  }

  const generationContextStartedAt = Date.now();
  const generationContextPromise = getBoosterGenerationContext({
    supabase,
    userId,
  }).then((generationContext) => {
    generationContextMs = Date.now() - generationContextStartedAt;
    professionalContextSource = generationContext.cacheSource.professional;
    publicationsContextSource = generationContext.cacheSource.publications;
    return generationContext;
  });
  const earlierEditorialAnglesPromise = editorialTarget
    ? loadEarlierEditorialAngles({
        userId,
        actionId: editorialTarget.id,
        scheduledFor: editorialTarget.plan.scheduledFor,
      })
    : Promise.resolve([] as string[]);

  const [
    availableChannels,
    generationContext,
    earlierEditorialAngles,
    ctaDefaults,
  ] =
    await Promise.all([
      selectConnectedChannels({
        supabase,
        userId,
        automation,
      }),
      generationContextPromise,
      earlierEditorialAnglesPromise,
      loadBoosterCtaDefaults({ supabase, userId }),
    ]);
  const plannedBoosterChannels = editorialTarget
    ? editorialTarget.plan.channels
        .map((channel) => agentToBoosterChannel[channel])
        .filter((channel): channel is BoosterChannels => Boolean(channel))
    : [];
  const channels = (
    editorialTarget
      ? availableChannels.filter((channel) =>
          plannedBoosterChannels.includes(channel),
        )
      : availableChannels
  ).filter(
    (channel) =>
      // Double sécurité : même si un ancien plan ou une donnée altérée remet
      // YouTube dans un créneau image, il ne traversera jamais la préparation.
      !(
        editorialTarget?.plan.mediaKind === "image" &&
        channel === "youtube_shorts"
      ),
  );
  if (!channels.length) {
    return NextResponse.json(
      {
        error:
          "Aucun canal Booster / Publier connecté et autorisé pour iNr’Agent.",
      },
      { status: 400 },
    );
  }

  const { profile, business, recentPublications } = generationContext;
  const agentTone = editorialTarget?.plan.tone || storedAgentTone;

  const businessProfession = getBusinessProfession(business);
  const plannedTheme = editorialTarget?.plan.theme;
  const agentTheme =
    plannedTheme && automation.allowedThemes.includes(plannedTheme)
      ? plannedTheme
      : chooseTheme(automation.allowedThemes, recentPublications);
  const boosterTheme = agentThemeToBoosterTheme[agentTheme] || "conseil";
  const baseIdea = buildAgentIdea({
    business,
    profile,
    theme: agentTheme,
    recentPublications,
  });
  const idea = editorialTarget
    ? `${baseIdea}\n\nPLAN ÉDITORIAL : publication ${editorialTarget.plan.sequence}/${editorialTarget.plan.totalSlots} du mois glissant, prévue le ${editorialTarget.plan.scheduledFor}. Choisis un angle concret distinct des autres publications du mois, tout en respectant strictement le thème et les informations vérifiées du profil.`
    : baseIdea;
  const requiresGeneratedVideo = channels.includes("youtube_shorts");
  const prefersExistingVideo =
    requiresGeneratedVideo || channels.includes("tiktok");
  const mediaSelectionStartedAt = Date.now();
  const recentMediaUsage = await loadRecentMediaUsage(userId);
  const diversifiedMediaSelection = automation.useImageBank
    ? await pickDiversifiedMedia({
        userId,
        business,
        theme: agentTheme,
        preferredTypes: prefersExistingVideo
          ? ["video", "image"]
          : ["image", "video"],
        preferredSource: automation.preferredMediaSource,
        recentMediaUsage,
      })
    : {
        media: null,
        diversificationTrace: buildMediaDiversificationTrace({
          proMedia: null,
          imageBankMedia: null,
          selected: null,
          roll: null,
          decisionReason: "image_bank_disabled_in_automation_settings",
          preferredSource: automation.preferredMediaSource,
        }),
        proCandidate: null,
        imageBankCandidate: null,
      };
  const fallbackMedia = diversifiedMediaSelection.media;
  const fallbackKind =
    fallbackMedia?.mediaType || fallbackMedia?.kind || "image";
  const shouldGenerateMedia =
    automation.preferredMediaSource === "ai_generation" ||
    !fallbackMedia ||
    (requiresGeneratedVideo && fallbackKind !== "video");
  const plannedMediaKind = editorialTarget?.plan.mediaKind;
  const generatedKind =
    plannedMediaKind === "image" || plannedMediaKind === "video"
      ? plannedMediaKind
      : requiresGeneratedVideo
        ? "video"
        : "image";
  const requestedGenerationCount =
    shouldGenerateMedia && generatedKind === "image"
      ? editorialTarget?.plan.imageCount === 2
        ? 2
        : 1
      : shouldGenerateMedia
        ? 1
        : 0;
  const generatedMediaResults: Array<
    Awaited<ReturnType<typeof generateInrAgentMedia>>
  > = [];
  for (let index = 0; index < requestedGenerationCount; index += 1) {
    generatedMediaResults.push(
      await generateInrAgentMedia({
        supabase: supabaseAdmin,
        accountId: userId,
        actorAuthUserId: actorUserId,
        idea:
          index === 0
            ? idea
            : `${idea}\n\nCrée une seconde variation visuelle complémentaire : autre cadrage ou autre scène, même identité de marque et même message, sans dupliquer la première image.`,
        theme: agentTheme,
        kind: generatedKind,
        adminUnlimited: isAdmin,
      }),
    );
  }
  const generatedMediaResult =
    generatedMediaResults.find((result) => Boolean(result.item)) ||
    generatedMediaResults[0] ||
    null;
  const generatedMediaAssets = generatedMediaResults.flatMap((result) =>
    result.item
      ? [generatedPickerItemToAgentMedia({ item: result.item, business })]
      : [],
  );
  const fallbackMatchesPlan =
    !editorialTarget ||
    plannedMediaKind === "existing" ||
    plannedMediaKind === fallbackKind;
  let media = generatedMediaResult?.item
    ? generatedPickerItemToAgentMedia({
        item: generatedMediaResult.item,
        business,
      })
    : fallbackMatchesPlan
      ? fallbackMedia
      : null;

  // Si une génération d'image ne peut pas satisfaire YouTube Shorts, on ne
  // remplace jamais une vidéo existante valide par cette image.
  if (
    requiresGeneratedVideo &&
    generatedMediaResult?.item &&
    generatedMediaResult.item.media_type !== "video" &&
    fallbackKind === "video"
  ) {
    media = fallbackMedia;
  }
  const mediaAssets: ImageBankAsset[] = generatedMediaAssets.length
    ? generatedMediaAssets
    : media
      ? [media]
      : [];
  if (
    editorialTarget &&
    automation.imageRequired &&
    requestedGenerationCount > 0 &&
    mediaAssets.length === 0
  ) {
    const outcomes = generatedMediaResults.map((result) => result.outcome);
    const primaryOutcome = outcomes[0] || "generation_failed";
    return NextResponse.json(
      {
        error: `editorial_media_${primaryOutcome}`,
        code: "editorial_media_required_unavailable",
        outcomes,
      },
      { status: primaryOutcome === "quota_reached" ? 429 : 503 },
    );
  }
  mediaSelectionMs = Date.now() - mediaSelectionStartedAt;
  const failedGeneratedMediaResult = generatedMediaResults.find(
    (result) => result.outcome !== "generated",
  );
  const generationWarning = failedGeneratedMediaResult
    ? failedGeneratedMediaResult.outcome === "quota_reached"
      ? "ai_generation_quota_reached_existing_media_fallback_used"
      : failedGeneratedMediaResult.outcome !== "generated"
        ? `ai_generation_${failedGeneratedMediaResult.outcome}_existing_media_fallback_used`
        : ""
    : "";
  const mediaSelectionTrace = {
    policyVersion: "media_selection_v7_monthly_editorial_mix",
    editorialPlan: editorialTarget?.plan || null,
    triedSources: [
      ...(shouldGenerateMedia ? ["ai_media_generation"] : []),
      ...(automation.useImageBank
        ? ["pro_media_library", "inrcy_image_bank"]
        : []),
    ],
    sourcePolicy: {
      proMediaLibrary: "owned_media_allowed_with_recent_reuse_exclusion",
      imageBank: "job_exact_then_generic_sector_only",
      imageBankGlobalFallbackAllowed: false,
      imageBankDiversificationRate: IMAGE_BANK_DIVERSIFICATION_RATE,
    },
    classification: {
      sector: businessProfession.sector,
      profession: businessProfession.profession,
      professionLabel: businessProfession.professionLabel,
      rawProfession: businessProfession.rawProfession,
      professionValidForSector: Boolean(
        businessProfession.sector &&
          businessProfession.profession &&
          isValidJobForSector(
            businessProfession.sector,
            businessProfession.profession,
          ),
      ),
    },
    diversification: diversifiedMediaSelection.diversificationTrace,
    proMediaLibraryCandidate: diversifiedMediaSelection.proCandidate,
    imageBankCandidate: diversifiedMediaSelection.imageBankCandidate,
    businessSector: businessProfession.sector,
    businessProfession: businessProfession.profession,
    businessProfessionLabel: businessProfession.professionLabel,
    rawProfession: businessProfession.rawProfession,
    aiGeneration: generatedMediaResult
      ? {
          attempted: true,
          kind: generatedMediaResult.kind,
          outcome: generatedMediaResult.outcome,
          errorCode: generatedMediaResult.errorCode || null,
          requestedCount: requestedGenerationCount,
          generatedCount: generatedMediaAssets.length,
          outcomes: generatedMediaResults.map((result) => result.outcome),
          consumedSharedStudioQuota:
            generatedMediaResults.some((result) => result.outcome === "generated"),
        }
      : {
          attempted: false,
          kind: null,
          outcome: "not_requested",
          errorCode: null,
          consumedSharedStudioQuota: false,
        },
    selectedSource: media
      ? media.source === "ai_media_generation"
        ? "ai_media_generation"
        : media.librarySource ||
          (media.source === "pro_media_library"
            ? "pro_media_library"
            : "inrcy_image_bank")
      : "none",
    selectedSector: media?.sector || "",
    selectedJob: media?.job || "",
    selectedMediaType: media?.mediaType || media?.kind || "none",
    matchLevel: media?.matchLevel || "none",
    unsafeGlobalImageBankFallbackAllowed: false,
    recentMediaPolicy: getRecentMediaTrace(recentMediaUsage),
    selectedWasRecentlyUsed:
      media && media.source !== "ai_media_generation"
      ? isRecentlyUsedMediaRow(
          {
            id: media.id,
            storage_path: media.storagePath,
          },
          media.librarySource === "pro_media_library"
            ? "pro_media_library"
            : "inrcy_image_bank",
          recentMediaUsage,
        )
      : false,
    warnings: [
      generationWarning,
      media?.librarySource === "pro_media_library" &&
      media.source !== "ai_media_generation" &&
      media.matchLevel === "pro_library_owned_fallback"
        ? "pro_library_owned_fallback_without_business_match"
        : "",
      media?.librarySource === "inrcy_image_bank" &&
      media.matchLevel === "image_bank_sector_generic"
        ? "image_bank_generic_sector_fallback_used"
        : "",
    ].filter(Boolean),
  };
  const mediaKind = media?.mediaType || media?.kind || "image";
  const images = mediaAssets.filter(
    (asset) => (asset.mediaType || asset.kind || "image") === "image",
  );
  const image = images[0] || null;
  const video =
    mediaAssets.find(
      (asset) => (asset.mediaType || asset.kind || "image") === "video",
    ) || null;

  let quotaReservation: AiCreditReservation | null = null;
  if (!isAdmin) {
    const quota = await reserveAiCredits({
      supabase,
      userId: quotaAccountId,
      action: "booster",
      credits: computeBoosterAiCredits({
        mediaType: mediaKind === "video" ? "video" : "images",
        imagesForAI: image ? [image] : [],
        videoForAI: video || undefined,
      }),
    });
    if (quota.errorResponse) return quota.errorResponse;
    quotaReservation = quota.reservation;
  }

  const fastMetadataOnlyMedia = shouldUseFastAgentMediaContext(image);
  let videoPreparation: InrAgentCachedVideoPreparationResult | null = null;
  if (video) {
    const videoPreparationStartedAt = Date.now();
    videoPreparation = await getOrPrepareInrAgentVideoForAi({
      mediaId: video.id,
      userId,
      accountId: userId,
      source: {
        id: video.id,
        bucket: video.bucket,
        storagePath: video.storagePath,
        url: video.url,
        mimeType: video.mimeType,
        size: video.size,
        duration: video.duration,
      },
    });
    videoPreparationMs = Date.now() - videoPreparationStartedAt;
  }

  const imagePreparationStartedAt = Date.now();
  const imagesForAI = video
    ? videoPreparation?.frames || []
    : fastMetadataOnlyMedia
      ? []
      : await prepareAgentSelectedImageForAI(image);
  imagePreparationMs = video ? 0 : Date.now() - imagePreparationStartedAt;
  const selectedMediaContext = buildAgentSelectedMediaContext(
    media,
    imagesForAI.length > 0,
    fastMetadataOnlyMedia,
    videoPreparation,
  );
  const videoGenerationContextMode = video
    ? getVideoGenerationContextMode(videoPreparation)
    : undefined;
  const videoAiContextRef = video
    ? buildVideoAiContextReference({
        mediaAssetId: video.id,
        mediaSource: video.librarySource || video.source,
        preparationVersion: INR_AGENT_VIDEO_AI_PREPARATION_VERSION,
        sourceFingerprint: videoPreparation?.cache.fingerprint,
        persisted: videoPreparation?.cache.persisted,
      })
    : null;

  console.info("[inr-agent] selected media AI routing", {
    userId,
    mediaId: media?.id || undefined,
    mediaType: media ? mediaKind : "none",
    mediaSource: media?.librarySource || media?.source || undefined,
    fastMetadataOnly: fastMetadataOnlyMedia,
    imagesSentToGeneration: imagesForAI.length,
    videoPreparationStatus: videoPreparation?.status,
    videoTranscriptAvailable: Boolean(videoPreparation?.transcript),
    videoPreparationWarnings: videoPreparation?.warnings.length || 0,
    videoContextCacheSource: videoPreparation?.cache.source,
    videoContextPersisted: videoPreparation?.cache.persisted,
    videoGenerationContextMode,
  });

  // Même logique que Booster / Publier : l'absence de média ne bloque jamais
  // la préparation du texte. Les canaux compatibles restent prêts en texte seul,
  // les canaux qui exigent un média sont marqués comme incomplets canal par canal.
  const mediaReadinessByChannel = Object.fromEntries(
    channels.map((channel) => [channel, channelMediaReadiness(channel, media)]),
  );
  const mediaAdaptationByChannel = Object.fromEntries(
    channels.map((channel) => [
      channel,
      channelMediaAdaptation(channel, media),
    ]),
  );

  try {
    let versions: Awaited<ReturnType<typeof generateBoosterPosts>>["versions"] = {};
    let recoveredChannels: Awaited<ReturnType<typeof generateBoosterPosts>>["recoveredChannels"] = [];
    const aiGenerationStartedAt = Date.now();
    try {
      ({ versions, recoveredChannels } = await generateBoosterPosts({
        idea,
        theme: boosterTheme,
        channels,
        profile,
        business,
        recentPublications,
        mediaType: mediaKind === "video" ? "video" : "images",
        imagesForAI,
        mediaContext: selectedMediaContext,
        accountId: userId,
        agentTone,
        earlierEditorialAngles,
        skipMediaVisionAnalysis: fastMetadataOnlyMedia,
      }));
      for (const channel of channels) {
        const post = versions[channel];
        if (!post) continue;
        versions[channel] = applySafePreferredCta({
          channel,
          post,
          defaults: ctaDefaults,
          preserveExplicit: false,
        });
      }
    } finally {
      aiGenerationMs = Date.now() - aiGenerationStartedAt;
    }

    const persistenceStartedAt = Date.now();
    const now = new Date().toISOString();
    const targetChannels = channels.map(
      (channel) => boosterToAgentChannel[channel],
    );
    const previewText = buildPreviewText(versions);
    const title = `Publication ${themeLabels[agentTheme] || "iNr’Agent"} prête`;
    const readyEditorialPlan = editorialTarget
      ? {
          ...editorialTarget.plan,
          state: "ready",
          generatedAt: now,
          generatedMediaCount: mediaAssets.length,
        }
      : null;
    const payload = {
      version: 1,
      source: "inr_agent_publish_preparer",
      idea,
      theme: agentTheme,
      boosterTheme,
      postByChannel: versions,
      ctaPolicy: {
        version: 1,
        source: "booster_preferences",
        preferredCta: ctaDefaults.preferredCta,
        hasWebsite: Boolean(ctaDefaults.preferredWebsiteUrl),
        hasPhone: Boolean(ctaDefaults.phone),
      },
      selectedChannels: channels,
      targetChannels,
      media,
      mediaAsset: media,
      mediaAssets,
      mediaSelectionTrace,
      mediaType: media ? mediaKind : "none",
      ...videoAiContextReferenceAliases(videoAiContextRef),
      videoAiPreparation: videoPreparation
        ? {
            version: INR_AGENT_VIDEO_AI_PREPARATION_VERSION,
            status: videoPreparation.status,
            frameCount: videoPreparation.frames.length,
            transcriptAvailable: Boolean(videoPreparation.transcript),
            warningCodes: videoPreparation.warnings.map((warning) =>
              warning.split(":", 1)[0],
            ),
            cacheSource: videoPreparation.cache.source,
            persisted: videoPreparation.cache.persisted,
            sourceFingerprint: videoPreparation.cache.fingerprint,
            framePaths: videoPreparation.cache.framePaths,
            timings: videoPreparation.timings,
            generationContextMode: videoGenerationContextMode,
          }
        : null,
      image,
      imageAsset: image,
      images,
      video,
      videoAsset: video,
      mediaReadinessByChannel,
      mediaAdaptationByChannel,
      mediaPolicy: "booster_publish_rules",
      imageRequiredRequested: automation.imageRequired,
      executionTarget: "booster_publish",
      ...(readyEditorialPlan ? { editorialPlan: readyEditorialPlan } : {}),
    };

    const actionValues = {
        user_id: userId,
        automation_key: "publish",
        action_type: "publication",
        target_tool: "booster",
        title,
        summary: buildSummary(channels, media, mediaAssets.length),
        preview_text: previewText,
        target_channels: targetChannels,
        target_themes: [agentTheme],
        recipients: [],
        image_assets: mediaAssets,
        payload,
        validation_required: requiresManualValidation(automation.validationMode),
        execution_policy: getExecutionPolicy(automation.validationMode),
        status: getInitialStatus(automation.validationMode),
        scheduled_for: editorialTarget?.plan.scheduledFor || null,
        prepared_at: now,
        metadata: {
          ...(editorialTarget?.metadata || {}),
          automationFrequency: automation.frequency,
          preparedManually: !isCron,
          preparedByCron: isCron,
          editorialPlan: Boolean(editorialTarget),
          editorialPlanVersion: editorialTarget ? 1 : undefined,
          editorialState: editorialTarget ? "ready" : undefined,
          editorialGeneratedAt: editorialTarget ? now : undefined,
          editorialNextRetryAt: editorialTarget ? null : undefined,
          editorialLastError: editorialTarget ? null : undefined,
          // Les canaux récupérés le sont désormais exclusivement par une nouvelle passe IA.
          // Aucun texte éditorial générique local n'est injecté.
          aiRecoveredChannels: recoveredChannels.map(
            (channel) => boosterToAgentChannel[channel],
          ),
          fallbackAppliedChannels: [],
          mediaSelectionTrace,
        },
        updated_at: now,
      };
    const actionSelect =
      "id, automation_key, action_type, target_tool, title, summary, preview_text, target_channels, target_themes, recipients, image_assets, payload, validation_required, execution_policy, status, scheduled_for, prepared_at, validated_at, refused_at, completed_at, last_error, created_at, updated_at";
    let inserted: unknown = null;
    let insertError: { message?: string } | null = null;
    if (editorialTarget) {
      const result = await supabaseAdmin
        .from("inr_agent_actions")
        .update(actionValues)
        .eq("id", editorialTarget.id)
        .eq("user_id", userId)
        .eq("status", "executing")
        .select(actionSelect)
        .single();
      inserted = result.data;
      insertError = result.error;
    } else {
      const result = await supabaseAdmin
        .from("inr_agent_actions")
        .insert({ ...actionValues, created_at: now })
        .select(actionSelect)
        .single();
      inserted = result.data;
      insertError = result.error;
    }

    if (insertError) {
      persistenceMs = Date.now() - persistenceStartedAt;
      await rollbackAiCredits(quotaReservation);
      console.warn("[inr-agent] prepare-publish timing", {
        userId,
        isCron,
        selectedChannels: channels.length,
        mediaType: media ? mediaKind : "none",
        mediaSource: media?.librarySource || media?.source || undefined,
        fastMetadataOnly: fastMetadataOnlyMedia,
        generationContextMs,
        professionalContextSource,
        publicationsContextSource,
        mediaSelectionMs,
        imagePreparationMs,
        videoPreparationMs,
        videoPreparationStatus: videoPreparation?.status,
        videoFramesSentToGeneration: videoPreparation?.frames.length || 0,
        videoTranscriptAvailable: Boolean(videoPreparation?.transcript),
        videoContextCacheSource: videoPreparation?.cache.source,
        videoContextPersisted: videoPreparation?.cache.persisted,
        aiGenerationMs,
        persistenceMs,
        totalMs: Date.now() - routeStartedAt,
        success: false,
        stage: "persist-action",
        message: insertError.message,
      });
      return NextResponse.json(
        {
          error: "Impossible d’enregistrer l’action préparée iNr’Agent.",
        },
        { status: 500 },
      );
    }

    await supabaseAdmin
      .from("inr_agent_automation_settings")
      .update({ last_prepared_at: now, updated_at: now })
      .eq("user_id", userId)
      .eq("automation_key", "publish");

    for (const usedMedia of mediaAssets) {
      if (!usedMedia.id) continue;
      try {
        const imageTable =
          usedMedia.librarySource === "pro_media_library" ||
          usedMedia.source === "pro_media_library" ||
          usedMedia.source === "ai_media_generation"
            ? "pro_media_library"
            : "inrcy_image_bank";
        const { data: usageRow } = await supabaseAdmin
          .from(imageTable)
          .select("usage_count")
          .eq("id", usedMedia.id)
          .maybeSingle();
        const nextUsageCount =
          Number(
            (usageRow as { usage_count?: unknown } | null)?.usage_count || 0,
          ) + 1;
        const usagePatch =
          imageTable === "pro_media_library"
            ? { usage_count: nextUsageCount, last_used_at: now, updated_at: now }
            : { usage_count: nextUsageCount, updated_at: now };
        await supabaseAdmin
          .from(imageTable)
          .update(usagePatch)
          .eq("id", usedMedia.id);
      } catch {
        // Non bloquant : la publication préparée reste valide même si le compteur image n'est pas mis à jour.
      }
    }
    persistenceMs = Date.now() - persistenceStartedAt;

    await commitAiCredits(quotaReservation);
    console.info("[inr-agent] prepare-publish timing", {
      userId,
      isCron,
      selectedChannels: channels.length,
      targetChannels,
      mediaType: media ? mediaKind : "none",
      mediaSource: media?.librarySource || media?.source || undefined,
      fastMetadataOnly: fastMetadataOnlyMedia,
      imagesSentToGeneration: imagesForAI.length,
      validationRequired: requiresManualValidation(automation.validationMode),
      generationContextMs,
      professionalContextSource,
      publicationsContextSource,
      mediaSelectionMs,
      imagePreparationMs,
      videoPreparationMs,
      videoPreparationStatus: videoPreparation?.status,
      videoFramesSentToGeneration: videoPreparation?.frames.length || 0,
      videoTranscriptAvailable: Boolean(videoPreparation?.transcript),
      videoContextCacheSource: videoPreparation?.cache.source,
      videoContextPersisted: videoPreparation?.cache.persisted,
      aiGenerationMs,
      persistenceMs,
      totalMs: Date.now() - routeStartedAt,
      recoveredChannels: recoveredChannels.length,
      success: true,
    });
    return NextResponse.json({
      action: rowToInrAgentAction(inserted as any),
      prepared: true,
    });
  } catch (error) {
    await rollbackAiCredits(quotaReservation);
    console.warn("[inr-agent] prepare-publish timing", {
      userId,
      isCron,
      selectedChannels: channels.length,
      mediaType: media ? mediaKind : "none",
      mediaSource: media?.librarySource || media?.source || undefined,
      fastMetadataOnly: fastMetadataOnlyMedia,
      imagesSentToGeneration: imagesForAI.length,
      generationContextMs,
      professionalContextSource,
      publicationsContextSource,
      mediaSelectionMs,
      imagePreparationMs,
      videoPreparationMs,
      videoPreparationStatus: videoPreparation?.status,
      videoFramesSentToGeneration: videoPreparation?.frames.length || 0,
      videoTranscriptAvailable: Boolean(videoPreparation?.transcript),
      videoContextCacheSource: videoPreparation?.cache.source,
      videoContextPersisted: videoPreparation?.cache.persisted,
      aiGenerationMs,
      persistenceMs,
      totalMs: Date.now() - routeStartedAt,
      success: false,
      stage: "generate-or-persist",
      message: error instanceof Error ? error.message : String(error || "Erreur inconnue"),
    });
    throw error;
  }
}
function channelMediaAdaptation(
  channel: BoosterChannels,
  media: ImageBankAsset | null,
) {
  const mediaKind = media?.mediaType || media?.kind || "none";
  const channelLabel = channelLabels[boosterToAgentChannel[channel]] || channel;

  if (!media) {
    return {
      channel,
      channelLabel,
      mediaType: "none",
      strategy: "text_only",
      userEditable: false,
      note: "Aucun média à adapter pour ce canal.",
    };
  }

  if (mediaKind === "video") {
    return {
      channel,
      channelLabel,
      mediaType: "video",
      strategy: "booster_video_format",
      userEditable: true,
      note: "iNr’Agent transmet la vidéo source à Booster. Le format vidéo sera préparé selon les règles du canal avant publication.",
    };
  }

  return {
    channel,
    channelLabel,
    mediaType: "image",
    strategy: "booster_image_adapter",
    userEditable: true,
    note: "iNr’Agent transmet l’image source à Booster. Une version compatible avec le canal sera préparée sans modifier l’original.",
  };
}
