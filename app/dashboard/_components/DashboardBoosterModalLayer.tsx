"use client";

import { useTranslations } from "next-intl";


import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../dashboard.module.css";
import b from "../booster/booster.module.css";
import BaseModal from "./WorkflowBaseModal";
import StatusMessage from "./StatusMessage";
import HelpButton from "./HelpButton";
import { WEEKLY_GOALS, clampProgress, getGoalCopy } from "@/lib/weeklyGoals";
import { getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { PROFILE_VERSION_EVENT, type ProfileVersionChangeDetail } from "@/lib/profileVersioning";
import {
  invalidateModuleSnapshot,
  MODULE_SNAPSHOT_KEYS,
} from "@/lib/browserModuleSnapshotCache";
import {
  postBoosterPublication,
  type BoosterPublishProgressUpdate,
} from "@/lib/boosterPublishClient";
import { mergePreflightFailuresIntoPublicationSummary } from "@/lib/boosterPublicationOutcome";
import { useUnsavedExitGuard } from "../_hooks/useUnsavedExitGuard";
import PublishModal from "../booster/publier/PublishModal";
import PublishExecutionResultModal from "./PublishExecutionResultModal";

type DashboardBoosterModalMode = "publish" | "stats" | null;

type WeeklySummary = {
  turbo?: { multiplier: number; connectedCount: number; totalChannels: number };
  missions?: {
    createActu?: { done: boolean; gained: number; projected: number };
  };
};

type PublishDraftHeaderState = {
  saving: boolean;
  draftSaving: boolean;
  draftMessage: string;
};

const BOOSTER_METRICS_REFRESH_DEBOUNCE_MS = 1_000;

export default function DashboardBoosterModalLayer({
  mode,
  onClose,
  initialConnectedChannels,
}: {
  mode: DashboardBoosterModalMode;
  onClose: () => void;
  initialConnectedChannels?: Partial<Record<"inrcy_site" | "site_web" | "inr_search" | "gmb" | "facebook" | "instagram" | "linkedin" | "tiktok" | "youtube_shorts" | "pinterest", boolean>>;
}) {
  const i18nT = useTranslations("booster");
  const router = useRouter();
  const [publishSuccessOpen, setPublishSuccessOpen] = useState(false);
  const [publishSummary, setPublishSummary] = useState<any>(null);
  const [publishEditorOverlayOpen, setPublishEditorOverlayOpen] = useState(false);
  const [publishHasUnsavedChanges, setPublishHasUnsavedChanges] = useState(false);
  const [publishRetrying, setPublishRetrying] = useState(false);
  const publishRetryFailedRef = useRef<(() => Promise<void>) | null>(null);
  const publishSaveDraftRef = useRef<(() => void) | null>(null);
  const publishOpenHelpRef = useRef<(() => void) | null>(null);
  const [publishDraftHeaderState, setPublishDraftHeaderState] = useState<PublishDraftHeaderState>({
    saving: false,
    draftSaving: false,
    draftMessage: "",
  });
  const [publishDraftMobileToast, setPublishDraftMobileToast] = useState("");
  const [metrics, setMetrics] = useState<any>(null);
  const [weeklySummary, setWeeklySummary] = useState<WeeklySummary | null>(null);
  const metricsRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const metricsRefreshQueuedRef = useRef(false);
  const metricsRefreshTimerRef = useRef<number | null>(null);

  const refreshMetrics = useCallback(async () => {
    if (metricsRefreshPromiseRef.current) {
      metricsRefreshQueuedRef.current = true;
      await metricsRefreshPromiseRef.current;
      return;
    }

    do {
      metricsRefreshQueuedRef.current = false;
      const job = (async () => {
        try {
          const [metricsRes, summaryRes] = await Promise.all([
            fetch("/api/booster/metrics?days=30", { cache: "no-store" as any }),
            fetch("/api/loyalty/weekly-summary", { cache: "no-store" as any }),
          ]);
          if (metricsRes.ok) setMetrics(await metricsRes.json());
          if (summaryRes.ok) setWeeklySummary(await summaryRes.json());
        } catch {
          // Silencieux : la modale doit rester utilisable même si une stat échoue.
        }
      })();

      metricsRefreshPromiseRef.current = job;
      try {
        await job;
      } finally {
        if (metricsRefreshPromiseRef.current === job) {
          metricsRefreshPromiseRef.current = null;
        }
      }
    } while (metricsRefreshQueuedRef.current);
  }, []);

  const scheduleMetricsRefresh = useCallback(() => {
    if (metricsRefreshTimerRef.current != null) {
      window.clearTimeout(metricsRefreshTimerRef.current);
    }
    metricsRefreshTimerRef.current = window.setTimeout(() => {
      metricsRefreshTimerRef.current = null;
      void refreshMetrics();
    }, BOOSTER_METRICS_REFRESH_DEBOUNCE_MS);
  }, [refreshMetrics]);

  useEffect(() => {
    if (!mode) {
      if (metricsRefreshTimerRef.current != null) {
        window.clearTimeout(metricsRefreshTimerRef.current);
        metricsRefreshTimerRef.current = null;
      }
      return;
    }
    void refreshMetrics();
  }, [mode, refreshMetrics]);

  useEffect(() => () => {
    if (metricsRefreshTimerRef.current != null) {
      window.clearTimeout(metricsRefreshTimerRef.current);
      metricsRefreshTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const open = mode === "publish";
    const root = document.documentElement;
    if (open) root.dataset.inrcyPublishOpen = "1";
    else delete root.dataset.inrcyPublishOpen;
    window.dispatchEvent(
      new CustomEvent("inrcy:publish-modal-state", { detail: { open } }),
    );

    return () => {
      if (!open) return;
      delete root.dataset.inrcyPublishOpen;
      window.dispatchEvent(
        new CustomEvent("inrcy:publish-modal-state", {
          detail: { open: false },
        }),
      );
    };
  }, [mode]);

  useEffect(() => {
    const handleProfileVersionChange = (event: Event) => {
      const detail = (event as CustomEvent<ProfileVersionChangeDetail>).detail;
      if (!(detail?.field === "publications_version" || detail?.field === "loyalty_version")) return;
      if (!mode) return;
      scheduleMetricsRefresh();
    };

    window.addEventListener(PROFILE_VERSION_EVENT, handleProfileVersionChange as EventListener);
    return () => window.removeEventListener(PROFILE_VERSION_EVENT, handleProfileVersionChange as EventListener);
  }, [mode, scheduleMetricsRefresh]);

  const closePublishModal = useCallback(() => {
    setPublishEditorOverlayOpen(false);
    setPublishHasUnsavedChanges(false);
    publishRetryFailedRef.current = null;
    setPublishRetrying(false);
    onClose();
  }, [onClose]);

  const closePublishSuccess = useCallback(() => {
    // The result modal can be shown while the publish editor is still mounted
    // (for example after a partial/failed publication). Clear both layers so
    // the close button always dismisses the complete Booster / Publier flow.
    setPublishSuccessOpen(false);
    setPublishSummary(null);
    setPublishEditorOverlayOpen(false);
    setPublishHasUnsavedChanges(false);
    publishRetryFailedRef.current = null;
    setPublishRetrying(false);
    // Always close the parent layer as well. The result overlay can outlive a
    // mode transition, and leaving the parent mounted makes the X appear to do
    // nothing even though its own state was cleared.
    closePublishModal();
  }, [closePublishModal]);

  const requestClosePublishModal = useCallback(async () => {
    if (publishHasUnsavedChanges) {
      const ok = await confirmInrcy({
        eyebrow: i18nT("publication_en_cours_58f34b8e"),
        title: i18nT("quitter_la_publication_509848c0"),
        message: i18nT("du_contenu_a_deja_ete_saisi_6057d3e7"),
        cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
        confirmLabel: i18nT("quitter_3e4126f5"),
        variant: "danger",
      });
      if (!ok) return;
    }
    closePublishModal();
  }, [closePublishModal, publishHasUnsavedChanges]);


  const handlePublishDraftHeaderStateChange = useCallback((next: PublishDraftHeaderState) => {
    setPublishDraftHeaderState((prev) =>
      prev.saving === next.saving &&
      prev.draftSaving === next.draftSaving &&
      prev.draftMessage === next.draftMessage
        ? prev
        : next,
    );
  }, []);

  useEffect(() => {
    if (mode === "publish") return;
    publishSaveDraftRef.current = null;
    setPublishDraftHeaderState({ saving: false, draftSaving: false, draftMessage: "" });
    setPublishDraftMobileToast("");
  }, [mode]);

  useEffect(() => {
    if (mode !== "publish") return;
    const message = publishDraftHeaderState.draftMessage;
    const isFinalDraftNotice = message === "Brouillon enregistré" || message === "Brouillon chargé";
    if (!isFinalDraftNotice) return;

    setPublishDraftMobileToast(message);
    const timer = window.setTimeout(() => {
      setPublishDraftMobileToast((current) => (current === message ? "" : current));
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [mode, publishDraftHeaderState.draftMessage]);

  useUnsavedExitGuard({
    active: mode === "publish",
    shouldBlock: mode === "publish" && publishHasUnsavedChanges,
    onConfirmExit: closePublishModal,
    eyebrow: i18nT("publication_en_cours_58f34b8e"),
    title: i18nT("quitter_la_publication_509848c0"),
    message: i18nT("du_contenu_a_deja_ete_saisi_6057d3e7"),
    cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
    confirmLabel: i18nT("quitter_3e4126f5"),
    variant: "danger",
  });

  const trackEvent = useCallback(
    async (type: "publish", payload: Record<string, any>) => {
      const isoWeekId = () => {
        const d = new Date();
        const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const dayNum = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
        return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
      };

      const award = async (actionKey: string, amount: number, sourceId: string, label?: string) => {
        try {
          await fetch("/api/loyalty/award", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              actionKey,
              amount,
              sourceId,
              label: label ?? null,
              meta: { origin: "booster", type },
            }),
          });
        } catch {
          // ignore
        }
      };

      try {
        const requestedVisibleWaitMs = Number(payload._clientVisibleWaitMs);
        const maxPollingMs = Number.isFinite(requestedVisibleWaitMs)
          ? Math.max(0, Math.min(90_000, requestedVisibleWaitMs))
          : undefined;
        const onPublicationProgress =
          typeof payload._onPublicationProgress === "function"
            ? (payload._onPublicationProgress as (
                update: BoosterPublishProgressUpdate,
              ) => void)
            : undefined;
        const publishPayload = { ...payload };
        delete publishPayload._clientVisibleWaitMs;
        // Callback strictement local : ne jamais le sérialiser ni l'envoyer à
        // l'API de publication.
        delete publishPayload._onPublicationProgress;
        const json = await postBoosterPublication(
          {
          ...publishPayload,
          source: payload.source || "booster_manual",
          origin: {
            ...(payload.origin || {}),
            source: payload.source || payload.origin?.source || "booster_manual",
            label: payload.origin?.label || "Booster",
            workflowTool: payload.origin?.workflowTool || "booster",
            workflowAction: payload.origin?.workflowAction || "publier",
          },
          },
          { maxPollingMs, onProgress: onPublicationProgress },
        );

        const summary = (json?.summary || null) as Record<string, any> | null;
        const failed = Object.entries((json?.results || {}) as Record<string, any>).filter(([, value]) => value && value.ok === false);

        // Si l’API renvoie un bilan canal par canal, on laisse toujours la modale
        // de résultat l’afficher, même quand un seul canal échoue.
        // Le message en bas de page reste réservé aux vrais problèmes techniques
        // sans résumé exploitable : réseau, serveur, JSON invalide, etc.
        if (!summary && failed.length) {
          const detail = failed.map(([channel, value]) => `${channel}: ${String((value as any)?.error || "erreur")}`).join(" | ");
          throw new Error(getSimpleFrenchErrorMessage(detail, "La publication a échoué."));
        }

        if (!summary || Number(summary.successCount || 0) > 0) {
          // La fidélité ne doit jamais retarder la 30e seconde ni l'ouverture
          // du bilan. L'attribution est idempotente et secondaire à l'envoi.
          void award("create_actu", 10, `week-${isoWeekId()}`, "Actu créée");
        }
        return json;
      } finally {
        // Metrics are secondary to the publishing acknowledgement. Refresh
        // them in the background so a slow dashboard request never keeps the
        // publication progress modal open.
        void Promise.resolve(refreshMetrics()).catch(() => undefined);
      }
    },
    [refreshMetrics],
  );

  const data = useMemo(() => {
    const publish = metrics?.publish ?? {};
    const n = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const publishWeek = n(publish.week);
    const turbo = weeklySummary?.turbo?.multiplier ?? 1;
    const rewardProjected = Number(weeklySummary?.missions?.createActu?.projected ?? Math.round(10 * turbo));
    const rewardGained = Number(weeklySummary?.missions?.createActu?.gained ?? 0);
    const publishChannels = publish.channels ?? {};
    const pc = (k: string) => n(publishChannels?.[k]);
    const statusCopy = getGoalCopy(publishWeek, WEEKLY_GOALS.booster.publish);
    const createActuDone = Boolean(weeklySummary?.missions?.createActu?.done);

    return {
      title: i18nT("publications_0855684c"),
      month: n(publish.month),
      week: publishWeek,
      goal: WEEKLY_GOALS.booster.publish,
      status: {
        label: statusCopy.short,
        color: statusCopy.tone,
        helper: createActuDone && publishWeek <= 0 ? "Mission UI déjà sécurisée cette semaine." : statusCopy.hint,
      },
      reward: {
        projected: rewardProjected,
        gained: rewardGained,
        done: createActuDone,
      },
      channels: [
        { name: "Site iNrCy", value: pc("inrcy_site") },
        { name: "Site web", value: pc("site_web") },
        { name: "Google Business", value: pc("gmb") },
        { name: "Facebook", value: pc("facebook") },
        { name: "Instagram", value: pc("instagram") },
        { name: "LinkedIn", value: pc("linkedin") },
      ],
      tips: [
        { left: "1 publication / semaine", right: "minimum" },
        { left: "Canaux prioritaires", right: "site + réseaux" },
        { left: "Objectif", right: "visibilité" },
      ],
    };
  }, [metrics, weeklySummary]);

  return (
    <>
      {mode === "stats" ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={i18nT("bilan_booster_f20fce08")}
          className={[styles.fullscreenModalOverlay, b.statsModalOverlay].join(" ")}
          onMouseDown={onClose}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            display: "grid",
            placeItems: "center",
            padding: 16,
            background: "rgba(3, 8, 20, 0.58)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            overflow: "auto",
          }}
        >
          <div
            className={[styles.blockCard, b.statsModalPanel].join(" ")}
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              width: "min(820px, calc(100vw - 24px))",
              maxWidth: "100%",
              overflow: "hidden",
              padding: 16,
              borderRadius: 24,
              boxShadow: "0 28px 90px rgba(0,0,0,0.48)",
              background: "radial-gradient(circle at 18% 10%, rgba(56,189,248,0.18), transparent 34%), radial-gradient(circle at 86% 0%, rgba(168,85,247,0.18), transparent 32%), linear-gradient(180deg, rgba(14,18,32,0.99), rgba(9,12,24,0.99))",
            }}
          >
            <div
              className={styles.blockHeaderRow}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 10,
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <span className={styles.ghostBtn} style={{ pointerEvents: "none", borderRadius: 999, padding: "7px 12px" }}>{i18nT("booster_8e4caec0")}</span>
              <div style={{ textAlign: "center" }}>
                <span className={styles.ghostBtn} style={{ pointerEvents: "none", borderRadius: 999, padding: "7px 12px" }}>{i18nT("bilan_a80c4623")}</span>
              </div>
              <button type="button" className={styles.ghostBtn} onClick={onClose} style={{ borderRadius: 999, padding: "7px 12px" }}>
                {i18nT("fermer_5ab4ec64")}{" "}</button>
            </div>

            <DashboardBoosterMetricCard data={data} />
            <details className={b.accordion} style={{ marginTop: 12 }}>
              <summary className={b.accordionSummary}><span>{i18nT("pour_mieux_publier_d16d5b81")}</span><span className={b.chev}>▾</span></summary>
              <div className={b.accordionBody}>
                <div className={[styles.blockCard, b.tipCard].join(" ")}>
                  <div className={b.tipListCompact}>
                    {data.tips.map((line, index) => (
                      <div key={index} className={b.tipLineCompact}><span>{line.left}</span><span className={b.tipBadge}>{line.right}</span></div>
                    ))}
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>
      ) : null}

      {mode === "publish" ? (
        <BaseModal
          title={i18nT("publier_34e6b19e")}
          moduleLabel={i18nT("module_booster_0eb9581c")}
          titleOnLeftOnMobile
          hideModuleLabelOnMobile
          onClose={requestClosePublishModal}
          headerHidden={publishEditorOverlayOpen}
          headerStatus={
            publishDraftHeaderState.draftMessage ? (
              <StatusMessage
                variant="success"
                className={styles.publishDraftHeaderStatus}
                style={{
                  marginTop: 0,
                  minHeight: 34,
                  padding: "6px 10px",
                  fontSize: 12,
                  whiteSpace: "normal",
                  maxWidth: "min(320px, calc(100vw - 120px))",
                  minWidth: 0,
                  overflowWrap: "anywhere",
                }}
              >
                {publishDraftHeaderState.draftMessage}
              </StatusMessage>
            ) : null
          }
          headerStatusMobileHidden
          headerActions={
            <>
              <HelpButton
                onClick={() => publishOpenHelpRef.current?.()}
                title={i18nT("aide_publication_et_inr_send_b984bd87")}
                size={32}
              />

              <button
                type="button"
                className={`${styles.secondaryBtn} ${styles.aiHeaderBtn}`}
                onClick={() => window.dispatchEvent(new CustomEvent("inrcy:open-ai-configuration"))}
                title={i18nT("configuration_ia_f620c8d8")}
                aria-label={i18nT("configuration_ia_f620c8d8")}
              >
                IA
              </button>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => publishSaveDraftRef.current?.()}
                disabled={publishDraftHeaderState.saving || publishDraftHeaderState.draftSaving}
                title={i18nT("enregistrer_le_brouillon_publication_22a24f8b")}
                aria-label={i18nT("enregistrer_le_brouillon_publication_22a24f8b")}
                style={{
                  width: 38,
                  minWidth: 38,
                  minHeight: 36,
                  padding: 0,
                  display: "inline-grid",
                  placeItems: "center",
                  fontSize: 18,
                  borderRadius: 999,
                  opacity: publishDraftHeaderState.saving || publishDraftHeaderState.draftSaving ? 0.64 : 1,
                  cursor: publishDraftHeaderState.saving || publishDraftHeaderState.draftSaving ? "wait" : "pointer",
                }}
              >
                {publishDraftHeaderState.draftSaving ? "…" : "💾"}
              </button>
            </>
          }
        >
          <PublishModal
            styles={styles}
            onClose={closePublishModal}
            trackEvent={trackEvent}
            onOverlayOpenChange={setPublishEditorOverlayOpen}
            onUnsavedChange={setPublishHasUnsavedChanges}
            saveDraftActionRef={publishSaveDraftRef}
            openHelpActionRef={publishOpenHelpRef}
            onDraftHeaderStateChange={handlePublishDraftHeaderStateChange}
            initialConnectedChannels={initialConnectedChannels}
            onPublishSuccess={(result) => {
              publishRetryFailedRef.current =
                typeof result?.retryFailed === "function"
                  ? result.retryFailed
                  : null;
              const preflightFailedChannels = Array.isArray(
                result?.preflightFailedChannels,
              )
                ? result.preflightFailedChannels
                : [];
              const summary = result?.summary
                ? {
                    ...mergePreflightFailuresIntoPublicationSummary(
                      result.summary,
                      preflightFailedChannels,
                    ),
                    channelLinks: result?.channelLinks || {},
                    publicationId:
                      String(
                        result?.publication_id || result?.publicationId || "",
                      ).trim() || null,
                    retryableFailureCount: Array.isArray(
                      result?.retryFailedChannels,
                    )
                      ? result.retryFailedChannels.length
                      : 0,
                  }
                : null;
              // A previous dashboard warm-up may still contain the history from
              // before this publication. Keep it only as a visual optimization:
              // iNrSend must read the accepted publication from the server.
              invalidateModuleSnapshot(MODULE_SNAPSHOT_KEYS.inrSendDefault);
              setPublishSummary(summary);
              setPublishSuccessOpen(true);
            }}
          />
        </BaseModal>
      ) : null}

      {mode === "publish" && publishDraftMobileToast ? (
        <div className={styles.publishDraftMobileToast} aria-live="polite">
          <StatusMessage variant="success" className={styles.publishDraftMobileToastMessage}>
            {publishDraftMobileToast}
          </StatusMessage>
        </div>
      ) : null}

      {publishSuccessOpen ? (
        <PublishExecutionResultModal
          styles={styles}
          summary={publishSummary}
          onClose={closePublishSuccess}
          retrying={publishRetrying}
          onRetryFailed={
            publishRetryFailedRef.current
              ? async () => {
                  if (publishRetrying) return;
                  setPublishSuccessOpen(false);
                  setPublishRetrying(true);
                  try {
                    await publishRetryFailedRef.current?.();
                  } finally {
                    setPublishRetrying(false);
                  }
                }
              : undefined
          }
          onOpenInrSend={() => {
            // Ne pas appeler closePublishModal ici : son onClose remet l'URL sur
            // /dashboard et peut écraser la navigation vers iNrSend.
            setPublishSuccessOpen(false);
            setPublishSummary(null);
            setPublishEditorOverlayOpen(false);
            setPublishHasUnsavedChanges(false);
            publishRetryFailedRef.current = null;
            setPublishRetrying(false);
            router.push("/dashboard/mails?folder=publications");
          }}
        />
      ) : null}
    </>
  );
}

