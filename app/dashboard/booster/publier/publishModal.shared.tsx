import type { CSSProperties } from "react";
import type { BoosterVideoTransformedVariant } from "@/lib/boosterVideoTransforms";
import {
  getBoosterImageDisplayPlan,
  getBoosterImageSafetyBackgroundMode,
  type BoosterImageDecisionMode,
} from "@/lib/boosterImageDecision";
import { mergeBoosterChannelImageSelection } from "@/lib/boosterChannelImageSelection";
import {
  INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS,
  INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES,
  INR_MEDIA_ALLOWED_VIDEO_EXTENSIONS,
  INR_MEDIA_ALLOWED_VIDEO_MIME_TYPES,
  INR_MEDIA_IMAGE_FORMATS_LABEL,
  INR_MEDIA_IMAGE_LIMITS_LABEL,
  INR_MEDIA_IMAGE_MAX_BYTES,
  INR_MEDIA_IMAGE_MAX_MB_LABEL,
  INR_MEDIA_PUBLICATION_IMAGES_TOTAL_MAX_BYTES,
  INR_MEDIA_PUBLICATION_IMAGES_TOTAL_MAX_MB_LABEL,
  INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT,
  INR_MEDIA_VIDEO_FORMATS_LABEL,
  INR_MEDIA_VIDEO_LIMITS_LABEL,
  INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES,
  INR_MEDIA_VIDEO_PUBLISH_MAX_MB_LABEL,
  INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
  INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL,
} from "@/lib/mediaRules";
import {
  buildBoosterGmbSummary,
  buildBoosterHashtagLine,
  buildBoosterInstagramCaption,
  buildBoosterMessage,
  getCtaMode,
  type BoosterCtaMode,
} from "@/lib/boosterCta";
import { INR_SEARCH_CONTENT_MAX_LENGTH } from "@/lib/boosterChannelRules";
import {
  getYoutubePublicationTypeForDuration,
  validateVideoDurationForChannel,
  type YoutubeLongUploadsStatus,
} from "@/lib/videoPublicationPolicy";
import {
  isUniversalMediaUploadEnabled,
  uploadUniversalMediaFile,
} from "@/lib/universalMediaUploadClient";
import {
  UNIVERSAL_MEDIA_STANDARD_UPLOAD_MAX_BYTES,
  UNIVERSAL_MEDIA_VIDEO_EXTENSIONS,
  UNIVERSAL_MEDIA_VIDEO_MIME_TYPES,
} from "@/lib/mediaUploadPolicy";
import { MEDIA_LIBRARY_VIDEO_SOURCE_MAX_MB_LABEL } from "@/lib/mediaLibraryOptimizationPolicy";
import { BOOSTER_ASIAN_CTA_LABELS } from "@/lib/boosterAsianCtaLabels";
import { buildSafePreferredCtaPatch } from "@/lib/boosterCtaPreferences";
export type { BoosterCtaMode } from "@/lib/boosterCta";

export type ChannelKey =
  | "inrcy_site"
  | "site_web"
  | "inr_search"
  | "gmb"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "tiktok"
  | "youtube_shorts"
  | "pinterest";
export type DisplayKey = ChannelKey;

// Ordre commun avec les bulles de canaux du dashboard.
export const BOOSTER_CHANNEL_ORDER: ChannelKey[] = [
  "inrcy_site",
  "site_web",
  "gmb",
  "inr_search",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube_shorts",
  "pinterest",
];

export type ThemeKey =
  | ""
  | "promotion"
  | "information"
  | "conseil"
  | "avis_client"
  | "realisation"
  | "actualite"
  | "autre";
export type StyleKey = "sobre" | "equilibre" | "dynamique";
export type FitMode = "contain" | "cover";
export type BackgroundMode =
  | "transparent"
  | "color"
  | "white"
  | "black"
  | "gray"
  | "sand"
  | "brand";

export type ChannelPost = {
  title: string;
  content: string;
  cta: string;
  ctaMode?: BoosterCtaMode;
  ctaUrl?: string;
  ctaPhone?: string;
  hashtags?: string[];
};

export type BoosterPreferredCta =
  | "none"
  | "site"
  | "devis"
  | "appeler"
  | "message"
  | "custom";

export type BoosterAiLanguage = "fr" | "en" | "es" | "it" | "de" | "nl" | "pt" | "th" | "zh";

export type BoosterCtaDefaults = {
  preferredWebsiteUrl: string;
  preferredWebsiteLabel: string;
  siteWebUrl: string;
  inrcySiteUrl: string;
  phone: string;
  preferredCta: BoosterPreferredCta;
  aiLanguage?: BoosterAiLanguage;
};

export const BOOSTER_PREFERRED_CTA_OPTIONS: Array<{
  value: BoosterPreferredCta;
  label: string;
}> = [
  { value: "none", label: "Aucun bouton" },
  { value: "site", label: "Voir le site" },
  { value: "devis", label: "Demander un devis" },
  { value: "appeler", label: "Appeler" },
  { value: "message", label: "Envoyer un message" },
  { value: "custom", label: "Lien personnalisé" },
];

const BOOSTER_PREFERRED_CTA_MESSAGE_KEYS = {
  none: "aucun_bouton_fd9e05c4",
  site: "voir_le_site_5bf01317",
  devis: "demander_un_devis_8a1f1c6c",
  appeler: "appeler_de49ee03",
  message: "envoyer_un_message_c211810b",
  custom: "lien_personnalise_d1d21cea",
} as const satisfies Record<BoosterPreferredCta, string>;

export function getLocalizedPreferredCtaLabel(
  choice: BoosterPreferredCta,
  translate: (key: string) => string,
) {
  return translate(BOOSTER_PREFERRED_CTA_MESSAGE_KEYS[choice]);
}

const BOOSTER_AI_LANGUAGE_VALUES: BoosterAiLanguage[] = [
  "fr",
  "en",
  "es",
  "it",
  "de",
  "nl",
  "pt",
  "th",
  "zh",
];

const CTA_LABELS_BY_LANGUAGE: Record<
  BoosterAiLanguage,
  Record<BoosterPreferredCta, string>
> = {
  fr: {
    none: "",
    site: "Voir le site",
    devis: "Demander un devis",
    appeler: "Appeler",
    message: "Envoyer un message",
    custom: "",
  },
  en: {
    none: "",
    site: "Visit website",
    devis: "Request a quote",
    appeler: "Call",
    message: "Send a message",
    custom: "",
  },
  es: {
    none: "",
    site: "Ver sitio web",
    devis: "Solicitar presupuesto",
    appeler: "Llamar",
    message: "Enviar mensaje",
    custom: "",
  },
  it: {
    none: "",
    site: "Visita il sito",
    devis: "Richiedi un preventivo",
    appeler: "Chiama",
    message: "Invia un messaggio",
    custom: "",
  },
  de: {
    none: "",
    site: "Website ansehen",
    devis: "Angebot anfordern",
    appeler: "Anrufen",
    message: "Nachricht senden",
    custom: "",
  },
  nl: {
    none: "",
    site: "Website bekijken",
    devis: "Offerte aanvragen",
    appeler: "Bellen",
    message: "Bericht sturen",
    custom: "",
  },
  pt: {
    none: "",
    site: "Ver site",
    devis: "Pedir orçamento",
    appeler: "Ligar",
    message: "Enviar mensagem",
    custom: "",
  },
  th: BOOSTER_ASIAN_CTA_LABELS.th,
  zh: BOOSTER_ASIAN_CTA_LABELS.zh,
};

export function normalizeBoosterAiLanguage(value: unknown): BoosterAiLanguage {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (BOOSTER_AI_LANGUAGE_VALUES.includes(raw as BoosterAiLanguage))
    return raw as BoosterAiLanguage;
  if (["french", "francais", "français"].includes(raw)) return "fr";
  if (["english", "anglais"].includes(raw)) return "en";
  if (["spanish", "espagnol"].includes(raw)) return "es";
  if (["italian", "italien"].includes(raw)) return "it";
  if (["german", "allemand"].includes(raw)) return "de";
  if (["dutch", "neerlandais", "néerlandais"].includes(raw)) return "nl";
  if (["portuguese", "portugais"].includes(raw)) return "pt";
  if (["thai", "thailandais", "thaïlandais", "ภาษาไทย", "th-th"].includes(raw)) return "th";
  if (["chinese", "simplified chinese", "chinois", "chinois simplifié", "中文", "简体中文", "zh-cn", "zh_cn", "zh-hans"].includes(raw)) return "zh";
  return "fr";
}

const BOOSTER_PREFERRED_CTA_VALUES = BOOSTER_PREFERRED_CTA_OPTIONS.map(
  (option) => option.value,
) as BoosterPreferredCta[];

export function normalizeBoosterPreferredCta(
  value: unknown,
): BoosterPreferredCta {
  const raw = String(value || "").trim() as BoosterPreferredCta;
  if (BOOSTER_PREFERRED_CTA_VALUES.includes(raw)) return raw;
  return "devis";
}

export function getPreferredCtaOptionLabel(choice: BoosterPreferredCta) {
  return (
    BOOSTER_PREFERRED_CTA_OPTIONS.find((option) => option.value === choice)
      ?.label || "Demander un devis"
  );
}

export function getPreferredCtaChoiceFromPost(
  channel: DisplayKey,
  post: Partial<ChannelPost> | null | undefined,
): BoosterPreferredCta {
  const normalized = normalizePost(post);
  const mode = normalized.ctaMode || "none";
  if (mode === "none") return "none";
  if (mode === "call") return "appeler";
  if (mode === "message") return "message";
  if (mode === "custom") return "custom";
  if (mode === "website") {
    const label = String(normalized.cta || "")
      .trim()
      .toLowerCase();
    if (label.includes("devis")) return "devis";
    if (label.includes("voir") || label.includes("site")) return "site";
    return channel === "inrcy_site" || channel === "site_web"
      ? "devis"
      : "site";
  }
  return "devis";
}

export type ImagePayload = {
  name: string;
  type: string;
  /** Fichier local transitoire, supprimé du payload dès que l'upload est terminé. */
  sourceFile?: File;
  dataUrl?: string;
  storagePath?: string;
  publicUrl?: string;
  renderedUrl?: string;
  originalUrl?: string;
  originalPublicUrl?: string;
  originalStoragePath?: string;
  originalName?: string;
  originalType?: string;
  imageKey?: string;
  transform?: ImageTransform;
  imageMeta?: ImageMeta;
  imageDecisionMode?: "original" | "adapted" | "customized" | "unsupported";
  imageDecisionLabel?: "Originale" | "Adaptée" | "Personnalisée" | "Indisponible";
  isCustomized?: boolean;
};

export type ImageTransform = {
  fit: FitMode;
  zoom: number;
  offsetX: number;
  offsetY: number;
  blurBackground: boolean;
  backgroundMode?: BackgroundMode;
  backgroundColor?: string;
};

export type ImageMeta = {
  width: number;
  height: number;
  ratio: number;
};

