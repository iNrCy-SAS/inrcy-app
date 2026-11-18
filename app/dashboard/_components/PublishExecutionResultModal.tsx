"use client";

import { useDashboardViewerAccess } from "./DashboardViewerAccessProvider";
import { isMetaPilotChannelVisible } from "@/lib/metaChannelUiAccess";
import { isRetryablePublicationEntry, publicationEntryRequiresAccountAction, publicationStorySequenceCounts } from "@/lib/publicationStorySequenceRetry";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { useLocale, useTranslations } from "next-intl";
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

import { getProviderPublicationErrorMessage, type PublicationErrorProvider } from "@/lib/publicationErrorFrench";
import { getLocalizedErrorMessage } from "@/lib/userFacingErrors";
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
  total?: number;
  entries?: Array<{
    channel: string;
    label: string;
    targetKey?: string | null;
    placement?: string | null;
    threads_publication_mode?: string | null;
    publicationId?: string | null;
    ok?: boolean;
    status?: "published" | "published_with_warning" | "queued" | "processing" | "failed" | string;
    technicalStatus?: string | null;
    code?: string | null;
    retryable?: boolean;
    story_sequence_resume_ref?: string | null;
    published_image_count?: number | null;
    expected_image_count?: number | null;
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

function publicationChannelKey(channel: string, targetKey?: string | null, placement?: string | null) {
  const [rawChannel, targetPlacement] = String(targetKey || channel).split(":");
  const base = ({ google_business: "gmb", youtube: "youtube_shorts", twitter: "x" } as Record<string, string>)[rawChannel] || rawChannel;
  const format = placement || targetPlacement;
  return format ? `${base}:${format}` : base;
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
  const polledChannels = new Set(current.entries
    .filter((entry) => entryPublicationId(entry, current) === polledPublicationId)
    .map((entry) => publicationChannelKey(entry.channel)));
  const entries = current.entries.flatMap((entry) => {
    if (entryPublicationId(entry, current) !== polledPublicationId) return [entry];
    const key = publicationChannelKey(entry.channel, entry.targetKey, entry.placement);
    const exact = snapshotEntries.find((candidate) => publicationChannelKey(candidate.channel, candidate.targetKey, candidate.placement) === key);
    // Older open dialogs may still have one aggregate card. Upgrade that card
    // to the independently reported formats without borrowing their statuses.
    const replacements = exact ? [exact] : !entry.targetKey && !entry.placement
      ? snapshotEntries.filter((candidate) => publicationChannelKey(candidate.channel) === publicationChannelKey(entry.channel))
      : [];
    if (!replacements.length) return [entry];
    return replacements.map((next) => {
      const sameTarget = publicationChannelKey(next.channel, next.targetKey, next.placement) === key;
      // A slower status read must not undo an already confirmed terminal result.
      if (sameTarget && isPendingPublicationEntry(next) && !isPendingPublicationEntry(entry)) return entry;
      const storyCounts = publicationStorySequenceCounts(next);
      return { ...next, channel: entry.channel, label: next.label || entry.label, publicationId: polledPublicationId,
        published_image_count: storyCounts?.confirmed, expected_image_count: storyCounts?.expected };
    });
  });
  // A target retried under a new publication keeps ownership of its card;
  // an older job must not append its obsolete result for that same target.
  const presentKeys = new Set(entries
    .map((entry) => publicationChannelKey(entry.channel, entry.targetKey, entry.placement)));
  for (const next of snapshotEntries) {
    const key = publicationChannelKey(next.channel, next.targetKey, next.placement);
    if (!polledChannels.has(publicationChannelKey(next.channel)) || presentKeys.has(key)) continue;
    if (!next.targetKey && !next.placement && [...presentKeys].some((present) => present.startsWith(`${key}:`))) continue;
    entries.push({ ...next, publicationId: polledPublicationId });
    presentKeys.add(key);
  }
  const detailedKeys = entries.map((entry) => publicationChannelKey(entry.channel, entry.targetKey, entry.placement)).filter((key) => key.includes(":"));
  const canonicalEntries = [...new Map(entries.filter((entry) => {
    const key = publicationChannelKey(entry.channel, entry.targetKey, entry.placement);
    return key.includes(":") || !detailedKeys.some((target) => target.startsWith(`${key}:`));
  }).map((entry) => [publicationChannelKey(entry.channel, entry.targetKey, entry.placement), entry])).values()];
  const statuses = canonicalEntries.map(getPublicationDestinationStatus);
  const pendingCount = statuses.filter((status) => status === "pending").length;
  const failureCount = statuses.filter((status) => status === "failed").length;
  const warningCount = statuses.filter((status) => status === "warning").length;
  const skippedCount = statuses.filter((status) => status === "skipped").length;
  const successCount = statuses.filter((status) => status === "published" || status === "warning").length;
  return {
    ...current, entries: canonicalEntries, total: canonicalEntries.length, successCount, pendingCount, failureCount, warningCount, skippedCount,
    retryableFailureCount: canonicalEntries.filter(isRetryablePublicationEntry).length,
    allFailed: failureCount > 0 && successCount === 0 && pendingCount === 0,
  };
}

function getPublicationResultCounts(
  effectiveSummary: PublishExecutionSummary | null | undefined,
  publicationDestinations?: readonly PublicationProgressDestination[],
) {
  const successCount = Number(effectiveSummary?.successCount || 0);
  const rawEntries = Array.isArray(effectiveSummary?.entries) ? effectiveSummary.entries : [];
  const selectedKeys = (publicationDestinations || []).map((destination) => publicationChannelKey(destination.key, undefined, destination.placement));
  const explicitKeys = rawEntries.map((entry) => publicationChannelKey(entry.channel, entry.targetKey, entry.placement)).filter((key) => key.includes(":"));
  const entriesByChannel = new Map<string, PublishExecutionEntry>();
  for (const entry of rawEntries) {
    let key = publicationChannelKey(entry.channel, entry.targetKey, entry.placement);
    if (!key.includes(":")) {
      // Channel aggregates are metadata once individual placements are known.
      if (explicitKeys.some((target) => target.startsWith(`${key}:`))) continue;
      const selectedTargets = selectedKeys.filter((target) => target.startsWith(`${key}:`));
      key = selectedTargets.find((target) => !target.endsWith(":story")) || (selectedTargets.length === 1 ? selectedTargets[0] : key);
    }
    entriesByChannel.set(key, key.includes(":") ? { ...entry, targetKey: key, placement: key.split(":")[1] } : entry);
  }
  const entries = [...entriesByChannel.values()];
  const destinationsByChannel = new Map((publicationDestinations || []).flatMap((destination) => {
    const key = publicationChannelKey(destination.key, undefined, destination.placement);
    const targetKeys = key.includes(":") ? [] : [...new Set([...selectedKeys, ...entriesByChannel.keys()])].filter((target) => target.startsWith(`${key}:`));
    // The progress surface can initially contain a channel-level destination.
    // Replace it with its reported formats instead of leaving a phantom card.
    return targetKeys.length
      ? targetKeys.map((target) => [target, { ...destination, key: target, status: undefined }] as const)
      : [[key, destination] as const];
  }));
  // Explicit placement state wins regardless of an older aggregate's order.
  for (const destination of publicationDestinations || []) {
    const key = publicationChannelKey(destination.key, undefined, destination.placement);
    if (key.includes(":")) destinationsByChannel.set(key, destination);
  }
  const destinationKeys = [...new Set([...destinationsByChannel.keys(), ...entriesByChannel.keys()])];
  const statuses = destinationKeys.map((key) => entriesByChannel.has(key)
    ? getPublicationDestinationStatus(entriesByChannel.get(key)!)
    : destinationsByChannel.get(key)?.status || "pending");
  const pendingCount = statuses.length ? statuses.filter((status) => status === "pending").length : Number(effectiveSummary?.pendingCount || 0);
  const failureCount = statuses.length ? statuses.filter((status) => status === "failed").length : Number(effectiveSummary?.failureCount || 0);
  const skippedCount = statuses.length ? statuses.filter((status) => status === "skipped").length : Number(effectiveSummary?.skippedCount || 0);
  const warningCount = statuses.length ? statuses.filter((status) => status === "warning").length : Number(effectiveSummary?.warningCount || 0);
  const publishedCount = statuses.length ? statuses.filter((status) => status === "published" || status === "warning").length : Math.max(0, successCount);
  const failedOrSkippedCount = failureCount + skippedCount;
  const totalCount = Math.max(destinationKeys.length || Number(effectiveSummary?.total || 0) || publishedCount + pendingCount + failedOrSkippedCount, 1);
  const allFailed = statuses.length ? failedOrSkippedCount === totalCount : Boolean(effectiveSummary?.allFailed);
  const hasPublishedChannels = publishedCount > 0;
  return { failureCount, allFailed, entries, warningCount, entriesByChannel, destinationsByChannel, destinationKeys, pendingCount, publishedCount, failedOrSkippedCount, totalCount, hasPublishedChannels };
}

function PublicationResultSummary({ summary, publicationDestinations, compact = false, titleId }: {
  summary: PublishExecutionSummary | null | undefined;
  publicationDestinations?: readonly PublicationProgressDestination[];
  compact?: boolean;
  titleId?: string;
}) {
  const i18nT = useTranslations("booster");
  const { publishedCount, totalCount, pendingCount, failedOrSkippedCount, warningCount, hasPublishedChannels } = getPublicationResultCounts(summary, publicationDestinations);
  return (
    <div className={resultCss.overview} data-publication-hub-summary={compact || undefined} role="status" aria-live="polite" aria-atomic="true">
      <header className={resultCss.hero}>
        <div className={resultCss.headline} data-success={hasPublishedChannels || undefined}>
          {hasPublishedChannels ? <span className={resultCss.overallSuccess} aria-hidden="true">🎉</span> : null}
          <h2 id={titleId}>{summary || publicationDestinations?.length ? i18nT("execution_result_compact_count", { count: publishedCount, total: totalCount }) : i18nT("execution_result_title")}</h2>
        </div>
      </header>

      {pendingCount > 0 || failedOrSkippedCount > 0 || warningCount > 0 || !publishedCount ? <div className={resultCss.summary} aria-label={i18nT("execution_result_state")}>
        <div className={resultCss.summaryCounts}>
          {pendingCount > 0 ? (
            <div className={resultCss.metric} data-tone="pending">
              <span className={resultCss.metricIcon} aria-hidden="true">◷</span>
              <strong>{pendingCount}</strong><span>{i18nT("execution_result_processing")}</span>
            </div>
          ) : null}
          {failedOrSkippedCount > 0 ? (
            <div className={resultCss.metric} data-tone="failed">
              <span className={resultCss.metricIcon} aria-hidden="true">!</span>
              <strong>{failedOrSkippedCount}</strong><span>{i18nT("execution_result_review")}</span>
            </div>
          ) : null}
          {warningCount > 0 ? (
            <div className={resultCss.metric} data-tone="warning">
              <span className={resultCss.metricIcon} aria-hidden="true">!</span>
              <strong>{warningCount}</strong><span>{i18nT("execution_result_warnings", { count: warningCount })}</span>
            </div>
          ) : null}
          {!publishedCount && !pendingCount && !failedOrSkippedCount ? <p className={resultCss.emptySummary}>{i18nT("execution_result_tracking_note")}</p> : null}
        </div>
      </div> : null}
    </div>
  );
}

export function PublishExecutionResultActions({
  summary,
  onOpenInrSend,
  onRetryFailed,
  retrying = false,
  compact = false,
  publicationDestinations,
}: {
  summary: PublishExecutionSummary | null | undefined;
  onOpenInrSend: () => void;
  onRetryFailed?: () => void | Promise<void>;
  retrying?: boolean;
  compact?: boolean;
  publicationDestinations?: readonly PublicationProgressDestination[];
}) {
  const i18nT = useTranslations("booster");
  const resultEntries = getPublicationResultCounts(summary, publicationDestinations).entries;
  const retryInFlightRef = useRef(false);
  const requiresAccountAction = resultEntries.some(publicationEntryRequiresAccountAction);
  const retryableFailureCount = resultEntries.length
    ? resultEntries.filter(isRetryablePublicationEntry).length
    : Math.max(0, Number(summary?.retryableFailureCount || 0));
  const requestRetry = async () => {
    if (retrying || retryInFlightRef.current || !onRetryFailed) return;
    retryInFlightRef.current = true;
    try {
      if (requiresAccountAction && !(await confirmInrcy({
        title: i18nT("execution_result_account_action_confirm_title"),
        message: i18nT("execution_result_account_action_confirm_message"),
        confirmLabel: i18nT("execution_result_account_action_retry"),
        variant: "warning",
      }))) return;
      await onRetryFailed();
    } finally {
      retryInFlightRef.current = false;
    }
  };
  const retryLabel = requiresAccountAction ? i18nT("execution_result_account_action_retry")
    : i18nT("execution_result_retry", { count: retryableFailureCount });

  const actions = (
    <div className={resultCss.actions} data-publish-result-actions data-compact={compact}>
      {onRetryFailed && retryableFailureCount > 0 ? (
        <button
          type="button"
          className={resultCss.retryButton}
          onClick={() => void requestRetry()}
          disabled={retrying}
          aria-busy={retrying}
          aria-label={retrying ? i18nT("relance_en_cours_82dfaae8") : retryLabel}
        >
          <span aria-hidden="true">↻</span>
          <span className={resultCss.actionFullLabel}>{retrying
            ? i18nT("relance_en_cours_82dfaae8")
            : retryLabel}</span>
          {compact ? <span className={resultCss.actionCompactLabel} aria-hidden="true">{retrying ? i18nT("execution_result_retrying_short") : i18nT("execution_result_failures", { count: retryableFailureCount })}</span> : null}
        </button>
      ) : null}
      <button type="button" onClick={onOpenInrSend} className={resultCss.inrSendButton}>
        <img src="/inrsend-logo-seul.png" alt="" aria-hidden="true" width={23} height={23} />
        <span>{i18nT("voir_dans_inr_send_a74cc9ea")}</span>
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );

  if (!compact) return actions;
  return (
    <div className={resultCss.resultFooter} data-publication-result-footer>
      <div className={resultCss.resultFooterLayout}>
        <PublicationResultSummary summary={summary} publicationDestinations={publicationDestinations} compact />
        {actions}
      </div>
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
  const locale = useLocale();
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
              ? "publication_failed"
              : "pending"),
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
  const { allFailed, entries, warningCount, entriesByChannel, destinationsByChannel, destinationKeys, pendingCount, publishedCount, failedOrSkippedCount, totalCount, hasPublishedChannels } = getPublicationResultCounts(effectiveSummary, publicationDestinations);
  const orderedEntries = entries;

  const hasPublishedWarnings = warningCount > 0;
  const resultTone = allFailed || (!hasPublishedChannels && failedOrSkippedCount > 0 && !pendingCount)
    ? "failed"
    : pendingCount > 0
      ? "pending"
      : hasPublishedWarnings || failedOrSkippedCount > 0
        ? "warning"
        : hasPublishedChannels ? "published" : "neutral";

  const channelLabel = (channel: string, label: string, placement?: string | null, threadsMode?: string | null) => {
    const base = publicationChannelKey(channel).split(":")[0];
    const name = base === "site_web" ? i18nT("site_web_7e78af33") : label;
    const format = placement || channel.split(":")[1];
    const formatLabel = format === "classic" ? i18nT("instagram_classic")
      : format === "reel" ? i18nT("instagram_reels") : format === "story" ? i18nT("instagram_stories")
        : base === "threads" && threadsMode === "ghost" ? i18nT("threads_ghost")
          : base === "threads" && threadsMode === "classic" ? i18nT("threads_classic") : "";
    return formatLabel && !name.endsWith(` · ${formatLabel}`) ? `${name} · ${formatLabel}` : name;
  };

  const metaVideoRuleMessage = (entry: PublishExecutionEntry, label: string) => {
    const channel = publicationChannelKey(entry.channel);
    if (channel !== "facebook" && channel !== "instagram") return "";
    const code = String(entry.code || entry.warning || "");
    const rule = code.match(/^(facebook|instagram)_(story|reel)_video_(duration_out_of_range|duration_unverified|dimensions_unverified|frame_rate_unverified|frame_rate|resolution|aspect_ratio|size_unverified|size|width|vertical_recommended)$/);
    const legacyDuration = /^(facebook_vertical_duration_invalid|instagram_story_duration_invalid|instagram_reel_duration_invalid)$/.test(code);
    if (!rule && !legacyDuration) return "";
    if (rule && rule[1] !== channel) return "";
    const placement = entry.placement || rule?.[2] || (code.includes("reel") ? "reel" : "story");
    const maximumDuration = channel === "facebook" && placement === "reel" ? 90 : 60;
    const suffix = legacyDuration ? "duration_out_of_range" : rule?.[3];
    if (suffix === "duration_out_of_range" || suffix === "duration_unverified") {
      // Extract only the numeric value from our validator's public template;
      // never pass the provider diagnostic itself into user-visible markup.
      const measured = String(entry.error || entry.warning_message || "").match(/la vidéo dure (\d+(?:[,.]\d{1,3})?) s\./);
      const duration = measured ? Number(measured[1].replace(",", ".")) : NaN;
      const detail = Number.isFinite(duration) && duration > 0 && duration < 86400
        ? i18nT("execution_result_video_measured_duration", { duration: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(duration) }) : "";
      return [suffix === "duration_unverified" ? i18nT("execution_result_video_metadata_unverified") : detail,
        i18nT("execution_result_video_duration_rule", { channel: label, min: 3, max: maximumDuration })].filter(Boolean).join(" ");
    }
    const requirement = suffix === "resolution" ? i18nT("execution_result_video_resolution_rule", { channel: label })
      : suffix === "frame_rate" || suffix === "frame_rate_unverified" ? i18nT("execution_result_video_frame_rate_rule", { channel: label, min: channel === "facebook" ? 24 : 23 })
        : suffix === "size" || suffix === "size_unverified" ? i18nT("execution_result_video_size_rule", { channel: label })
          : suffix === "width" ? i18nT("execution_result_video_width_rule", { channel: label })
            : suffix === "vertical_recommended" ? i18nT("execution_result_video_vertical_recommended", { channel: label })
              : suffix === "aspect_ratio" && channel === "instagram" ? i18nT("execution_result_video_aspect_ratio_rule", { channel: label })
                : suffix === "dimensions_unverified" && channel === "facebook"
                  ? `${i18nT("execution_result_video_vertical_rule", { channel: label })} ${i18nT("execution_result_video_resolution_rule", { channel: label })}`
                  : suffix === "dimensions_unverified" ? i18nT("execution_result_video_vertical_recommended", { channel: label })
                    : i18nT("execution_result_video_vertical_rule", { channel: label });
    return suffix?.endsWith("_unverified")
      ? `${i18nT("execution_result_video_metadata_unverified")} ${requirement}` : requirement;
  };

  // Raw provider diagnostics stay in the result payload for internal diagnosis.
  // Render known public guidance or a localized next step, including in tooltips.
  const diagnostic = (input: unknown, fallback: string, code?: string | null, provider?: string) => {
    const context = { ...(input && typeof input === "object" ? input : { message: input }), code, channel: provider ? publicationChannelKey(provider).split(":")[0] : undefined };
    const knownMessage = getLocalizedErrorMessage(context, locale, fallback, { allowUnknownMessage: false });
    if (knownMessage !== fallback) return knownMessage;
    if (typeof input === "string" && ["publication_failed", "pending"].includes(input)) return fallback;
    const providerMessage = provider ? getProviderPublicationErrorMessage(publicationChannelKey(provider) as PublicationErrorProvider, input) : null;
    if (providerMessage) return getLocalizedErrorMessage(providerMessage, locale, fallback);
    return fallback;
  };

  const entryDiagnostics = (entry: PublishExecutionEntry) => {
    const label = channelLabel(entry.channel, entry.label, entry.placement, entry.threads_publication_mode);
    const status = getPublicationDestinationStatus(entry);
    const errorFallback = i18nT("execution_result_failed_message", { channel: label });
    const errorInput = status !== "pending" ? entry.error || (status === "failed" ? "publication_failed" : "") : "";
    const ruleMessage = metaVideoRuleMessage(entry, label);
    const error = errorInput ? ruleMessage || diagnostic({ ...entry, message: errorInput }, errorFallback, entry.code, entry.channel) : "";
    const rawWarning = String(entry.warning_message || (entry.warning !== "pending" ? entry.warning || "" : "")).trim();
    const warningFallback = i18nT(status === "pending" ? "execution_result_pending_message" : "execution_result_warning_message", { channel: label });
    const warning = rawWarning ? ruleMessage || diagnostic(rawWarning, warningFallback) : "";
    const blockerFallback = i18nT("execution_result_blocker_message", { channel: label });
    const blockers = (entry.blockers || []).map((blocker) => diagnostic(blocker, blockerFallback));
    return {
      error, warning, blockers,
    };
  };

  const visualDestinations: PublicationProgressDestination[] = destinationKeys.map((key) => {
    const entry = entriesByChannel.get(key);
    if (!entry) return { key, channel: key.split(":")[0], label: channelLabel(key, destinationsByChannel.get(key)?.label || key), status: destinationsByChannel.get(key)?.status || "pending", details: i18nT("execution_result_waiting_channel") };
    const status = getPublicationDestinationStatus(entry);
    const details = entryDiagnostics(entry);
    const storyCounts = publicationStorySequenceCounts(entry);
    return {
      key,
      channel: publicationChannelKey(entry.channel).split(":")[0],
      placement: entry.placement,
      label: channelLabel(entry.channel, entry.label, entry.placement, entry.threads_publication_mode),
      status,
      storyProgressLabel: storyCounts ? i18nT("publication_stories_confirmed_count", { confirmed: storyCounts.confirmed, expected: storyCounts.expected }) : undefined,
      href: String(effectiveSummary?.channelLinks?.[key] || effectiveSummary?.channelLinks?.[entry.channel] || "").trim() || undefined,
      details: [details.error, details.warning, ...details.blockers].filter(Boolean).join("\n") || undefined,
    };
  });

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
          centerLabel={i18nT("execution_result_ready")}
        />
      ) : null}
      {!embedded ? <PublicationResultSummary summary={effectiveSummary} publicationDestinations={publicationDestinations} titleId={titleId} /> : null}
        {!embedded ? <div className={resultCss.progressTrack} aria-hidden="true">
          <span data-tone="published" style={{ width: (publishedCount / totalCount * 100) + "%" }} />
          <span data-tone="pending" style={{ width: (pendingCount / totalCount * 100) + "%" }} />
          <span data-tone="failed" style={{ width: (failedOrSkippedCount / totalCount * 100) + "%" }} />
        </div> : null}

      {!embedded && entries.length ? (
        <section className={resultCss.channelsSection} aria-label={i18nT("execution_result_by_channel")}>
          {pendingCount > 0 ? <div className={resultCss.sectionHeading}><span className={resultCss.liveIndicator}><span aria-hidden="true" />{i18nT("execution_result_live_tracking")}</span></div> : null}
          <div className={resultCss.channelGrid}>
            {orderedEntries.map((entry) => {
              const entryKey = publicationChannelKey(entry.channel, entry.targetKey, entry.placement);
              const storyCounts = publicationStorySequenceCounts(entry);
              const entryStatus = getPublicationDestinationStatus(entry);
              const entryIsPending = entryStatus === "pending";
              const entryIsSkipped = entryStatus === "skipped";
              const entryIsFailed = entryStatus === "failed";
              const entryHasWarning = entryStatus === "warning";
              const channelHref = String(effectiveSummary?.channelLinks?.[entryKey] || effectiveSummary?.channelLinks?.[entry.channel] || "").trim();
              const channelLogo = CHANNEL_LOGO_BY_KEY[entry.channel];
              const label = channelLabel(entry.channel, entry.label, entry.placement, entry.threads_publication_mode);
              const { error: visibleError, warning: visibleWarning, blockers: visibleBlockers } = entryDiagnostics(entry);
              const tone = entryIsPending ? "pending"
                : entryIsFailed || entryIsSkipped ? "failed"
                  : entryHasWarning ? "warning" : "published";
              const statusLabel = i18nT(entryIsSkipped ? "execution_result_not_sent"
                : entryIsPending ? "execution_result_processing_status"
                  : entryIsFailed ? "execution_result_failed"
                    : entryHasWarning ? "execution_result_published_warning" : "execution_result_published");
              // Pending is evaluated before ok: an accepted job is not a published post.
              const semanticStatusIcon = entryIsSkipped
                ? "⏭"
                : entryIsPending
                  ? "⏳"
                  : entryIsFailed ? "×" : entryHasWarning ? "!" : "✓";
              const accessibleStatusLabel = entryIsSkipped
                ? i18nT("execution_result_skipped_before_sending")
                : entryIsPending ? i18nT("execution_result_pending") : statusLabel;
              const hasFailureDetails = (entryIsFailed || entryIsSkipped) && Boolean(visibleError || visibleBlockers.length);
              const failureDetailsOpen = Boolean(expandedEntryDetails[entryKey]);
              const detailsId = titleId + "-details-" + entryKey;

              return (
                <article key={entryKey} className={resultCss.channelCard} data-tone={tone} data-channel={entry.channel} data-target-key={entryKey}>
                  <div className={resultCss.channelMain}>
                    <span className={resultCss.channelLogo} aria-hidden="true">
                      {channelLogo ? <img src={channelLogo} alt="" width={34} height={34} loading="eager" decoding="sync" /> : <span>{label.slice(0, 1)}</span>}
                    </span>
                    <div className={resultCss.channelIdentity}>
                      <strong title={label}>{label}</strong>
                      <span className={resultCss.channelStatus} aria-label={label + " — " + accessibleStatusLabel} data-status-icon={semanticStatusIcon}>
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
                          aria-label={i18nT(failureDetailsOpen ? "execution_result_hide_failure_details" : "execution_result_show_failure_details", { channel: label })}
                          aria-expanded={failureDetailsOpen}
                          aria-controls={detailsId}
                          onClick={() => setExpandedEntryDetails((current) => ({ ...current, [entryKey]: !current[entryKey] }))}
                        ><span aria-hidden="true">i</span></button>
                      ) : null}
                      {channelHref ? (
                        <a href={channelHref} target="_blank" rel="noopener noreferrer" className={resultCss.channelLink} aria-label={i18nT("voir_8a754f1f") + " · " + label}>
                          {i18nT("voir_8a754f1f")}<span aria-hidden="true">↗</span>
                        </a>
                      ) : null}
                    </div>
                  </div>
                  {storyCounts ? <p className={resultCss.entryMessage} data-story-confirmed-count>{i18nT("publication_stories_confirmed_count", { confirmed: storyCounts.confirmed, expected: storyCounts.expected })}</p> : null}
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
