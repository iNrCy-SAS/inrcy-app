"use client";

import { useTranslations } from "next-intl";


import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  ensureFrenchPublicationErrorMessage,
  getFrenchPublicationErrorMessage,
} from "@/lib/publicationErrorFrench";
import { isBoosterPublicationPendingStatus } from "@/lib/boosterPublicationStatus";

type DashboardStyles = Readonly<Record<string, string>>;

type PublishExecutionSummary = {
  publicationId?: string | null;
  publication_id?: string | null;
  allFailed?: boolean;
  failureCount?: number;
  successCount?: number;
  warningCount?: number;
  mediaWarningCount?: number;
  pendingCount?: number;
  skippedCount?: number;
  entries?: Array<{
    channel: string;
    label: string;
    ok?: boolean;
    status?: "published" | "published_with_warning" | "queued" | "processing" | "failed" | string;
    technicalStatus?: string | null;
    code?: string | null;
    retryable?: boolean;
    error?: string | null;
    warning?: string | null;
    warning_kind?: "media_degraded" | "degraded" | "pending" | string | null;
    warning_message?: string | null;
    blockers?: string[];
  }>;
  channelLinks?: Record<string, string>;
  retryableFailureCount?: number;
};

type PublishExecutionEntry = NonNullable<PublishExecutionSummary["entries"]>[number];

const CHANNEL_LOGO_BY_KEY: Readonly<Record<string, string>> = {
  inrcy_site: "/icons/inrcy.png",
  site_web: "/icons/site-web.jpg",
  inr_search: "/icons/inr-search-bubble-128.png",
  gmb: "/icons/google.jpg",
  google_business: "/icons/google.jpg",
  facebook: "/icons/facebook.png",
  instagram: "/icons/instagram.jpg",
  linkedin: "/icons/linkedin.png",
  tiktok: "/icons/tiktok.png",
  youtube: "/icons/youtube-shorts.png",
  youtube_shorts: "/icons/youtube-shorts.png",
  pinterest: "/icons/pinterest-logo-128.png",
  mail: "/icons/mails-inrcy-dashboard-v2.png",
  mails: "/icons/mails-inrcy-dashboard-v2.png",
};

function isPendingPublicationEntry(entry: PublishExecutionEntry) {
  const status = String(entry.status || "").trim().toLowerCase();
  const technicalStatus = String(entry.technicalStatus || "")
    .trim()
    .toLowerCase();
  const warningKind = String(entry.warning_kind || "").trim().toLowerCase();

  return (
    isBoosterPublicationPendingStatus(status) ||
    isBoosterPublicationPendingStatus(technicalStatus) ||
    warningKind === "pending"
  );
}