export type ChannelImageEditorState = {
  imageKeys: string[];
  transforms: Record<string, ImageTransform>;
  /** Explicit Adapter provenance. Opening the modal alone never adds a key. */
  customizedImageKeys?: string[];
  /** Internal marker used to distinguish a new file from an explicit deselection. */
  synchronizedImageKeys?: string[];
};

export type ChannelImagePayload = Record<ChannelKey, ImagePayload[]>;
export type ChannelImageSettingsPayload = Record<
  ChannelKey,
  {
    imageKeys: string[];
    transforms: Record<string, ImageTransform>;
    customizedImageKeys?: string[];
  }
>;

export type RenderPreset = {
  width: number;
  height: number;
  defaultFit: FitMode;
  defaultBlurBackground: boolean;
};

export type PreviewLayout = {
  drawW: number;
  drawH: number;
  dx: number;
  dy: number;
  maxX: number;
  maxY: number;
};

export const DEFAULT_TRANSFORM: ImageTransform = {
  fit: "contain",
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  blurBackground: false,
  backgroundMode: "color",
  backgroundColor: "#ffffff",
};

export function getImageFitLabel(
  transform?: Pick<ImageTransform, "fit"> | null,
) {
  return transform?.fit === "cover" ? "Plein cadre" : "Image entière";
}

export function getLocalizedImageFitLabel(
  transform: Pick<ImageTransform, "fit"> | null | undefined,
  translate: (key: string) => string,
) {
  return translate(
    transform?.fit === "cover"
      ? "plein_cadre_96d0dd78"
      : "image_entiere_76cd8175",
  );
}

export function getLocalizedImageDecisionLabel(
  mode: BoosterImageDecisionMode,
  translate: (key: string) => string,
) {
  return translate(
    mode === "original"
      ? "image_decision_original"
      : mode === "adapted"
        ? "image_decision_adapted"
        : mode === "customized"
          ? "image_decision_customized"
          : "image_decision_unavailable",
  );
}

export const DISPLAY_LABELS: Record<DisplayKey, string> = {
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

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  inrcy_site: "Site iNrCy",
  site_web: "Site web",
  gmb: "Google Business",
  inr_search: "iNr'Search",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube_shorts: "YouTube",
  pinterest: "Pinterest",
};

export const CHANNEL_LABEL_MESSAGE_KEYS: Partial<Record<ChannelKey, string>> = {
  inrcy_site: "site_inrcy_57016d6f",
  site_web: "site_web_7e78af33",
};

export function getLocalizedChannelLabel(
  channel: ChannelKey,
  translate: (key: string) => string,
) {
  const messageKey = CHANNEL_LABEL_MESSAGE_KEYS[channel];
  return messageKey ? translate(messageKey) : CHANNEL_LABELS[channel];
}

export const CHANNEL_PRESETS: Record<ChannelKey, RenderPreset> = {
  inrcy_site: {
    width: 1440,
    height: 900,
    defaultFit: "contain",
    defaultBlurBackground: false,
  },
  site_web: {
    width: 1440,
    height: 900,
    defaultFit: "contain",
    defaultBlurBackground: false,
  },
  inr_search: {
    width: 1440,
    height: 900,
    defaultFit: "contain",
    defaultBlurBackground: false,
  },
  gmb: {
    width: 1200,
    height: 675,
    defaultFit: "contain",
    defaultBlurBackground: false,
  },
  facebook: {
    width: 1200,
    height: 1200,
    defaultFit: "cover",
    defaultBlurBackground: false,
  },
  instagram: {
    width: 1080,
    height: 1350,
    defaultFit: "cover",
    defaultBlurBackground: false,
  },
  linkedin: {
    width: 1200,
    height: 1200,
    defaultFit: "cover",
    defaultBlurBackground: false,
  },
  tiktok: {
    width: 1080,
    height: 1920,
    defaultFit: "cover",
    defaultBlurBackground: false,
  },
  youtube_shorts: {
    width: 1080,
    height: 1920,
    defaultFit: "cover",
    defaultBlurBackground: false,
  },
  pinterest: {
    width: 1000,
    height: 1500,
    defaultFit: "cover",
    defaultBlurBackground: false,
  },
};

export {
  VIDEO_ADAPTATION_MODE_LABELS,
  VIDEO_FORMAT_ASPECT_RATIOS,
  VIDEO_FORMAT_LABELS,
  VIDEO_FORMAT_OPTIONS_BY_CHANNEL,
  VIDEO_RECOMMENDED_FORMAT_BY_CHANNEL,
  buildVideoSettingsByChannel,
  getDefaultChannelVideoSettings,
  getAutomaticVideoSettingsForPublication,
  getRecommendedVideoFormatForSource,
  getLocalizedVideoAdaptationModeLabel,
  getLocalizedVideoFormatLabel,
  getLocalizedVideoOrientationLabel,
  getVideoFormatLabel,
  getVideoPreviewAspectRatio,
  getVideoPreviewFitMode,
  getVideoSourceOrientation,
  normalizeChannelVideoSettings,
  normalizeVideoAdaptationMode,
  normalizeVideoFormat,
  splitVideoSettingsByChannel,
} from "@/lib/boosterVideoSettings";
export type {
  ChannelVideoSettings,
  VideoAdaptationMode,
  VideoFormat,
  VideoSettingsByChannel,
} from "@/lib/boosterVideoSettings";

export type PublicationMediaType = "images" | "video";
export type ChannelMediaMode = "video" | "images" | "none";

export function channelSupportsImages(channel: ChannelKey) {
  return channel !== "youtube_shorts";
}

export function channelSupportsTextOnly(channel: ChannelKey) {
  return channel !== "youtube_shorts" && channel !== "tiktok" && channel !== "pinterest";
}

export function channelRequiresMedia(channel: ChannelKey) {
  return (
    channel === "youtube_shorts" ||
    channel === "tiktok" ||
    channel === "instagram" ||
    channel === "pinterest"
  );
}

export function getUnavailableMediaModeMessage(
  channel: ChannelKey,
  mode: ChannelMediaMode,
) {
  if (channel === "youtube_shorts") {
    if (mode === "images")
      return "YouTube nécessite une vidéo. Les photos seules ne peuvent pas être publiées sur YouTube.";
    if (mode === "none") return "YouTube nécessite une vidéo.";
  }
  if (channel === "tiktok" && mode === "none") {
    return "TikTok nécessite au moins une photo ou une vidéo.";
  }
  if (channel === "pinterest" && mode === "none") {
    return "Pinterest nécessite une image ou une vidéo.";
  }
  return "";
}

export function getLocalizedUnavailableMediaModeMessage(
  channel: ChannelKey,
  mode: ChannelMediaMode,
  translate: (key: string) => string,
) {
  if (channel === "youtube_shorts") {
    if (mode === "images") {
      return translate("youtube_necessite_une_video_les_photos_be0f53d0");
    }
    if (mode === "none") return translate("youtube_necessite_une_video_e82a0e29");
  }
  if (channel === "tiktok" && mode === "none") {
    return translate("tiktok_necessite_au_moins_une_photo_3359fe2d");
  }
  if (channel === "pinterest" && mode === "none") {
    return translate("pinterest_necessite_une_image_ou_une_e2a7f196");
  }
  return "";
}

