"use client";

import { useLocale, useTranslations } from "next-intl";


import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { confirmInrcy } from "@/lib/inrcyDialog";
import EmojiPickerButton from "@/app/dashboard/_components/EmojiPickerButton";
import AiContentReportButton from "@/app/dashboard/_components/AiContentReportButton";
import AiConfigurationIcon from "@/app/dashboard/_components/AiConfigurationIcon";
import PublishAiConfigurationDrawer from "@/app/dashboard/booster/publier/components/PublishAiConfigurationDrawer";
import { MODULE_SNAPSHOT_KEYS, readModuleSnapshot, writeModuleSnapshot } from "@/lib/browserModuleSnapshotCache";
import styles from "./eReputation.module.css";

type ReputationTranslator = (
  key: string,
  values?: Record<string, string | number | boolean>,
) => string;

export type EReputationPlatformId = "google";

export type EReputationReviewItem = {
  id: string;
  platform?: EReputationPlatformId;
  reviewName: string | null;
  name: string;
  rating: number;
  date: string;
  status: "À répondre" | "Répondu" | "À traiter";
  comment: string;
  originalComment?: string | null;
  translatedComment?: string | null;
  reply?: string | null;
  live?: boolean;
  replyable?: boolean;
  verified?: boolean;
};

export type EReputationReviewsPlatform = {
  id: EReputationPlatformId;
  label: string;
  shortLabel: string;
  iconSrc: string;
  modalKicker: string;
  replyLabel: string;
  reviews: EReputationReviewItem[];
  reviewsReady: boolean;
  reviewsError: string | null;
  initialNextPageToken?: string | null;
  totalReviewCount?: number;
  averageRatingLabel?: string;
  locationLabel?: string;
  statusLabel?: string;
  connected?: boolean;
  canReply?: boolean;
  reportUrl?: string | null;
  profileUrl?: string | null;
  inviteUrl?: string | null;
};

type Props = {
  reviews: EReputationReviewItem[];
  reviewsReady: boolean;
  reviewsError: string | null;
  initialNextPageToken?: string | null;
  totalReviewCount?: number;
  averageRatingLabel?: string;
  locationLabel?: string;
  statusLabel?: string;
  gmbReady?: boolean;
  reportGoogleUrl?: string | null;
  platforms?: EReputationReviewsPlatform[];
};

type ReplyResponse = {
  ok?: boolean;
  error?: string;
  user_message?: string;
  reviewName?: string;
  replyStatus?: "answered" | "unanswered";
  reply?: {
    comment?: string;
    updateTime?: string | null;
  } | null;
};

type GenerateReplyResponse = {
  ok?: boolean;
  error?: string;
  user_message?: string;
  reply_text?: string;
};

type ApiReview = {
  name?: string | null;
  reviewId?: string | null;
  reviewerName?: string | null;
  starRating?: number | null;
  rating?: number | null;
  title?: string | null;
  comment?: string | null;
  originalComment?: string | null;
  translatedComment?: string | null;
  createTime?: string | null;
  updateTime?: string | null;
  replyStatus?: "answered" | "unanswered" | string;
  reply?: {
    comment?: string | null;
    updateTime?: string | null;
  } | null;
  isVerified?: boolean | null;
  replyable?: boolean | null;
};

type ReviewsResponse = {
  error?: string;
  user_message?: string;
  connected?: boolean;
  configured?: boolean;
  locationTitle?: string | null;
  reportUrl?: string | null;
  averageRating?: number | null;
  nextPageToken?: string | null;
  totalReviewCount?: number;
  reviews?: ApiReview[];
};

const REVIEWS_PAGE_SIZE = 50;

