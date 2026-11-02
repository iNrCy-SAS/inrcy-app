import type { generateInrAgentMedia } from "@/lib/inrAgentMediaGeneration";
import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildStorageContentUrl } from "@/lib/storageContentUrl";
import { type InrAgentAutomationSettings, type InrAgentPreferredMediaSource, type InrAgentTheme } from "@/lib/inrAgentSettings";
import { type JsonRecord, type ImageBankAsset, type RecentMediaUsage, type MediaSelectionAttempt, type InrAgentPublicationPreparationContext } from "@/lib/inrAgentPublicationPreparationTypes";
import { cleanList, cleanText, asRecord, normalizeCatalogSlug, getBusinessProfession } from "@/lib/inrAgentPublicationPreparationPolicy";

const BUCKET = "inrcy-image-bank";

const PRO_MEDIA_BUCKET = "inrcy-pro-media";

const MEDIA_REUSE_EXCLUSION_DAYS = 60;

const RECENT_MEDIA_MEMORY_LIMIT = 80;

export const IMAGE_BANK_DIVERSIFICATION_RATE = 0.3;

function normalizeMediaLibrarySource(record: JsonRecord) {
  const raw = cleanText(
    record.librarySource || record.library_source || record.source || "",
    80
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
    300
  );
}

function getMediaSourceKey(
  source: "pro_media_library" | "inrcy_image_bank" | null,
  storagePath: string
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
    Date.now() - MEDIA_REUSE_EXCLUSION_DAYS * 24 * 60 * 60 * 1000
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

export function isRecentlyUsedMediaRow(
  row: any,
  source: "pro_media_library" | "inrcy_image_bank",
  usage: RecentMediaUsage
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
  T extends { id?: unknown; storage_path?: unknown }
>(
  rows: T[],
  source: "pro_media_library" | "inrcy_image_bank",
  usage: RecentMediaUsage
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
  }
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
      (params.genericSectorCandidates ?? totalCandidates) - eligibleCandidates
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

export function getRecentMediaTrace(usage: RecentMediaUsage) {
  return {
    exclusionDays: MEDIA_REUSE_EXCLUSION_DAYS,
    cutoffIso: usage.cutoffIso,
    rowsScanned: usage.rowsScanned,
    excludedProMediaCount: usage.proMediaIds.size,
    excludedImageBankCount: usage.imageBankIds.size,
    excludedStoragePathCount: usage.storageKeys.size,
  };
}

async function pickMediaFromProLibrary(args: {
  userId: string;
  business: JsonRecord | null;
  theme: InrAgentTheme;
  preferredTypes: Array<"image" | "video">;
  videoDurationSeconds?: 8;
  recentMediaUsage: RecentMediaUsage;
  attempts?: MediaSelectionAttempt[];
}): Promise<ImageBankAsset | null> {
  const { sector, profession, professionLabel } = getBusinessProfession(
    args.business
  );
  const searchTokens = Array.from(
    new Set(
      [profession, professionLabel, sector]
        .map((item) => cleanText(item, 80))
        .filter(Boolean)
    )
  );

  async function sign(
    row: any,
    matchLevel: "pro_library_business_match" | "pro_library_owned_fallback"
  ): Promise<ImageBankAsset | null> {
    if (!row?.storage_path) return null;
    const bucket = cleanText(row.bucket_name, 80) || PRO_MEDIA_BUCKET;
    const storagePath = String(row.storage_path);
    const contentUrl = buildStorageContentUrl(bucket, storagePath);
    const mediaType = row.media_type === "video" ? "video" : "image";
    const size = Number(row.size_bytes || 0);
    const duration = Number(row.duration_seconds || 0);
    if (mediaType === "video" && args.videoDurationSeconds === 8 && Math.abs(duration - 8) > 0.1) return null;

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
          args.recentMediaUsage
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
        args.recentMediaUsage
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

  return genericMarkers.has(job) || tags.some((tag) => genericMarkers.has(tag));
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
    matchLevel: "image_bank_job_exact" | "image_bank_sector_generic"
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
        args.recentMediaUsage
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
        args.recentMediaUsage
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
          originalRows.length - genericRows.length
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
        selected.librarySource === "inrcy_image_bank"
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
  videoDurationSeconds?: 8;
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
  const imageBankMedia = args.preferredTypes.includes("image") ? await pickImageFromBank({
    business: args.business,
    theme: args.theme,
    recentMediaUsage: args.recentMediaUsage,
    attempts,
  }) : null;

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

/** Selects account-owned/library candidates and reserves distinct carousel choices in memory. */
export async function selectInrAgentPublicationMedia(args: {
  context: InrAgentPublicationPreparationContext;
  business: JsonRecord | null;
  automation: InrAgentAutomationSettings;
  agentTheme: InrAgentTheme;
  ghostOnlyPublication: boolean;
  automaticMediaKind: "image" | "video";
  requestedImageCount: number;
  videoDurationSeconds?: 8;
}) {
  const { business, automation, agentTheme, ghostOnlyPublication, automaticMediaKind, requestedImageCount, videoDurationSeconds } = args;
  const userId = args.context.accountId;
  const prefersExistingVideo = automaticMediaKind === "video";
  const recentMediaUsage = await loadRecentMediaUsage(userId);
  const diversifiedMediaSelection = !ghostOnlyPublication && automation.useImageBank
    ? await pickDiversifiedMedia({
        userId,
        business,
        theme: agentTheme,
        preferredTypes: prefersExistingVideo ? ["video"] : ["image"],
        videoDurationSeconds,
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
  const fallbackAssets: ImageBankAsset[] = fallbackMedia && fallbackKind === automaticMediaKind
    ? [fallbackMedia] : [];
  const carouselSelectionUsage: RecentMediaUsage = {
    ...recentMediaUsage,
    proMediaIds: new Set(recentMediaUsage.proMediaIds),
    imageBankIds: new Set(recentMediaUsage.imageBankIds),
    storageKeys: new Set(recentMediaUsage.storageKeys),
  };
  // Les trois visuels sont distincts, même lorsque la médiathèque est prioritaire.
  while (automation.useImageBank && automaticMediaKind === "image" &&
    fallbackAssets.length > 0 && fallbackAssets.length < requestedImageCount) {
    for (const asset of fallbackAssets) {
      if (asset.librarySource === "pro_media_library") carouselSelectionUsage.proMediaIds.add(asset.id);
      else carouselSelectionUsage.imageBankIds.add(asset.id);
      carouselSelectionUsage.storageKeys.add(getMediaSourceKey(asset.librarySource || "inrcy_image_bank", asset.storagePath));
    }
    const next = await pickDiversifiedMedia({
      userId, business, theme: agentTheme, preferredTypes: ["image"],
      preferredSource: automation.preferredMediaSource, recentMediaUsage: carouselSelectionUsage,
    });
    if (!next.media || fallbackAssets.some((asset) => asset.id === next.media?.id || asset.storagePath === next.media?.storagePath)) break;
    fallbackAssets.push(next.media);
  }
  return { recentMediaUsage, diversifiedMediaSelection, fallbackAssets };
}

export function generatedPickerItemToAgentMedia(args: {
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
        args.item.storage_path
      ) ||
      args.item.signed_url ||
      "",
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
    width: width || null,
    height: height || null,
  } satisfies ImageBankAsset;
}