export const BOOSTER_MAX_IMAGE_COUNT = INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT;
export const BOOSTER_IMAGE_ACCEPT = [
  ...INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES,
  ...INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");
export const BOOSTER_VIDEO_ACCEPT = [
  ...UNIVERSAL_MEDIA_VIDEO_MIME_TYPES,
  ...UNIVERSAL_MEDIA_VIDEO_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");
export const BOOSTER_IMAGE_FORMATS_LABEL = INR_MEDIA_IMAGE_FORMATS_LABEL;
export const BOOSTER_VIDEO_FORMATS_LABEL =
  "MP4, M4V, MOV, WebM, MPEG, AVI, MKV, 3GP, TS, WMV, FLV ou OGV";
export const BOOSTER_MAX_MEDIA_BYTES =
  INR_MEDIA_PUBLICATION_IMAGES_TOTAL_MAX_BYTES;
export const BOOSTER_MAX_MEDIA_MB_LABEL =
  INR_MEDIA_PUBLICATION_IMAGES_TOTAL_MAX_MB_LABEL;
export const BOOSTER_MAX_IMAGE_BYTES = INR_MEDIA_IMAGE_MAX_BYTES;
export const BOOSTER_MAX_IMAGE_MB_LABEL = INR_MEDIA_IMAGE_MAX_MB_LABEL;
export const BOOSTER_MAX_VIDEO_COUNT = 1;
export const BOOSTER_MAX_VIDEO_BYTES = INR_MEDIA_VIDEO_SOURCE_MAX_BYTES;
export const BOOSTER_MAX_VIDEO_MB_LABEL = INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL;
export const BOOSTER_MAX_VIDEO_PUBLISH_BYTES =
  INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES;
export const BOOSTER_MAX_VIDEO_PUBLISH_MB_LABEL =
  INR_MEDIA_VIDEO_PUBLISH_MAX_MB_LABEL;
export const BOOSTER_RECOMMENDED_VIDEO_DURATION_LABEL = "3 min conseillées";
export const BOOSTER_IMAGE_LIMITS_LABEL = INR_MEDIA_IMAGE_LIMITS_LABEL;
export const BOOSTER_VIDEO_LIMITS_LABEL = INR_MEDIA_VIDEO_LIMITS_LABEL;
export const BOOSTER_GENERATION_MEDIA_OPTIMIZATION_LABEL =
  `Jusqu’à ${BOOSTER_MAX_IMAGE_COUNT} images ou 1 vidéo (${MEDIA_LIBRARY_VIDEO_SOURCE_MAX_MB_LABEL} max) · médias optimisés si nécessaire : format adapté et/ou poids ramené à ${BOOSTER_MAX_IMAGE_MB_LABEL}/image ou ${BOOSTER_MAX_VIDEO_MB_LABEL}/vidéo.`;
export const BOOSTER_PUBLICATION_MEDIA_OPTIMIZATION_LABEL =
  `Jusqu’à ${BOOSTER_MAX_IMAGE_COUNT} images et 1 vidéo (${MEDIA_LIBRARY_VIDEO_SOURCE_MAX_MB_LABEL} max) · médias optimisés si nécessaire : format adapté et/ou poids ramené à ${BOOSTER_MAX_IMAGE_MB_LABEL}/image ou ${BOOSTER_MAX_VIDEO_MB_LABEL}/vidéo.`;

export function getBoosterSelectedMediaSummary(params: {
  imageCount: number;
  hasVideo: boolean;
  context?: "generation" | "publication";
}) {
  const parts: string[] = [];
  if (params.imageCount > 0) {
    parts.push(
      `${params.imageCount}/${BOOSTER_MAX_IMAGE_COUNT} image${params.imageCount > 1 ? "s" : ""} · ${BOOSTER_MAX_IMAGE_MB_LABEL} par image · ${BOOSTER_MAX_MEDIA_MB_LABEL} au total`,
    );
  }
  if (params.hasVideo) {
    parts.push(
      `1 vidéo ajoutée · source jusqu’à ${MEDIA_LIBRARY_VIDEO_SOURCE_MAX_MB_LABEL} · optimisation au-delà de ${BOOSTER_MAX_VIDEO_MB_LABEL} · original conservé`,
    );
  }
  return parts.length
    ? parts.join(" · ")
    : `Aucun média ajouté · ${
        params.context === "generation"
          ? BOOSTER_GENERATION_MEDIA_OPTIMIZATION_LABEL
          : BOOSTER_PUBLICATION_MEDIA_OPTIMIZATION_LABEL
      }`;
}

type BoosterMediaTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

const BOOSTER_MEDIA_MESSAGE_VALUES = {
  maxImages: BOOSTER_MAX_IMAGE_COUNT,
  imageMaxMb: 50,
  imagesTotalMaxMb: 150,
  videoSourceMaxMb: 300,
  videoPublishMaxMb: 75,
} as const;

export function getLocalizedBoosterImageFormats(translate: BoosterMediaTranslator) {
  return translate("media_image_formats");
}

export function getLocalizedBoosterVideoFormats(translate: BoosterMediaTranslator) {
  return translate("media_video_formats");
}

export function getLocalizedBoosterRecommendedVideoDuration(
  translate: BoosterMediaTranslator,
) {
  return translate("media_recommended_video_duration");
}

export function getLocalizedBoosterImageLimits(translate: BoosterMediaTranslator) {
  return translate("media_image_limits", BOOSTER_MEDIA_MESSAGE_VALUES);
}

export function getLocalizedBoosterVideoLimits(translate: BoosterMediaTranslator) {
  return translate("media_video_limits", BOOSTER_MEDIA_MESSAGE_VALUES);
}

export function getLocalizedBoosterMediaOptimization(
  context: "generation" | "publication",
  translate: BoosterMediaTranslator,
) {
  return translate(
    context === "generation"
      ? "media_generation_optimization"
      : "media_publication_optimization",
    BOOSTER_MEDIA_MESSAGE_VALUES,
  );
}

export function getLocalizedBoosterSelectedMediaSummary(
  params: {
    imageCount: number;
    hasVideo: boolean;
    context?: "generation" | "publication";
  },
  translate: BoosterMediaTranslator,
) {
  const parts: string[] = [];
  if (params.imageCount > 0) {
    parts.push(
      translate("media_selected_images_summary", {
        ...BOOSTER_MEDIA_MESSAGE_VALUES,
        count: params.imageCount,
      }),
    );
  }
  if (params.hasVideo) {
    parts.push(
      translate("media_selected_video_summary", BOOSTER_MEDIA_MESSAGE_VALUES),
    );
  }
  return parts.length
    ? parts.join(" · ")
    : translate(
        params.context === "generation"
          ? "media_selected_none_generation"
          : "media_selected_none_publication",
        BOOSTER_MEDIA_MESSAGE_VALUES,
      );
}
export type ChannelPublicationRequirementInput = {
  channel: ChannelKey;
  connected?: boolean;
  mediaMode: ChannelMediaMode;
  hasVideo: boolean;
  videoDurationSeconds?: number | null;
  videoFileType?: string | null;
  videoFileName?: string | null;
  tiktokMaxVideoDurationSeconds?: number | null;
  tiktokDurationLimitVerified?: boolean;
  youtubeLongUploadsStatus?: YoutubeLongUploadsStatus | null;
  hasImage: boolean;
  imageCount: number;
  hasText: boolean;
  hasTitle: boolean;
  hasContent: boolean;
};

export type ChannelPublicationRequirements = {
  warnings: string[];
  warningCodes: string[];
  blockers: string[];
  mediaBlockers: string[];
  blockerCodes: string[];
  mediaBlockerCodes: string[];
};

type ChannelRequirementLocalizationInput = {
  code: string;
  channel: ChannelKey;
  imageCount?: number;
};

export function getLocalizedChannelPublicationRequirement(
  { code, channel, imageCount = 0 }: ChannelRequirementLocalizationInput,
  translate: BoosterMediaTranslator,
) {
  const channelLabel = getLocalizedChannelLabel(channel, translate);
  const simpleKeys: Record<string, string> = {
    content_empty: "requirement_content_empty",
    title_empty: "requirement_title_empty",
    video_source_will_convert: "requirement_video_source_will_convert",
    youtube_short_auto: "requirement_youtube_short_auto",
    youtube_classic_auto: "requirement_youtube_classic_auto",
    tiktok_video_settings_validated:
      "requirement_tiktok_video_settings_validated",
    pinterest_video_cover_auto: "requirement_pinterest_video_cover_auto",
    linkedin_video_finalization: "requirement_linkedin_video_finalization",
    no_image_selected: "requirement_no_image_selected",
    tiktok_photo_settings_validated:
      "requirement_tiktok_photo_settings_validated",
    pinterest_board_selected: "requirement_pinterest_board_selected",
    video_required: "requirement_video_required",
    instagram_image_required: "requirement_instagram_image_required",
    tiktok_photo_or_video_required:
      "requirement_tiktok_photo_or_video_required",
    youtube_video_required: "requirement_youtube_video_required",
    pinterest_image_required: "requirement_pinterest_image_required",
    youtube_photos_unsupported: "requirement_youtube_photos_unsupported",
    instagram_media_required: "requirement_instagram_media_required",
    pinterest_media_required: "requirement_pinterest_media_required",
    text_or_media_required: "requirement_text_or_media_required",
    video_conversion_failed: "requirement_video_conversion_failed",
    media_upload_pending: "requirement_media_upload_failed",
    pinterest_board_required: "requirement_pinterest_board_required",
  };

  if (code === "channel_not_connected") {
    return translate("requirement_channel_not_connected", { channel: channelLabel });
  }
  if (code === "pinterest_multi_image") {
    return translate("requirement_pinterest_multi_image", {
      count: Math.min(imageCount, BOOSTER_MAX_IMAGE_COUNT),
    });
  }
  if (code === "video_duration_unknown") {
    return translate("requirement_video_duration_unknown", { channel: channelLabel });
  }
  if (code === "video_duration_too_short") {
    return translate("requirement_video_duration_too_short", { channel: channelLabel });
  }
  if (code === "video_duration_too_long") {
    return translate("requirement_video_duration_too_long", { channel: channelLabel });
  }
  if (code === "video_duration_account_limit_unknown") {
    return translate(
      channel === "tiktok"
        ? "requirement_tiktok_duration_limit_unknown"
        : "requirement_youtube_long_upload_status_unknown",
    );
  }
  if (code === "video_duration_long_upload_not_allowed") {
    return translate("requirement_youtube_long_upload_not_allowed");
  }

  const messageKey = simpleKeys[code];
  return translate(messageKey || "requirement_validation_failed");
}

function isMp4VideoFile(type?: string | null, name?: string | null) {
  const normalizedType = String(type || "").toLowerCase();
  const normalizedName = String(name || "").toLowerCase();
  return normalizedType.includes("mp4") || normalizedName.endsWith(".mp4");
}

export function getChannelPublicationRequirements({
  channel,
  connected = true,
  mediaMode,
  hasVideo,
  videoDurationSeconds,
  videoFileType,
  videoFileName,
  tiktokMaxVideoDurationSeconds,
  tiktokDurationLimitVerified,
  youtubeLongUploadsStatus,
  hasImage,
  imageCount,
  hasText,
  hasTitle,
  hasContent,
}: ChannelPublicationRequirementInput): ChannelPublicationRequirements {
  const warnings: string[] = [];
  const warningCodes: string[] = [];
  const blockers: string[] = [];
  const mediaBlockers: string[] = [];
  const blockerCodes: string[] = [];
  const mediaBlockerCodes: string[] = [];
  const addWarning = (message: string, code: string) => {
    warnings.push(message);
    warningCodes.push(code);
  };
  const addBlocker = (message: string, code = "prepublish_validation_failed") => {
    blockers.push(message);
    blockerCodes.push(code);
  };
  const addMediaBlocker = (
    message: string,
    code = "prepublish_validation_failed",
  ) => {
    addBlocker(message, code);
    mediaBlockers.push(message);
    mediaBlockerCodes.push(code);
  };

  if (!connected) {
    addBlocker("Canal non connecté.", "channel_not_connected");
    return {
      warnings,
      warningCodes,
      blockers,
      mediaBlockers,
      blockerCodes,
      mediaBlockerCodes,
    };
  }

  if (!hasContent) addWarning("Contenu vide", "content_empty");
  if (!hasTitle) addWarning("Titre vide", "title_empty");

  if (mediaMode === "video") {
    if (!hasVideo) addMediaBlocker("Ajoutez une vidéo.", "video_required");
    let videoDurationIsValid = true;

    if (hasVideo) {
      const durationValidation = validateVideoDurationForChannel({
        channel,
        durationSeconds: videoDurationSeconds,
        tiktokMaxDurationSeconds: tiktokMaxVideoDurationSeconds,
        tiktokAccountLimitVerified: tiktokDurationLimitVerified,
        youtubeLongUploadsStatus,
        enforceAccountCapabilities: true,
      });
      if (!durationValidation.ok) {
        videoDurationIsValid = false;
        addMediaBlocker(
          durationValidation.message,
          durationValidation.reason,
        );
      }

      if (!isMp4VideoFile(videoFileType, videoFileName)) {
        addWarning(
          "Format source détecté : iNrCy le convertira automatiquement en MP4/H.264, audio AAC et 30 fps avant l’envoi.",
          "video_source_will_convert",
        );
      }
    }

    if (channel === "youtube_shorts") {
      if (hasVideo && videoDurationSeconds != null && videoDurationIsValid) {
        const publicationType = getYoutubePublicationTypeForDuration(
          videoDurationSeconds,
        );
        if (publicationType === "short") {
          addWarning(
            "YouTube : vidéo de 3 minutes maximum, iNrCy la convertira automatiquement en format vertical et la publiera en Short.",
            "youtube_short_auto",
          );
        } else {
          addWarning(
            "YouTube : vidéo de plus de 3 minutes, publication automatique en vidéo classique.",
            "youtube_classic_auto",
          );
        }
      }
    }

    if (channel === "tiktok" && videoDurationIsValid) {
      addWarning(
        "TikTok publiera la vidéo sur le compte connecté avec les paramètres validés.",
        "tiktok_video_settings_validated",
      );
    }

    if (channel === "pinterest" && hasVideo && videoDurationIsValid) {
      addWarning(
        "Pinterest publiera la vidéo avec une image de couverture générée automatiquement si nécessaire.",
        "pinterest_video_cover_auto",
      );
    }

    if (channel === "linkedin" && hasVideo && videoDurationIsValid) {
      addWarning(
        "LinkedIn finalise la vidéo après la conversion iNrCy. L’envoi peut prendre quelques secondes.",
        "linkedin_video_finalization",
      );
    }
  } else if (mediaMode === "images") {
    if (!hasImage) {
      if (channel === "instagram") {
        addMediaBlocker(
          "Instagram nécessite au moins 1 image.",
          "instagram_image_required",
        );
      } else if (channel === "tiktok") {
        addMediaBlocker(
          "TikTok nécessite au moins 1 photo ou 1 vidéo.",
          "tiktok_photo_or_video_required",
        );
      } else if (channel === "youtube_shorts") {
        addMediaBlocker("YouTube nécessite une vidéo.", "youtube_video_required");
      } else if (channel === "pinterest") {
        addMediaBlocker(
          "Pinterest nécessite au moins 1 image.",
          "pinterest_image_required",
        );
      } else if (channel !== "gmb") {
        addWarning("Aucune image sélectionnée.", "no_image_selected");
      }
    }

    if (channel === "tiktok" && hasImage) {
      addWarning(
        "TikTok publiera les photos sur le compte connecté avec les paramètres validés.",
        "tiktok_photo_settings_validated",
      );
    }

    if (channel === "pinterest" && hasImage) {
      if (imageCount > 1) {
        addWarning(
          `Pinterest créera une épingle multi-images avec ${Math.min(imageCount, 5)} images.`,
          "pinterest_multi_image",
        );
      } else {
        addWarning(
          "Pinterest créera une épingle dans le tableau choisi.",
          "pinterest_board_selected",
        );
      }
    }

    if (channel === "youtube_shorts" && hasImage) {
      addMediaBlocker(
        "YouTube ne publie pas les photos : ajoutez une vidéo.",
        "youtube_photos_unsupported",
      );
    }
  } else {
    if (channel === "instagram") {
      addMediaBlocker(
        "Instagram nécessite une vidéo ou au moins 1 image.",
        "instagram_media_required",
      );
    } else if (channel === "tiktok") {
      addMediaBlocker(
        "TikTok nécessite une vidéo ou au moins 1 photo.",
        "tiktok_photo_or_video_required",
      );
    } else if (channel === "youtube_shorts") {
      addMediaBlocker("YouTube nécessite une vidéo.", "youtube_video_required");
    } else if (channel === "pinterest") {
      addMediaBlocker(
        "Pinterest nécessite une image ou une vidéo.",
        "pinterest_media_required",
      );
    }
  }

  const hasMedia =
    mediaMode === "video"
      ? hasVideo
      : mediaMode === "images"
        ? hasImage
        : false;
  if (!hasText && !hasMedia) {
    addBlocker(
      "Ajoutez au moins du texte ou un média.",
      "text_or_media_required",
    );
  }

  return {
    warnings: Array.from(new Set(warnings)),
    warningCodes: Array.from(new Set(warningCodes)),
    blockers: Array.from(new Set(blockers)),
    mediaBlockers: Array.from(new Set(mediaBlockers)),
    blockerCodes: Array.from(new Set(blockerCodes)),
    mediaBlockerCodes: Array.from(new Set(mediaBlockerCodes)),
  };
}

export const BOOSTER_ALLOWED_VIDEO_MIME_TYPES = INR_MEDIA_ALLOWED_VIDEO_MIME_TYPES;

export function normalizePublicationMediaType(
  value: unknown,
): PublicationMediaType {
  return value === "video" ? "video" : "images";
}

export function isHeicOrHeifImageFile(file: Pick<File, "name" | "type">) {
  const type =
    String(file?.type || "")
      .toLowerCase()
      .split(";")[0]
      ?.trim() || "";
  const extension = getUploadFileExtension(file as Pick<File, "name">);
  return (
    type === "image/heic" ||
    type === "image/heif" ||
    extension === "heic" ||
    extension === "heif"
  );
}

export function isBoosterImageFile(file: Pick<File, "name" | "type">) {
  const type =
    String(file?.type || "")
      .toLowerCase()
      .split(";")[0]
      ?.trim() || "";
  const extension = getUploadFileExtension(file);
  return (
    INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES.includes(type as any) ||
    INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS.includes(extension as any)
  );
}

export function getUploadFileExtension(file: Pick<File, "name">): string {
  const name =
    String(file?.name || "")
      .toLowerCase()
      .split("?")[0] || "";
  return name.includes(".") ? name.split(".").pop() || "" : "";
}

export function isUnsupportedBrowserImageFile(
  file: Pick<File, "name" | "type">,
): boolean {
  return isHeicOrHeifImageFile(file);
}

export function unsupportedBrowserImageMessage(
  file?: Pick<File, "name" | "type"> | null,
): string {
  const name = String(file?.name || "").trim();
  const prefix = name
    ? `L'image ${name} n'est pas lisible par le navigateur.`
    : "Cette image n'est pas lisible par le navigateur.";
  return `${prefix} Utilisez un format compatible : ${BOOSTER_IMAGE_FORMATS_LABEL}.`;
}

export function isBoosterVideoFile(file: Pick<File, "type" | "name">) {
  const type =
    String(file?.type || "")
      .toLowerCase()
      .split(";")[0]
      ?.trim() || "";
  const name = String(file?.name || "").toLowerCase();
  const extensionAccepted = INR_MEDIA_ALLOWED_VIDEO_EXTENSIONS.some(
    (extension) => name.endsWith(`.${extension}`),
  );
  const mimeAccepted =
    !type ||
    type === "application/octet-stream" ||
    BOOSTER_ALLOWED_VIDEO_MIME_TYPES.includes(type as any);
  return extensionAccepted && mimeAccepted;
}

export function getPublicationMediaLabel(
  mediaType: PublicationMediaType,
  count: number,
) {
  if (mediaType === "video") return count ? "1 vidéo" : "Aucune vidéo";
  return count
    ? `${count}/${BOOSTER_MAX_IMAGE_COUNT} image${count > 1 ? "s" : ""}`
    : "Aucune image";
}

export type TextFieldKey = "title" | "content" | "cta" | "hashtags";
export type LimitTone = "ok" | "warn" | "over";

export type ChannelTextGuidelines = {
  title: number;
  content: number;
  cta: number;
  hashtags?: number;
  totalLabel?: string;
  totalMax?: number;
  totalValue?: (post: ChannelPost) => number;
};

export const CHANNEL_TEXT_GUIDELINES: Record<
  DisplayKey,
  ChannelTextGuidelines
> = {
  inrcy_site: {
    title: 90,
    content: 6000,
    cta: 180,
  },
  site_web: {
    title: 90,
    content: 6000,
    cta: 180,
  },
  inr_search: {
    title: 100,
    content: INR_SEARCH_CONTENT_MAX_LENGTH,
    cta: 180,
  },
  gmb: {
    title: 90,
    content: 2000,
    cta: 80,
    totalLabel: "Résumé final Google Business",
    totalMax: 1498,
    totalValue: (post) => buildBoosterGmbSummary(post).length,
  },
  facebook: {
    title: 90,
    content: 5000,
    cta: 180,
  },
  instagram: {
    title: 90,
    content: 2000,
    cta: 180,
    hashtags: 20,
    totalLabel: "Légende Instagram finale",
    totalMax: 2200,
    totalValue: (post) => buildInstagramPreviewCaption(post).length,
  },
  linkedin: {
    title: 90,
    content: 3000,
    cta: 180,
  },
  tiktok: {
    title: 90,
    content: 2200,
    cta: 120,
    hashtags: 8,
    totalLabel: "Légende TikTok finale",
    totalMax: 2200,
    totalValue: (post) => {
      const body = buildBoosterMessage("tiktok", post);
      const hashtags = buildBoosterHashtagLine(post, body, 8);
      return [body, hashtags].filter(Boolean).join("\n\n").length;
    },
  },
  youtube_shorts: {
    title: 90,
    content: 2200,
    cta: 120,
    hashtags: 8,
    totalLabel: "Légende YouTube finale",
    totalMax: 2200,
    totalValue: (post) => {
      const body = buildBoosterMessage("youtube_shorts", post);
      const hashtags = buildBoosterHashtagLine(post, body, 8);
      return [body, hashtags].filter(Boolean).join("\n\n").length;
    },
  },
  pinterest: {
    title: 90,
    content: 500,
    cta: 120,
    hashtags: 8,
    totalLabel: "Description Pinterest finale",
    totalMax: 500,
    totalValue: (post) => {
      const body = buildBoosterMessage("pinterest", { ...post, title: "" });
      const hashtags = buildBoosterHashtagLine(post, body, 8);
      return [body, hashtags].filter(Boolean).join("\n\n").length;
    },
  },
};

export const CTA_MODE_OPTIONS: Record<
  DisplayKey,
  Array<{ value: BoosterCtaMode; label: string }>
> = {
  inrcy_site: [
    { value: "none", label: "Aucun bouton" },
    { value: "website", label: "Voir le site" },
    { value: "call", label: "Appeler" },
    { value: "message", label: "Envoyer un message" },
    { value: "custom", label: "Lien personnalisé" },
  ],
  site_web: [
    { value: "none", label: "Aucun bouton" },
    { value: "website", label: "Voir le site" },
    { value: "call", label: "Appeler" },
    { value: "message", label: "Envoyer un message" },
    { value: "custom", label: "Lien personnalisé" },
  ],
  inr_search: [
    { value: "none", label: "Aucun bouton" },
    { value: "website", label: "Voir le site" },
    { value: "call", label: "Appeler" },
    { value: "message", label: "Envoyer un message" },
    { value: "custom", label: "Lien personnalisé" },
  ],
  gmb: [
    { value: "none", label: "Aucun bouton" },
    { value: "website", label: "Voir le site" },
    { value: "call", label: "Appeler" },
    { value: "custom", label: "Lien personnalisé" },
  ],
  facebook: [
    { value: "none", label: "Aucun bouton" },
    { value: "website", label: "Voir le site" },
    { value: "call", label: "Appeler" },
    { value: "message", label: "Envoyer un message" },
    { value: "custom", label: "Lien personnalisé" },
  ],
  instagram: [
    { value: "none", label: "Aucun bouton" },
    { value: "website", label: "Voir le site" },
    { value: "call", label: "Appeler" },
    { value: "message", label: "Envoyer un message" },
    { value: "custom", label: "Lien personnalisé" },
  ],
  linkedin: [
    { value: "none", label: "Aucun bouton" },
    { value: "website", label: "Voir le site" },
    { value: "call", label: "Appeler" },
    { value: "message", label: "Envoyer un message" },
    { value: "custom", label: "Lien personnalisé" },
  ],
  tiktok: [
    { value: "none", label: "Aucun bouton" },
    { value: "website", label: "Voir le site" },
    { value: "call", label: "Appeler" },
    { value: "message", label: "Envoyer un message" },
    { value: "custom", label: "Lien personnalisé" },
  ],
  youtube_shorts: [
    { value: "none", label: "Aucun bouton" },
    { value: "website", label: "Voir le site" },
    { value: "call", label: "Appeler" },
    { value: "message", label: "Envoyer un message" },
    { value: "custom", label: "Lien personnalisé" },
  ],
  pinterest: [
    { value: "none", label: "Aucun bouton" },
    { value: "website", label: "Voir le site" },
    { value: "call", label: "Appeler" },
    { value: "message", label: "Envoyer un message" },
    { value: "custom", label: "Lien personnalisé" },
  ],
};

export function getCtaModeHelp(channel: DisplayKey, mode: BoosterCtaMode) {
  if (mode === "none") return "Aucun bouton ne sera ajouté à la fin du texte.";
  if (mode === "website")
    return channel === "gmb"
      ? "Un vrai bouton Google Business sera utilisé quand une URL de site est disponible."
      : "Le lien du site sera ajouté proprement à la fin du contenu. L’URL du site est préremplie automatiquement quand elle est disponible.";
  if (mode === "call")
    return channel === "gmb"
      ? "Un vrai bouton Appeler sera utilisé si un numéro est disponible."
      : "Une phrase d’appel naturelle sera ajoutée avec le numéro si disponible.";
  if (mode === "message")
    return "Une phrase naturelle du type “Envoyez-nous un message privé.” sera ajoutée.";
  return channel === "gmb"
    ? "Lien ou texte personnalisé. À utiliser seulement si le bouton automatique ne convient pas."
    : "Lien personnalisé. Renseignez une URL et le texte du bouton si besoin.";
}

export function getLocalizedCtaModeHelp(
  channel: DisplayKey,
  mode: BoosterCtaMode,
  translate: (key: string) => string,
) {
  if (mode === "none") return translate("cta_help_none");
  if (mode === "website") {
    return translate(channel === "gmb" ? "cta_help_gmb_website" : "cta_help_website");
  }
  if (mode === "call") {
    return translate(channel === "gmb" ? "cta_help_gmb_call" : "cta_help_call");
  }
  if (mode === "message") return translate("cta_help_message");
  return translate(channel === "gmb" ? "cta_help_gmb_custom" : "cta_help_custom");
}

export function getDefaultPost(): ChannelPost {
  return {
    title: "",
    content: "",
    cta: "",
    ctaMode: "none",
    ctaUrl: "",
    ctaPhone: "",
    hashtags: [],
  };
}

export function getChannelDefaultCtaLabel(
  channel: DisplayKey,
  mode: BoosterCtaMode,
) {
  void channel;
  if (mode === "website") return "Voir le site";
  if (mode === "call") return "Appeler";
  if (mode === "message") return "Envoyer un message";
  return "";
}

export function getLocalizedChannelDefaultCtaLabel(
  mode: BoosterCtaMode,
  translate: (key: string) => string,
) {
  if (mode === "website") return translate("voir_le_site_5bf01317");
  if (mode === "call") return translate("appeler_de49ee03");
  if (mode === "message") return translate("envoyer_un_message_c211810b");
  return "";
}

export function getCtaLabelForPreferredChoice(
  choice: BoosterPreferredCta,
  language: unknown = "fr",
) {
  const aiLanguage = normalizeBoosterAiLanguage(language);
  return (
    CTA_LABELS_BY_LANGUAGE[aiLanguage]?.[choice] ||
    CTA_LABELS_BY_LANGUAGE.fr[choice] ||
    ""
  );
}

export function isSiteDisplayKey(channel: DisplayKey) {
  return channel === "inrcy_site" || channel === "site_web" || channel === "inr_search";
}

export function getWebsiteUrlForChannel(
  channel: DisplayKey,
  defaults: BoosterCtaDefaults | null,
) {
  if (!defaults) return "";
  const siteWebUrl = String(defaults.siteWebUrl || "").trim();
  const inrcySiteUrl = String(defaults.inrcySiteUrl || "").trim();

  if (channel === "inrcy_site") return inrcySiteUrl || siteWebUrl || "";
  if (channel === "site_web") return siteWebUrl || inrcySiteUrl || "";

  if (siteWebUrl && !inrcySiteUrl) return siteWebUrl;
  if (inrcySiteUrl && !siteWebUrl) return inrcySiteUrl;
  return "";
}

export function getWebsiteSourceLabelForChannel(
  channel: DisplayKey,
  defaults: BoosterCtaDefaults | null,
) {
  const url = getWebsiteUrlForChannel(channel, defaults);
  if (!url || !defaults) return "";
  if (defaults.siteWebUrl && url === defaults.siteWebUrl)
    return "Site web connecté";
  if (defaults.inrcySiteUrl && url === defaults.inrcySiteUrl)
    return "Site iNrCy";
  return defaults.preferredWebsiteLabel || "Site connecté";
}

export function getLocalizedWebsiteSourceLabelForChannel(
  channel: DisplayKey,
  defaults: BoosterCtaDefaults | null,
  translate: (key: string) => string,
) {
  const url = getWebsiteUrlForChannel(channel, defaults);
  if (!url || !defaults) return "";
  if (defaults.siteWebUrl && url === defaults.siteWebUrl) {
    return translate("site_web_connecte_21cd3026");
  }
  if (defaults.inrcySiteUrl && url === defaults.inrcySiteUrl) {
    return translate("site_inrcy_57016d6f");
  }
  return translate("site_connecte_f4833d02");
}

const CHANNEL_TOTAL_LABEL_MESSAGE_KEYS: Partial<Record<DisplayKey, string>> = {
  gmb: "resume_final_google_business_d9bf3960",
  instagram: "legende_instagram_finale_b89c3cc2",
  tiktok: "legende_tiktok_finale_4975393f",
  youtube_shorts: "legende_youtube_finale_11f26e6f",
  pinterest: "description_pinterest_finale_4d0327ff",
};

export function getLocalizedChannelTotalLabel(
  channel: DisplayKey,
  translate: (key: string) => string,
) {
  const key = CHANNEL_TOTAL_LABEL_MESSAGE_KEYS[channel];
  return key ? translate(key) : "";
}

export function getDefaultCtaModeForChannel(
  channel: DisplayKey,
  defaults: BoosterCtaDefaults | null,
): BoosterCtaMode {
  const preferred = normalizeBoosterPreferredCta(
    defaults?.preferredCta || "devis",
  );

  if (preferred === "none") return "none";
  if (preferred === "custom") return "custom";

  if (preferred === "appeler") {
    if (defaults?.phone) return "call";
    return getWebsiteUrlForChannel(channel, defaults) ? "website" : "none";
  }

  if (preferred === "message") {
    const supportsPrivateMessage = CTA_MODE_OPTIONS[channel].some(
      (option) => option.value === "message",
    );
    if (supportsPrivateMessage) return "message";
    return getWebsiteUrlForChannel(channel, defaults) ? "website" : "none";
  }

  return getWebsiteUrlForChannel(channel, defaults) ? "website" : "none";
}

export function buildPreferredCtaPatch(
  channel: DisplayKey,
  choice: BoosterPreferredCta,
  post: ChannelPost,
  defaults: BoosterCtaDefaults | null,
  language: unknown = defaults?.aiLanguage || "fr",
): Partial<ChannelPost> {
  return buildSafePreferredCtaPatch({
    channel,
    choice,
    post,
    defaults,
    language,
  });
}

export function buildAutoPrefillPatch(
  channel: DisplayKey,
  mode: BoosterCtaMode,
  post: ChannelPost,
  defaults: BoosterCtaDefaults | null,
  language: unknown = defaults?.aiLanguage || "fr",
): Partial<ChannelPost> {
  const patch: Partial<ChannelPost> = { ctaMode: mode };
  const aiLanguage = normalizeBoosterAiLanguage(language);
  if (!defaults) return patch;

  if (mode === "website") {
    const preferred = ["site", "devis"].includes(defaults.preferredCta)
      ? defaults.preferredCta
      : getPreferredCtaChoiceFromPost(channel, post);
    const channelWebsiteUrl = getWebsiteUrlForChannel(channel, defaults);
    if (!String(post.cta || "").trim())
      patch.cta =
        getCtaLabelForPreferredChoice(
          preferred as BoosterPreferredCta,
          aiLanguage,
        ) || getChannelDefaultCtaLabel(channel, mode);
    if (!String(post.ctaUrl || "").trim() && channelWebsiteUrl)
      patch.ctaUrl = channelWebsiteUrl;
  }

  if (mode === "call") {
    if (!String(post.cta || "").trim())
      patch.cta = getCtaLabelForPreferredChoice("appeler", aiLanguage);
    if (!String(post.ctaPhone || "").trim() && defaults.phone)
      patch.ctaPhone = defaults.phone;
  }

  if (mode === "message") {
    if (!String(post.cta || "").trim())
      patch.cta = getCtaLabelForPreferredChoice("message", aiLanguage);
  }

  return patch;
}

export function getWebsiteSourceLabel(defaults: BoosterCtaDefaults | null) {
  if (!defaults?.preferredWebsiteUrl) return "";
  if (
    defaults.siteWebUrl &&
    defaults.preferredWebsiteUrl === defaults.siteWebUrl
  )
    return "Site web connecté";
  if (
    defaults.inrcySiteUrl &&
    defaults.preferredWebsiteUrl === defaults.inrcySiteUrl
  )
    return "Site iNrCy";
  return defaults.preferredWebsiteLabel || "Site connecté";
}

export function normalizePost(post?: Partial<ChannelPost> | null): ChannelPost {
  return {
    ...getDefaultPost(),
    ...(post || {}),
    ctaMode: getCtaMode(post || {}),
    ctaUrl: String(post?.ctaUrl || ""),
    ctaPhone: String(post?.ctaPhone || ""),
    hashtags: Array.isArray(post?.hashtags) ? post!.hashtags! : [],
  };
}

export function normalizeHashtagPreview(input: string): string {
  return String(input || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .slice(0, 40);
}

export function parseInstagramHashtagsInput(input: string): string[] {
  return String(input || "")
    .split(/[\s,;]+/)
    .map(normalizeHashtagPreview)
    .filter(Boolean)
    .slice(0, 20);
}

export function buildInstagramPreviewCaption(post: ChannelPost) {
  const cleanPost = {
    ...post,
    hashtags: Array.isArray(post.hashtags)
      ? post.hashtags.map(normalizeHashtagPreview).filter(Boolean).slice(0, 8)
      : [],
  };
  return buildBoosterInstagramCaption(cleanPost);
}

export function getLimitTone(current: number, max: number): LimitTone {
  if (current > max) return "over";
  if (current >= Math.round(max * 0.9)) return "warn";
  return "ok";
}

export function getLimitToneStyle(tone: LimitTone): CSSProperties {
  if (tone === "over") return { color: "#ff8f8f" };
  if (tone === "warn") return { color: "#fde68a" };
  return { color: "rgba(255,255,255,0.62)" };
}

export function renderLimitCounter(
  label: string,
  current: number,
  max: number,
) {
  const tone = getLimitTone(current, max);
  return (
    <div
      style={{
        fontSize: 11,
        marginTop: 6,
        textAlign: "right",
        ...getLimitToneStyle(tone),
      }}
    >
      {label} : {current} / {max}
    </div>
  );
}

export const THEME_OPTIONS: Array<{ value: ThemeKey; label: string }> = [
  { value: "", label: "—" },
  { value: "promotion", label: "Promotion" },
  { value: "information", label: "Information" },
  { value: "conseil", label: "Conseil / Astuce" },
  { value: "avis_client", label: "Avis client / preuve sociale" },
  { value: "realisation", label: "Réalisation / intervention / chantier" },
  { value: "actualite", label: "Actualité / nouveauté" },
  { value: "autre", label: "Autre" },
];

export const THEME_PLACEHOLDERS: Record<ThemeKey, string> = {
  "": "Ex : Chantier réalisé chez Michel à Arras",
  promotion: "Ex : Offre de printemps sur la taille de haies jusqu’au 30 avril",
  information:
    "Ex : Nous intervenons désormais aussi le samedi sur Berck et ses alentours",
  conseil:
    "Ex : Pensez à faire entretenir votre chaudière avant l’hiver pour éviter les pannes",
  avis_client:
    "Ex : Merci à Mme Dupont pour sa confiance après la rénovation complète de sa salle de bain",
  realisation:
    "Ex : Terrasse en bois posée cette semaine chez un client à Montreuil",
  actualite:
    "Ex : Notre nouvelle prestation de nettoyage toiture est maintenant disponible",
  autre:
    "Ex : Intervention rapide réalisée ce matin suite à une fuite en cuisine",
};

export const STYLE_OPTIONS: Array<{ value: StyleKey; label: string }> = [
  { value: "sobre", label: "Sobre" },
  { value: "equilibre", label: "Équilibré" },
  { value: "dynamique", label: "Dynamique" },
];

export const STYLE_HELPERS: Record<StyleKey, string> = {
  sobre: "Ton plus posé, accroches sobres, très peu d’emojis.",
  equilibre:
    "Ton chaleureux et pro, avec juste ce qu’il faut de peps et d’emojis.",
  dynamique:
    "Ton plus vivant, accroches plus fortes, phrases plus rythmées et emojis adaptés au canal.",
};

export function makeImageKey(file: File): string {
  return `${file.name}__${file.size}__${file.lastModified}`;
}

export async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

export type BoosterAiImagePayload = {
  name: string;
  type: string;
  dataUrl: string;
};

export type BoosterAiVideoFramePayload = BoosterAiImagePayload & {
  frameTarget: "start" | "middle" | "end";
  timeSeconds: number;
};

const BOOSTER_AI_IMAGE_MAX_SIDE = 1280;
const BOOSTER_AI_IMAGE_JPEG_QUALITY = 0.76;
const BOOSTER_AI_DIRECT_DATA_URL_MAX_LENGTH = 3_500_000;
const BOOSTER_AI_DIRECT_DATA_URL_RE =
  /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function normalizeDirectAiImageType(value: unknown) {
  const type = String(value || "")
    .toLowerCase()
    .trim();
  if (type === "image/jpg") return "image/jpeg";
  if (type === "image/jpeg" || type === "image/png" || type === "image/webp")
    return type;
  return "";
}

function drawBoosterAiImagePayload(params: {
  file: File;
  source: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
}): BoosterAiImagePayload {
  const sourceW = params.sourceWidth || 1;
  const sourceH = params.sourceHeight || 1;
  const scale = Math.min(
    1,
    BOOSTER_AI_IMAGE_MAX_SIDE / Math.max(sourceW, sourceH),
  );
  const width = Math.max(1, Math.round(sourceW * scale));
  const height = Math.max(1, Math.round(sourceH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(params.source, 0, 0, width, height);

  return {
    name: params.file.name || "image",
    type: "image/jpeg",
    dataUrl: canvas.toDataURL("image/jpeg", BOOSTER_AI_IMAGE_JPEG_QUALITY),
  };
}

async function fileToDirectBoosterAiImagePayload(
  file: File,
): Promise<BoosterAiImagePayload | null> {
  const type = normalizeDirectAiImageType(file.type);
  if (!type) return null;

  const dataUrl = await fileToDataUrl(file).catch(() => "");
  if (
    !dataUrl ||
    dataUrl.length > BOOSTER_AI_DIRECT_DATA_URL_MAX_LENGTH ||
    !BOOSTER_AI_DIRECT_DATA_URL_RE.test(dataUrl)
  ) {
    return null;
  }

  return {
    name: file.name || "image",
    type,
    dataUrl,
  };
}

export async function fileToBoosterAiImagePayload(
  file: File,
): Promise<BoosterAiImagePayload> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        return drawBoosterAiImagePayload({
          file,
          source: bitmap,
          sourceWidth: bitmap.width,
          sourceHeight: bitmap.height,
        });
      } finally {
        bitmap.close();
      }
    } catch {
      // Fallback ci-dessous : certains mobiles refusent createImageBitmap
      // selon le format ou la provenance de l'image.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadHtmlImage(objectUrl);
    return drawBoosterAiImagePayload({
      file,
      source: img,
      sourceWidth: img.naturalWidth || img.width || 1,
      sourceHeight: img.naturalHeight || img.height || 1,
    });
  } catch (error) {
    const directPayload = await fileToDirectBoosterAiImagePayload(file);
    if (directPayload) return directPayload;
    throw error instanceof Error ? error : new Error("Image illisible.");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function loadHtmlVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    let timeoutId: number | null = null;

    const cleanup = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      video.onloadedmetadata = null;
      video.onerror = null;
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Impossible de charger la vidéo."));
    };

    video.onloadedmetadata = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(video);
    };
    video.onerror = fail;
    timeoutId = window.setTimeout(fail, 8_000);
    video.src = src;
  });
}