function renderStars(rating: number) {
  return Array.from({ length: 5 }, (_, index) => (
    <span key={index} className={index < rating ? styles.starOn : styles.starOff} aria-hidden="true">
      ★
    </span>
  ));
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pickVariant<T>(variants: T[], seed: number) {
  if (!variants.length) throw new Error("Aucune variante disponible.");
  return variants[Math.abs(seed) % variants.length];
}

function getReviewerFirstName(name: string) {
  const firstName = String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")[0]
    ?.replace(/[^A-Za-zÀ-ÿ'’-]/g, "")
    .trim();

  if (!firstName || firstName.length < 2) return "";
  if (["client", "google", "user", "utilisateur"].includes(firstName.toLowerCase())) return "";
  return firstName;
}

function reviewHasWrittenComment(review: EReputationReviewItem | null) {
  if (!review) return false;
  if (review.live) return Boolean(compactReviewText(review.originalComment));
  return Boolean(getReviewOriginalText(review));
}

function joinWithOptionalSignature(text: string, seed: number, t: ReputationTranslator) {
  const signature = pickVariant(["", "", "", `\n${t("team_signature")}`], seed + 17);
  return `${text}${signature}`.trim();
}

function defaultReplyFor(review: EReputationReviewItem | null, t: ReputationTranslator) {
  if (!review) return "";
  if (review.reply) return review.reply;

  const seed = stableHash([review.id, review.name, review.rating, getReviewOriginalText(review), review.date].join("|"));
  const firstName = getReviewerFirstName(review.name);
  const withComment = reviewHasWrittenComment(review);
  let variants: Array<{ key: string; nameStyle: "direct" | "comma" }> = [];

  if (review.rating >= 5) {
    variants = withComment
      ? [
          { key: "merci_value_pour_votre_retour_si_f0c2ab82", nameStyle: "direct" },
          { key: "un_grand_merci_value_pour_votre_68c38539", nameStyle: "direct" },
          { key: "merci_beaucoup_value_pour_ce_tres_563e04eb", nameStyle: "direct" },
          { key: "merci_value_pour_votre_commentaire_et_d30ebbd5", nameStyle: "direct" },
        ]
      : [
          { key: "merci_beaucoup_value_pour_votre_excellente_a012072c", nameStyle: "direct" },
          { key: "un_grand_merci_value_pour_vos_a4686f98", nameStyle: "direct" },
          { key: "merci_value_pour_cette_tres_belle_3b6ca1d1", nameStyle: "direct" },
          { key: "merci_infiniment_value_pour_votre_note_3f2a9070", nameStyle: "direct" },
        ];
  } else if (review.rating === 4) {
    variants = withComment
      ? [
          { key: "merci_value_pour_votre_retour_et_7a6b283c", nameStyle: "direct" },
          { key: "merci_beaucoup_value_pour_votre_avis_ff352f28", nameStyle: "direct" },
          { key: "merci_value_pour_votre_confiance_et_b5a214f5", nameStyle: "direct" },
          { key: "un_grand_merci_value_pour_votre_af57b469", nameStyle: "direct" },
        ]
      : [
          { key: "merci_beaucoup_value_pour_votre_note_a5d924e4", nameStyle: "direct" },
          { key: "merci_value_pour_cette_belle_note_5595bdae", nameStyle: "direct" },
          { key: "un_grand_merci_value_pour_votre_032c55c8", nameStyle: "direct" },
          { key: "merci_value_pour_votre_retour_toute_ece727a1", nameStyle: "direct" },
        ];
  } else if (review.rating === 3) {
    variants = [
      { key: "merci_value_pour_votre_retour_nous_8a13bc92", nameStyle: "direct" },
      { key: "merci_value_d_avoir_pris_le_9021204e", nameStyle: "direct" },
      { key: "merci_pour_votre_evaluation_value_nous_e5421e2d", nameStyle: "comma" },
      { key: "merci_value_pour_votre_avis_nous_80996010", nameStyle: "direct" },
    ];
  } else {
    variants = [
      { key: "merci_value_d_avoir_pris_le_03cb2ebc", nameStyle: "direct" },
      { key: "merci_pour_votre_retour_value_nous_de42f06e", nameStyle: "comma" },
      { key: "merci_value_pour_votre_message_nous_aea336d4", nameStyle: "direct" },
      { key: "merci_d_avoir_partage_votre_avis_94bf4a38", nameStyle: "comma" },
    ];
  }

  const variant = pickVariant(variants, seed);
  const name = firstName
    ? variant.nameStyle === "comma"
      ? `, ${firstName}`
      : ` ${firstName}`
    : "";
  return joinWithOptionalSignature(t(variant.key, { value0: name }), seed, t);
}

function getErrorMessage(payload: ReplyResponse | GenerateReplyResponse | ReviewsResponse | null, fallback: string) {
  void payload;
  return fallback;
}

function formatReviewDate(value: string | null | undefined, locale: string, t: ReputationTranslator) {
  if (!value) return t("date_non_precisee_4bef7159");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("date_non_precisee_4bef7159");
  return date.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
}

function platformDefaultReviewer(_platform: EReputationPlatformId, t: ReputationTranslator) {
  return t("client_google");
}

function toReviewItem(
  review: ApiReview,
  platform: EReputationPlatformId,
  locale: string,
  t: ReputationTranslator,
): EReputationReviewItem {
  const reviewName = String(review.name || review.reviewId || "").trim() || null;
  const reviewId = String(review.reviewId || reviewName || Math.random().toString(36).slice(2)).trim();
  const hasReply = review.replyStatus === "answered" || Boolean(review.reply?.comment);
  const rating = Math.min(5, Math.max(0, Math.round(Number(review.starRating ?? review.rating ?? 0)))) || 0;
  const parsedComment = splitGoogleReviewText(review.comment);
  const originalComment = cleanGoogleReviewText(review.originalComment) || parsedComment.original;
  const translatedComment = cleanGoogleReviewText(review.translatedComment) || parsedComment.translated;
  const cleanComment = originalComment || cleanGoogleReviewText(review.comment) || translatedComment;
  const cleanReply = cleanGoogleReviewText(review.reply?.comment);

  return {
    id: `${platform}:${reviewName || reviewId}`,
    platform,
    reviewName: reviewName || reviewId,
    name: String(review.reviewerName || platformDefaultReviewer(platform, t)).trim() || platformDefaultReviewer(platform, t),
    rating,
    date: formatReviewDate(review.updateTime || review.createTime, locale, t),
    status: hasReply ? "Répondu" : rating > 0 && rating <= 3 ? "À traiter" : "À répondre",
    comment: cleanComment || t("avis_sans_commentaire_ecrit_3e602596"),
    originalComment: originalComment || cleanComment || null,
    translatedComment: translatedComment || null,
    reply: cleanReply || null,
    live: true,
    replyable: review.replyable !== false,
    verified: Boolean(review.isVerified),
  };
}

function mergeReviews(current: EReputationReviewItem[], incoming: EReputationReviewItem[]) {
  const map = new Map<string, EReputationReviewItem>();
  for (const item of current) map.set(item.id, item);
  for (const item of incoming) map.set(item.id, item);
  return Array.from(map.values());
}

function isTodo(review: EReputationReviewItem) {
  return review.status !== "Répondu";
}

function compactReviewText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanGoogleReviewText(value: string | null | undefined) {
  return compactReviewText(value)
    .replace(/\(\s*(?:Translated by Google|Traduit par Google|Translation by Google|Traduction Google)\s*\)\s*/gi, "")
    .replace(/\(\s*(?:Original|Texte original)\s*\)\s*/gi, "")
    .trim();
}

function splitGoogleReviewText(value: string | null | undefined) {
  const text = compactReviewText(value);
  if (!text) return { original: "", translated: "" };
  const translatedMarker = /\(\s*(?:Translated by Google|Traduit par Google|Translation by Google|Traduction Google)\s*\)/i;
  const originalMarker = /\(\s*(?:Original|Texte original)\s*\)/i;
  const translatedMatch = translatedMarker.exec(text);
  const originalMatch = originalMarker.exec(text);

  if (originalMatch) {
    const original = cleanGoogleReviewText(text.slice(originalMatch.index + originalMatch[0].length));
    const translatedSource = translatedMatch && translatedMatch.index < originalMatch.index
      ? text.slice(translatedMatch.index + translatedMatch[0].length, originalMatch.index)
      : text.slice(0, originalMatch.index);
    const translated = cleanGoogleReviewText(translatedSource);
    return { original, translated };
  }

  return { original: cleanGoogleReviewText(text), translated: "" };
}

function getReviewOriginalText(review: EReputationReviewItem | null) {
  if (!review) return "";
  const parsed = splitGoogleReviewText(review.comment);
  return cleanGoogleReviewText(review.originalComment) || parsed.original || cleanGoogleReviewText(review.comment);
}

function getReviewTranslatedText(review: EReputationReviewItem | null) {
  if (!review) return "";
  const parsed = splitGoogleReviewText(review.comment);
  return cleanGoogleReviewText(review.translatedComment) || parsed.translated;
}

function truncateText(review: EReputationReviewItem, max = 110) {
  const source = getReviewOriginalText(review) || review.comment;
  const clean = source;
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}…`;
}

function reviewStatusLabel(status: EReputationReviewItem["status"], t: ReputationTranslator) {
  if (status === "Répondu") return t("status_answered");
  if (status === "À traiter") return t("status_to_handle");
  return t("a_repondre_6f7c5ab8");
}

function renderMultilineText(value: string) {
  return value
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => <p key={`${index}-${part.slice(0, 16)}`}>{part}</p>);
}

function ReviewTextBlock({ review }: { review: EReputationReviewItem }) {
  const i18nT = useTranslations("reputation");
  const original = getReviewOriginalText(review);
  const translated = getReviewTranslatedText(review);

  if (translated && original) {
    return (
      <div className={styles.reviewLanguageGroup}>
        <div className={styles.reviewLanguageBlock}>
          <span className={styles.reviewLanguageLabel}>{i18nT("version_originale_4f69bd3a")}</span>
          <div className={styles.reviewLanguageText}>{renderMultilineText(original)}</div>
        </div>
        <div className={styles.reviewLanguageBlock}>
          <span className={styles.reviewLanguageLabel}>{i18nT("version_traduite_par_google_374a8b9f")}</span>
          <div className={styles.reviewLanguageText}>{renderMultilineText(translated)}</div>
        </div>
      </div>
    );
  }

  return <div className={styles.reviewLanguageText}>{renderMultilineText(original || i18nT("avis_sans_commentaire_ecrit_3e602596"))}</div>;
}

function buildDefaultPlatform(props: Props, t: ReputationTranslator): EReputationReviewsPlatform {
  return {
    id: "google",
    label: "Google",
    shortLabel: "Google",
    iconSrc: "/icons/google.jpg",
    modalKicker: t("avis_google_7cf4e619"),
    replyLabel: t("reponse_google_447ce1c4"),
    reviews: props.reviews.map((review) => ({ ...review, platform: "google" as const, replyable: review.replyable !== false })),
    reviewsReady: props.reviewsReady,
    reviewsError: props.reviewsError,
    initialNextPageToken: props.initialNextPageToken || null,
    totalReviewCount: props.totalReviewCount || 0,
    averageRatingLabel: props.averageRatingLabel || "—",
    locationLabel: props.locationLabel || t("fiche_google_business_09b337dd"),
    statusLabel: props.statusLabel || t("synchronisation_google_0008de4a"),
    connected: props.gmbReady,
    canReply: props.gmbReady,
    reportUrl: props.reportGoogleUrl || null,
  };
}

function normalizePlatform(platform: EReputationReviewsPlatform): EReputationReviewsPlatform {
  return {
    ...platform,
    reviews: platform.reviews.map((review) => ({ ...review, platform: platform.id, replyable: review.replyable !== false })),
    initialNextPageToken: platform.initialNextPageToken || null,
    totalReviewCount: platform.totalReviewCount || 0,
    averageRatingLabel: platform.averageRatingLabel || "—",
    locationLabel: platform.locationLabel || platform.label,
    statusLabel: platform.statusLabel || platform.label,
    connected: Boolean(platform.connected),
    canReply: Boolean(platform.canReply),
  };
}

function apiBaseFor(_platform: EReputationPlatformId) {
  return "/api/e-reputation/google";
}

function formatAverageRating(value: number | null | undefined, locale: string) {
  if (!Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function platformFromSnapshot(
  platform: EReputationReviewsPlatform,
  snapshot: ReviewsResponse | null,
  locale: string,
  t: ReputationTranslator,
): EReputationReviewsPlatform {
  if (!snapshot) return platform;
  const connected = Boolean(snapshot.connected);
  const configured = Boolean(snapshot.configured);
  const ready = connected && configured;
  const cachedReviews = Array.isArray(snapshot.reviews)
    ? snapshot.reviews.map((review) => toReviewItem(review, platform.id, locale, t))
    : [];

  return normalizePlatform({
    ...platform,
    reviews: ready ? cachedReviews : platform.reviews,
    reviewsReady: ready,
    reviewsError: null,
    initialNextPageToken: snapshot.nextPageToken || null,
    totalReviewCount: Number.isFinite(Number(snapshot.totalReviewCount))
      ? Number(snapshot.totalReviewCount)
      : cachedReviews.length,
    averageRatingLabel: ready ? formatAverageRating(snapshot.averageRating, locale) : "—",
    locationLabel: String(snapshot.locationTitle || platform.locationLabel || t("fiche_google_business_09b337dd")),
    statusLabel: ready
      ? t("google_reviews_loaded")
      : connected
        ? t("establishment_to_choose")
        : t("google_business_to_connect"),
    connected,
    canReply: ready,
    reportUrl: snapshot.reportUrl || platform.reportUrl || null,
    profileUrl: snapshot.reportUrl || platform.profileUrl || null,
  });
}

export default function EReputationReviewsClient(props: Props) {
  const i18nT = useTranslations("reputation");
  const locale = useLocale();
  const runtimeT = i18nT as unknown as ReputationTranslator;
  const normalizedPlatforms = useMemo(() => {
    const source = props.platforms?.length ? props.platforms : [buildDefaultPlatform(props, runtimeT)];
    return source.map(normalizePlatform);
  }, [i18nT, props.platforms, props.reviews, props.reviewsReady, props.reviewsError, props.initialNextPageToken, props.totalReviewCount, props.averageRatingLabel, props.locationLabel, props.statusLabel, props.gmbReady, props.reportGoogleUrl]);

  const [platformData, setPlatformData] = useState<EReputationReviewsPlatform[]>(() => {
    const snapshot = readModuleSnapshot<ReviewsResponse>(MODULE_SNAPSHOT_KEYS.eReputationGoogle)?.data ?? null;
    return normalizedPlatforms.map((platform) => platform.id === "google" ? platformFromSnapshot(platform, snapshot, locale, runtimeT) : platform);
  });
  const [activePlatformId, setActivePlatformId] = useState<EReputationPlatformId>(() => {
    const initial = platformData.find((platform) => platform.connected) || platformData[0];
    return initial?.id || "google";
  });
  const [filter, setFilter] = useState<"all" | "todo" | "answered">("all");
  const [starFilter, setStarFilter] = useState<"all" | "5" | "4" | "3" | "2" | "1">("all");
  const [query, setQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedId, setSelectedId] = useState(platformData[0]?.reviews[0]?.id || "");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [replyText, setReplyText] = useState(defaultReplyFor(platformData[0]?.reviews[0] || null, runtimeT));
  const [aiReplyGenerated, setAiReplyGenerated] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [listNotice, setListNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [aiConfigurationOpen, setAiConfigurationOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const replySelectionRef = useRef<{ start: number; end: number } | null>(null);
  const backgroundRefreshRef = useRef<(silent?: boolean) => Promise<void>>(async () => undefined);
  const refreshedPlatformRef = useRef<EReputationPlatformId | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobile(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.("change", update);
    return () => mediaQuery.removeEventListener?.("change", update);
  }, []);

  const activePlatform = platformData.find((platform) => platform.id === activePlatformId) || platformData[0] || normalizePlatform(buildDefaultPlatform(props, runtimeT));
  const items = activePlatform.reviews;
  const nextPageToken = activePlatform.initialNextPageToken || null;
  const reviewsReady = activePlatform.reviewsReady;
  const reviewsError = activePlatform.reviewsError;
  const platformApiBase = apiBaseFor(activePlatform.id);
  const platformLabel = activePlatform.label;
  const platformShortLabel = activePlatform.shortLabel || activePlatform.label;
  const platformCanReply = Boolean(activePlatform.canReply);

  function updateActivePlatform(updater: (platform: EReputationReviewsPlatform) => EReputationReviewsPlatform) {
    setPlatformData((current) => current.map((platform) => platform.id === activePlatform.id ? updater(platform) : platform));
  }

  function setItems(next: EReputationReviewItem[] | ((current: EReputationReviewItem[]) => EReputationReviewItem[])) {
    updateActivePlatform((platform) => ({
      ...platform,
      reviews: typeof next === "function" ? next(platform.reviews) : next,
    }));
  }

  function setNextPageToken(next: string | null) {
    updateActivePlatform((platform) => ({ ...platform, initialNextPageToken: next }));
  }

  useEffect(() => {
    const first = activePlatform.reviews[0] || null;
    setCurrentPage(1);
    setSelectedId((current) => (activePlatform.reviews.some((review) => review.id === current) ? current : first?.id || ""));
    setReplyText(defaultReplyFor(first, runtimeT));
    setNotice(null);
    setListNotice(null);
  }, [activePlatform.id, i18nT]);

  const stats = useMemo(() => {
    const answered = items.filter((review) => review.status === "Répondu").length;
    const todo = items.length - answered;
    return { total: items.length, todo, answered };
  }, [items]);

  const selectedReview = items.find((review) => review.id === selectedId) || items[0] || null;

  const filteredReviews = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((review) => {
      if (filter === "todo" && !isTodo(review)) return false;
      if (filter === "answered" && review.status !== "Répondu") return false;
      if (starFilter !== "all" && review.rating !== Number(starFilter)) return false;
      if (!normalizedQuery) return true;
      return [review.name, review.comment, review.originalComment || "", review.translatedComment || "", review.reply || "", review.date, review.status]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [filter, items, query, starFilter]);

  const hasLocalFilter = filter !== "all" || starFilter !== "all" || query.trim().length > 0;
  const totalReviewCount = activePlatform.totalReviewCount || 0;
  const totalPages = Math.max(
    1,
    Math.ceil((hasLocalFilter ? filteredReviews.length : Math.max(totalReviewCount, filteredReviews.length)) / REVIEWS_PAGE_SIZE),
  );
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = (safeCurrentPage - 1) * REVIEWS_PAGE_SIZE;
  const paginatedReviews = filteredReviews.slice(pageStartIndex, pageStartIndex + REVIEWS_PAGE_SIZE);
  const firstDisplayedReview = paginatedReviews.length ? pageStartIndex + 1 : 0;
  const lastDisplayedReview = paginatedReviews.length ? pageStartIndex + paginatedReviews.length : 0;
  const footerTotalReviews = hasLocalFilter ? filteredReviews.length : Math.max(totalReviewCount, filteredReviews.length);

  const paginationItems = useMemo(() => {
    const pages: Array<number | "ellipsis"> = [];
    if (totalPages <= 7) {
      for (let page = 1; page <= totalPages; page += 1) pages.push(page);
      return pages;
    }
    const current = safeCurrentPage;
    const candidates = new Set([1, 2, totalPages - 1, totalPages, current - 1, current, current + 1]);
    const ordered = Array.from(candidates)
      .filter((page) => page >= 1 && page <= totalPages)
      .sort((a, b) => a - b);
    for (const page of ordered) {
      const previous = pages[pages.length - 1];
      if (typeof previous === "number" && page - previous > 1) pages.push("ellipsis");
      pages.push(page);
    }
    return pages;
  }, [safeCurrentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, query, starFilter, activePlatform.id]);

  useEffect(() => {
    if (filteredReviews.length === 0) return;
    if (!filteredReviews.some((review) => review.id === selectedId)) {
      setSelectedId(filteredReviews[0].id);
    }
  }, [filteredReviews, selectedId]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    setReplyText(defaultReplyFor(selectedReview, runtimeT));
    replySelectionRef.current = null;
    setNotice(null);
  }, [selectedReview?.id, i18nT]);

  useEffect(() => {
    if (!detailsOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [detailsOpen]);

  const busy = publishing || generating || deleting || loadingMore || refreshing;
  const selectedAlreadyAnswered = selectedReview?.status === "Répondu";
  const selectedCanReply = Boolean(selectedReview?.live && selectedReview.reviewName && selectedReview.replyable !== false && platformCanReply);
  const canGenerate = Boolean(selectedCanReply && !busy);
  const canPublish = Boolean(selectedCanReply && replyText.trim().length >= 2 && !busy);
  const canDelete = Boolean(selectedCanReply && selectedReview?.reply && !busy);
  const canReport = Boolean(selectedReview?.live && activePlatform.reportUrl && activePlatform.id === "google");
  const loadedLabel = totalReviewCount > 0 ? `${items.length.toLocaleString(locale)} / ${totalReviewCount.toLocaleString(locale)}` : items.length.toLocaleString(locale);
  const totalReviewsLabel = (totalReviewCount > 0 ? totalReviewCount : stats.total).toLocaleString(locale);
  const totalReviewsCaption = reviewsReady
    ? i18nT("review_quantity", { count: totalReviewsLabel })
    : i18nT("example_quantity", { count: totalReviewsLabel });
  const summaryStatusLabel = reviewsReady ? i18nT("reviews_loaded") : activePlatform.statusLabel || platformLabel;
  const summaryStatusShortLabel = reviewsReady ? i18nT("loaded_short") : activePlatform.statusLabel || platformShortLabel;
  const averageRatingLabel = activePlatform.averageRatingLabel || "—";
  const locationLabel = activePlatform.locationLabel || platformLabel;
  const selectedFilteredIndex = selectedReview
    ? filteredReviews.findIndex((review) => review.id === selectedReview.id)
    : -1;
  const detailTotalReviews = hasLocalFilter
    ? filteredReviews.length
    : Math.max(totalReviewCount, filteredReviews.length);
  const detailPosition = selectedFilteredIndex >= 0 ? selectedFilteredIndex + 1 : 0;
  const canGoToPreviousReview = selectedFilteredIndex > 0;
  const canGoToNextReview = selectedFilteredIndex >= 0 && (
    selectedFilteredIndex < filteredReviews.length - 1 ||
    (!hasLocalFilter && Boolean(nextPageToken))
  );
  const replyHasUnsavedChanges = Boolean(
    selectedReview && replyText.trim() !== defaultReplyFor(selectedReview, runtimeT).trim(),
  );

  function openDetails(review: EReputationReviewItem) {
    setSelectedId(review.id);
    setReplyText(defaultReplyFor(review, runtimeT));
    setAiReplyGenerated(false);
    replySelectionRef.current = null;
    setNotice(null);
    setDetailsOpen(true);
  }

  async function confirmReviewChange() {
    if (!replyHasUnsavedChanges) return true;
    return confirmInrcy({
      eyebrow: i18nT("reponse_non_publiee_432acc3a"),
      title: i18nT("changer_d_avis_70394e68"),
      message: i18nT("la_reponse_preparee_pour_cet_avis_e2f53bc1"),
      cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
      confirmLabel: i18nT("changer_d_avis_e7b9f76f"),
      variant: "warning",
    });
  }

  function selectReviewFromSequence(review: EReputationReviewItem, index: number) {
    setSelectedId(review.id);
    setReplyText(defaultReplyFor(review, runtimeT));
    setAiReplyGenerated(false);
    setCurrentPage(Math.floor(Math.max(0, index) / REVIEWS_PAGE_SIZE) + 1);
    replySelectionRef.current = null;
    setNotice(null);
  }

  async function requestCloseDetails() {
    if (!(await confirmReviewChange())) return;
    setDetailsOpen(false);
  }

  async function navigateReview(direction: "previous" | "next") {
    if (!selectedReview || loadingMore || publishing || generating || deleting) return;
    if (!(await confirmReviewChange())) return;

    const currentIndex = filteredReviews.findIndex((review) => review.id === selectedReview.id);
    if (currentIndex < 0) return;
    const targetIndex = direction === "previous" ? currentIndex - 1 : currentIndex + 1;

    if (targetIndex >= 0 && targetIndex < filteredReviews.length) {
      selectReviewFromSequence(filteredReviews[targetIndex], targetIndex);
      return;
    }

    if (direction !== "next" || hasLocalFilter || !nextPageToken) return;

    setLoadingMore(true);
    setListNotice(null);
    try {
      const payload = await requestReviews(nextPageToken);
      const mergedItems = mergeReviews(items, payload.incoming);
      updateActivePlatform((platform) => ({
        ...platform,
        reviews: mergedItems,
        initialNextPageToken: payload.nextToken,
        totalReviewCount: payload.total,
        reviewsReady: payload.ready,
        connected: payload.ready,
        canReply: payload.ready,
        locationLabel: payload.locationLabel,
        averageRatingLabel: payload.averageRatingLabel,
        statusLabel: payload.ready ? i18nT("google_reviews_loaded") : platform.statusLabel,
      }));
      const nextReview = mergedItems[currentIndex + 1];
      if (nextReview) selectReviewFromSequence(nextReview, currentIndex + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : i18nT("unable_load_next_review");
      setListNotice({ type: "error", text: message });
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!detailsOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editingText = Boolean(
        target?.isContentEditable ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "INPUT",
      );

      if (event.key === "Escape") {
        event.preventDefault();
        void requestCloseDetails();
      } else if (!editingText && event.key === "ArrowLeft" && canGoToPreviousReview) {
        event.preventDefault();
        void navigateReview("previous");
      } else if (!editingText && event.key === "ArrowRight" && canGoToNextReview) {
        event.preventDefault();
        void navigateReview("next");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [canGoToNextReview, canGoToPreviousReview, detailsOpen, replyHasUnsavedChanges, selectedReview?.id]);

  function saveReplySelection() {
    const textarea = replyTextareaRef.current;
    if (!textarea) return;
    replySelectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
  }

  function insertReplyEmoji(emoji: string) {
    const textarea = replyTextareaRef.current;
    if (!textarea) return;
    const selection = replySelectionRef.current || {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
    const nextText = `${replyText.slice(0, selection.start)}${emoji}${replyText.slice(selection.end)}`;
    const nextCursor = selection.start + emoji.length;
    setReplyText(nextText);
    replySelectionRef.current = { start: nextCursor, end: nextCursor };
    window.requestAnimationFrame(() => {
      const currentTextarea = replyTextareaRef.current;
      if (!currentTextarea) return;
      currentTextarea.focus({ preventScroll: true });
      currentTextarea.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function changePlatform(platformId: EReputationPlatformId) {
    if (platformId === activePlatform.id || busy) return;
    setActivePlatformId(platformId);
  }

  async function requestReviews(pageToken?: string | null) {
    const params = new URLSearchParams({ pageSize: String(REVIEWS_PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetch(`${platformApiBase}/reviews?${params.toString()}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as ReviewsResponse | null;

    if (!response.ok || !payload) {
      throw new Error(getErrorMessage(payload, i18nT("unable_load_reviews_source", { value0: platformLabel })));
    }

    // Le snapshot d'ouverture doit toujours rester la première page complète.
    // Un chargement "Suivant" ne doit pas remplacer le cache par un lot isolé.
    if (!pageToken) {
      writeModuleSnapshot(MODULE_SNAPSHOT_KEYS.eReputationGoogle, payload);
    }
    const connected = Boolean(payload.connected);
    const configured = Boolean(payload.configured);

    return {
      incoming: Array.isArray(payload.reviews) ? payload.reviews.map((review) => toReviewItem(review, activePlatform.id, locale, runtimeT)) : [],
      nextToken: payload.nextPageToken || null,
      total: Number.isFinite(Number(payload.totalReviewCount)) ? Number(payload.totalReviewCount) : activePlatform.totalReviewCount || 0,
      connected,
      configured,
      ready: connected && configured,
      locationLabel: String(payload.locationTitle || activePlatform.locationLabel || i18nT("fiche_google_business_09b337dd")),
      averageRatingLabel: connected && configured ? formatAverageRating(payload.averageRating, locale) : "—",
      reportUrl: payload.reportUrl || null,
    };
  }

  async function fetchReviews({ pageToken, replace }: { pageToken?: string | null; replace?: boolean } = {}) {
    const payload = await requestReviews(pageToken);
    updateActivePlatform((platform) => ({
      ...platform,
      reviews: payload.ready
        ? (replace ? payload.incoming : mergeReviews(platform.reviews, payload.incoming))
        : platform.reviews,
      initialNextPageToken: payload.nextToken,
      totalReviewCount: payload.total,
      reviewsReady: payload.ready,
      reviewsError: null,
      connected: payload.connected,
      canReply: payload.ready,
      locationLabel: payload.locationLabel,
      averageRatingLabel: payload.averageRatingLabel,
      reportUrl: payload.reportUrl || platform.reportUrl || null,
      profileUrl: payload.reportUrl || platform.profileUrl || null,
      statusLabel: payload.ready
        ? i18nT("google_reviews_loaded")
        : payload.connected
          ? i18nT("establishment_to_choose")
          : i18nT("google_business_to_connect"),
    }));
    setSelectedId((current) => {
      if (!replace && current) return current;
      return payload.incoming[0]?.id || current;
    });
    return payload.incoming.length;
  }

  async function refreshReviews(silent = false) {
    if (!silent) {
      setRefreshing(true);
      setListNotice(null);
    }
    try {
      const count = await fetchReviews({ replace: true });
      if (!silent) {
        setListNotice({
          type: "success",
          text: count > 0
            ? i18nT("reviews_refreshed_source", { value0: platformLabel })
            : i18nT("no_reviews_returned_source", { value0: platformLabel }),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : i18nT("unable_refresh_reviews_source", { value0: platformLabel });
      if (!silent) setListNotice({ type: "error", text: message });
      updateActivePlatform((platform) => ({ ...platform, reviewsError: message }));
    } finally {
      if (!silent) setRefreshing(false);
    }
  }

  useEffect(() => {
    backgroundRefreshRef.current = refreshReviews;
  });

  useEffect(() => {
    if (refreshedPlatformRef.current === activePlatform.id) return;
    refreshedPlatformRef.current = activePlatform.id;
    void backgroundRefreshRef.current(true);
  }, [activePlatform.id]);

  async function loadMoreReviews() {
    if (!nextPageToken || !reviewsReady) return;
    setLoadingMore(true);
    setListNotice(null);
    try {
      const count = await fetchReviews({ pageToken: nextPageToken });
      setListNotice({ type: "success", text: count > 0 ? i18nT("more_reviews_loaded") : i18nT("no_more_reviews") });
      if (count > 0) setCurrentPage((page) => page + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : i18nT("unable_load_following_reviews");
      setListNotice({ type: "error", text: message });
    } finally {
      setLoadingMore(false);
    }
  }

  async function goToPage(targetPage: number) {
    if (!reviewsReady || busy) return;
    const cleanTarget = Math.min(Math.max(targetPage, 1), totalPages);
    const requiredCount = (cleanTarget - 1) * REVIEWS_PAGE_SIZE + 1;

    if (hasLocalFilter || items.length >= requiredCount || !nextPageToken) {
      setCurrentPage(cleanTarget);
      return;
    }

    setLoadingMore(true);
    setListNotice(null);
    try {
      let accumulated = items;
      let token: string | null = nextPageToken;
      let total = activePlatform.totalReviewCount || 0;

      while (accumulated.length < requiredCount && token) {
        const payload = await requestReviews(token);
        accumulated = mergeReviews(accumulated, payload.incoming);
        token = payload.nextToken;
        total = payload.total;
        if (payload.incoming.length === 0) break;
      }

      setItems(accumulated);
      setNextPageToken(token);
      updateActivePlatform((platform) => ({ ...platform, totalReviewCount: total }));
      setCurrentPage(Math.min(cleanTarget, Math.max(1, Math.ceil(accumulated.length / REVIEWS_PAGE_SIZE))));
      setListNotice({ type: "success", text: i18nT("page_d_avis_chargee_ff57e1db") });
    } catch (error) {
      const message = error instanceof Error ? error.message : i18nT("unable_load_review_page");
      setListNotice({ type: "error", text: message });
    } finally {
      setLoadingMore(false);
    }
  }

  async function generateReply() {
    if (!selectedReview?.reviewName) return;
    setGenerating(true);
    setNotice(null);
    setListNotice(null);
    try {
      const response = await fetch(`${platformApiBase}/generate-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          reviewName: selectedReview.reviewName,
          reviewerName: selectedReview.name,
          rating: selectedReview.rating,
          comment: getReviewOriginalText(selectedReview) || selectedReview.comment,
          existingReply: selectedReview.reply || undefined,
        }),
      });
      const payload = (await response.json().catch(() => null)) as GenerateReplyResponse | null;
      if (!response.ok || !payload?.ok || !payload.reply_text) {
        throw new Error(getErrorMessage(payload, i18nT("impossible_de_generer_une_reponse_ia_ebc226a1")));
      }
      setReplyText(payload.reply_text);
      setAiReplyGenerated(true);
      setNotice({
        type: "success",
        text: selectedAlreadyAnswered
          ? i18nT("nouvelle_proposition_generee_relisez_la_puis_aa2473e8", { value0: platformLabel })
          : i18nT("reponse_generee_relisez_la_puis_publiez_ab165142", { value0: platformLabel }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : i18nT("impossible_de_generer_une_reponse_ia_ebc226a1");
      setNotice({ type: "error", text: message });
    } finally {
      setGenerating(false);
    }
  }

  async function publishReply() {
    if (!selectedReview?.reviewName) return;
    const cleanReply = replyText.trim();
    if (cleanReply.length < 2) {
      setNotice({ type: "error", text: i18nT("la_reponse_ne_peut_pas_etre_d4b602fe") });
      return;
    }
    setPublishing(true);
    setNotice(null);
    setListNotice(null);
    try {
      const response = await fetch(`${platformApiBase}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reviewName: selectedReview.reviewName, comment: cleanReply }),
      });
      const payload = (await response.json().catch(() => null)) as ReplyResponse | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(getErrorMessage(payload, i18nT("impossible_de_publier_la_reponse_value_a883eef2", { value0: platformLabel })));
      }
      const publishedComment = payload.reply?.comment || cleanReply;
      setItems((current) => current.map((review) => review.id === selectedReview.id ? { ...review, reply: publishedComment, status: "Répondu" } : review));
      setReplyText(publishedComment);
      setNotice({ type: "success", text: i18nT("reponse_publiee_sur_value_f848d3da", { value0: platformLabel }) });
    } catch (error) {
      const message = error instanceof Error ? error.message : i18nT("impossible_de_publier_la_reponse_value_a883eef2", { value0: platformLabel });
      setNotice({ type: "error", text: message });
    } finally {
      setPublishing(false);
    }
  }

  async function deleteReply() {
    if (!selectedReview?.reviewName || !selectedReview.reply) return;
    const confirmed = await confirmInrcy({
      eyebrow: i18nT("e_reputation_1d5febdc"),
      title: i18nT("supprimer_cette_reponse_a67330f4"),
      message: i18nT("la_reponse_publiee_sur_value_sera_4250c131", { value0: platformLabel }),
      confirmLabel: i18nT("supprimer_1acfc1c7"),
      cancelLabel: i18nT("annuler_49ba3292"),
      variant: "danger",
    });
    if (!confirmed) return;
    setDeleting(true);
    setNotice(null);
    setListNotice(null);
    try {
      const response = await fetch(`${platformApiBase}/reply`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reviewName: selectedReview.reviewName }),
      });
      const payload = (await response.json().catch(() => null)) as ReplyResponse | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(getErrorMessage(payload, i18nT("impossible_de_supprimer_la_reponse_value_9114adb7", { value0: platformLabel })));
      }
      setItems((current) => current.map((review) => review.id === selectedReview.id ? { ...review, reply: null, status: "À répondre" } : review));
      setReplyText(defaultReplyFor({ ...selectedReview, reply: null, status: "À répondre" }, runtimeT));
      setNotice({ type: "success", text: i18nT("reponse_supprimee_de_value_35d48b8f", { value0: platformLabel }) });
    } catch (error) {
      const message = error instanceof Error ? error.message : i18nT("impossible_de_supprimer_la_reponse_value_9114adb7", { value0: platformLabel });
      setNotice({ type: "error", text: message });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {aiConfigurationOpen && typeof document !== "undefined"
        ? createPortal(
            <PublishAiConfigurationDrawer
              open={aiConfigurationOpen}
              isMobile={isMobile}
              drawerHeight="100dvh"
              onClose={() => setAiConfigurationOpen(false)}
            />,
            document.body,
          )
        : null}
      <section className={styles.mailboxPanel} aria-label={i18nT("gestion_des_avis_value_3fa4a9b6", { value0: platformLabel })}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            {platformData.length > 1 ? (
              <div className={styles.platformTabs} role="tablist" aria-label={i18nT("plateformes_d_avis_df7d687b")}>
                {platformData.map((platform) => (
                  <button
                    key={platform.id}
                    type="button"
                    className={platform.id === activePlatform.id ? styles.platformTabActive : styles.platformTab}
                    onClick={() => changePlatform(platform.id)}
                    disabled={busy}
                    role="tab"
                    aria-selected={platform.id === activePlatform.id}
                  >
                    <img src={platform.iconSrc} alt="" aria-hidden="true" />
                    <span>{platform.shortLabel}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <label className={styles.filterLabel} htmlFor="review-filter">{i18nT("filtrer_a7a02ef5")}</label>
            <select id="review-filter" className={styles.select} value={filter} onChange={(event) => setFilter(event.target.value as "all" | "todo" | "answered")}>
              <option value="all">{i18nT("tous_les_avis_a5afe373")}</option>
              <option value="todo">{i18nT("a_repondre_6f7c5ab8")}</option>
              <option value="answered">{i18nT("repondus_c1c02d63")}</option>
            </select>
            <select id="review-star-filter" className={styles.select} value={starFilter} onChange={(event) => setStarFilter(event.target.value as "all" | "5" | "4" | "3" | "2" | "1")}>
              <option value="all">{i18nT("toutes_les_notes_6126cdb9")}</option>
              <option value="5">{i18nT("5_etoiles_ee75ad7d")}</option>
              <option value="4">{i18nT("4_etoiles_de837521")}</option>
              <option value="3">{i18nT("3_etoiles_1bb6d17b")}</option>
              <option value="2">{i18nT("2_etoiles_0b452909")}</option>
              <option value="1">{i18nT("1_etoile_cd0c0850")}</option>
            </select>
            <input className={styles.searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={i18nT("rechercher_un_avis_572722a7")} type="search" />
          </div>
          <div className={styles.toolbarRight}>
            <div className={`${styles.reputationSummaryChip} ${activePlatform.connected ? styles.reputationSummaryReady : ""}`} aria-label={i18nT("value_value_value_note_value_8e0d66cb", { value0: locationLabel, value1: summaryStatusLabel, value2: totalReviewsCaption, value3: averageRatingLabel })}>
              <span className={styles.summaryLocation}>{locationLabel}</span>
              <span className={styles.summaryStatus}>
                <span className={styles.summaryDot} aria-hidden="true" />
                <span className={styles.summaryStatusDesktop}>{summaryStatusLabel}</span>
                <span className={styles.summaryStatusMobile}>{summaryStatusShortLabel}</span>
              </span>
              <span>{totalReviewsCaption}</span>
              <span>{i18nT("note_value_e58cb214", { value0: averageRatingLabel })}</span>
            </div>
            <button
              type="button"
              className={`${styles.btnGhostSmall} ${styles.refreshButton}`}
              onClick={() => void refreshReviews()}
              disabled={busy}
              aria-label={refreshing ? i18nT("refreshing_reviews_aria") : i18nT("refresh_reviews_aria")}
              title={refreshing ? i18nT("actualisation_d6e57c7d") : i18nT("actualiser_9d3b2a7d")}
            >
              <span className={styles.refreshIcon} aria-hidden="true">⟳</span>
              <span className={styles.refreshText}>{refreshing ? i18nT("actualisation_d6e57c7d") : i18nT("actualiser_9d3b2a7d")}</span>
            </button>
          </div>
        </div>

        {reviewsError ? (
          <div className={styles.noticeError}>
            <strong>{i18nT("avis_indisponibles_4933ffc3")}</strong>
            <span>{reviewsError}</span>
          </div>
        ) : null}

        {!reviewsReady ? (
          <div className={`${styles.noticeInfo} ${styles.previewNotice}`}>
            <div className={styles.previewNoticeCopy}>
              <strong>{i18nT("avis_d_exemple_aucun_avis_google_a67550e6")}</strong>
              <span>{i18nT("les_lignes_ci_dessous_sont_fictives_a40db886")}</span>
            </div>
            <Link className={styles.connectGoogleCta} href="/dashboard?panel=gmb">
              <span aria-hidden="true">G</span>
              {i18nT("brancher_google_c497afba")}{" "}<span aria-hidden="true">→</span>
            </Link>
          </div>
        ) : null}

        {null}

        {listNotice ? <div className={listNotice.type === "success" ? styles.noticeSuccess : styles.noticeError} role="status">{listNotice.text}</div> : null}

        <div className={styles.tableWrap}>
          <table className={styles.reviewsTable}>
            <thead>
              <tr>
                <th>{i18nT("avis_69f2e194")}</th>
                <th>{i18nT("note_2c924e30")}</th>
                <th>{i18nT("statut_659499f3")}</th>
                <th>{i18nT("date_eb9a4bc1")}</th>
                <th>{i18nT("details_aaa029e6")}</th>
              </tr>
            </thead>
            <tbody>
              {paginatedReviews.length ? (
                paginatedReviews.map((review) => (
                  <tr
                    key={review.id}
                    className={`${review.id === selectedId ? styles.activeRow : ""} ${!reviewsReady ? styles.previewRow : ""}`.trim() || undefined}
                  >
                    <td>
                      <button type="button" className={styles.reviewMainCell} onClick={() => openDetails(review)}>
                        <strong>
                          {review.name}
                          {!reviewsReady ? <span className={styles.exampleBadge}>{i18nT("exemple_396e7bd8")}</span> : null}
                        </strong>
                        <span>{truncateText(review)}</span>
                        <span className={styles.mobileReviewMeta}>
                          <span className={styles.mobileReviewStars} aria-label={i18nT("value_etoiles_sur_5_d0131ac3", { value0: review.rating })}>{renderStars(review.rating)}</span>
                          <span className={review.status === "Répondu" ? styles.mobileStatusAnswered : styles.mobileStatusTodo}>{reviewStatusLabel(review.status, runtimeT)}</span>
                          <span>{review.date}</span>
                        </span>
                      </button>
                    </td>
                    <td><span className={styles.stars} aria-label={i18nT("value_etoiles_sur_5_d0131ac3", { value0: review.rating })}>{renderStars(review.rating)}</span></td>
                    <td><span className={review.status === "Répondu" ? styles.answeredBadge : styles.todoBadge}>{reviewStatusLabel(review.status, runtimeT)}</span></td>
                    <td>{review.date}</td>
                    <td>
                      <button type="button" className={styles.detailsBtn} onClick={() => openDetails(review)} aria-label={i18nT("ouvrir_le_detail_de_l_avis_387d2096", { value0: review.name })}>
                        ↗
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>
                    <div className={styles.emptyState}>
                      <strong>{i18nT("aucun_avis_dans_ce_filtre_9ec92ee7")}</strong>
                      <span>{i18nT("changez_de_filtre_ou_reclamez_de_37e61258")}</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.footerBar}>
          <span>
            {reviewsReady
              ? i18nT("value_value_charges_662e7e53", { value0: paginatedReviews.length
                ? i18nT("reviews_range", {
                    start: firstDisplayedReview.toLocaleString(locale),
                    end: lastDisplayedReview.toLocaleString(locale),
                    total: footerTotalReviews.toLocaleString(locale),
                  })
                : i18nT("no_reviews_displayed"), value1: loadedLabel })
              : i18nT("value_exemples_fictifs_affiches_56447aa0", { value0: paginatedReviews.length.toLocaleString(locale) })}
          </span>
          {reviewsReady ? (
            <div className={styles.paginationControls} aria-label={i18nT("pagination_des_avis_49f33c6b")}>
              <button type="button" className={styles.paginationArrow} onClick={() => goToPage(safeCurrentPage - 1)} disabled={busy || safeCurrentPage <= 1}>‹</button>
              {paginationItems.map((page, index) => page === "ellipsis" ? (
                <span key={`ellipsis-${index}`} className={styles.paginationEllipsis}>…</span>
              ) : (
                <button key={page} type="button" className={page === safeCurrentPage ? styles.paginationActive : styles.paginationPage} onClick={() => goToPage(page)} disabled={busy || page === safeCurrentPage}>{page}</button>
              ))}
              <button type="button" className={styles.paginationArrow} onClick={() => goToPage(safeCurrentPage + 1)} disabled={busy || safeCurrentPage >= totalPages || (!hasLocalFilter && !nextPageToken && items.length <= safeCurrentPage * REVIEWS_PAGE_SIZE)}>›</button>
            </div>
          ) : (
            <span className={styles.footerHint}>{i18nT("connexion_value_requise_72d0dbdd", { value0: platformLabel })}</span>
          )}
        </div>
      </section>

      {detailsOpen && selectedReview && typeof document !== "undefined"
        ? createPortal(
            <div
              className={styles.modalBackdrop}
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) void requestCloseDetails();
              }}
            >
              <section className={styles.detailsModal} role="dialog" aria-modal="true" aria-labelledby="review-details-title" onMouseDown={(event) => event.stopPropagation()}>
                <header className={styles.modalHeader}>
                  <span className={styles.modalKicker}>{activePlatform.modalKicker}</span>
                  <h2 id="review-details-title">{i18nT("details_de_l_avis_3fc3ec16")}</h2>
                  <div className={styles.reviewSequenceControls} aria-label={i18nT("navigation_entre_les_avis_f543661b")}>
                    <button
                      type="button"
                      className={styles.reviewSequenceButton}
                      onClick={() => void navigateReview("previous")}
                      disabled={!canGoToPreviousReview || busy}
                      aria-label={i18nT("avis_precedent_21f2a811")}
                      title={i18nT("avis_precedent_21f2a811")}
                    >
                      ‹
                    </button>
                    <span className={styles.reviewSequenceCounter} aria-live="polite">
                      {detailPosition.toLocaleString(locale)} / {detailTotalReviews.toLocaleString(locale)}
                    </span>
                    <button
                      type="button"
                      className={styles.reviewSequenceButton}
                      onClick={() => void navigateReview("next")}
                      disabled={!canGoToNextReview || busy}
                      aria-label={i18nT("avis_suivant_11787676")}
                      title={i18nT("avis_suivant_11787676")}
                    >
                      ›
                    </button>
                    <button
                      type="button"
                      className={`${styles.modalClose} ${styles.modalCloseIcon}`}
                      onClick={() => void requestCloseDetails()}
                      aria-label={i18nT("fermer_5ab4ec64")}
                      title={i18nT("fermer_5ab4ec64")}
                    >
                      ×
                    </button>
                  </div>
                </header>

                <div className={styles.modalBody}>
                  <article className={styles.reviewDetailCard}>
                    <div className={styles.reviewDetailTop}>
                      <div>
                        <strong>{selectedReview.name}</strong>
                        {!reviewsReady ? <span className={styles.exampleBadge}>{i18nT("exemple_avis_fictif_8d938cc5")}</span> : null}
                        <span>{selectedReview.date}{selectedReview.verified ? i18nT("avis_verifie_8d816987") : ""}</span>
                      </div>
                      <span className={selectedReview.status === "Répondu" ? styles.answeredBadge : styles.todoBadge}>{reviewStatusLabel(selectedReview.status, runtimeT)}</span>
                    </div>
                    <div className={styles.modalStars} aria-label={i18nT("value_etoiles_sur_5_d0131ac3", { value0: selectedReview.rating })}>{renderStars(selectedReview.rating)}</div>
                    <div className={styles.reviewDetailScroll}>
                      <ReviewTextBlock review={selectedReview} />
                      {selectedReview.reply ? (
                        <div className={styles.currentReplyBox}>
                          <strong>{i18nT("reponse_actuelle_00f1de26")}</strong>
                          <span>{selectedReview.reply}</span>
                        </div>
                      ) : null}
                    </div>
                    {canReport ? (
                      <div className={styles.reviewReportLine}>
                        <span>{i18nT("signaler_l_avis_sur_google_cfad97a3")}</span>
                        <a className={styles.reportReviewButton} href={activePlatform.reportUrl || "#"} target="_blank" rel="noreferrer" aria-label={i18nT("signaler_l_avis_de_value_sur_4b52223b", { value0: selectedReview.name })}>
                          <span aria-hidden="true">⚠</span>
                          <span className={styles.reportReviewTooltip}>{i18nT("signaler_l_avis_sur_google_cfad97a3")}</span>
                        </a>
                      </div>
                    ) : null}
                  </article>

                  <article className={styles.replyDetailCard}>
                    <div className={styles.replyHeaderLine}>
                      <span className={styles.modalKicker}>{activePlatform.replyLabel}</span>
                      <button
                        type="button"
                        className={`${styles.aiChip} ${styles.aiChipButton}`}
                        onClick={() => setAiConfigurationOpen(true)}
                        aria-label={i18nT("ouvrir_la_configuration_ia_a4ecd6d4")}
                        title={i18nT("configuration_ia_f620c8d8")}
                      >
                        <AiConfigurationIcon size={18} />
                      </button>
                    </div>
                    <div className={styles.replyHeaderTitleLine}>
                      <h3>{selectedAlreadyAnswered ? i18nT("modifier_la_reponse_46c5f616") : i18nT("preparer_la_reponse_4df89405")}</h3>
                      <EmojiPickerButton
                        onBeforeOpen={saveReplySelection}
                        onSelect={insertReplyEmoji}
                        disabled={!selectedCanReply || busy}
                        buttonStyle={{ minWidth: 34, height: 32, borderRadius: 10, border: "1px solid rgba(125,211,252,0.32)", background: "rgba(56,189,248,0.16)", color: "white", cursor: "pointer", fontSize: 17 }}
                      />
                    </div>
                    <textarea
                      ref={replyTextareaRef}
                      value={replyText}
                      onChange={(event) => setReplyText(event.target.value)}
                      onFocus={saveReplySelection}
                      onClick={saveReplySelection}
                      onSelect={saveReplySelection}
                      onKeyUp={saveReplySelection}
                      disabled={!selectedCanReply || busy}
                      maxLength={4096}
                      placeholder={i18nT("redigez_votre_reponse_value_35171dc3", { value0: platformLabel })}
                    />
                    <div className={styles.replyMetaRow}>
                      <div className={styles.charCount}>{i18nT("characters_count", { count: replyText.trim().length.toLocaleString(locale), max: (4096).toLocaleString(locale) })}</div>
                      {aiReplyGenerated ? (
                        <AiContentReportButton
                          className={styles.replyAiReportButton}
                          surface="e-reputation:reply"
                          content={replyText}
                        />
                      ) : null}
                    </div>
                    {notice ? <div className={notice.type === "success" ? styles.noticeSuccess : styles.noticeError} role="status">{notice.text}</div> : null}
                    <div className={styles.modalActions}>
                      <button className={styles.btnGhostSmall} type="button" disabled={!canGenerate} onClick={generateReply}>{generating ? i18nT("generation_839b5564") : i18nT("generer_avec_inrcy_bcf461c3")}</button>
                      <button className={styles.btnPrimarySmall} type="button" disabled={!canPublish} onClick={publishReply}>{publishing ? i18nT("publication_aa5ddada") : selectedAlreadyAnswered ? i18nT("modifier_la_reponse_46c5f616") : i18nT("publier_la_reponse_5d40615c")}</button>
                      {selectedAlreadyAnswered ? <button className={styles.btnDangerSmall} type="button" disabled={!canDelete} onClick={deleteReply}>{deleting ? i18nT("suppression_a67d695d") : i18nT("supprimer_1acfc1c7")}</button> : null}
                    </div>
                    <div className={styles.reportFooterLine}>
                      <p className={styles.secureText}>{i18nT("vous_validez_chaque_reponse_avant_publication_fc19200d", { value0: platformLabel })}</p>
                    </div>
                  </article>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