function DashboardBoosterMetricCard({ data }: { data: any }) {
  const i18nT = useTranslations("booster");
  const progress = clampProgress(data.week, data.goal);
  const toneClass = data.status.color === "green" ? b.toneGreen : data.status.color === "orange" ? b.toneOrange : b.toneRed;
  const reward = data.reward ?? { projected: 0, gained: 0, done: false };
  const rewardMain = reward.done ? `${reward.gained} UI débloqués cette semaine` : `Jusqu’à +${reward.projected} UI à débloquer`;
  const rewardSub = reward.done ? "Mission Booster validée" : `${reward.gained} UI gagnés`;
  return (
    <div className={[styles.blockCard, b.metricCard, b.boosterStatsCard].join(" ")}>
      <div className={b.cardTopRow}>
        <div className={styles.blockTitle}>{data.title}</div>
        <div className={b.pill}>{i18nT("ce_mois_value_98fdfb42", { value0: data.month })}</div>
      </div>
      <div className={b.statsRewardInline} aria-label={i18nT("unites_d_inr_cy_a_debloquer_684675e7")}>
        <span className={b.statsRewardPrimary}>{rewardMain}</span>
        <span className={b.statsRewardSecondary}>{rewardSub}</span>
      </div>
      <div className={b.progressLabel}>{i18nT("progression_hebdo_64ff4a6f")}</div>
      <div className={b.metricLine}>
        <div className={[b.metricBubble, toneClass].join(" ")}>{data.week}/{data.goal}</div>
        <div className={[b.progressState, toneClass].join(" ")}>{data.status.label}</div>
      </div>
      <div className={b.progressBar}><div className={[b.progressFill, toneClass].join(" ")} style={{ width: `${progress * 100}%` }} /></div>
      <div className={b.progressHint}>{data.status.helper}</div>
      <div className={b.channelGridCompact}>
        {data.channels.map((channel: any) => (
          <div key={channel.name} className={b.channelItemCompact}><span>{channel.name}</span><span className={b.channelCount}>{channel.value}</span></div>
        ))}
      </div>
    </div>
  );
}