export function seekHtmlVideo(
  video: HTMLVideoElement,
  timeSeconds: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : 0;
    const maxSeek =
      duration > 0.1 ? Math.max(0, duration - 0.08) : Number.POSITIVE_INFINITY;
    const requestedTarget = Math.max(
      0,
      Number.isFinite(timeSeconds) ? timeSeconds : 0,
    );
    const target = Math.min(requestedTarget, maxSeek);
    const seekTarget = target <= 0 && duration > 0.08 ? 0.03 : target;
    let settled = false;
    let timeoutId: number | null = null;

    const cleanup = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      video.onseeked = null;
      video.onerror = null;
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    video.onseeked = finish;
    video.onerror = () => fail(new Error("Impossible de lire la vidéo."));
    timeoutId = window.setTimeout(
      () => fail(new Error("Impossible de lire la vidéo.")),
      5_000,
    );

    try {
      if (
        Math.abs((video.currentTime || 0) - seekTarget) < 0.04 &&
        video.readyState >= 2
      ) {
        finish();
        return;
      }
      video.currentTime = seekTarget;
      window.setTimeout(() => {
        if (
          !settled &&
          Math.abs((video.currentTime || 0) - seekTarget) < 0.08 &&
          video.readyState >= 2
        ) {
          finish();
        }
      }, 150);
    } catch {
      fail(new Error("Impossible de positionner la vidéo."));
    }
  });
}

