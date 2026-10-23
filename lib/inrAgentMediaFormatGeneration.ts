import "server-only";
import { createHash } from "node:crypto";
import type { generateInrAgentMedia } from "@/lib/inrAgentMediaGeneration";
import { buildMediaLibraryContentUrl } from "@/lib/mediaLibraryContentUrl";
import { INR_AGENT_THEMES, type InrAgentTheme } from "@/lib/inrAgentSettings";
import { buildInrAgentMediaFormatPlan, bindInrAgentMediaFormatVariants, readInrAgentMediaFormatVariants, type InrAgentMediaFormatVariants } from "@/lib/inrAgentMediaFormats";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => String(value || "").trim();

/** Lazy, credit-reserved creation. Existing compatible variants are free reuses. */
export async function ensureInrAgentMediaFormats(args: {
  supabase: Parameters<typeof generateInrAgentMedia>[0]["supabase"];
  accountId: string;
  actorAuthUserId: string;
  actionId: string;
  payload: RecordValue;
  channels: string[];
  fallbackAssets?: unknown[];
  rebindChannels?: readonly string[];
  /** Publication itself must never buy an unseen replacement media. */
  allowGeneration?: boolean;
}): Promise<{ payload: RecordValue; createdFormats: string[] }> {
  const payload = args.payload;
  const nested = record(payload.publishPayload);
  const overrides = record(payload.mediaFormatVariantsByChannel || nested.mediaFormatVariantsByChannel);
  const overrideChannels = args.channels.filter(channel => record(overrides[channel]).version === 1);
  if (overrideChannels.length) {
    // A channel-only regeneration owns its formats. Rebinding the shared
    // cache must never replace that channel with the previous global image.
    const sharedChannels = args.channels.filter(channel => !overrideChannels.includes(channel));
    const withoutOverrides = { ...payload, mediaFormatVariantsByChannel: null,
      ...(Object.keys(nested).length ? { publishPayload: { ...nested, mediaFormatVariantsByChannel: null } } : {}) };
    const shared = sharedChannels.length ? await ensureInrAgentMediaFormats({ ...args,
      payload: withoutOverrides, channels: sharedChannels,
      rebindChannels: args.rebindChannels?.filter(channel => sharedChannels.includes(channel)),
    }) : { payload: withoutOverrides, createdFormats: [] as string[] };
    const nextPayload: RecordValue = { ...shared.payload };
    const nextOverrides = { ...overrides };
    const createdFormats = [...shared.createdFormats];
    for (const channel of overrideChannels) {
      const result = await ensureInrAgentMediaFormats({ ...args, channels: [channel], rebindChannels: [channel],
        payload: { ...withoutOverrides, mediaFormatVariants: overrides[channel],
          ...(Object.keys(nested).length ? { publishPayload: { ...nested, mediaFormatVariantsByChannel: null, mediaFormatVariants: overrides[channel] } } : {}) },
      });
      nextOverrides[channel] = result.payload.mediaFormatVariants;
      createdFormats.push(...result.createdFormats);
      for (const key of ["imagesByChannel", "videoByChannel", "imagesByPlacement", "videoSettingsByChannel"]) {
        const resultMap = record(result.payload[key]);
        if (Object.hasOwn(resultMap, channel)) nextPayload[key] = { ...record(nextPayload[key]), [channel]: resultMap[channel] };
      }
    }
    nextPayload.mediaFormatVariantsByChannel = nextOverrides;
    if (Object.keys(nested).length) nextPayload.publishPayload = { ...record(nextPayload.publishPayload),
      mediaFormatVariantsByChannel: nextOverrides,
      ...Object.fromEntries(["imagesByChannel", "videoByChannel", "imagesByPlacement", "videoSettingsByChannel"]
        .filter(key => nextPayload[key] !== undefined).map(key => [key, nextPayload[key]])),
    };
    return { payload: nextPayload, createdFormats };
  }
  let variants = readInrAgentMediaFormatVariants(payload);
  // A manual replacement is authoritative, including mixed image/video
  // publications. Choosing a placement must never overwrite that work with AI.
  if (!variants && record(payload.lastManualEdit).editType === "publish_channel_media") return { payload, createdFormats: [] as string[] };
  const media = record(payload.media || payload.mediaAsset || payload.video || payload.image);
  const kind = variants?.kind || (text(payload.mediaType || media.kind || media.mediaType) === "video" ? "video" : "image");
  const candidates = kind === "video"
    ? [payload.video || payload.videoAsset || media]
    : (Array.isArray(payload.images) && payload.images.length ? payload.images
      : Array.isArray(payload.mediaAssets) && payload.mediaAssets.length ? payload.mediaAssets : args.fallbackAssets || [media]);
  const baseAssets = candidates.map((item) => ({ ...record(item) })).filter((item) => item.id || item.storagePath || item.url).slice(0, kind === "video" ? 1 : 3);
  if (!baseAssets.length && !variants) return { payload, createdFormats: [] as string[] };
  if (!variants) {
    const first = baseAssets[0];
    if ((!first.width || !first.height) && /^[a-f0-9-]{36}$/i.test(text(first.id))) {
      const owned = await args.supabase.from("pro_media_library").select("width,height").eq("id", first.id).eq("user_id", args.accountId).maybeSingle();
      if (owned.error) throw new Error("Impossible de vérifier le format du média existant.");
      if (owned.data) Object.assign(first, { width: owned.data.width, height: owned.data.height });
    }
    const ratio = Number(first.width) / Number(first.height);
    const defaultFormat = Math.abs(ratio - 9 / 16) < 0.001 ? "story" : kind === "video" ? "landscape" : "portrait";
    variants = { version: 1, kind, defaultFormat, byFormat: { [defaultFormat]: baseAssets } };
  }
  const plan = buildInrAgentMediaFormatPlan({ kind, channels: args.channels, payload });
  const createdFormats: string[] = [];
  const missingFormats = plan.formats.filter((format) => !variants!.byFormat[format]?.length);
  if (missingFormats.length) {
    if (args.allowGeneration === false) throw new Error("Une version du média manque pour ce format. Créez-la dans l’aperçu iNr’Agent avant de valider la publication ou sa programmation. Aucun recadrage automatique ne sera appliqué.");
    // Listing/reusing actions stays lightweight; load provider SDKs only when
    // the professional explicitly asks to create a missing format.
    const [{ generateInrAgentMedia }, { loadInrAgentStudioMediaPreferences }, { isAdminUserForAi }] = await Promise.all([
      import("@/lib/inrAgentMediaGeneration"), import("@/lib/inrAgentMediaPreferencesServer"), import("@/lib/aiUsageQuota"),
    ]);
    const [adminUnlimited, studioPreferences] = await Promise.all([
      isAdminUserForAi(args.supabase, args.actorAuthUserId),
      loadInrAgentStudioMediaPreferences({ supabase: args.supabase, accountId: args.accountId }),
    ]);
    const rawTheme = text(payload.theme);
    const theme = (INR_AGENT_THEMES.includes(rawTheme as InrAgentTheme) ? rawTheme : "realisations") as InrAgentTheme;
    const idea = text(payload.idea || media.title).slice(0, 5000);
    if (!idea) throw new Error("Cette publication n’a pas de brief pour créer le nouveau format. Régénérez ses médias depuis iNr’Agent.");
    const sourceAssets = variants.byFormat[variants.defaultFormat] || baseAssets;
    const count = kind === "video" ? 1 : sourceAssets.length;
    const intent = createHash("sha256").update(JSON.stringify([idea, theme, sourceAssets.map((item) => item.id || item.storagePath), studioPreferences, kind])).digest("hex").slice(0, 24);
    const byFormat = { ...variants.byFormat };
    for (const outputFormat of missingFormats) {
      const items: RecordValue[] = [];
      for (let index = 0; index < count; index += 1) {
        const result = await generateInrAgentMedia({
          supabase: args.supabase, accountId: args.accountId, actorAuthUserId: args.actorAuthUserId,
          idea: count > 1 ? `${idea}\n\nSÉRIE COHÉRENTE : image ${index + 1}/${count}. Même sujet et identité visuelle ; détail complémentaire, sans inventer de preuve.` : idea,
          theme, kind, adminUnlimited, studioMediaPreferencePercent: 100, studioPreferences,
          outputFormat, videoDurationSeconds: kind === "video" ? 8 : undefined,
          variantSeed: `${args.actionId}:format:${intent}:${index}`,
          generationRequestId: `${args.actionId}:format:${outputFormat}:${intent}:${index}`,
        });
        if (!result.item) throw new Error(result.outcome === "quota_reached"
          ? "Crédits média insuffisants pour créer ce format. Les médias existants sont conservés."
          : "La création de ce format n’a pas pu se terminer. Les médias obtenus sont conservés pour la reprise, sans nouvelle génération des parties réussies.");
        const item = result.item;
        items.push({ id: item.id, bucket: item.bucket_name || "inrcy-pro-media", storagePath: item.storage_path,
          url: buildMediaLibraryContentUrl(item.id), name: item.original_file_name || item.title || `${kind}-iNrAgent`, title: item.title,
          kind, mediaType: kind, mimeType: item.mime_type, size: item.size_bytes, width: item.width, height: item.height,
          duration: item.duration_seconds, source: "ai_media_generation", librarySource: "pro_media_library" });
      }
      byFormat[outputFormat] = items;
      createdFormats.push(outputFormat);
    }
    variants = { ...variants, byFormat } as InrAgentMediaFormatVariants;
  }
  if (kind === "video" && variants.byFormat[plan.defaultFormat]?.length) variants = { ...variants, defaultFormat: plan.defaultFormat };
  const bindings = bindInrAgentMediaFormatVariants({ variants, channels: args.channels, payload });
  const rebind = new Set(args.rebindChannels || args.channels);
  const retainOtherChannels = (previous: unknown, next: RecordValue) => ({ ...record(previous), ...Object.fromEntries(Object.entries(next).filter(([channel]) => rebind.has(channel))) });
  const maps = {
    ...bindings,
    ...(kind === "video" ? { video: variants.byFormat[variants.defaultFormat]?.[0], videoAsset: variants.byFormat[variants.defaultFormat]?.[0], media: variants.byFormat[variants.defaultFormat]?.[0], mediaAsset: variants.byFormat[variants.defaultFormat]?.[0] } : {}),
    imagesByChannel: retainOtherChannels(payload.imagesByChannel || nested.imagesByChannel, bindings.imagesByChannel),
    videoByChannel: retainOtherChannels(payload.videoByChannel || nested.videoByChannel, bindings.videoByChannel),
    imagesByPlacement: retainOtherChannels(payload.imagesByPlacement || nested.imagesByPlacement, bindings.imagesByPlacement),
    ...(kind === "video" && createdFormats.length ? { videoSettingsByChannel: retainOtherChannels(
      payload.videoSettingsByChannel || nested.videoSettingsByChannel,
      Object.fromEntries(args.channels.map((channel) => [channel, { format: "original", adaptationMode: "safe_frame" }])),
    ) } : {}),
  };
  return { payload: { ...payload, ...maps,
    ...(Object.keys(nested).length ? { publishPayload: { ...nested, ...maps } } : {}) }, createdFormats };
}
