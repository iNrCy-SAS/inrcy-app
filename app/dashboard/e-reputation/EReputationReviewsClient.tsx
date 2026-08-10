"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { confirmInrcy } from "@/lib/inrcyDialog";
import EmojiPickerButton from "@/app/dashboard/_components/EmojiPickerButton";
import PublishAiConfigurationDrawer from "@/app/dashboard/booster/publier/components/PublishAiConfigurationDrawer";
import { MODULE_SNAPSHOT_KEYS, readModuleSnapshot, writeModuleSnapshot } from "@/lib/browserModuleSnapshotCache";
import styles from "./eReputation.module.css";

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
  const text = getReviewOriginalText(review);
  return Boolean(text && !/avis sans commentaire écrit/i.test(text));
}

function joinWithOptionalSignature(text: string, seed: number) {
  const signature = pickVariant(["", "", "", "\n— L’équipe"], seed + 17);
  return `${text}${signature}`.trim();
}

function defaultReplyFor(review: EReputationReviewItem | null) {
  if (!review) return "";
  if (review.reply) return review.reply;

  const seed = stableHash([review.id, review.name, review.rating, getReviewOriginalText(review), review.date].join("|"));
  const firstName = getReviewerFirstName(review.name);
  const directName = firstName ? ` ${firstName}` : "";
  const commaName = firstName ? `, ${firstName}` : "";
  const withComment = reviewHasWrittenComment(review);
  let variants: string[] = [];

  if (review.rating >= 5) {
    variants = withComment
      ? [
          `Merci${directName} pour votre retour si positif. Nous sommes ravis de voir que notre accompagnement a répondu à vos attentes. Au plaisir de vous revoir bientôt !`,
          `Un grand merci${directName} pour votre confiance et pour votre avis. Toute l’équipe est heureuse d’avoir pu vous apporter satisfaction.`,
          `Merci beaucoup${directName} pour ce très beau retour. Votre satisfaction est une vraie récompense pour notre équipe.`,
          `Merci${directName} pour votre commentaire et votre excellente note. Nous sommes heureux d’avoir pu vous accompagner dans les meilleures conditions.`,
        ]
      : [
          `Merci beaucoup${directName} pour votre excellente note. Nous sommes ravis de votre confiance et espérons vous revoir prochainement.`,
          `Un grand merci${directName} pour vos 5 étoiles. Toute l’équipe vous remercie chaleureusement pour ce retour.`,
          `Merci${directName} pour cette très belle note. Votre satisfaction nous fait très plaisir.`,
          `Merci infiniment${directName} pour votre note. Nous sommes heureux d’avoir pu vous apporter une expérience positive.`,
        ];
  } else if (review.rating === 4) {
    variants = withComment
      ? [
          `Merci${directName} pour votre retour et pour cette belle note. Nous sommes heureux d’avoir pu vous satisfaire et restons attentifs à toujours faire encore mieux.`,
          `Merci beaucoup${directName} pour votre avis. Votre retour compte pour nous et nous motive à continuer dans cette direction.`,
          `Merci${directName} pour votre confiance et pour votre commentaire. Nous sommes ravis de votre satisfaction et prenons aussi en compte chaque détail pour progresser.`,
          `Un grand merci${directName} pour votre retour positif. Nous restons mobilisés pour vous offrir la meilleure expérience possible.`,
        ]
      : [
          `Merci beaucoup${directName} pour votre note et votre confiance. Nous sommes ravis de voir que votre expérience a été positive.`,
          `Merci${directName} pour cette belle note. Votre retour nous encourage à continuer avec le même sérieux.`,
          `Un grand merci${directName} pour votre évaluation. Nous espérons avoir le plaisir de vous accompagner à nouveau.`,
          `Merci${directName} pour votre retour. Toute l’équipe vous remercie pour cette belle note.`,
        ];
  } else if (review.rating === 3) {
    variants = [
      `Merci${directName} pour votre retour. Nous prenons bien en compte votre avis et restons à votre écoute si vous souhaitez nous préciser votre expérience.`,
      `Merci${directName} d’avoir pris le temps de partager votre avis. Votre retour nous aide à continuer à progresser.`,
      `Merci pour votre évaluation${commaName}. Nous restons disponibles si vous souhaitez échanger avec nous sur votre expérience.`,
      `Merci${directName} pour votre avis. Nous sommes attentifs à vos retours et disponibles pour en discuter si besoin.`,
    ];
  } else {
    variants = [
      `Merci${directName} d’avoir pris le temps de partager votre ressenti. Nous sommes désolés que votre expérience n’ait pas été pleinement satisfaisante et restons disponibles pour échanger avec vous.`,
      `Merci pour votre retour${commaName}. Nous prenons votre avis au sérieux et vous invitons à nous contacter afin que nous puissions mieux comprendre la situation.`,
      `Merci${directName} pour votre message. Nous regrettons que votre expérience n’ait pas répondu à vos attentes et restons à votre écoute pour en discuter.`,
      `Merci d’avoir partagé votre avis${commaName}. Nous restons disponibles pour échanger directement et mieux comprendre votre retour.`,
    ];
  }

  return joinWithOptionalSignature(pickVariant(variants, seed), seed);
}