export function buildVideoFrameCapturePlan(durationSeconds: number): Array<{
  frameTarget: "start" | "middle" | "end";
  timeSeconds: number;
}> {
  const duration =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : 3;
  const maxSeek = duration > 0.2 ? Math.max(0, duration - 0.12) : 0;
  const points = [
    { frameTarget: "start" as const, ratio: duration <= 2 ? 0 : 0.15 },
    { frameTarget: "middle" as const, ratio: 0.5 },
    { frameTarget: "end" as const, ratio: 0.85 },
  ];
  return points.map((point) => ({
    frameTarget: point.frameTarget,
    timeSeconds: clamp(duration * point.ratio, 0, maxSeek),
  }));
}

export async function extractVideoFramesForAI(
  file: File,
  options?: { maxSide?: number; quality?: number },
): Promise<BoosterAiVideoFramePayload[]> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = await loadHtmlVideo(objectUrl);
    const sourceW = video.videoWidth || 1280;
    const sourceH = video.videoHeight || 720;
    const maxSide = Math.max(
      480,
      Math.min(1600, Math.round(options?.maxSide || 1280)),
    );
    const quality = Math.max(
      0.55,
      Math.min(0.9, Number(options?.quality || 0.76)),
    );
    const scale = Math.min(1, maxSide / Math.max(sourceW, sourceH));
    const width = Math.max(1, Math.round(sourceW * scale));
    const height = Math.max(1, Math.round(sourceH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponible.");

    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : 3;
    const plan = buildVideoFrameCapturePlan(duration);
    const baseName =
      String(file.name || "video-inrcy").replace(/\.[^.]+$/, "") ||
      "video-inrcy";
    const frames: BoosterAiVideoFramePayload[] = [];

    for (const item of plan) {
      await seekHtmlVideo(video, item.timeSeconds);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(video, 0, 0, width, height);
      frames.push({
        name: `${baseName}-${item.frameTarget}.jpg`,
        type: "image/jpeg",
        dataUrl: canvas.toDataURL("image/jpeg", quality),
        frameTarget: item.frameTarget,
        timeSeconds: Number(item.timeSeconds.toFixed(2)),
      });
    }

    return frames;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getEffectiveTransformZoom(
  transform: Pick<ImageTransform, "fit" | "zoom">,
) {
  const maxZoom = transform.fit === "cover" ? 3 : 1;
  return clamp(transform.zoom || 1, 0.4, maxZoom);
}

export function normalizeContainTransform(
  transform: ImageTransform,
): ImageTransform {
  if (transform.fit === "cover") return transform;
  return {
    ...transform,
    fit: "contain",
    zoom: getEffectiveTransformZoom(transform),
    offsetX: clamp(transform.offsetX || 0, -100, 100),
    offsetY: clamp(transform.offsetY || 0, -100, 100),
  };
}

export function getChannelSafetyBackgroundMode(
  channel: ChannelKey,
): BackgroundMode {
  return getBoosterImageSafetyBackgroundMode(channel);
}

export function getBackgroundMode(transform: ImageTransform): BackgroundMode {
  const rawMode = String(transform.backgroundMode || "").trim().toLowerCase();
  // Legacy persisted blur settings are converted to a sober solid background.
  if (rawMode === "blur" || transform.blurBackground) return "black";
  if (rawMode) return rawMode as BackgroundMode;
  return transform.backgroundColor ? "color" : "black";
}

export function withBackgroundMode(
  transform: ImageTransform,
  backgroundMode: BackgroundMode,
): ImageTransform {
  return {
    ...transform,
    backgroundMode,
    blurBackground: false,
  };
}

export function getBackgroundFill(
  mode: BackgroundMode,
  backgroundColor?: string,
): string {
  if (backgroundColor) return backgroundColor;
  switch (mode) {
    case "white":
      return "#ffffff";
    case "gray":
      return "#d6dae2";
    case "sand":
      return "#efe4d3";
    case "brand":
      return "#ffffff";
    case "color":
      return "#ffffff";
    default:
      return "#0d1320";
  }
}

export function computePreviewLayout(params: {
  containerWidth: number;
  containerHeight: number;
  imageWidth: number;
  imageHeight: number;
  transform: ImageTransform;
}): PreviewLayout {
  const {
    containerWidth,
    containerHeight,
    imageWidth,
    imageHeight,
    transform,
  } = params;
  if (!containerWidth || !containerHeight || !imageWidth || !imageHeight) {
    return { drawW: 0, drawH: 0, dx: 0, dy: 0, maxX: 0, maxY: 0 };
  }

  const baseScale =
    transform.fit === "cover"
      ? Math.max(containerWidth / imageWidth, containerHeight / imageHeight)
      : Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const scale = baseScale * getEffectiveTransformZoom(transform);
  const drawW = imageWidth * scale;
  const drawH = imageHeight * scale;
  const maxX = Math.abs(drawW - containerWidth) / 2;
  const maxY = Math.abs(drawH - containerHeight) / 2;
  const dx =
    (containerWidth - drawW) / 2 -
    (maxX * clamp(transform.offsetX || 0, -100, 100)) / 100;
  const dy =
    (containerHeight - drawH) / 2 -
    (maxY * clamp(transform.offsetY || 0, -100, 100)) / 100;

  return { drawW, drawH, dx, dy, maxX, maxY };
}

export function offsetFromDrawPosition(params: {
  containerWidth: number;
  containerHeight: number;
  drawW: number;
  drawH: number;
  dx: number;
  dy: number;
}): Pick<ImageTransform, "offsetX" | "offsetY"> {
  const { containerWidth, containerHeight, drawW, drawH, dx, dy } = params;
  const maxX = Math.abs(drawW - containerWidth) / 2;
  const maxY = Math.abs(drawH - containerHeight) / 2;
  const offsetX = maxX
    ? clamp((((containerWidth - drawW) / 2 - dx) / maxX) * 100, -100, 100)
    : 0;
  const offsetY = maxY
    ? clamp((((containerHeight - drawH) / 2 - dy) / maxY) * 100, -100, 100)
    : 0;
  return { offsetX, offsetY };
}

export function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error("Image manquante."));
      return;
    }
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(
        new Error(`Image illisible. Formats compatibles : ${BOOSTER_IMAGE_FORMATS_LABEL}.`),
      );
    img.src = src;
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const value = String(dataUrl || "").trim();
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(value);
  if (!match) throw new Error("Impossible de préparer l'image.");

  const mimeType = match[1] || "application/octet-stream";
  const encoded = match[3] || "";

  try {
    if (match[2]) {
      // Ne pas faire fetch(dataUrl) : Safari iOS peut interrompre ce fetch local
      // avec "Load failed" lorsque plusieurs photos sont préparées en mémoire.
      const binary = atob(encoded.replace(/\s/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new Blob([bytes], { type: mimeType });
    }

    return new Blob([decodeURIComponent(encoded)], { type: mimeType });
  } catch {
    throw new Error("Impossible de préparer l'image.");
  }
}

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
  "heic",
  "heif",
]);
const ALLOWED_VIDEO_UPLOAD_EXTENSIONS = new Set(["mp4", "m4v", "mov"]);

