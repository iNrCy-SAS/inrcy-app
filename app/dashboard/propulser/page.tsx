"use client";

import { useLocale, useTranslations } from "next-intl";


import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "../../dashboard/dashboard.module.css";
import b from "../booster/booster.module.css";
import BaseModal from "../_components/WorkflowBaseModal";
import DetailSequenceNavigation from "../_components/DetailSequenceNavigation";
import ResponsiveActionButton from "../_components/ResponsiveActionButton";
import HelpButton from "../_components/HelpButton";
import HelpModal from "../_components/HelpModal";
import { getGoalCopy } from "@/lib/weeklyGoals";
import { PROFILE_VERSION_EVENT, type ProfileVersionChangeDetail } from "@/lib/profileVersioning";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { useUnsavedExitGuard } from "../_hooks/useUnsavedExitGuard";
import PublishAiConfigurationDrawer from "../booster/publier/components/PublishAiConfigurationDrawer";
import { MODULE_SNAPSHOT_KEYS, readModuleSnapshot, writeModuleSnapshot } from "@/lib/browserModuleSnapshotCache";


const ValoriserModal = dynamic(() => import("./components/valoriser/ValoriserModal"), {
  ssr: false,
  loading: () => <GrowthEditorLoading />,
});
const RecolterModal = dynamic(() => import("./components/recolter/RecolterModal"), {
  ssr: false,
  loading: () => <GrowthEditorLoading />,
});
const OffrirModal = dynamic(() => import("./components/offrir/OffrirModal"), {
  ssr: false,
  loading: () => <GrowthEditorLoading />,
});

function GrowthEditorLoading() {
  const i18nT = useTranslations("growth");
  return <div style={{ padding: 24, textAlign: "center" }}>{i18nT("chargement_de_l_editeur_5a6e7fa2")}</div>;
}

type ActiveModal = null | "valorize" | "reviews" | "promo";

type WeeklySummary = {
  turbo?: { multiplier: number; connectedCount: number; totalChannels: number };
  missions?: {
    weeklyPropulserUse?: { done: boolean; gained: number; projected: number };
  };
};

const PROPULSER_GOAL = 1;
const PROPULSER_THEMES = ["valorize", "reviews", "promo"] as const;
type PropulserTheme = (typeof PROPULSER_THEMES)[number];
type PropulserMetricsSnapshot = { metrics: any; weeklySummary: WeeklySummary | null };