function getErrorMessage(payload: ReplyResponse | GenerateReplyResponse | ReviewsResponse | null, fallback: string) {
  return payload?.user_message || payload?.error || fallback;
}

function formatReviewDate(value: string | null | undefined) {
  if (!value) return "Date non précisée";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date non précisée";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function platformDefaultReviewer(_platform: EReputationPlatformId) {
  return "Client Google";
}

function toReviewItem(review: ApiReview, platform: EReputationPlatformId): EReputationReviewItem {
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
    name: String(review.reviewerName || platformDefaultReviewer(platform)).trim() || platformDefaultReviewer(platform),
    rating,
    date: formatReviewDate(review.updateTime || review.createTime),
    status: hasReply ? "Répondu" : rating > 0 && rating <= 3 ? "À traiter" : "À répondre",
    comment: cleanComment || "Avis sans commentaire écrit.",
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
  const clean = getReviewOriginalText(review) || review.comment;
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}…`;
}

function renderMultilineText(value: string) {
  return value
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => <p key={`${index}-${part.slice(0, 16)}`}>{part}</p>);
}

function ReviewTextBlock({ review }: { review: EReputationReviewItem }) {
  const original = getReviewOriginalText(review);
  const translated = getReviewTranslatedText(review);

  if (translated && original) {
    return (
      <div className={styles.reviewLanguageGroup}>
        <div className={styles.reviewLanguageBlock}>
          <span className={styles.reviewLanguageLabel}>Version originale</span>
          <div className={styles.reviewLanguageText}>{renderMultilineText(original)}</div>
        </div>
        <div className={styles.reviewLanguageBlock}>
          <span className={styles.reviewLanguageLabel}>Version traduite par Google</span>
          <div className={styles.reviewLanguageText}>{renderMultilineText(translated)}</div>
        </div>
      </div>
    );
  }

  return <div className={styles.reviewLanguageText}>{renderMultilineText(original || "Avis sans commentaire écrit.")}</div>;
}

function buildDefaultPlatform(props: Props): EReputationReviewsPlatform {
  return {
    id: "google",
    label: "Google",
    shortLabel: "Google",
    iconSrc: "/icons/google.jpg",
    modalKicker: "Avis Google",
    replyLabel: "Réponse Google",
    reviews: props.reviews.map((review) => ({ ...review, platform: "google" as const, replyable: review.replyable !== false })),
    reviewsReady: props.reviewsReady,
    reviewsError: props.reviewsError,
    initialNextPageToken: props.initialNextPageToken || null,
    totalReviewCount: props.totalReviewCount || 0,
    averageRatingLabel: props.averageRatingLabel || "—",
    locationLabel: props.locationLabel || "Fiche Google Business",
    statusLabel: props.statusLabel || "Google Business",
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

function formatAverageRating(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function platformFromSnapshot(
  platform: EReputationReviewsPlatform,
  snapshot: ReviewsResponse | null,
): EReputationReviewsPlatform {
  if (!snapshot) return platform;
  const connected = Boolean(snapshot.connected);
  const configured = Boolean(snapshot.configured);
  const ready = connected && configured;
  const cachedReviews = Array.isArray(snapshot.reviews)
    ? snapshot.reviews.map((review) => toReviewItem(review, platform.id))
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
    averageRatingLabel: ready ? formatAverageRating(snapshot.averageRating) : "—",
    locationLabel: String(snapshot.locationTitle || platform.locationLabel || "Fiche Google Business"),
    statusLabel: ready
      ? "Avis Google chargés"
      : connected
        ? "Établissement à choisir"
        : "Google Business à connecter",
    connected,
    canReply: ready,
    reportUrl: snapshot.reportUrl || platform.reportUrl || null,
    profileUrl: snapshot.reportUrl || platform.profileUrl || null,
  });
}

export default function EReputationReviewsClient(props: Props) {
  const normalizedPlatforms = useMemo(() => {
    const source = props.platforms?.length ? props.platforms : [buildDefaultPlatform(props)];
    return source.map(normalizePlatform);
  }, [props.platforms, props.reviews, props.reviewsReady, props.reviewsError, props.initialNextPageToken, props.totalReviewCount, props.averageRatingLabel, props.locationLabel, props.statusLabel, props.gmbReady, props.reportGoogleUrl]);

  const [platformData, setPlatformData] = useState<EReputationReviewsPlatform[]>(() => {
    const snapshot = readModuleSnapshot<ReviewsResponse>(MODULE_SNAPSHOT_KEYS.eReputationGoogle)?.data ?? null;
    return normalizedPlatforms.map((platform) => platform.id === "google" ? platformFromSnapshot(platform, snapshot) : platform);
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
  const [replyText, setReplyText] = useState(defaultReplyFor(platformData[0]?.reviews[0] || null));
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

  const activePlatform = platformData.find((platform) => platform.id === activePlatformId) || platformData[0] || normalizePlatform(buildDefaultPlatform(props));
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
    setReplyText(defaultReplyFor(first));
    setNotice(null);
    setListNotice(null);
  }, [activePlatform.id]);

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
    setReplyText(defaultReplyFor(selectedReview));
    replySelectionRef.current = null;
    setNotice(null);
  }, [selectedReview?.id]);

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
  const loadedLabel = totalReviewCount > 0 ? `${items.length.toLocaleString("fr-FR")} / ${totalReviewCount.toLocaleString("fr-FR")}` : items.length.toLocaleString("fr-FR");
  const totalReviewsLabel = (totalReviewCount > 0 ? totalReviewCount : stats.total).toLocaleString("fr-FR");
  const totalReviewsCaption = reviewsReady ? `Qté : ${totalReviewsLabel}` : `Exemples : ${totalReviewsLabel}`;
  const summaryStatusLabel = reviewsReady ? "Avis chargés" : activePlatform.statusLabel || platformLabel;
  const summaryStatusShortLabel = reviewsReady ? "Chargés" : activePlatform.statusLabel || platformShortLabel;
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
    selectedReview && replyText.trim() !== defaultReplyFor(selectedReview).trim(),
  );

  function openDetails(review: EReputationReviewItem) {
    setSelectedId(review.id);
    setReplyText(defaultReplyFor(review));
    replySelectionRef.current = null;
    setNotice(null);
    setDetailsOpen(true);
  }

  async function confirmReviewChange() {
    if (!replyHasUnsavedChanges) return true;
    return confirmInrcy({
      eyebrow: "Réponse non publiée",
      title: "Changer d’avis ?",
      message: "La réponse préparée pour cet avis n’a pas été publiée. Elle sera perdue si vous continuez.",
      cancelLabel: "Continuer l’édition",
      confirmLabel: "Changer d’avis",
      variant: "warning",
    });
  }

  function selectReviewFromSequence(review: EReputationReviewItem, index: number) {
    setSelectedId(review.id);
    setReplyText(defaultReplyFor(review));
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
        statusLabel: payload.ready ? "Avis Google chargés" : platform.statusLabel,
      }));
      const nextReview = mergedItems[currentIndex + 1];
      if (nextReview) selectReviewFromSequence(nextReview, currentIndex + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de charger l’avis suivant.";
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
      throw new Error(getErrorMessage(payload, `Impossible de charger les avis ${platformLabel} pour le moment.`));
    }

    // Le snapshot d'ouverture doit toujours rester la première page complète.
    // Un chargement "Suivant" ne doit pas remplacer le cache par un lot isolé.
    if (!pageToken) {
      writeModuleSnapshot(MODULE_SNAPSHOT_KEYS.eReputationGoogle, payload);
    }
    const connected = Boolean(payload.connected);
    const configured = Boolean(payload.configured);

    return {
      incoming: Array.isArray(payload.reviews) ? payload.reviews.map((review) => toReviewItem(review, activePlatform.id)) : [],
      nextToken: payload.nextPageToken || null,
      total: Number.isFinite(Number(payload.totalReviewCount)) ? Number(payload.totalReviewCount) : activePlatform.totalReviewCount || 0,
      connected,
      configured,
      ready: connected && configured,
      locationLabel: String(payload.locationTitle || activePlatform.locationLabel || "Fiche Google Business"),
      averageRatingLabel: connected && configured ? formatAverageRating(payload.averageRating) : "—",
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
        ? "Avis Google chargés"
        : payload.connected
          ? "Établissement à choisir"
          : "Google Business à connecter",
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
          text: count > 0 ? `Avis ${platformLabel} actualisés.` : `Aucun avis ${platformLabel} n’a été retourné.`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `Impossible d’actualiser les avis ${platformLabel} pour le moment.`;
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
      setListNotice({ type: "success", text: count > 0 ? "Avis supplémentaires chargés." : "Aucun autre avis à afficher." });
      if (count > 0) setCurrentPage((page) => page + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de charger les avis suivants.";
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
      setListNotice({ type: "success", text: "Page d’avis chargée." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de charger cette page d’avis.";
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
        throw new Error(getErrorMessage(payload, "Impossible de générer une réponse IA pour le moment."));
      }
      setReplyText(payload.reply_text);
      setNotice({
        type: "success",
        text: selectedAlreadyAnswered
          ? `Nouvelle proposition générée. Relisez-la puis modifiez la réponse ${platformLabel} si elle vous convient.`
          : `Réponse générée. Relisez-la puis publiez-la sur ${platformLabel} si elle vous convient.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de générer une réponse IA pour le moment.";
      setNotice({ type: "error", text: message });
    } finally {
      setGenerating(false);
    }
  }

  async function publishReply() {
    if (!selectedReview?.reviewName) return;
    const cleanReply = replyText.trim();
    if (cleanReply.length < 2) {
      setNotice({ type: "error", text: "La réponse ne peut pas être vide." });
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
        throw new Error(getErrorMessage(payload, `Impossible de publier la réponse ${platformLabel} pour le moment.`));
      }
      const publishedComment = payload.reply?.comment || cleanReply;
      setItems((current) => current.map((review) => review.id === selectedReview.id ? { ...review, reply: publishedComment, status: "Répondu" } : review));
      setReplyText(publishedComment);
      setNotice({ type: "success", text: `Réponse publiée sur ${platformLabel}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : `Impossible de publier la réponse ${platformLabel} pour le moment.`;
      setNotice({ type: "error", text: message });
    } finally {
      setPublishing(false);
    }
  }

  async function deleteReply() {
    if (!selectedReview?.reviewName || !selectedReview.reply) return;
    const confirmed = await confirmInrcy({
      eyebrow: "e-Réputation",
      title: "Supprimer cette réponse ?",
      message: `La réponse publiée sur ${platformLabel} sera supprimée définitivement pour cet avis.`,
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
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
        throw new Error(getErrorMessage(payload, `Impossible de supprimer la réponse ${platformLabel} pour le moment.`));
      }
      setItems((current) => current.map((review) => review.id === selectedReview.id ? { ...review, reply: null, status: "À répondre" } : review));
      setReplyText(defaultReplyFor({ ...selectedReview, reply: null, status: "À répondre" }));
      setNotice({ type: "success", text: `Réponse supprimée de ${platformLabel}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : `Impossible de supprimer la réponse ${platformLabel} pour le moment.`;
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
      <section className={styles.mailboxPanel} aria-label={`Gestion des avis ${platformLabel}`}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            {platformData.length > 1 ? (
              <div className={styles.platformTabs} role="tablist" aria-label="Plateformes d’avis">
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
            <label className={styles.filterLabel} htmlFor="review-filter">Filtrer</label>
            <select id="review-filter" className={styles.select} value={filter} onChange={(event) => setFilter(event.target.value as "all" | "todo" | "answered")}>
              <option value="all">Tous les avis</option>
              <option value="todo">À répondre</option>
              <option value="answered">Répondus</option>
            </select>
            <select id="review-star-filter" className={styles.select} value={starFilter} onChange={(event) => setStarFilter(event.target.value as "all" | "5" | "4" | "3" | "2" | "1")}>
              <option value="all">Toutes les notes</option>
              <option value="5">5 étoiles</option>
              <option value="4">4 étoiles</option>
              <option value="3">3 étoiles</option>
              <option value="2">2 étoiles</option>
              <option value="1">1 étoile</option>
            </select>
            <input className={styles.searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un avis..." type="search" />
          </div>
          <div className={styles.toolbarRight}>
            <div className={`${styles.reputationSummaryChip} ${activePlatform.connected ? styles.reputationSummaryReady : ""}`} aria-label={`${locationLabel} · ${summaryStatusLabel} · ${totalReviewsCaption} · Note : ${averageRatingLabel}`}>
              <span className={styles.summaryLocation}>{locationLabel}</span>
              <span className={styles.summaryStatus}>
                <span className={styles.summaryDot} aria-hidden="true" />
                <span className={styles.summaryStatusDesktop}>{summaryStatusLabel}</span>
                <span className={styles.summaryStatusMobile}>{summaryStatusShortLabel}</span>
              </span>
              <span>{totalReviewsCaption}</span>
              <span>Note : {averageRatingLabel}</span>
            </div>
            <button
              type="button"
              className={`${styles.btnGhostSmall} ${styles.refreshButton}`}
              onClick={() => void refreshReviews()}
              disabled={busy}
              aria-label={refreshing ? "Actualisation des avis" : "Actualiser les avis"}
              title={refreshing ? "Actualisation..." : "Actualiser"}
            >
              <span className={styles.refreshIcon} aria-hidden="true">⟳</span>
              <span className={styles.refreshText}>{refreshing ? "Actualisation..." : "Actualiser"}</span>
            </button>
          </div>
        </div>

        {reviewsError ? (
          <div className={styles.noticeError}>
            <strong>Avis indisponibles</strong>
            <span>{reviewsError}</span>
          </div>
        ) : null}

        {!reviewsReady ? (
          <div className={`${styles.noticeInfo} ${styles.previewNotice}`}>
            <div className={styles.previewNoticeCopy}>
              <strong>AVIS D’EXEMPLE — aucun avis Google n’est chargé</strong>
              <span>Les lignes ci-dessous sont fictives. Branchez Google pour afficher et gérer les vrais avis de l’entreprise.</span>
            </div>
            <Link className={styles.connectGoogleCta} href="/dashboard?panel=gmb">
              <span aria-hidden="true">G</span>
              Brancher Google
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        ) : null}

        {null}

        {listNotice ? <div className={listNotice.type === "success" ? styles.noticeSuccess : styles.noticeError} role="status">{listNotice.text}</div> : null}

        <div className={styles.tableWrap}>
          <table className={styles.reviewsTable}>
            <thead>
              <tr>
                <th>Avis</th>
                <th>Note</th>
                <th>Statut</th>
                <th>Date</th>
                <th>Détails</th>
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
                          {!reviewsReady ? <span className={styles.exampleBadge}>EXEMPLE</span> : null}
                        </strong>
                        <span>{truncateText(review)}</span>
                        <span className={styles.mobileReviewMeta}>
                          <span className={styles.mobileReviewStars} aria-label={`${review.rating} étoiles sur 5`}>{renderStars(review.rating)}</span>
                          <span className={review.status === "Répondu" ? styles.mobileStatusAnswered : styles.mobileStatusTodo}>{review.status}</span>
                          <span>{review.date}</span>
                        </span>
                      </button>
                    </td>
                    <td><span className={styles.stars} aria-label={`${review.rating} étoiles sur 5`}>{renderStars(review.rating)}</span></td>
                    <td><span className={review.status === "Répondu" ? styles.answeredBadge : styles.todoBadge}>{review.status}</span></td>
                    <td>{review.date}</td>
                    <td>
                      <button type="button" className={styles.detailsBtn} onClick={() => openDetails(review)} aria-label={`Ouvrir le détail de l’avis de ${review.name}`}>
                        ↗
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>
                    <div className={styles.emptyState}>
                      <strong>Aucun avis dans ce filtre</strong>
                      <span>Changez de filtre ou réclamez de nouveaux avis.</span>
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
              ? `${paginatedReviews.length
                ? `Affichage ${firstDisplayedReview.toLocaleString("fr-FR")}–${lastDisplayedReview.toLocaleString("fr-FR")} sur ${footerTotalReviews.toLocaleString("fr-FR")} avis`
                : "Affichage 0 avis"} · ${loadedLabel} chargés`
              : `${paginatedReviews.length.toLocaleString("fr-FR")} exemples fictifs affichés`}
          </span>
          {reviewsReady ? (
            <div className={styles.paginationControls} aria-label="Pagination des avis">
              <button type="button" className={styles.paginationArrow} onClick={() => goToPage(safeCurrentPage - 1)} disabled={busy || safeCurrentPage <= 1}>‹</button>
              {paginationItems.map((page, index) => page === "ellipsis" ? (
                <span key={`ellipsis-${index}`} className={styles.paginationEllipsis}>…</span>
              ) : (
                <button key={page} type="button" className={page === safeCurrentPage ? styles.paginationActive : styles.paginationPage} onClick={() => goToPage(page)} disabled={busy || page === safeCurrentPage}>{page}</button>
              ))}
              <button type="button" className={styles.paginationArrow} onClick={() => goToPage(safeCurrentPage + 1)} disabled={busy || safeCurrentPage >= totalPages || (!hasLocalFilter && !nextPageToken && items.length <= safeCurrentPage * REVIEWS_PAGE_SIZE)}>›</button>
            </div>
          ) : (
            <span className={styles.footerHint}>Connexion {platformLabel} requise</span>
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
                  <h2 id="review-details-title">Détails de l’avis</h2>
                  <div className={styles.reviewSequenceControls} aria-label="Navigation entre les avis">
                    <button
                      type="button"
                      className={styles.reviewSequenceButton}
                      onClick={() => void navigateReview("previous")}
                      disabled={!canGoToPreviousReview || busy}
                      aria-label="Avis précédent"
                      title="Avis précédent"
                    >
                      ‹
                    </button>
                    <span className={styles.reviewSequenceCounter} aria-live="polite">
                      {detailPosition.toLocaleString("fr-FR")} / {detailTotalReviews.toLocaleString("fr-FR")}
                    </span>
                    <button
                      type="button"
                      className={styles.reviewSequenceButton}
                      onClick={() => void navigateReview("next")}
                      disabled={!canGoToNextReview || busy}
                      aria-label="Avis suivant"
                      title="Avis suivant"
                    >
                      ›
                    </button>
                    <button
                      type="button"
                      className={`${styles.modalClose} ${styles.modalCloseIcon}`}
                      onClick={() => void requestCloseDetails()}
                      aria-label="Fermer"
                      title="Fermer"
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
                        {!reviewsReady ? <span className={styles.exampleBadge}>EXEMPLE — avis fictif</span> : null}
                        <span>{selectedReview.date}{selectedReview.verified ? " · Avis vérifié" : ""}</span>
                      </div>
                      <span className={selectedReview.status === "Répondu" ? styles.answeredBadge : styles.todoBadge}>{selectedReview.status}</span>
                    </div>
                    <div className={styles.modalStars} aria-label={`${selectedReview.rating} étoiles sur 5`}>{renderStars(selectedReview.rating)}</div>
                    <div className={styles.reviewDetailScroll}>
                      <ReviewTextBlock review={selectedReview} />
                      {selectedReview.reply ? (
                        <div className={styles.currentReplyBox}>
                          <strong>Réponse actuelle</strong>
                          <span>{selectedReview.reply}</span>
                        </div>
                      ) : null}
                    </div>
                  </article>

                  <article className={styles.replyDetailCard}>
                    <div className={styles.replyHeaderLine}>
                      <span className={styles.modalKicker}>{activePlatform.replyLabel}</span>
                      <button
                        type="button"
                        className={`${styles.aiChip} ${styles.aiChipButton}`}
                        onClick={() => setAiConfigurationOpen(true)}
                        aria-label="Ouvrir la Configuration IA"
                        title="Configuration IA"
                      >
                        IA
                      </button>
                    </div>
                    <div className={styles.replyHeaderTitleLine}>
                      <h3>{selectedAlreadyAnswered ? "Modifier la réponse" : "Préparer la réponse"}</h3>
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
                      placeholder={`Rédigez votre réponse ${platformLabel}...`}
                    />
                    <div className={styles.charCount}>{replyText.trim().length.toLocaleString("fr-FR")} / 4 096 caractères</div>
                    {notice ? <div className={notice.type === "success" ? styles.noticeSuccess : styles.noticeError} role="status">{notice.text}</div> : null}
                    <div className={styles.modalActions}>
                      <button className={styles.btnGhostSmall} type="button" disabled={!canGenerate} onClick={generateReply}>{generating ? "Génération..." : "Générer avec iNrCy"}</button>
                      <button className={styles.btnPrimarySmall} type="button" disabled={!canPublish} onClick={publishReply}>{publishing ? "Publication..." : selectedAlreadyAnswered ? "Modifier la réponse" : "Publier la réponse"}</button>
                      {selectedAlreadyAnswered ? <button className={styles.btnDangerSmall} type="button" disabled={!canDelete} onClick={deleteReply}>{deleting ? "Suppression..." : "Supprimer"}</button> : null}
                    </div>
                    <div className={styles.reportFooterLine}>
                      <p className={styles.secureText}>Vous validez chaque réponse avant publication sur {platformLabel}.</p>
                      {canReport ? (
                        <a className={styles.reportReviewButton} href={activePlatform.reportUrl || "#"} target="_blank" rel="noreferrer" aria-label={`Signaler l’avis de ${selectedReview.name} sur Google`}>
                          <span aria-hidden="true">⚠</span>
                          <span className={styles.reportReviewTooltip}>Signaler l’avis sur Google</span>
                        </a>
                      ) : null}
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