function normalizeUploadSegment(value: string, fallback: string): string {
  const safe = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 90);

  return safe || fallback;
}

export function sanitizeUploadName(name: string): string {
  const rawName =
    String(name || "image")
      .split(/[\\/]/)
      .pop() || "image";
  const rawExtension = rawName.includes(".")
    ? rawName.split(".").pop()?.toLowerCase() || ""
    : "";
  const extension = ALLOWED_UPLOAD_EXTENSIONS.has(rawExtension)
    ? rawExtension === "jpeg"
      ? "jpg"
      : rawExtension
    : "jpg";
  const base = normalizeUploadSegment(rawName.replace(/\.[^.]*$/, ""), "image");
  return `${base}.${extension}`.toLowerCase();
}

export function buildBoosterUploadPath(
  fileName: string,
  folder = "booster-prepublish",
): string {
  const safeFolder = normalizeUploadSegment(folder, "booster-prepublish")
    .replace(/\./g, "-")
    .toLowerCase();
  const safeName = sanitizeUploadName(fileName);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${safeFolder}/${unique}-${safeName}`;
}
export function sanitizeVideoUploadName(name: string, _mimeType = ""): string {
  const rawName =
    String(name || "video-inrcy")
      .split(/[\\/]/)
      .pop() || "video-inrcy";
  const rawExtension = rawName.includes(".")
    ? rawName.split(".").pop()?.toLowerCase() || ""
    : "";
  const extension = ALLOWED_VIDEO_UPLOAD_EXTENSIONS.has(rawExtension)
    ? rawExtension === "m4v"
      ? "mp4"
      : rawExtension
    : "mp4";
  const base = normalizeUploadSegment(
    rawName.replace(/\.[^.]*$/, ""),
    "video-inrcy",
  );
  return `${base}.${extension}`.toLowerCase();
}

export function buildBoosterVideoUploadPath(
  fileName: string,
  folder = "booster-videos",
  mimeType = "",
): string {
  const safeFolder = normalizeUploadSegment(folder, "booster-videos")
    .replace(/\./g, "-")
    .toLowerCase();
  const safeName = sanitizeVideoUploadName(fileName, mimeType);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${safeFolder}/${unique}-${safeName}`;
}