export default function PublishExecutionResultModal({
  styles,
  summary,
  onClose,
  onOpenInrSend,
  onRetryFailed,
  retrying = false,
}: {
  styles: DashboardStyles;
  summary: PublishExecutionSummary | null | undefined;
  onClose: () => void;
  onOpenInrSend: () => void;
  onRetryFailed?: () => void | Promise<void>;
  retrying?: boolean;
}) {
  const i18nT = useTranslations("booster");
  const [liveSummary, setLiveSummary] = useState<PublishExecutionSummary | null>(summary || null);
  const [expandedEntryDetails, setExpandedEntryDetails] = useState<Record<string, boolean>>({});
  const tiktokPollInFlightRef = useRef(false);
  const closeTapHandledRef = useRef(false);

  const requestClose = () => {
    if (closeTapHandledRef.current) return;
    closeTapHandledRef.current = true;
    onClose();
    window.setTimeout(() => {
      closeTapHandledRef.current = false;
    }, 250);
  };

  const handleClosePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    requestClose();
  };

  const handleCloseClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    // Le clic reste indispensable pour l'activation clavier. La fermeture
    // pointeur est volontairement déclenchée dès pointerdown : le X vit au-dessus
    // d'une surface défilante et certains navigateurs annulent pointerup/click
    // lorsque cette surface reprend la capture du pointeur.
    event.preventDefault();
    event.stopPropagation();
    requestClose();
  };

  useEffect(() => {
    setLiveSummary(summary || null);
  }, [summary]);

  const publicationId = String(
    liveSummary?.publicationId || liveSummary?.publication_id || "",
  ).trim();

  useEffect(() => {
    setExpandedEntryDetails({});
  }, [publicationId]);
  const liveEntries = Array.isArray(liveSummary?.entries)
    ? liveSummary.entries
    : [];
  const hasPendingAsyncJob = liveEntries.some(isPendingPublicationEntry);

  useEffect(() => {
    if (!publicationId || !hasPendingAsyncJob) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let resumeRequested = false;
    const startedAt = Date.now();

    const clearTimer = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    };

    const schedule = (delayMs: number) => {
      clearTimer();
      if (cancelled || document.hidden) return;
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delayMs);
    };

    const run = async () => {
      if (cancelled || document.hidden) return;
      if (inFlight) {
        resumeRequested = true;
        return;
      }

      inFlight = true;
      let shouldContinue = true;
      try {
        const response = await fetch(
          `/api/booster/publications/${encodeURIComponent(publicationId)}/status`,
          { method: "GET", cache: "no-store" },
        );
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload?.summary) {
          setLiveSummary((current) => ({
            ...(current || {}),
            ...payload.summary,
            publicationId,
            publication_id: publicationId,
            channelLinks: current?.channelLinks || {},
            retryableFailureCount: current?.retryableFailureCount || 0,
          }));
          shouldContinue = payload?.done !== true;
        }
      } catch {
        shouldContinue = true;
      } finally {
        inFlight = false;
      }

      if (cancelled || document.hidden) return;
      if (resumeRequested) {
        resumeRequested = false;
        schedule(0);
        return;
      }
      if (shouldContinue && Date.now() - startedAt < 8 * 60_000) {
        schedule(Date.now() - startedAt < 60_000 ? 3_000 : 10_000);
      }
    };

    const handleVisibilityChange = () => {
      if (cancelled) return;
      if (document.hidden) {
        clearTimer();
        return;
      }
      if (inFlight) {
        resumeRequested = true;
        return;
      }
      schedule(0);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (!document.hidden) schedule(2_000);
    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [publicationId, hasPendingAsyncJob]);
  const pendingTiktokEntry = liveEntries.find(
    (entry) => entry.channel === "tiktok" && entry.status === "processing",
  );
  const hasPendingTiktok = Boolean(pendingTiktokEntry);

  useEffect(() => {
    if (!publicationId || !hasPendingTiktok) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let resumeRequested = false;
    const startedAt = Date.now();

    const clearTimer = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    };

    const schedule = (delayMs: number) => {
      clearTimer();
      if (cancelled || document.hidden) return;
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delayMs);
    };

    const run = async () => {
      if (cancelled || document.hidden) return;
      if (tiktokPollInFlightRef.current) {
        schedule(1_000);
        return;
      }

      tiktokPollInFlightRef.current = true;
      let shouldContinue = true;
      try {
        const res = await fetch(
          `/api/inrsend/publications/${encodeURIComponent(publicationId)}/tiktok/status`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          },
        );
        const json = await res.json().catch(() => ({}));
        const status = String(json?.status?.status || "").toUpperCase();
        const complete = ["PUBLISH_COMPLETE", "DONE", "SUCCESS"].includes(status);
        const failed = ["FAILED", "PUBLISH_FAILED", "ERROR"].includes(status);
        const message = String(
          json?.message ||
            (failed
              ? "TikTok n'a pas pu finaliser la publication."
              : "TikTok traite encore la publication."),
        ).trim();
        shouldContinue = !complete && !failed;

        setLiveSummary((current) => {
          if (!current || !Array.isArray(current.entries)) return current;
          const previousEntry = current.entries.find(
            (entry) => entry.channel === "tiktok",
          );
          if (!previousEntry) return current;

          const nextEntries = current.entries.map((entry) => {
            if (entry.channel !== "tiktok") return entry;
            if (complete) {
              return {
                ...entry,
                ok: true,
                status: "published",
                error: null,
                warning: null,
                warning_kind: null,
                warning_message: null,
              };
            }
            if (failed) {
              return {
                ...entry,
                ok: false,
                status: "failed",
                error: message,
                warning: null,
                warning_kind: null,
                warning_message: null,
              };
            }
            return {
              ...entry,
              ok: true,
              status: "processing",
              warning: "pending",
              warning_kind: "pending",
              warning_message: message,
            };
          });

          let successCount = Number(current.successCount || 0);
          let failureCount = Number(current.failureCount || 0);
          let pendingCount = Number(current.pendingCount || 0);
          if (previousEntry.status === "processing" && complete) {
            pendingCount = Math.max(0, pendingCount - 1);
          } else if (previousEntry.status === "processing" && failed) {
            pendingCount = Math.max(0, pendingCount - 1);
            successCount = Math.max(0, successCount - 1);
            failureCount += 1;
          }

          return {
            ...current,
            entries: nextEntries,
            successCount,
            failureCount,
            pendingCount,
            allFailed: failureCount > 0 && successCount === 0,
          };
        });
      } catch {
        shouldContinue = true;
      } finally {
        tiktokPollInFlightRef.current = false;
      }

      if (cancelled || document.hidden) return;
      if (resumeRequested) {
        resumeRequested = false;
        schedule(0);
        return;
      }
      if (shouldContinue && Date.now() - startedAt < 5 * 60_000) {
        schedule(Date.now() - startedAt >= 2 * 60_000 ? 30_000 : 15_000);
      }
    };

    const handleVisibilityChange = () => {
      if (cancelled) return;
      if (document.hidden) {
        clearTimer();
        return;
      }
      if (tiktokPollInFlightRef.current) {
        resumeRequested = true;
        return;
      }
      schedule(0);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (!document.hidden) schedule(8_000);
    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [publicationId, hasPendingTiktok]);

  const effectiveSummary = liveSummary || summary;
  const failureCount = Number(effectiveSummary?.failureCount || 0);
  const successCount = Number(effectiveSummary?.successCount || 0);
  const allFailed = Boolean(effectiveSummary?.allFailed);
  const entries = Array.isArray(effectiveSummary?.entries) ? effectiveSummary.entries : [];
  const warningCount = Math.max(
    Number(effectiveSummary?.warningCount || 0),
    entries.filter((entry) => entry.status === "published_with_warning").length,
  );
  const pendingCount = Math.max(
    Number(effectiveSummary?.pendingCount || 0),
    entries.filter(isPendingPublicationEntry).length,
  );
  const skippedCount = Math.max(
    Number(effectiveSummary?.skippedCount || 0),
    entries.filter((entry) => entry.status === "skipped").length,
  );
  const retryableFailureCount = Math.max(
    0,
    Number(effectiveSummary?.retryableFailureCount || 0),
  );
  const publishedEntryCount = entries.filter(
    (entry) =>
      entry.status !== "skipped" &&
      !isPendingPublicationEntry(entry) &&
      entry.ok !== false &&
      String(entry.status || "").toLowerCase() !== "failed",
  ).length;
  const failedEntryCount = entries.filter(
    (entry) =>
      entry.status !== "skipped" &&
      !isPendingPublicationEntry(entry) &&
      (entry.ok === false || String(entry.status || "").toLowerCase() === "failed"),
  ).length;
  const publishedCount = entries.length
    ? publishedEntryCount
    : Math.max(0, successCount - pendingCount);
  const failedOrSkippedCount = Math.max(failureCount, failedEntryCount) + skippedCount;
  const totalCount = Math.max(
    entries.length,
    publishedCount + pendingCount + failedOrSkippedCount,
    1,
  );
  const hasPublishedChannels = publishedCount > 0;
  const orderedEntries = [...entries].sort((left, right) => {
    const rank = (entry: PublishExecutionEntry) => {
      if (entry.status === "skipped") return 3;
      if (isPendingPublicationEntry(entry)) return 1;
      if (entry.ok === false || String(entry.status || "").toLowerCase() === "failed") return 2;
      return 0;
    };
    return rank(left) - rank(right);
  });

  const hasMixedResults =
    hasPublishedChannels && (pendingCount > 0 || failedOrSkippedCount > 0);
  const hasPublishedWarnings = warningCount > 0;
  const overallTitle = allFailed
    ? "Publication échouée"
    : hasMixedResults
      ? "Publication avec résultats mixtes"
      : hasPublishedWarnings
        ? "Publication publiée avec avertissement"
      : hasPublishedChannels
        ? "Publication bien lancée !"
        : pendingCount
          ? "Publication en cours"
          : failureCount
            ? "Publication envoyée partiellement"
            : "Publication envoyée avec succès";
  const overallSubtitle = allFailed
    ? "Aucun canal n’a pu publier. Les erreurs sont détaillées ci-dessous."
    : hasMixedResults
      ? `${totalCount}/${totalCount} ${totalCount > 1 ? "canaux traités" : "canal traité"} avec détails ci-dessous.`
      : hasPublishedChannels && pendingCount
        ? `${publishedCount} ${publishedCount > 1 ? "canaux sont déjà publiés" : "canal est déjà publié"} sur ${totalCount}. iNrCy poursuit automatiquement le traitement.`
        : hasPublishedChannels && hasPublishedWarnings
          ? `${publishedCount}/${totalCount} ${totalCount > 1 ? "canaux publiés" : "canal publié"} · ${warningCount} avertissement${warningCount > 1 ? "s" : ""} à consulter.`
        : hasPublishedChannels
          ? `${publishedCount}/${totalCount} ${totalCount > 1 ? "canaux publiés" : "canal publié"} avec succès.`
          : `${pendingCount || totalCount} ${(pendingCount || totalCount) > 1 ? "canaux sont" : "canal est"} encore en traitement. iNrCy actualise ce bilan automatiquement.`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={overallTitle}
      className={styles.fullscreenModalOverlay}
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "rgba(3, 8, 20, 0.64)",
        zIndex: 150,
        padding: 16,
        overflowY: "auto",
        overscrollBehavior: "contain",
      }}
    >
      <div
        className={styles.publishResultDialogShell}
        style={{
          width: "min(660px, 100%)",
          maxHeight:
            "calc(100dvh - var(--inrcy-mobile-bottom-nav-total-height, calc(50px + var(--inrcy-safe-area-bottom))) - 32px)",
          position: "relative",
          minWidth: 0,
        }}
      >
        <button
          type="button"
          onPointerDown={handleClosePointerDown}
          onClick={handleCloseClick}
          data-testid="publish-result-close"
          aria-label={i18nT("fermer_5ab4ec64")}
          title={i18nT("fermer_5ab4ec64")}
          className={`${styles.secondaryBtn} ${styles.publishResultCloseButton}`}
        >
          ✕
        </button>

        <div
          role="document"
          className={`${styles.blockCard} ${styles.publishResultScrollCard}`}
          style={{
            width: "100%",
            maxHeight:
              "calc(100dvh - var(--inrcy-mobile-bottom-nav-total-height, calc(50px + var(--inrcy-safe-area-bottom))) - 32px)",
            overflowY: "auto",
            textAlign: "left",
            position: "relative",
            padding: "22px clamp(14px, 3vw, 24px) 20px",
            boxShadow: hasPublishedChannels
              ? "0 32px 90px rgba(0,0,0,0.50), 0 0 48px rgba(99,102,241,0.10)"
              : allFailed
                ? "0 32px 90px rgba(0,0,0,0.50), 0 0 42px rgba(248,113,113,0.10)"
                : "0 32px 90px rgba(0,0,0,0.50), 0 0 42px rgba(251,191,36,0.08)",
            border: `1px solid ${
              hasPublishedChannels
                ? "rgba(96,165,250,0.28)"
                : allFailed
                  ? "rgba(248,113,113,0.34)"
                  : "rgba(251,191,36,0.28)"
            }`,
            background:
              "radial-gradient(circle at 50% 0%, rgba(59,130,246,0.09), transparent 30%), linear-gradient(180deg, rgba(12,18,34,0.99), rgba(8,13,25,0.99))",
          }}
        >
          <header
          style={{
            minHeight: 66,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 13,
            padding: "3px 48px 0",
            marginBottom: 15,
          }}
        >
          <div
            aria-hidden
            style={{
              width: 62,
              flex: "0 0 62px",
              display: "grid",
              placeItems: "center",
              fontSize: hasPublishedChannels ? 49 : 41,
              lineHeight: 1,
              filter: "drop-shadow(0 12px 24px rgba(99,102,241,0.28))",
            }}
          >
            {hasPublishedChannels ? "🎉" : allFailed ? "❌" : "⏳"}
          </div>
          <div style={{ minWidth: 0, textAlign: "left" }}>
            <div className={styles.blockTitle} style={{ marginBottom: 5, fontSize: 23 }}>
              {overallTitle}
            </div>
            <div
              className={styles.subtitle}
              style={{ maxWidth: 500, margin: 0, lineHeight: 1.38 }}
            >
              {overallSubtitle}
            </div>
          </div>
        </header>

        <div
          style={{
            minHeight: 56,
            padding: "8px 10px",
            display: "grid",
            gridTemplateColumns: `repeat(${Math.max(
              1,
              Number(publishedCount > 0) + Number(pendingCount > 0) + Number(failedOrSkippedCount > 0),
            )}, minmax(0, 1fr))`,
            alignItems: "center",
            borderRadius: 20,
            border: "1px solid rgba(168,85,247,0.55)",
            background:
              "linear-gradient(90deg, rgba(6,182,212,0.08), rgba(124,58,237,0.10), rgba(236,72,153,0.08))",
            boxShadow: "inset 0 0 24px rgba(59,130,246,0.04)",
          }}
        >
          {publishedCount > 0 ? (
            <div
              style={{
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: publishedCount === totalCount ? "space-between" : "center",
                gap: 9,
                padding: "0 10px",
              }}
            >
              <strong style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                <span
                  aria-hidden
                  style={{
                    width: 26,
                    height: 26,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 999,
                    border: "2px solid #34d399",
                    color: "#34d399",
                    boxShadow: "0 0 15px rgba(52,211,153,0.24)",
                  }}
                >
                  ✓
                </span>
                {publishedCount} {" "}{i18nT("publie_bf504032")}{publishedCount > 1 ? "s" : ""}
              </strong>
              {publishedCount === totalCount ? (
                <strong style={{ color: "#c084fc", fontSize: 13, textAlign: "right" }}>
                  {i18nT("tout_est_en_ligne_94126b3c")}{" "}</strong>
              ) : null}
            </div>
          ) : null}
          {pendingCount > 0 ? (
            <div
              style={{
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "0 10px",
                borderLeft: publishedCount > 0 ? "1px solid rgba(148,163,184,0.16)" : undefined,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 26,
                  height: 26,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 999,
                  border: "2px solid #fbbf24",
                  color: "#fbbf24",
                  boxShadow: "0 0 15px rgba(251,191,36,0.20)",
                }}
              >
                ◷
              </span>
              <strong style={{ color: "#fbbf24", whiteSpace: "nowrap" }}>
                {i18nT("value_en_traitement_cf234a8a", { value0: pendingCount })}</strong>
            </div>
          ) : null}
          {failedOrSkippedCount > 0 ? (
            <div
              style={{
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "0 10px",
                borderLeft:
                  publishedCount > 0 || pendingCount > 0
                    ? "1px solid rgba(148,163,184,0.16)"
                    : undefined,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 26,
                  height: 26,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 999,
                  border: "2px solid #fb7185",
                  color: "#fb7185",
                  boxShadow: "0 0 15px rgba(251,113,133,0.20)",
                }}
              >
                ×
              </span>
              <strong style={{ color: "#fb7185", whiteSpace: "nowrap" }}>
                {failedOrSkippedCount} {" "}{i18nT("echec_f2da5369")}{failedOrSkippedCount > 1 ? "s" : ""}
              </strong>
            </div>
          ) : null}
        </div>

        {entries.length ? (
          <div
            style={{
              marginTop: 13,
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr)",
              gap: 7,
              textAlign: "left",
            }}
          >
            {orderedEntries.map((entry) => {
              const entryIsPending = isPendingPublicationEntry(entry);
              const entryIsSkipped = entry.status === "skipped";
              const entryIsFailed = !entryIsPending && !entryIsSkipped && (
                entry.ok === false || String(entry.status || "").toLowerCase() === "failed"
              );
              const entryHasWarning = entry.status === "published_with_warning";
              const channelHref = String(effectiveSummary?.channelLinks?.[entry.channel] || "").trim();
              const channelLogo = CHANNEL_LOGO_BY_KEY[entry.channel];
              const channelLogoSize = entry.channel === "site_web" ? 25 : 27;
              const visibleError = !entryIsPending && entry.error
                ? getFrenchPublicationErrorMessage(
                    entry.channel,
                    entry.error,
                    `${entry.label} n'a pas pu publier. Merci de réessayer.`,
                  )
                : entryIsFailed
                  ? getFrenchPublicationErrorMessage(
                      entry.channel,
                      "publication_failed",
                      `${entry.label} n'a pas pu publier. Merci de réessayer.`,
                    )
                  : "";
              const rawWarning = String(
                entry.warning_message || (entry.warning !== "pending" ? entry.warning || "" : ""),
              ).trim();
              const visibleWarning = rawWarning
                ? ensureFrenchPublicationErrorMessage(
                    rawWarning,
                    entryIsPending
                      ? `${entry.label} est encore en attente de finalisation.`
                      : `${entry.label} a publié avec un avertissement.`,
                  )
                : "";
              const visibleBlockers = (entry.blockers || []).map((blocker) =>
                ensureFrenchPublicationErrorMessage(
                  blocker,
                  `${entry.label} n'est pas prêt pour la publication.`,
                ),
              );
              const tone = entryIsPending || entryHasWarning
                ? {
                    border: "rgba(251,191,36,0.22)",
                    background: "linear-gradient(90deg, rgba(245,158,11,0.07), rgba(20,27,45,0.86))",
                    statusColor: "#fbbf24",
                  }
                : entryIsFailed || entryIsSkipped
                  ? {
                      border: "rgba(248,113,113,0.24)",
                      background: "linear-gradient(90deg, rgba(239,68,68,0.07), rgba(20,27,45,0.86))",
                      statusColor: "#fb7185",
                    }
                  : {
                      border: "rgba(96,165,250,0.16)",
                      background: "linear-gradient(90deg, rgba(30,58,138,0.10), rgba(30,27,75,0.08), rgba(20,27,45,0.88))",
                      statusColor: "#34d399",
                    };
              const statusLabel = entryIsSkipped
                ? "Non envoyé"
                : entryIsPending
                  ? "En traitement"
                  : entryIsFailed
                    ? "Échec"
                    : entryHasWarning
                      ? "Publié avec avertissement"
                      : "Publié";
              // Conserve une description sémantique explicite pour les lecteurs d’écran :
              // un canal en file d’attente ne doit jamais être annoncé comme publié à cause de `ok`.
              const semanticStatusIcon = entry.status === "skipped"
                ? "⏭"
                : entryIsPending
                  ? "⏳"
                  : entry.ok
                    ? entryHasWarning
                      ? "!"
                      : "✓"
                    : "×";
              const accessibleStatusLabel = entry.status === "skipped"
                ? "Ignoré avant envoi"
                : entryIsPending
                  ? "En attente"
                  : entry.ok
                    ? entryHasWarning
                      ? "Publié avec avertissement"
                      : "Publié"
                    : "Échec";
              const hasFailureDetails =
                (entryIsFailed || entryIsSkipped) &&
                Boolean(visibleError || visibleBlockers.length);
              const failureDetailsOpen = Boolean(
                expandedEntryDetails[entry.channel],
              );

              return (
                <div
                  key={entry.channel}
                  style={{
                    borderRadius: 13,
                    padding: "8px 10px",
                    border: `1px solid ${tone.border}`,
                    background: tone.background,
                  }}
                >
                  <div
                    style={{
                      minHeight: 32,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <strong
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 10,
                        minWidth: 0,
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 31,
                          height: 31,
                          flex: "0 0 31px",
                          borderRadius: 999,
                          overflow: "hidden",
                          display: "grid",
                          placeItems: "center",
                          background: "transparent",
                        }}
                      >
                        {channelLogo ? (
                          <img
                            src={channelLogo}
                            alt=""
                            aria-hidden="true"
                            loading="eager"
                            decoding="sync"
                            fetchPriority="high"
                            style={{
                              width: channelLogoSize,
                              height: channelLogoSize,
                              borderRadius: 999,
                              objectFit: "cover",
                              boxShadow: "0 0 18px rgba(76,195,255,0.24)",
                            }}
                          />
                        ) : (
                          <span style={{ fontSize: 13 }}>{entry.label.slice(0, 1)}</span>
                        )}
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{entry.label}</span>
                    </strong>

                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 9,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        aria-label={`${entry.label} — ${accessibleStatusLabel}`}
                        data-status-icon={semanticStatusIcon}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          color: tone.statusColor,
                          fontSize: 12,
                          fontWeight: 750,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 18,
                            height: 18,
                            display: "grid",
                            placeItems: "center",
                            borderRadius: 999,
                            border: `1.5px solid ${tone.statusColor}`,
                            boxShadow: `0 0 11px ${tone.statusColor}55`,
                            fontSize: 12,
                            lineHeight: 1,
                          }}
                        >
                          {entryIsPending
                            ? "◷"
                            : entryIsFailed || entryIsSkipped
                              ? "×"
                              : entryHasWarning
                                ? "!"
                                : "✓"}
                        </span>
                        {statusLabel}
                      </span>
                      {hasFailureDetails ? (
                        <button
                          type="button"
                          aria-label={
                            failureDetailsOpen
                              ? `Masquer le détail de l’échec ${entry.label}`
                              : `Afficher le détail de l’échec ${entry.label}`
                          }
                          aria-expanded={failureDetailsOpen}
                          onClick={() =>
                            setExpandedEntryDetails((current) => ({
                              ...current,
                              [entry.channel]: !current[entry.channel],
                            }))
                          }
                          style={{
                            width: 25,
                            height: 25,
                            flex: "0 0 25px",
                            display: "grid",
                            placeItems: "center",
                            borderRadius: 999,
                            border: "1px solid rgba(248,113,113,0.45)",
                            background: failureDetailsOpen
                              ? "rgba(239,68,68,0.20)"
                              : "rgba(239,68,68,0.08)",
                            color: "#fecaca",
                            fontSize: 13,
                            fontWeight: 900,
                            cursor: "pointer",
                          }}
                        >
                          i
                        </button>
                      ) : null}
                      {channelHref ? (
                        <a
                          href={channelHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.secondaryBtn}
                          style={{
                            minHeight: 28,
                            minWidth: 0,
                            padding: "3px 11px",
                            borderRadius: 999,
                            fontSize: 12,
                            textDecoration: "none",
                          }}
                        >
                          {i18nT("voir_8a754f1f")}{" "}</a>
                      ) : null}
                    </span>
                  </div>

                  {visibleError && (!hasFailureDetails || failureDetailsOpen) ? (
                    <div
                      style={{
                        marginTop: 7,
                        padding: "7px 9px",
                        borderRadius: 9,
                        borderLeft: "3px solid #fb7185",
                        background: "rgba(239,68,68,0.08)",
                        fontSize: 12.5,
                        lineHeight: 1.4,
                        color: "#fecaca",
                      }}
                    >
                      {visibleError}
                    </div>
                  ) : null}
                  {entryIsSkipped && visibleBlockers.length && failureDetailsOpen ? (
                    <div
                      style={{
                        marginTop: 7,
                        padding: "7px 9px",
                        borderRadius: 9,
                        borderLeft: "3px solid #fb7185",
                        background: "rgba(239,68,68,0.08)",
                        fontSize: 12.5,
                        lineHeight: 1.4,
                        color: "#fecaca",
                      }}
                    >
                      {visibleBlockers.join(" · ")}
                    </div>
                  ) : null}
                  {visibleWarning ? (
                    <div
                      style={{
                        marginTop: 7,
                        padding: "7px 9px",
                        borderRadius: 9,
                        borderLeft: "3px solid #fbbf24",
                        background: "rgba(245,158,11,0.08)",
                        fontSize: 12.5,
                        lineHeight: 1.4,
                        color: "#fde68a",
                      }}
                    >
                      {visibleWarning}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: "1px solid rgba(148,163,184,0.12)",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: 9,
          }}
        >
          {onRetryFailed && retryableFailureCount > 0 ? (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => void onRetryFailed()}
              disabled={retrying}
              style={{ width: "100%" }}
            >
              {retrying
                ? i18nT("relance_en_cours_82dfaae8")
                : i18nT("retenter_value_value_en_echec_b7d1f934", { value0: retryableFailureCount, value1: retryableFailureCount > 1 ? "canaux" : "canal" })}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenInrSend}
            style={{
              width: "100%",
              minHeight: 46,
              border: 0,
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              color: "#fff",
              fontWeight: 850,
              cursor: "pointer",
              background: "linear-gradient(90deg, #ec4899 0%, #8b5cf6 52%, #2563eb 100%)",
              boxShadow: "0 12px 28px rgba(124,58,237,0.27)",
            }}
          >
            <img
              src="/inrsend-logo-seul.png"
              alt=""
              aria-hidden="true"
              width={23}
              height={23}
              style={{ width: 23, height: 23, objectFit: "contain" }}
            />
            {i18nT("voir_dans_inr_send_a74cc9ea")}{" "}</button>
        </div>
        </div>
      </div>
    </div>
  );
}
