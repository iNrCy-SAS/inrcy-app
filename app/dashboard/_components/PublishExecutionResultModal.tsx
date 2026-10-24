"use client";

import { useDashboardViewerAccess } from "./DashboardViewerAccessProvider";
import { isMetaPilotChannelVisible } from "@/lib/metaChannelUiAccess";
import { useTranslations } from "next-intl";
import PublishWizardFrame, { PublishWizardScreen } from "../booster/publier/components/PublishWizardFrame";
import type { PublishWizardStep } from "../booster/publier/components/publishWizard";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  ensureFrenchPublicationErrorMessage,
  getFrenchPublicationErrorMessage,
} from "@/lib/publicationErrorFrench";
import resultCss from "./PublishExecutionResultModal.module.css";
import { getPublicationDestinationStatus, PublicationVisualHub, type PublicationProgressDestination } from "./PublishExecutionProgress";
import progressCss from "./PublishExecutionProgress.module.css";

type DashboardStyles = Readonly<Record<string, string>>;

export type PublishExecutionSummary = {
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
    publicationId?: string | null;
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

function publicationChannelKey(channel: string) {
  return ({ google_business: "gmb", youtube: "youtube_shorts", twitter: "x" } as Record<string, string>)[channel] || channel;
}

const CHANNEL_LOGO_BY_KEY: Readonly<Record<string, string>> = {

  site_web: "/icons/site-web.jpg",
  inr_search: "/icons/inr-search-bubble-128.png",
  gmb: "/icons/google.jpg",
  google_business: "/icons/google.jpg",
  facebook: "/icons/facebook.png",
  instagram: "/icons/instagram.jpg",
  threads: "/icons/threads.svg",
  linkedin: "/icons/linkedin.png",
  x: "/icons/x.svg",
  twitter: "/icons/x.svg",
  tiktok: "/icons/tiktok.png",
  youtube: "/icons/youtube-shorts.png",
  youtube_shorts: "/icons/youtube-shorts.png",
  pinterest: "/icons/pinterest-logo-128.png",
  mail: "/icons/mails-inrcy-dashboard-v2.png",
  mails: "/icons/mails-inrcy-dashboard-v2.png",
};

function isPendingPublicationEntry(entry: PublishExecutionEntry) {
  return getPublicationDestinationStatus(entry) === "pending";
}

function entryPublicationId(entry: PublishExecutionEntry, summary: PublishExecutionSummary) {
  return String(entry.publicationId || summary.publicationId || summary.publication_id || "").trim();
}

export function mergePublicationResultSnapshot(
  current: PublishExecutionSummary | null,
  snapshot: PublishExecutionSummary,
  polledPublicationId: string,
): PublishExecutionSummary | null {
  if (!current || !Array.isArray(current.entries)) return current;
  const snapshotEntries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  const entries = current.entries.map((entry) => {
    if (entryPublicationId(entry, current) !== polledPublicationId) return entry;
    const next = snapshotEntries.find((candidate) => publicationChannelKey(candidate.channel) === publicationChannelKey(entry.channel));
    // A slower status read must not undo an already confirmed terminal result.
    if (next && isPendingPublicationEntry(next) && !isPendingPublicationEntry(entry)) return entry;
    return next ? { ...next, channel: entry.channel, label: next.label || entry.label, publicationId: polledPublicationId } : entry;
  });
  const statuses = entries.map(getPublicationDestinationStatus);
  const pendingCount = statuses.filter((status) => status === "pending").length;
  const failureCount = statuses.filter((status) => status === "failed").length;
  const warningCount = statuses.filter((status) => status === "warning").length;
  const skippedCount = statuses.filter((status) => status === "skipped").length;
  const successCount = statuses.filter((status) => status === "published" || status === "warning" || status === "pending").length;
  return {
    ...current, entries, successCount, pendingCount, failureCount, warningCount, skippedCount,
    retryableFailureCount: entries.filter((entry) => getPublicationDestinationStatus(entry) === "failed" && entry.retryable !== false).length,
    allFailed: failureCount > 0 && successCount === 0,
  };
}

export function PublishExecutionResultActions({
  summary,
  onOpenInrSend,
  onRetryFailed,
  retrying = false,
  compact = false,
}: {
  summary: PublishExecutionSummary | null | undefined;
  onOpenInrSend: () => void;
  onRetryFailed?: () => void | Promise<void>;
  retrying?: boolean;
  compact?: boolean;
}) {
  const i18nT = useTranslations("booster");
  const retryableFailureCount = summary?.entries?.length
    ? summary.entries.filter((entry) => getPublicationDestinationStatus(entry) === "failed" && entry.retryable !== false).length
    : Math.max(0, Number(summary?.retryableFailureCount || 0));

  return (
    <div className={resultCss.actions} data-publish-result-actions data-compact={compact}>
      {onRetryFailed && retryableFailureCount > 0 ? (
        <button
          type="button"
          className={resultCss.retryButton}
          onClick={() => void onRetryFailed()}
          disabled={retrying}
          aria-busy={retrying}
          aria-label={retrying ? i18nT("relance_en_cours_82dfaae8") : i18nT("retenter_value_value_en_echec_b7d1f934", { value0: retryableFailureCount, value1: retryableFailureCount > 1 ? "canaux" : "canal" })}
        >
          <span aria-hidden="true">↻</span>
          <span className={resultCss.actionFullLabel}>{retrying
            ? i18nT("relance_en_cours_82dfaae8")
            : i18nT("retenter_value_value_en_echec_b7d1f934", { value0: retryableFailureCount, value1: retryableFailureCount > 1 ? "canaux" : "canal" })}</span>
          {compact ? <span className={resultCss.actionCompactLabel} aria-hidden="true">{retrying ? "Relance…" : `${retryableFailureCount} échec${retryableFailureCount > 1 ? "s" : ""}`}</span> : null}
        </button>
      ) : null}
      <button type="button" onClick={onOpenInrSend} className={resultCss.inrSendButton}>
        <img src="/inrsend-logo-seul.png" alt="" aria-hidden="true" width={23} height={23} />
        <span>{i18nT("voir_dans_inr_send_a74cc9ea")}</span>
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

export default function PublishExecutionResultModal({
  summary,
  onClose,
  onOpenInrSend,
  onRetryFailed,
  retrying = false,
  wizardSteps,
  embedded = false,
  publicationDestinations,
  onSummaryChange,
}: {
  styles: DashboardStyles;
  summary: PublishExecutionSummary | null | undefined;
  onClose: () => void;
  onOpenInrSend: () => void;
  onRetryFailed?: () => void | Promise<void>;
  retrying?: boolean;
  wizardSteps?: readonly PublishWizardStep[];
  embedded?: boolean;
  publicationDestinations?: readonly PublicationProgressDestination[];
  onSummaryChange?: (summary: PublishExecutionSummary) => void;
}) {
  const { metaPilotEnabled } = useDashboardViewerAccess();
  const i18nT = useTranslations("booster");
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (embedded) return;
    const previouslyFocused = document.activeElement;
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const ownsHtmlLock = previousHtmlOverflow !== "hidden";
    const ownsBodyLock = previousBodyOverflow !== "hidden";
    if (ownsHtmlLock) html.style.overflow = "hidden";
    if (ownsBodyLock) body.style.overflow = "hidden";
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      if (ownsHtmlLock) html.style.overflow = previousHtmlOverflow;
      if (ownsBodyLock) body.style.overflow = previousBodyOverflow;
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [embedded]);
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
    ? liveSummary.entries.filter((entry) => isMetaPilotChannelVisible(entry.channel, metaPilotEnabled))
    : [];
  const hasPendingAsyncJob = liveEntries.some(isPendingPublicationEntry);
  const pendingPublicationIds = JSON.stringify([...new Set(liveEntries
    .filter(isPendingPublicationEntry)
    .map((entry) => entryPublicationId(entry, liveSummary || {}))
    .filter(Boolean))].sort());

  useEffect(() => {
    const publicationIds = JSON.parse(pendingPublicationIds) as string[];
    if (!hasPendingAsyncJob || !publicationIds.length) return;

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
        const pendingJobs = await Promise.all(publicationIds.map(async (jobId) => {
          try {
            const response = await fetch(
              `/api/booster/publications/${encodeURIComponent(jobId)}/status`,
              { method: "GET", cache: "no-store" },
            );
            const payload = await response.json().catch(() => ({}));
            if (cancelled) return false;
            if (response.ok && payload?.summary) {
              setLiveSummary((current) => mergePublicationResultSnapshot(current, payload.summary, jobId));
              return payload?.done !== true;
            }
            return true;
          } catch {
            return true;
          }
        }));
        shouldContinue = pendingJobs.some(Boolean);
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
  }, [pendingPublicationIds, hasPendingAsyncJob]);
  const pendingTiktokEntry = liveEntries.find(
    (entry) => entry.channel === "tiktok" && entry.status === "processing",
  );
  const hasPendingTiktok = Boolean(pendingTiktokEntry);
  const tiktokPublicationId = pendingTiktokEntry
    ? entryPublicationId(pendingTiktokEntry, liveSummary || {})
    : "";

  useEffect(() => {
    if (!tiktokPublicationId || !hasPendingTiktok) return;

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
          `/api/inrsend/publications/${encodeURIComponent(tiktokPublicationId)}/tiktok/status`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          },
        );
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
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
            (entry) => entry.channel === "tiktok" && entryPublicationId(entry, current) === tiktokPublicationId,
          );
          if (!previousEntry) return current;

          const nextEntries = current.entries.map((entry) => {
            if (entry.channel !== "tiktok" || entryPublicationId(entry, current) !== tiktokPublicationId) return entry;
            if (complete) {
              return {
                ...entry,
                ok: true,
                status: "published",
                technicalStatus: "completed",
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
                technicalStatus: "failed",
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

          return mergePublicationResultSnapshot(current, { entries: nextEntries }, tiktokPublicationId);
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
  }, [tiktokPublicationId, hasPendingTiktok]);

  useEffect(() => {
    if (!liveSummary || !onSummaryChange) return;
    const liveId = liveSummary.publicationId || liveSummary.publication_id;
    const sourceId = summary?.publicationId || summary?.publication_id;
    if (liveId === sourceId) onSummaryChange(liveSummary);
  }, [liveSummary, summary, onSummaryChange]);

  const effectiveSummary = liveSummary || summary;
  const failureCount = Number(effectiveSummary?.failureCount || 0);
  const successCount = Number(effectiveSummary?.successCount || 0);
  const allFailed = Boolean(effectiveSummary?.allFailed);
  const entries = Array.isArray(effectiveSummary?.entries) ? effectiveSummary.entries : [];
  const warningCount = Math.max(
    Number(effectiveSummary?.warningCount || 0),
    entries.filter((entry) => getPublicationDestinationStatus(entry) === "warning").length,
  );
  const entriesByChannel = new Map(entries.map((entry) => [publicationChannelKey(entry.channel), entry]));
  const destinationsByChannel = new Map((publicationDestinations || []).map((destination) => [publicationChannelKey(destination.key), destination]));
  const destinationKeys = [...new Set([...destinationsByChannel.keys(), ...entriesByChannel.keys()])];
  const missingDestinationCount = destinationKeys.filter((key) => !entriesByChannel.has(key)).length;
  const pendingCount = Math.max(
    Number(effectiveSummary?.pendingCount || 0),
    entries.filter(isPendingPublicationEntry).length + missingDestinationCount,
  );
  const skippedCount = Math.max(
    Number(effectiveSummary?.skippedCount || 0),
    entries.filter((entry) => getPublicationDestinationStatus(entry) === "skipped").length,
  );
  const publishedEntryCount = entries.filter(
    (entry) => ["published", "warning"].includes(getPublicationDestinationStatus(entry)),
  ).length;
  const failedEntryCount = entries.filter(
    (entry) => getPublicationDestinationStatus(entry) === "failed",
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
  const orderedEntries = entries;

  const hasPublishedWarnings = warningCount > 0;
  const overallTitle = hasPublishedChannels
    ? `${publishedCount} publication${publishedCount > 1 ? "s" : ""} en ligne`
    : "Bilan de publication";
  const resultTone = allFailed || (!hasPublishedChannels && failedOrSkippedCount > 0 && !pendingCount)
    ? "failed"
    : pendingCount > 0
      ? "pending"
      : hasPublishedWarnings || failedOrSkippedCount > 0
        ? "warning"
        : hasPublishedChannels ? "published" : "neutral";

  const visualDestinations: PublicationProgressDestination[] = destinationKeys.map((key) => {
    const entry = entriesByChannel.get(key);
    if (!entry) return { key, label: destinationsByChannel.get(key)?.label || key, status: "pending", details: "En attente du résultat de ce canal." };
    const status = getPublicationDestinationStatus(entry);
    const pending = status === "pending";
    const failed = status === "failed";
    const rawWarning = String(entry.warning_message || (entry.warning !== "pending" ? entry.warning || "" : "")).trim();
    const errorMessage = !pending && entry.error
      ? getFrenchPublicationErrorMessage(entry.channel, entry.error, entry.label + " n’a pas pu publier. Merci de réessayer.")
      : failed ? getFrenchPublicationErrorMessage(entry.channel, "publication_failed", entry.label + " n’a pas pu publier. Merci de réessayer.") : "";
    const warningMessage = rawWarning ? ensureFrenchPublicationErrorMessage(rawWarning,
      pending ? entry.label + " est encore en attente de finalisation." : entry.label + " a publié avec un avertissement.") : "";
    const blockers = (entry.blockers || []).map((blocker) => ensureFrenchPublicationErrorMessage(blocker, entry.label + " n’est pas prêt pour la publication."));
    return {
      key,
      label: entry.label,
      status,
      href: String(effectiveSummary?.channelLinks?.[entry.channel] || effectiveSummary?.channelLinks?.[key] || "").trim() || undefined,
      details: [errorMessage, warningMessage, ...blockers].filter(Boolean).join("\n") || undefined,
    };
  });
  const visualTotalCount = Math.max(totalCount, visualDestinations.length);

  const resultActions = (
    <PublishExecutionResultActions summary={effectiveSummary} onOpenInrSend={onOpenInrSend} onRetryFailed={onRetryFailed} retrying={retrying} />
  );

  const closeButton = (
    <button
      ref={closeButtonRef}
      type="button"
      onPointerDown={handleClosePointerDown}
      onClick={handleCloseClick}
      data-testid="publish-result-close"
      aria-label={i18nT("fermer_5ab4ec64")}
      title={i18nT("fermer_5ab4ec64")}
      className={resultCss.closeButton}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
    </button>
  );

  const resultCard = (
    <div className={`${resultCss.resultBody}${embedded ? ` ${progressCss.immersive}` : ""}`} data-result-tone={resultTone} data-embedded={embedded}>
      {embedded && visualDestinations.length ? (
        <PublicationVisualHub
          progress={100}
          destinations={visualDestinations}
          completed={pendingCount === 0 && visualDestinations.every((destination) => Boolean(destination.status))}
          outcome={resultTone}
          centerLabel="Bilan prêt"
        />
      ) : null}
      <div className={resultCss.overview} data-publication-hub-summary={embedded || undefined} role="status" aria-live="polite" aria-atomic="true">
        <header className={resultCss.hero}>
          <div className={resultCss.headline} data-success={hasPublishedChannels || undefined}>
            {hasPublishedChannels ? <span className={resultCss.overallSuccess} aria-hidden="true">🎉</span> : null}
            <h2 id={titleId}>{embedded && visualDestinations.length ? `${publishedCount}/${visualTotalCount} publié${publishedCount > 1 ? "s" : ""}` : overallTitle}</h2>
          </div>
        </header>

      {pendingCount > 0 || failedOrSkippedCount > 0 || warningCount > 0 || !publishedCount ? <div className={resultCss.summary} aria-label="État des publications">
        <div className={resultCss.summaryCounts}>
          {pendingCount > 0 ? (
            <div className={resultCss.metric} data-tone="pending">
              <span className={resultCss.metricIcon} aria-hidden="true">◷</span>
              <strong>{pendingCount}</strong><span>en traitement</span>
            </div>
          ) : null}
          {failedOrSkippedCount > 0 ? (
            <div className={resultCss.metric} data-tone="failed">
              <span className={resultCss.metricIcon} aria-hidden="true">!</span>
              <strong>{failedOrSkippedCount}</strong><span>à revoir</span>
            </div>
          ) : null}
          {warningCount > 0 ? (
            <div className={resultCss.metric} data-tone="warning">
              <span className={resultCss.metricIcon} aria-hidden="true">!</span>
              <strong>{warningCount}</strong><span>avertissement{warningCount > 1 ? "s" : ""}</span>
            </div>
          ) : null}
          {!publishedCount && !pendingCount && !failedOrSkippedCount ? <p className={resultCss.emptySummary}>Consultez le suivi détaillé dans iNrSend.</p> : null}
        </div>
      </div> : null}
      </div>
        {!embedded ? <div className={resultCss.progressTrack} aria-hidden="true">
          <span data-tone="published" style={{ width: (publishedCount / totalCount * 100) + "%" }} />
          <span data-tone="pending" style={{ width: (pendingCount / totalCount * 100) + "%" }} />
          <span data-tone="failed" style={{ width: (failedOrSkippedCount / totalCount * 100) + "%" }} />
        </div> : null}

      {!embedded && entries.length ? (
        <section className={resultCss.channelsSection} aria-label="Résultat par canal">
          {pendingCount > 0 ? <div className={resultCss.sectionHeading}><span className={resultCss.liveIndicator}><span aria-hidden="true" />Suivi en direct</span></div> : null}
          <div className={resultCss.channelGrid}>
            {orderedEntries.map((entry) => {
              const entryStatus = getPublicationDestinationStatus(entry);
              const entryIsPending = entryStatus === "pending";
              const entryIsSkipped = entryStatus === "skipped";
              const entryIsFailed = entryStatus === "failed";
              const entryHasWarning = entryStatus === "warning";
              const channelHref = String(effectiveSummary?.channelLinks?.[entry.channel] || "").trim();
              const channelLogo = CHANNEL_LOGO_BY_KEY[entry.channel];
              const visibleError = !entryIsPending && entry.error
                ? getFrenchPublicationErrorMessage(
                    entry.channel, entry.error,
                    entry.label + " n'a pas pu publier. Merci de réessayer.",
                  )
                : entryIsFailed
                  ? getFrenchPublicationErrorMessage(
                      entry.channel, "publication_failed",
                      entry.label + " n'a pas pu publier. Merci de réessayer.",
                    )
                  : "";
              const rawWarning = String(
                entry.warning_message || (entry.warning !== "pending" ? entry.warning || "" : ""),
              ).trim();
              const visibleWarning = rawWarning
                ? ensureFrenchPublicationErrorMessage(
                    rawWarning,
                    entryIsPending
                      ? entry.label + " est encore en attente de finalisation."
                      : entry.label + " a publié avec un avertissement.",
                  )
                : "";
              const visibleBlockers = (entry.blockers || []).map((blocker) =>
                ensureFrenchPublicationErrorMessage(blocker, entry.label + " n'est pas prêt pour la publication."),
              );
              const tone = entryIsPending ? "pending"
                : entryIsFailed || entryIsSkipped ? "failed"
                  : entryHasWarning ? "warning" : "published";
              const statusLabel = entryIsSkipped ? "Non envoyé"
                : entryIsPending ? "En traitement"
                  : entryIsFailed ? "Échec"
                    : entryHasWarning ? "Publié avec avertissement" : "Publié";
              // Pending is evaluated before ok: an accepted job is not a published post.
              const semanticStatusIcon = entryIsSkipped
                ? "⏭"
                : entryIsPending
                  ? "⏳"
                  : entryIsFailed ? "×" : entryHasWarning ? "!" : "✓";
              const accessibleStatusLabel = entryIsSkipped
                ? "Ignoré avant envoi"
                : entryIsPending
                  ? "En attente"
                  : entryIsFailed ? "Échec" : entryHasWarning ? "Publié avec avertissement" : "Publié";
              const hasFailureDetails = (entryIsFailed || entryIsSkipped) && Boolean(visibleError || visibleBlockers.length);
              const failureDetailsOpen = Boolean(expandedEntryDetails[entry.channel]);
              const detailsId = titleId + "-details-" + entry.channel;

              return (
                <article key={entry.channel} className={resultCss.channelCard} data-tone={tone} data-channel={entry.channel}>
                  <div className={resultCss.channelMain}>
                    <span className={resultCss.channelLogo} aria-hidden="true">
                      {channelLogo ? <img src={channelLogo} alt="" width={34} height={34} loading="eager" decoding="sync" /> : <span>{entry.label.slice(0, 1)}</span>}
                    </span>
                    <div className={resultCss.channelIdentity}>
                      <strong title={entry.label}>{entry.label}</strong>
                      <span className={resultCss.channelStatus} aria-label={entry.label + " — " + accessibleStatusLabel} data-status-icon={semanticStatusIcon}>
                        <span className={resultCss.statusMark} aria-hidden="true">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            {entryIsPending ? <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></> : entryIsFailed || entryIsSkipped || entryHasWarning ? <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v4m0 4h.01" /></> : <path d="m5 12 4 4L19 6" />}
                          </svg>
                        </span>
                        {statusLabel}
                      </span>
                    </div>
                    <div className={resultCss.channelActions}>
                      {hasFailureDetails ? (
                        <button
                          type="button"
                          className={resultCss.detailsButton}
                          aria-label={(failureDetailsOpen ? "Masquer le détail de l’échec " : "Afficher le détail de l’échec ") + entry.label}
                          aria-expanded={failureDetailsOpen}
                          aria-controls={detailsId}
                          onClick={() => setExpandedEntryDetails((current) => ({ ...current, [entry.channel]: !current[entry.channel] }))}
                        ><span aria-hidden="true">i</span></button>
                      ) : null}
                      {channelHref ? (
                        <a href={channelHref} target="_blank" rel="noopener noreferrer" className={resultCss.channelLink} aria-label={i18nT("voir_8a754f1f") + " · " + entry.label}>
                          {i18nT("voir_8a754f1f")}<span aria-hidden="true">↗</span>
                        </a>
                      ) : null}
                    </div>
                  </div>
                  {hasFailureDetails ? (
                    <div id={detailsId} hidden={!failureDetailsOpen}>
                      {visibleError ? <p className={resultCss.entryMessage} data-tone="failed">{visibleError}</p> : null}
                      {entryIsSkipped && visibleBlockers.length ? <p className={resultCss.entryMessage} data-tone="failed">{visibleBlockers.join(" · ")}</p> : null}
                    </div>
                  ) : visibleError ? <p className={resultCss.entryMessage} data-tone="failed">{visibleError}</p> : null}
                  {visibleWarning ? <p className={resultCss.entryMessage} data-tone={entryIsPending ? "pending" : "warning"}>{visibleWarning}</p> : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );

  if (embedded) return resultCard;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={resultCss.overlay}
      data-wizard={Boolean(wizardSteps)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          requestClose();
        } else if (event.key === "Tab") {
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]')).filter(element => !element.closest("[hidden]"));
          const first = focusable[0];
          const last = focusable.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div className={resultCss.shell} data-wizard={Boolean(wizardSteps)}>
        {closeButton}
        {wizardSteps ? (
          <PublishWizardFrame step="results" steps={wizardSteps} canOpenStep={() => false} onOpenStep={() => {}} footer={resultActions}>
            <PublishWizardScreen active step="results">{resultCard}</PublishWizardScreen>
          </PublishWizardFrame>
        ) : (
          <>
            <div role="document" className={resultCss.scrollSurface}>{resultCard}</div>
            <footer className={resultCss.standaloneFooter}>{resultActions}</footer>
          </>
        )}
      </div>
    </div>
  );
}