export type BoosterVideoGenerationSource = "browser_file" | "supabase_storage";

export type BoosterVideoGenerationContext = {
  enabled: boolean;
  source: BoosterVideoGenerationSource;
  name: string;
  type: string;
  size: number;
  duration: number | null;
  storagePath?: string;
  publicUrl?: string;
  url?: string;
  visualFrames?: BoosterAiVideoFramePayload[];
  audioTranscript?: string;
  rawAudioTranscript?: string;
  analysisPlan: {
    visualFrames: "pending" | "ready";
    audioTranscript: "pending" | "ready" | "unavailable";
    frameTargets: ["start", "middle", "end"];
  };
};

export function buildBoosterVideoGenerationContext(params: {
  mediaType: PublicationMediaType;
  videoFile: File | null;
  duration: number | null;
  storage?: Pick<VideoPayload, "storagePath" | "publicUrl" | "url"> | null;
}): BoosterVideoGenerationContext | null {
  const file = params.videoFile;
  if (params.mediaType !== "video" || !file) return null;

  const storagePath = String(params.storage?.storagePath || "").trim();
  const publicUrl = String(
    params.storage?.publicUrl || params.storage?.url || "",
  ).trim();

  return {
    enabled: true,
    source: storagePath || publicUrl ? "supabase_storage" : "browser_file",
    name: file.name || "video-inrcy.mp4",
    type: file.type || "video/mp4",
    size: Number(file.size || 0),
    duration:
      typeof params.duration === "number" &&
      Number.isFinite(params.duration) &&
      params.duration > 0
        ? params.duration
        : null,
    ...(storagePath ? { storagePath } : {}),
    ...(publicUrl ? { publicUrl, url: publicUrl } : {}),
    analysisPlan: {
      visualFrames: "pending",
      audioTranscript: "pending",
      frameTargets: ["start", "middle", "end"],
    },
  };
}

export type BoosterVideoOrientation =
  | "horizontal"
  | "vertical"
  | "square"
  | "unknown";

export type BoosterVideoSourceMetadata = {
  width: number | null;
  height: number | null;
  duration: number | null;
  size: number;
  type: string;
  ratio: number | null;
  ratioLabel: string;
  orientation: BoosterVideoOrientation;
  orientationLabel: string;
  /** RenseignÃ©s uniquement aprÃ¨s le probe serveur ; `null` force l'adaptation. */
  videoCodec?: string | null;
  audioCodec?: string | null;
  frameRate?: number | null;
  hasAudio?: boolean | null;
  containerFormats?: string[] | null;
  pixelFormat?: string | null;
  compatibilityProof?: "server_ffmpeg" | "canonical_derivative" | null;
};

export type VideoPayload = {
  name: string;
  type: string;
  size: number;
  lastModified?: number;
  duration?: number | null;
  sourceMetadata?: BoosterVideoSourceMetadata | null;
  storagePath?: string;
  publicUrl?: string;
  url?: string;
  transformedVariants?: BoosterVideoTransformedVariant[];
};

export async function uploadBoosterVideo(
  file: File,
  options?: {
    folder?: string;
    path?: string;
    duration?: number | null;
    sourceMetadata?: BoosterVideoSourceMetadata | null;
  },
): Promise<VideoPayload> {
  const path =
    options?.path ||
    buildBoosterVideoUploadPath(file.name, options?.folder, file.type);

  if (isUniversalMediaUploadEnabled()) {
    try {
      const result = await uploadUniversalMediaFile(file, {
        target: "booster_video_source",
        requestedPath: path,
        requestedFolder: options?.folder || "booster-videos",
        source: "booster",
      });
      return {
        name: file.name || "video-inrcy.mp4",
        type: result.contentType || file.type || "video/mp4",
        size: Number(file.size || 0),
        lastModified: file.lastModified,
        duration: typeof options?.duration === "number" ? options.duration : null,
        sourceMetadata: options?.sourceMetadata || null,
        storagePath: result.storagePath,
        publicUrl: result.publicUrl || undefined,
        url: result.publicUrl || undefined,
      };
    } catch (error) {
      console.warn("[media-pipeline] universal video upload fallback", error);
      // A TUS upload is resumable. Falling back to one monolithic PUT after a
      // transient failure could restart an accepted 75 MB file from byte zero
      // and make the UI appear frozen. Keep direct fallback for small files.
      if (file.size > UNIVERSAL_MEDIA_STANDARD_UPLOAD_MAX_BYTES) {
        throw error instanceof Error
          ? error
          : new Error(
              "L'upload vidéo a été interrompu. Relancez-le pour reprendre le transfert.",
            );
      }
    }
  }

  const signedRes = await fetch("/api/booster/video-upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      type: file.type,
      size: file.size,
      path,
      duration: options?.duration ?? null,
    }),
  });

  const signedJson = await signedRes.json().catch(() => ({}));
  if (!signedRes.ok) {
    throw new Error(
      String(signedJson?.error || "Impossible de préparer l'upload vidéo."),
    );
  }

  const storagePath = String(
    signedJson?.storagePath || signedJson?.path || path,
  );
  const token = String(signedJson?.token || "");
  if (!storagePath || !token) {
    throw new Error("Upload vidéo impossible : jeton Supabase manquant.");
  }

  const { createClient } = await import("@/lib/supabaseClient");
  const supabase = createClient();
  const { error } = await supabase.storage
    .from("booster")
    .uploadToSignedUrl(storagePath, token, file, {
      contentType: String(signedJson?.contentType || file.type || "video/mp4"),
    });

  if (error) {
    throw new Error(error.message || "Impossible d'uploader la vidéo.");
  }

  const publicUrl =
    String(signedJson?.publicUrl || "") ||
    supabase.storage.from("booster").getPublicUrl(storagePath).data.publicUrl;

  return {
    name: String(signedJson?.name || file.name),
    type: String(signedJson?.contentType || file.type || "video/mp4"),
    size: Number(signedJson?.size || file.size || 0),
    lastModified: file.lastModified,
    duration: typeof options?.duration === "number" ? options.duration : null,
    sourceMetadata: options?.sourceMetadata || null,
    storagePath,
    publicUrl,
    url: publicUrl,
  };
}

export function clampPercent(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function loadImageElementFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image illisible."));
    });
    img.src = url;
    return await loaded;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  }
}