export default function PropulserPage() {
  const i18nT = useTranslations("growth");
  const locale = useLocale();
  const [helpOpen, setHelpOpen] = useState(false);
  const [aiConfigurationOpen, setAiConfigurationOpen] = useState(false);
  const [isMobileHeader, setIsMobileHeader] = useState(false);
  const [active, setActive] = useState<ActiveModal>(null);
  const workflowDraftActionRef = useRef<(() => Promise<void>) | null>(null);
  const [workflowDraftSaving, setWorkflowDraftSaving] = useState(false);
  const [workflowDraftMessage, setWorkflowDraftMessage] = useState("");
  const [initialMetricsSnapshot] = useState<PropulserMetricsSnapshot | null>(() =>
    readModuleSnapshot<PropulserMetricsSnapshot>(MODULE_SNAPSHOT_KEYS.propulserMetrics)?.data ?? null,
  );
  const [metrics, setMetrics] = useState<any>(() => initialMetricsSnapshot?.metrics ?? null);
  const [weeklySummary, setWeeklySummary] = useState<WeeklySummary | null>(() => initialMetricsSnapshot?.weeklySummary ?? null);
  const [metricsLoadedOnce, setMetricsLoadedOnce] = useState(() => Boolean(initialMetricsSnapshot));

  const searchParams = useSearchParams();

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobileHeader(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  const closeActiveModal = useCallback(() => {
    setActive(null);
  }, []);

  const activeHasUnsavedWork = active === "valorize" || active === "reviews" || active === "promo";

  const requestCloseActiveModal = useCallback(async () => {
    if (activeHasUnsavedWork) {
      const ok = await confirmInrcy({
        eyebrow: active === "valorize" ? "Valorisation en cours" : "Modèle en cours",
        title: active === "valorize" ? "Quitter la valorisation ?" : "Quitter ce modèle ?",
        message: i18nT("vous_avez_un_modele_en_cours_6354a6c4"),
        cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
        confirmLabel: i18nT("quitter_3e4126f5"),
        variant: "danger",
      });
      if (!ok) return;
    }
    closeActiveModal();
  }, [active, activeHasUnsavedWork, closeActiveModal]);

  useUnsavedExitGuard({
    active: Boolean(active),
    shouldBlock: Boolean(activeHasUnsavedWork),
    onConfirmExit: closeActiveModal,
    eyebrow: active === "valorize" ? "Valorisation en cours" : "Modèle en cours",
    title: active === "valorize" ? "Quitter la valorisation ?" : "Quitter ce modèle ?",
    message: i18nT("vous_avez_un_modele_en_cours_6354a6c4"),
    cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
    confirmLabel: i18nT("quitter_3e4126f5"),
    variant: "danger",
  });

  useEffect(() => {
    const a = (searchParams?.get("action") || "").toLowerCase();
    const normalized =
      a === "valoriser" || a === "valorize" ? "valorize" :
      a === "recolter" ? "reviews" :
      a === "offrir" ? "promo" :
      a;
    if (normalized === "valorize" || normalized === "reviews" || normalized === "promo") {
      setActive(normalized as ActiveModal);
    }
  }, [searchParams]);

  const refreshMetrics = useCallback(async () => {
    try {
      const [metricsRes, summaryRes] = await Promise.all([
        fetch("/api/propulser/metrics?days=30", { cache: "no-store" as any }),
        fetch("/api/loyalty/weekly-summary", { cache: "no-store" as any }),
      ]);
      const nextMetrics = metricsRes.ok ? await metricsRes.json() : null;
      const nextWeeklySummary = summaryRes.ok ? await summaryRes.json() : null;
      if (nextMetrics !== null) setMetrics(nextMetrics);
      if (nextWeeklySummary !== null) setWeeklySummary(nextWeeklySummary);
      if (nextMetrics !== null && nextWeeklySummary !== null) {
        writeModuleSnapshot<PropulserMetricsSnapshot>(MODULE_SNAPSHOT_KEYS.propulserMetrics, {
          metrics: nextMetrics,
          weeklySummary: nextWeeklySummary,
        });
      }
    } catch {
      // Le cache déjà affiché reste disponible pendant une coupure réseau.
    } finally {
      setMetricsLoadedOnce(true);
    }
  }, []);

  useEffect(() => { void refreshMetrics(); }, [refreshMetrics]);

  useEffect(() => {
    const handleProfileVersionChange = (event: Event) => {
      const detail = (event as CustomEvent<ProfileVersionChangeDetail>).detail;
      if (!(detail?.field === "publications_version" || detail?.field === "loyalty_version")) return;
      void refreshMetrics();
    };
    window.addEventListener(PROFILE_VERSION_EVENT, handleProfileVersionChange as EventListener);
    return () => window.removeEventListener(PROFILE_VERSION_EVENT, handleProfileVersionChange as EventListener);
  }, [refreshMetrics]);

  const activeThemeIndex = active ? PROPULSER_THEMES.indexOf(active as PropulserTheme) : -1;
  const switchActiveTheme = useCallback(async (direction: -1 | 1) => {
    if (activeThemeIndex < 0) return;
    const next = PROPULSER_THEMES[activeThemeIndex + direction];
    if (!next) return;
    const ok = await confirmInrcy({
      eyebrow: i18nT("modele_en_cours_12d87956"),
      title: i18nT("changer_de_theme_681e14d6"),
      message: i18nT("les_modifications_non_enregistrees_du_theme_b2a5284d"),
      cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
      confirmLabel: i18nT("changer_de_theme_5113d95e"),
      variant: "warning",
    });
    if (!ok) return;
    setWorkflowDraftMessage("");
    workflowDraftActionRef.current = null;
    setActive(next);
  }, [activeThemeIndex]);

  const metricsLoading = !metricsLoadedOnce;

  const data = useMemo(() => {
    const valorize = metrics?.valorize ?? {};
    const review = metrics?.review_mail ?? {};
    const promo = metrics?.promo_mail ?? {};
    const n = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const turbo = weeklySummary?.turbo?.multiplier ?? 1;
    const featureMissionDone = Boolean(weeklySummary?.missions?.weeklyPropulserUse?.done);
    const missionProjected = Number(weeklySummary?.missions?.weeklyPropulserUse?.projected ?? Math.round(10 * turbo));
    const featureGained = Number(weeklySummary?.missions?.weeklyPropulserUse?.gained ?? 0);
    const valorizeWeek = n(valorize.week);
    const reviewWeek = n(review.week);
    const promoWeek = n(promo.week);
    const totalWeek = valorizeWeek + reviewWeek + promoWeek;

    const formatLastSend = (value: any) => {
      if (!value) return "—";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "—";
      return date.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
    };

    const buildStatus = (done: number, goal: number) => {
      const copy = getGoalCopy(done, goal);
      return { label: copy.short, color: copy.tone, helper: copy.hint, ctaHint: copy.action };
    };

    const buildMissionReward = (doneThisCard: number, missionDone: boolean, projected: number, gained: number) => {
      if (missionDone) {
        if (doneThisCard > 0) return `${gained} UI gagnés`;
        return "Mission UI déjà sécurisée";
      }
      return `+${projected} UI × multiplicateur`;
    };

    const buildMissionHelper = (doneThisCard: number, missionDone: boolean, fallback: string) => {
      if (missionDone && doneThisCard <= 0) return "Cette action reste utile, mais ne rapporte plus d’UI cette semaine.";
      return fallback;
    };

    const missionStatus = buildStatus(totalWeek, PROPULSER_GOAL);
    const campaignRows = (item: any) => [
      { name: "Envoyées cette semaine", value: n(item.week) },
      { name: "Envoyées ce mois-ci", value: n(item.month) },
      { name: "Destinataires touchés", value: n(item.sent) },
      { name: "Dernier envoi", value: formatLastSend(item.last_sent_at) },
    ];
    const valorizeRows = (item: any) => [
      { name: "Envoyées cette semaine", value: n(item.week) },
      { name: "Envoyées ce mois-ci", value: n(item.month) },
      { name: "Destinataires touchés", value: n(item.sent) },
      { name: "Dernier envoi", value: formatLastSend(item.last_sent_at) },
    ];

    const actions = [
      {
        key: "valorize" as const,
        title: i18nT("valoriser_0859943f"),
        desc: "Mettez en avant vos avis, réalisations, coulisses, savoir-faire ou preuves de confiance.",
        accent: "cyan" as const,
        cta: i18nT("lancer_6a009498"),
        status: { ...missionStatus, helper: buildMissionHelper(valorizeWeek, featureMissionDone, missionStatus.helper) },
        reward: buildMissionReward(valorizeWeek, featureMissionDone, missionProjected, featureGained),
      },
      {
        key: "reviews" as const,
        title: i18nT("recolter_1d0f06aa"),
        desc: "Demandez des avis ou des retours clients via un email prêt à envoyer.",
        accent: "purple" as const,
        cta: i18nT("lancer_6a009498"),
        status: { ...missionStatus, helper: buildMissionHelper(reviewWeek, featureMissionDone, missionStatus.helper) },
        reward: buildMissionReward(reviewWeek, featureMissionDone, missionProjected, featureGained),
      },
      {
        key: "promo" as const,
        title: i18nT("offrir_48d9d533"),
        desc: "Mettez en avant une offre commerciale auprès des bons contacts.",
        accent: "pink" as const,
        cta: i18nT("lancer_6a009498"),
        status: { ...missionStatus, helper: buildMissionHelper(promoWeek, featureMissionDone, missionStatus.helper) },
        reward: buildMissionReward(promoWeek, featureMissionDone, missionProjected, featureGained),
      },
    ];

    return {
      turbo,
      missions: {
        totalAvailable: missionProjected,
        totalEarned: featureGained,
        completedCount: Number(featureMissionDone),
        featureDone: featureMissionDone,
        projectedFeature: missionProjected,
        totalWeek,
      },
      actions,
      metrics: [
        { title: i18nT("valorisations_9d618671"), variant: "campaign", month: n(valorize.month), week: valorizeWeek, goal: PROPULSER_GOAL, status: buildStatus(valorizeWeek, PROPULSER_GOAL), channels: valorizeRows(valorize) },
        { title: i18nT("recoltes_4c5913ca"), variant: "campaign", month: n(review.month), week: reviewWeek, goal: PROPULSER_GOAL, status: buildStatus(reviewWeek, PROPULSER_GOAL), channels: campaignRows(review) },
        { title: i18nT("offres_1b2f74c2"), variant: "campaign", month: n(promo.month), week: promoWeek, goal: PROPULSER_GOAL, status: buildStatus(promoWeek, PROPULSER_GOAL), channels: campaignRows(promo) },
      ],
      tips: [
        { title: i18nT("pour_mieux_valoriser_aa7c0476"), lines: [{ left: "Avis client", right: "Confiance" }, { left: "Avant / après", right: "Preuve" }, { left: "Photo réelle", right: "Crédible" }] },
        { title: i18nT("pour_mieux_recolter_b17edf36"), lines: [{ left: "Envoyer à J+1", right: "Meilleur taux" }, { left: "10 contacts ciblés", right: "Plus d’avis" }, { left: "1 relance simple", right: "x1.4" }] },
        { title: i18nT("pour_mieux_offrir_1bf173fe"), lines: [{ left: "Offre courte 7 jours", right: "Décision rapide" }, { left: "1 CTA clair", right: "Plus de clics" }, { left: "Segmenter la liste", right: "Plus pertinent" }] },
      ],
    };
  }, [i18nT, locale, metrics, weeklySummary]);

  const saveWorkflowDraftFromHeader = useCallback(async () => {
    if (!workflowDraftActionRef.current || workflowDraftSaving) return;
    setWorkflowDraftSaving(true);
    setWorkflowDraftMessage("");
    try {
      await workflowDraftActionRef.current();
    } finally {
      setWorkflowDraftSaving(false);
    }
  }, [workflowDraftSaving]);

  useEffect(() => {
    if (!active) setWorkflowDraftMessage("");
  }, [active]);

  return (
    <main className={`${styles.page} ${b.page}`}>

      <PublishAiConfigurationDrawer
        open={aiConfigurationOpen}
        isMobile={isMobileHeader}
        drawerHeight="100dvh"
        onClose={() => setAiConfigurationOpen(false)}
      />

      <div style={{ filter: active ? "blur(10px)" : "none", opacity: active ? 0.55 : 1, transition: "filter 180ms ease, opacity 180ms ease", pointerEvents: active ? "none" : "auto" }} aria-hidden={active ? true : undefined}>
        <div className={b.container}>
          <header className={b.headerRow}>
            <div className={b.titleLine}><span aria-hidden className={b.titleIcon}>🚀</span><div className={styles.title}>{i18nT("propulser_2de43942")}</div></div>
            <div className={b.tagline}>{i18nT("lancez_une_action_business_75b7d4e1")}{" "}<strong>{i18nT("valoriser_recolter_ou_offrir_f36016e7")}</strong></div>
            <div className={b.closeWrap}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <HelpButton onClick={() => setHelpOpen(true)} title={i18nT("aide_propulser_f14568d1")} />
                <ResponsiveActionButton desktopLabel={i18nT("fideliser_8fa9e4f1")} mobileIcon="F" href="/dashboard/fideliser" ariaLabel={i18nT("aller_vers_fideliser_27c4ce6a")} title={i18nT("fideliser_8fa9e4f1")} className={b.headerBtnFideliser} />
                <Link href="/dashboard/mails?folder=propulsions" aria-label={i18nT("aller_vers_inr_send_propulsions_dfee649f")} title={i18nT("ouvrir_inr_send_d4b453c9")} className={`${b.inrSendHeaderShortcut} ${b.headerBtnInrSend}`}>
                  <span className={b.inrSendHeaderText}>{i18nT("inr_send_5c2a3e92")}</span>
                  <img className={b.inrSendHeaderLogo} src="/inrsend-logo-seul.png" alt="" aria-hidden />
                </Link>
                <ResponsiveActionButton desktopLabel={i18nT("fermer_5ab4ec64")} mobileIcon="✕" href="/dashboard" />
              </div>
            </div>
          </header>

          <HelpModal open={helpOpen} title={i18nT("propulser_2de43942")} onClose={() => setHelpOpen(false)}>
            <p style={{ marginTop: 0 }}>{i18nT("propulser_regroupe_les_actions_qui_donnent_7b72a6ea")}</p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li><strong>{i18nT("valoriser_0859943f")}</strong> {" "}{i18nT("mettre_en_avant_le_savoir_faire_87004354")}</li>
              <li><strong>{i18nT("recolter_1d0f06aa")}</strong> {" "}{i18nT("obtenir_des_avis_retours_ou_demandes_3478d1ae")}</li>
              <li><strong>{i18nT("offrir_48d9d533")}</strong> {" "}{i18nT("pousser_une_offre_ou_une_opportunite_5fe01f41")}</li>
            </ul>
          </HelpModal>

          <section className={[styles.blockCard, b.missionBanner, data.missions.featureDone ? b.missionBannerDone : b.missionBannerTodo].join(" ")}>
            <div className={b.missionBannerLeft}>
              <div className={b.heroEyebrow}>{i18nT("mission_propulser_09f6fdac")}</div>
              <div className={b.missionBannerTitle}>{i18nT("1_action_semaine_af4d116e")}</div>
            </div>
            <div className={b.missionBannerCenter}>
              <span className={b.missionBannerProgress}>{metricsLoading ? <TinyLoader /> : `${data.missions.completedCount}/1`}</span>
              <span className={b.missionBannerState}>{metricsLoading ? i18nT("chargement_c7ac0481") : data.missions.featureDone ? i18nT("validee_2cc6c327") : i18nT("a_lancer_244bf2ef")}</span>
            </div>
            <div className={b.missionBannerRight}>
              <span className={b.missionBannerUi}>{i18nT("jusqu_a_22ae04ef")}{" "}{metricsLoading ? <TinyLoader /> : `+${data.missions.totalAvailable}`} UI</span>
              <span className={b.missionBannerEarned}>{metricsLoading ? <TinyLoader /> : `+${data.missions.totalEarned}`} {" "}{i18nT("ui_gagnes_cb41480e")}</span>
            </div>
          </section>

          <div className={b.desktopOnly}>
            <section className={b.triRow} aria-hidden>
              <div className={[b.triItem, b.triCyan].join(" ")}><div className={b.triLabel}>VALORISER</div></div>
              <div className={[b.triItem, b.triPurple].join(" ")}><div className={b.triLabel}>{i18nT("recolter_8a526e6d")}</div></div>
              <div className={[b.triItem, b.triPink].join(" ")}><div className={b.triLabel}>OFFRIR</div></div>
            </section>

            <section className={b.rocketGrid}>
              {data.actions.map((a, idx) => {
                const m = data.metrics[idx];
                const tip = data.tips[idx];
                return (
                  <article key={a.key} className={b.rocketColumn}>
                    <ActionCard styles={styles} accent={a.accent} title={a.title} desc={a.desc} cta={a.cta} onClick={() => setActive(a.key)} />
                    <MetricCard styles={styles} title={m.title} month={m.month} channels={m.channels} loading={metricsLoading} />
                    <TipPanel styles={styles} title={tip.title} lines={tip.lines} />
                  </article>
                );
              })}
            </section>
          </div>

          <section className={b.mobileOnly}>
            {data.actions.map((a, idx) => {
              const m = data.metrics[idx];
              const tip = data.tips[idx];
              return (
                <div key={a.key} className={b.mobileGroup}>
                  <ActionCard styles={styles} accent={a.accent} title={a.title} desc={a.desc} cta={a.cta} onClick={() => setActive(a.key)} />
                  <details className={[b.accordion, b.mobileAccordion].join(" ")}>
                    <summary className={b.accordionSummary}>
                      <span>📊 {m.title}</span>
                      <span className={b.chev}>▾</span>
                    </summary>
                    <div className={b.accordionBody}>
                      <MetricCard styles={styles} title={m.title} month={m.month} channels={m.channels} loading={metricsLoading} />
                    </div>
                  </details>
                  <details className={[b.accordion, b.mobileAccordion].join(" ")}>
                    <summary className={b.accordionSummary}>
                      <span>💡 {tip.title}</span>
                      <span className={b.chev}>▾</span>
                    </summary>
                    <div className={b.accordionBody}>
                      <TipPanel styles={styles} title={tip.title} lines={tip.lines} />
                    </div>
                  </details>
                </div>
              );
            })}
          </section>
        </div>
      </div>


      {active && (
        <BaseModal
          title={active === "valorize" ? "Valoriser" : active === "reviews" ? "Récolter" : "Offrir"}
          moduleLabel={i18nT("module_propulser_08eded54")}
          onClose={requestCloseActiveModal}
          headerHidden={false}
          titleOnLeftOnMobile
          hideModuleLabelOnMobile
          headerStatus={workflowDraftMessage ? <span style={{ fontSize: 12, fontWeight: 800 }}>{workflowDraftMessage}</span> : null}
          headerStatusMobileHidden
          headerActions={
            <>
              <DetailSequenceNavigation
                label={`${activeThemeIndex + 1} / ${PROPULSER_THEMES.length}`}
                canPrevious={activeThemeIndex > 0}
                canNext={activeThemeIndex >= 0 && activeThemeIndex < PROPULSER_THEMES.length - 1}
                onPrevious={() => switchActiveTheme(-1)}
                onNext={() => switchActiveTheme(1)}
                ariaLabel={i18nT("navigation_entre_les_themes_propulser_9e51e926")}
              />
              <button type="button" className={`${styles.secondaryBtn} ${styles.aiHeaderBtn}`} onClick={() => setAiConfigurationOpen(true)} aria-label={i18nT("configuration_ia_f620c8d8")} title={i18nT("configuration_ia_f620c8d8")} style={{ width: isMobileHeader ? 32 : 38, minWidth: isMobileHeader ? 32 : 38, minHeight: isMobileHeader ? 32 : 36, padding: 0, fontSize: isMobileHeader ? 12 : 13, borderRadius: 999 }}>IA</button>
              <button type="button" className={styles.secondaryBtn} onClick={() => void saveWorkflowDraftFromHeader()} disabled={workflowDraftSaving} title={i18nT("enregistrer_le_brouillon_6a319595")} aria-label={i18nT("enregistrer_le_brouillon_6a319595")} style={{ width: isMobileHeader ? 32 : 38, minWidth: isMobileHeader ? 32 : 38, minHeight: isMobileHeader ? 32 : 36, padding: 0, display: "inline-grid", placeItems: "center", fontSize: isMobileHeader ? 15 : 18, borderRadius: 999, opacity: workflowDraftSaving ? 0.64 : 1, cursor: workflowDraftSaving ? "wait" : "pointer" }}>
                {workflowDraftSaving ? "…" : "💾"}
              </button>
            </>
          }
        >
          {active === "valorize" && <ValoriserModal styles={styles} onClose={requestCloseActiveModal} onDone={closeActiveModal} saveDraftActionRef={workflowDraftActionRef} onDraftStatusChange={setWorkflowDraftMessage} />}
          {active === "reviews" && <RecolterModal styles={styles} onClose={requestCloseActiveModal} onDone={closeActiveModal} saveDraftActionRef={workflowDraftActionRef} onDraftStatusChange={setWorkflowDraftMessage} />}
          {active === "promo" && <OffrirModal styles={styles} onClose={requestCloseActiveModal} onDone={closeActiveModal} saveDraftActionRef={workflowDraftActionRef} onDraftStatusChange={setWorkflowDraftMessage} />}
        </BaseModal>
      )}
    </main>
  );
}


function ActionCard({ styles, accent, title, desc, cta, onClick }: any) {
  return (
    <article className={[styles.moduleCard, styles[`accent_${accent}`], b.actionCard, b.actionCardSimple].join(" ")}>
      <div className={styles.moduleGlow} />
      <div className={b.actionMiniTitle}>{title}</div>
      <div className={[styles.moduleDesc, b.actionDesc].join(" ")}>{desc}</div>
      <div className={b.actionBtnWrap}>
        <button type="button" className={[styles.primaryBtn, b.actionBtn].join(" ")} onClick={onClick}>{cta}</button>
      </div>
    </article>
  );
}

function TinyLoader() {
  const i18nT = useTranslations("growth");
  return <span aria-label={i18nT("chargement_c7ac0481")} title={i18nT("chargement_c7ac0481")}>…</span>;
}

function MetricCard({ styles, title, month, channels, loading }: any) {
  const i18nT = useTranslations("growth");
  return (
    <div className={[styles.blockCard, b.metricCard, b.metricCardSimple].join(" ")}>
      <div className={b.cardTopRow}>
        <div>
          <div className={styles.blockTitle}>{title}</div>
          <div className={b.progressLabel}>{i18nT("statistiques_fdce305a")}</div>
        </div>
        <div className={b.pill}>{i18nT("ce_mois_688e5f3c")}{" "}{loading ? <TinyLoader /> : month}</div>
      </div>
      <div className={[b.channelGridCompact, b.channelGridCampaign, b.statsListSimple].join(" ")}>
        {channels.map((c: any) => (
          <div key={c.name} className={b.channelItemCompact}>
            <span>{c.name}</span>
            <span className={b.channelCount}>{loading ? <TinyLoader /> : c.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TipPanel({ styles, title, lines }: any) {
  return (
    <div className={[styles.blockCard, b.tipPanel].join(" ")}>
      <div className={b.tipPanelTitle}>💡 {title}</div>
      <div className={b.tipListCompact}>
        {lines.map((l: any, idx: number) => (
          <div key={idx} className={b.tipLineCompact}>
            <span>{l.left}</span>
            <span className={b.tipBadge}>{l.right}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


const aiHeaderButtonStyle: CSSProperties = {
  width: 38,
  minWidth: 38,
  minHeight: 36,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 2,
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 900,
  lineHeight: 1,
};