async function compressImageBlobForUpload(blob: Blob): Promise<Blob> {
  if (typeof window === "undefined" || typeof document === "undefined")
    return blob;
  if (!String(blob.type || "").startsWith("image/")) return blob;
  // Les PNG générés par l'adaptateur peuvent contenir de la transparence.
  // Ne jamais les convertir en JPEG, sinon les zones transparentes deviennent noires.
  if (/^image\/png$/i.test(blob.type || "")) return blob;
  if (/image\/(gif|svg\+xml|heic|heif|avif)/i.test(blob.type || ""))
    return blob;

  const img = await loadImageElementFromBlob(blob);
  const sourceWidth = Number(img.naturalWidth || img.width || 0);
  const sourceHeight = Number(img.naturalHeight || img.height || 0);
  if (!sourceWidth || !sourceHeight) return blob;

  const maxSide = 2500;
  const ratio = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * ratio));
  const height = Math.max(1, Math.round(sourceHeight * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return blob;
  ctx.drawImage(img, 0, 0, width, height);

  const jpegBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.84),
  );
  if (!jpegBlob) return blob;

  // On garde l'original si la compression ne gagne rien.
  return jpegBlob.size < blob.size ? jpegBlob : blob;
}

function withJpegExtension(name: string) {
  const safeName = sanitizeUploadName(name || "image");
  return safeName.replace(/\.[^.]+$/, "") + ".jpg";
}

type PreparedUploadCacheEntry = {
  storagePath: string;
  publicUrl: string;
};

// Cache mémoire de l'onglet : une image déjà envoyée pendant la préparation
// d'une publication n'est pas renvoyée si le même rendu est réutilisé sur un
// autre canal ou après une reprise immédiate. Le cache disparaît au rechargement.
const preparedUploadCache = new Map<string, PreparedUploadCacheEntry>();

export async function uploadBoosterImageFileDirect(params: {
  file: File;
  path: string;
  target?: "booster_prepared_image" | "booster_draft_image";
  clientMediaKey?: string | null;
}): Promise<PreparedUploadCacheEntry> {
  if (isUniversalMediaUploadEnabled()) {
    try {
      const result = await uploadUniversalMediaFile(params.file, {
        target: params.target || "booster_prepared_image",
        requestedPath: params.path,
        requestedFolder:
          params.target === "booster_draft_image"
            ? "booster-drafts"
            : "booster-prepublish",
        clientMediaKey: params.clientMediaKey || undefined,
        source: "booster",
      });
      if (!result.storagePath || !result.publicUrl) {
        throw new Error("L’URL publique du média préparé est indisponible.");
      }
      return {
        storagePath: result.storagePath,
        publicUrl: result.publicUrl,
      };
    } catch (error) {
      // L'ancien endpoint reste un secours temporaire tant que le pipeline
      // universel n'est pas certifié sur tous les parcours.
      console.warn("[media-pipeline] universal image upload fallback", error);
    }
  }

  const formData = new FormData();
  formData.append("file", params.file);
  formData.append("path", params.path);

  const response = await fetch("/api/booster/upload-prepared", {
    method: "POST",
    body: formData,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      String(json?.error || "Impossible d'uploader l'image préparée."),
    );
  }
  return {
    storagePath: String(json?.storagePath || ""),
    publicUrl: String(json?.publicUrl || ""),
  };
}

async function preparedUploadCacheKey(
  blob: Blob,
  fileName: string,
): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  try {
    const base = `${sanitizeUploadName(fileName)}:${blob.type}:${blob.size}`;
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    return `${base}:${hash}`;
  } catch {
    return null;
  }
}

export async function uploadPreparedImages(
  images: ImagePayload[],
  onProgress?: (current: number, total: number) => void,
): Promise<ImagePayload[]> {
  const uploaded: ImagePayload[] = [];
  const total = images.filter(
    (image) => !!image?.sourceFile || !!image?.dataUrl,
  ).length;
  let done = 0;

  for (const image of images) {
    const localFile = image?.sourceFile;
    if (!localFile && !image?.dataUrl) {
      uploaded.push(image);
      continue;
    }

    // Les photos originales sont envoyées directement comme File. On évite ainsi
    // File -> Base64 -> fetch(dataUrl) -> Blob, très coûteux et instable sur iPhone.
    const blob = localFile ?? (await dataUrlToBlob(String(image.dataUrl || "")));
    const uploadBlob = await compressImageBlobForUpload(blob);
    const uploadName =
      uploadBlob.type === "image/jpeg"
        ? withJpegExtension(image.name)
        : sanitizeUploadName(image.name);
    if (uploadBlob.size > BOOSTER_MAX_IMAGE_BYTES) {
      throw new Error(
        `Image préparée trop lourde. Taille maximale : ${BOOSTER_MAX_IMAGE_MB_LABEL}.`,
      );
    }
    const file = new File([uploadBlob], uploadName, {
      type:
        uploadBlob.type ||
        image.type ||
        blob.type ||
        "application/octet-stream",
    });
    const cacheKey = await preparedUploadCacheKey(uploadBlob, uploadName);
    let cachedUpload = cacheKey
      ? preparedUploadCache.get(cacheKey) || null
      : null;

    if (!cachedUpload) {
      cachedUpload = await uploadBoosterImageFileDirect({
        file,
        path: buildBoosterUploadPath(image.name),
        target: "booster_prepared_image",
        clientMediaKey: cacheKey,
      });
      if (cacheKey && cachedUpload.storagePath && cachedUpload.publicUrl) {
        if (preparedUploadCache.size >= 300) {
          const oldestKey = preparedUploadCache.keys().next().value;
          if (oldestKey) preparedUploadCache.delete(oldestKey);
        }
        preparedUploadCache.set(cacheKey, cachedUpload);
      }
    }

    const serializableImage = { ...image };
    delete serializableImage.sourceFile;
    uploaded.push({
      ...serializableImage,
      dataUrl: undefined,
      name: image.name,
      type:
        uploadBlob.type ||
        image.type ||
        blob.type ||
        "application/octet-stream",
      storagePath: cachedUpload.storagePath,
      publicUrl: cachedUpload.publicUrl,
    });
    done += 1;
    onProgress?.(done, total);
  }

  if (!total) onProgress?.(0, 0);

  return uploaded;
}

export async function renderChannelImage(params: {
  file: File;
  transform: ImageTransform;
  preset: RenderPreset;
  channel?: ChannelKey;
}): Promise<ImagePayload> {
  const { file, transform, preset, channel } = params;
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadHtmlImage(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = preset.width;
    canvas.height = preset.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponible.");

    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const baseScale =
      transform.fit === "cover"
        ? Math.max(cw / iw, ch / ih)
        : Math.min(cw / iw, ch / ih);
    const scale = baseScale * getEffectiveTransformZoom(transform);
    const drawW = iw * scale;
    const drawH = ih * scale;
    const maxX = Math.abs(drawW - cw) / 2;
    const maxY = Math.abs(drawH - ch) / 2;
    const dx =
      (cw - drawW) / 2 -
      (maxX * clamp(transform.offsetX || 0, -100, 100)) / 100;
    const dy =
      (ch - drawH) / 2 -
      (maxY * clamp(transform.offsetY || 0, -100, 100)) / 100;

    ctx.clearRect(0, 0, cw, ch);

    const requestedBackgroundMode = getBackgroundMode(transform);
    const googleBusinessSafeBackground =
      channel === "gmb" && requestedBackgroundMode === "transparent";
    const backgroundMode = googleBusinessSafeBackground
      ? "color"
      : requestedBackgroundMode;
    const backgroundColor = googleBusinessSafeBackground
      ? "#ffffff"
      : transform.backgroundColor;
    if (backgroundMode !== "transparent") {
      ctx.fillStyle = getBackgroundFill(backgroundMode, backgroundColor);
      ctx.fillRect(0, 0, cw, ch);
    }

    ctx.drawImage(img, dx, dy, drawW, drawH);

    const exportAsPng = backgroundMode === "transparent";
    const outputType = exportAsPng ? "image/png" : "image/jpeg";
    const dataUrl = canvas.toDataURL(outputType, 0.92);
    return {
      name:
        file.name.replace(/\.[^.]+$/, "") +
        `-${preset.width}x${preset.height}.${exportAsPng ? "png" : "jpg"}`,
      type: outputType,
      dataUrl,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function getDefaultTransform(channel: ChannelKey): ImageTransform {
  const preset = CHANNEL_PRESETS[channel];
  return {
    fit: preset.defaultFit,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    blurBackground: false,
    backgroundMode:
      preset.defaultFit === "contain"
        ? getBoosterImageSafetyBackgroundMode(channel)
        : "black",
  };
}

export function getOptimizedTransform(
  channel: ChannelKey,
  meta?: ImageMeta,
): ImageTransform {
  const base = getDefaultTransform(channel);
  const displayPlan = getBoosterImageDisplayPlan({ channel, meta });

  if (displayPlan.decision.mode === "adapted") {
    const fit = displayPlan.automaticFit;
    return withBackgroundMode(
      {
        ...base,
        fit,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
        blurBackground: false,
        backgroundColor: undefined,
      },
      fit === "contain"
        ? getBoosterImageSafetyBackgroundMode(channel)
        : "black",
    );
  }

  // Automatic Originale state: the publication path keeps the source ratio.
  // This neutral transform is only the Adapter reference, not a forced canvas.
  return withBackgroundMode(
    {
      ...base,
      fit: "contain",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      blurBackground: false,
      backgroundColor: "#ffffff",
    },
    "color",
  );
}

export async function readImageMeta(file: File): Promise<ImageMeta> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadHtmlImage(objectUrl);
    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;
    return {
      width,
      height,
      ratio: width && height ? width / height : 1,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function syncChannelImageEditors(params: {
  previous: Partial<Record<ChannelKey, ChannelImageEditorState>>;
  imageKeys: string[];
  selectedChannels: ChannelKey[];
  imageMetaByKey?: Record<string, ImageMeta>;
}): Partial<Record<ChannelKey, ChannelImageEditorState>> {
  const { previous, imageKeys, selectedChannels, imageMetaByKey = {} } = params;
  const next: Partial<Record<ChannelKey, ChannelImageEditorState>> = {};

  for (const channel of selectedChannels) {
    const prevState = previous[channel];
    const supportsImages = channelSupportsImages(channel);
    const mergedKeys = mergeBoosterChannelImageSelection({
      availableKeys: imageKeys,
      previousSelectedKeys: prevState?.imageKeys,
      previousAvailableKeys: prevState?.synchronizedImageKeys,
      supportsImages,
    });
    const transforms: Record<string, ImageTransform> = {};
    if (channelSupportsImages(channel)) {
      for (const key of imageKeys) {
        transforms[key] = prevState?.transforms?.[key]
          ? { ...prevState.transforms[key] }
          : getOptimizedTransform(channel, imageMetaByKey[key]);
      }
    }
    const customizedImageKeys = (prevState?.customizedImageKeys || []).filter(
      (key) => imageKeys.includes(key),
    );
    next[channel] = {
      imageKeys: mergedKeys,
      transforms,
      customizedImageKeys,
      synchronizedImageKeys: [...imageKeys],
    };
  }

  return next;
}
