"use client";

import { useLocale, useTranslations } from "next-intl";


import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "../../dashboard/dashboard.module.css";
import b from "./fideliser.module.css";
import BaseModal from "../_components/WorkflowBaseModal";
import DetailSequenceNavigation from "../_components/DetailSequenceNavigation";
import ResponsiveActionButton from "../_components/ResponsiveActionButton";
import HelpButton from "../_components/HelpButton";
import HelpModal from "../_components/HelpModal";
import { WEEKLY_GOALS, getGoalCopy } from "@/lib/weeklyGoals";
import { PROFILE_VERSION_EVENT, type ProfileVersionChangeDetail } from "@/lib/profileVersioning";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { useUnsavedExitGuard } from "../_hooks/useUnsavedExitGuard";
import PublishAiConfigurationDrawer from "../booster/publier/components/PublishAiConfigurationDrawer";
import { MODULE_SNAPSHOT_KEYS, readModuleSnapshot, writeModuleSnapshot } from "@/lib/browserModuleSnapshotCache";
import AiConfigurationIcon from "../_components/AiConfigurationIcon";


const InformerModal = dynamic(() => import("./components/informer/InformerModal"), {
  ssr: false,
  loading: () => <GrowthEditorLoading />,
});
const SuivreModal = dynamic(() => import("./components/suivre/SuivreModal"), {
  ssr: false,
  loading: () => <GrowthEditorLoading />,
});
const EnqueterModal = dynamic(() => import("./components/enqueter/EnqueterModal"), {
  ssr: false,
  loading: () => <GrowthEditorLoading />,
});

function GrowthEditorLoading() {
  const i18nT = useTranslations("growth");
  return <div style={{ padding: 24, textAlign: "center" }}>{i18nT("chargement_de_l_editeur_5a6e7fa2")}</div>;
}

type ActiveModal = null | "inform" | "thanks" | "satisfaction";
const FIDELISER_THEMES = ["inform", "thanks", "satisfaction"] as const;
type FideliserTheme = (typeof FIDELISER_THEMES)[number];

type WeeklySummary = {
  turbo?: { multiplier: number; connectedCount: number; totalChannels: number };
  missions?: {
    weeklyFideliserUse?: { done: boolean; gained: number; projected: number };
  };
};
type FideliserMetricsSnapshot = { metrics: any; weeklySummary: WeeklySummary | null };

export default function FideliserPage() {
  const i18nT = useTranslations("growth");
  const locale = useLocale();
  const [helpOpen, setHelpOpen] = useState(false);
  const [aiConfigurationOpen, setAiConfigurationOpen] = useState(false);
  const [isMobileHeader, setIsMobileHeader] = useState(false);
  const [active, setActive] = useState<ActiveModal>(null);
  const workflowDraftActionRef = useRef<(() => Promise<void>) | null>(null);
  const [workflowDraftSaving, setWorkflowDraftSaving] = useState(false);
  const [workflowDraftMessage, setWorkflowDraftMessage] = useState("");
  const [initialMetricsSnapshot] = useState<FideliserMetricsSnapshot | null>(() =>
    readModuleSnapshot<FideliserMetricsSnapshot>(MODULE_SNAPSHOT_KEYS.fideliserMetrics)?.data ?? null,
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

  const closeActiveModal = useCallback(() => setActive(null), []);

  const requestCloseActiveModal = useCallback(async () => {
    if (active) {
      const ok = await confirmInrcy({
        eyebrow: i18nT("modele_en_cours_12d87956"),
        title: i18nT("quitter_ce_modele_a8a7d73a"),
        message: i18nT("vous_avez_un_modele_en_cours_6354a6c4"),
        cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
        confirmLabel: i18nT("quitter_3e4126f5"),
        variant: "danger",
      });
      if (!ok) return;
    }
    closeActiveModal();
  }, [active, closeActiveModal]);

  useUnsavedExitGuard({
    active: Boolean(active),
    shouldBlock: Boolean(active),
    onConfirmExit: closeActiveModal,
    eyebrow: i18nT("modele_en_cours_12d87956"),
    title: i18nT("quitter_ce_modele_a8a7d73a"),
    message: i18nT("vous_avez_un_modele_en_cours_6354a6c4"),
    cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
    confirmLabel: i18nT("quitter_3e4126f5"),
    variant: "danger",
  });

  useEffect(() => {
    const a = (searchParams?.get("action") || "").toLowerCase();
    const normalized = a === "informer" ? "inform" : a === "suivre" ? "thanks" : a === "enqueter" ? "satisfaction" : a;
    if (normalized === "inform" || normalized === "thanks" || normalized === "satisfaction") {
      setActive(normalized as ActiveModal);
    }
  }, [searchParams]);

  const refreshMetrics = useCallback(async () => {
    try {
      const [metricsRes, summaryRes] = await Promise.all([
        fetch("/api/fideliser/metrics?days=30", { cache: "no-store" as any }),
        fetch("/api/loyalty/weekly-summary", { cache: "no-store" as any }),
      ]);
      const nextMetrics = metricsRes.ok ? await metricsRes.json() : null;
      const nextWeeklySummary = summaryRes.ok ? await summaryRes.json() : null;
      if (nextMetrics !== null) setMetrics(nextMetrics);
      if (nextWeeklySummary !== null) setWeeklySummary(nextWeeklySummary);
      if (nextMetrics !== null && nextWeeklySummary !== null) {
        writeModuleSnapshot<FideliserMetricsSnapshot>(MODULE_SNAPSHOT_KEYS.fideliserMetrics, {
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

  useEffect(() => {
    void refreshMetrics();
  }, [refreshMetrics]);

  useEffect(() => {
    const handleProfileVersionChange = (event: Event) => {
      const detail = (event as CustomEvent<ProfileVersionChangeDetail>).detail;
      if (!(detail?.field === "loyalty_version")) return;
      void refreshMetrics();
    };

    window.addEventListener(PROFILE_VERSION_EVENT, handleProfileVersionChange as EventListener);
    return () => {
      window.removeEventListener(PROFILE_VERSION_EVENT, handleProfileVersionChange as EventListener);
    };
  }, [refreshMetrics]);

  const activeThemeIndex = active ? FIDELISER_THEMES.indexOf(active as FideliserTheme) : -1;
  const switchActiveTheme = useCallback(async (direction: -1 | 1) => {
    if (activeThemeIndex < 0) return;
    const next = FIDELISER_THEMES[activeThemeIndex + direction];
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
    const newsletter = metrics?.newsletter_mail ?? {};
    const thanks = metrics?.thanks_mail ?? {};
    const satisfaction = metrics?.satisfaction_mail ?? {};
    const n = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const turbo = weeklySummary?.turbo?.multiplier ?? 1;
    const featureMissionDone = Boolean(weeklySummary?.missions?.weeklyFideliserUse?.done);
    const missionProjected = Number(weeklySummary?.missions?.weeklyFideliserUse?.projected ?? Math.round(10 * turbo));
    const featureGained = Number(weeklySummary?.missions?.weeklyFideliserUse?.gained ?? 0);
    const totalEarned = featureGained;

    const buildStatus = (done: number, goal: number) => {
      const copy = getGoalCopy(done, goal);
      return { label: copy.short, color: copy.tone, helper: copy.hint };
    };

    const buildMissionReward = (doneThisCard: number, missionDone: boolean, projected: number, gained: number) => {
      if (missionDone) {
        if (doneThisCard > 0) return `${gained} UI gagnés`;
        return `Mission UI déjà sécurisée`;
      }
      return `+${projected} UI × multiplicateur`;
    };

    const buildMissionHelper = (doneThisCard: number, missionDone: boolean, fallback: string) => {
      if (missionDone && doneThisCard <= 0) return "Cette action reste utile, mais ne rapporte plus d’UI cette semaine.";
      return fallback;
    };

    const informWeek = n(newsletter.week);
    const thanksWeek = n(thanks.week);
    const satisfactionWeek = n(satisfaction.week);
    const totalWeek = informWeek + thanksWeek + satisfactionWeek;
    const missionStatus = buildStatus(totalWeek, 1);

    const formatLastSend = (value: any) => {
      if (!value) return "—";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "—";
      return date.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
    };

    return {
      turbo,
      missions: {
        totalAvailable: missionProjected,
        totalEarned,
        completedCount: Number(featureMissionDone),
        featureDone: featureMissionDone,
        projectedFeature: missionProjected,
        totalWeek,
      },
      actions: [
        {
          key: "inform" as const,
          title: i18nT("informer_570ee22d"),
          desc: "Newsletter, actualités, nouveautés. Sélectionnez vos contacts CRM puis envoyez.",
          accent: "cyan" as const,
          cta: i18nT("envoyer_e9ce243b"),
          status: { ...missionStatus, helper: buildMissionHelper(informWeek, featureMissionDone, missionStatus.helper) },
          reward: buildMissionReward(informWeek, featureMissionDone, missionProjected, featureGained),
        },
        {
          key: "thanks" as const,
          title: i18nT("suivre_7cca6c92"),
          desc: "Un mail simple après intervention. Sélectionnez des contacts CRM. Lancez.",
          accent: "purple" as const,
          cta: i18nT("envoyer_e9ce243b"),
          status: { ...missionStatus, helper: buildMissionHelper(thanksWeek, featureMissionDone, missionStatus.helper) },
          reward: buildMissionReward(thanksWeek, featureMissionDone, missionProjected, featureGained),
        },
        {
          key: "satisfaction" as const,
          title: i18nT("enqueter_4fd8cc8c"),
          desc: "Enquête de satisfaction ou demande d’avis. Envoyez aux bons clients.",
          accent: "pink" as const,
          cta: i18nT("envoyer_e9ce243b"),
          status: { ...missionStatus, helper: buildMissionHelper(satisfactionWeek, featureMissionDone, missionStatus.helper) },
          reward: buildMissionReward(satisfactionWeek, featureMissionDone, missionProjected, featureGained),
        },
      ],
      metrics: [
        {
          title: i18nT("informations_54937b3a"),
          variant: "campaign",
          month: n(newsletter.month),
          week: informWeek,
          goal: WEEKLY_GOALS.fideliser.inform,
          status: buildStatus(informWeek, WEEKLY_GOALS.fideliser.inform),
          channels: [
            { name: "Envoyées cette semaine", value: informWeek },
            { name: "Envoyées ce mois-ci", value: n(newsletter.month) },
            { name: "Destinataires touchés", value: n(newsletter.sent) },
            { name: "Dernier envoi", value: formatLastSend(newsletter.last_sent_at) },
          ],
        },
        {
          title: i18nT("suivis_ba12ded5"),
          variant: "campaign",
          month: n(thanks.month),
          week: thanksWeek,
          goal: WEEKLY_GOALS.fideliser.thanks,
          status: buildStatus(thanksWeek, WEEKLY_GOALS.fideliser.thanks),
          channels: [
            { name: "Envoyées cette semaine", value: thanksWeek },
            { name: "Envoyées ce mois-ci", value: n(thanks.month) },
            { name: "Destinataires touchés", value: n(thanks.sent) },
            { name: "Dernier envoi", value: formatLastSend(thanks.last_sent_at) },
          ],
        },
        {
          title: i18nT("enquetes_354b5a30"),
          variant: "campaign",
          month: n(satisfaction.month),
          week: satisfactionWeek,
          goal: WEEKLY_GOALS.fideliser.satisfaction,
          status: buildStatus(satisfactionWeek, WEEKLY_GOALS.fideliser.satisfaction),
          channels: [
            { name: "Envoyées cette semaine", value: satisfactionWeek },
            { name: "Envoyées ce mois-ci", value: n(satisfaction.month) },
            { name: "Destinataires touchés", value: n(satisfaction.sent) },
            { name: "Dernier envoi", value: formatLastSend(satisfaction.last_sent_at) },
          ],
        },
      ],
      tips: [
        {
          title: i18nT("pour_mieux_informer_dae2682a"),
          lines: [
            { left: "1 newsletter / mois", right: "Top rappel" },
            { left: "Sujet clair", right: "Plus d’ouvertures" },
            { left: "1 CTA max", right: "Plus de clics" },
          ],
        },
        {
          title: i18nT("pour_mieux_suivre_4879e325"),
          lines: [
            { left: "Envoyer à J+1", right: "Meilleur timing" },
            { left: "Message court", right: "Lecture rapide" },
            { left: "Prochain pas clair", right: "Récurrence" },
          ],
        },
        {
          title: i18nT("pour_mieux_enqueter_d1a88772"),
          lines: [
            { left: "3 questions max", right: "Plus de réponses" },
            { left: "Demande d’avis ciblée", right: "Plus d’avis" },
            { left: "1 relance", right: "x1.4" },
          ],
        },
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
            <div className={b.titleLine}><span aria-hidden className={b.titleIcon}>💌</span><div className={styles.title}>{i18nT("fideliser_8fa9e4f1")}</div></div>
            <div className={b.tagline}>{i18nT("faites_revenir_vos_clients_40a33c57")}{" "}<strong>{i18nT("3_actions_997cf6ea")}</strong>{i18nT("maintenant_4590a147")}</div>
            <div className={b.closeWrap}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><HelpButton onClick={() => setHelpOpen(true)} title={i18nT("aide_fideliser_a1feee79")} /><ResponsiveActionButton desktopLabel={i18nT("propulser_2de43942")} mobileIcon="P" href="/dashboard/propulser" ariaLabel={i18nT("aller_vers_propulser_f020d44a")} title={i18nT("propulser_2de43942")} className={b.headerBtnBooster} /><Link href="/dashboard/mails?folder=fidelisations" aria-label={i18nT("aller_vers_inr_send_fidelisations_834d32a3")} title={i18nT("ouvrir_inr_send_d4b453c9")} className={`${b.inrSendHeaderShortcut} ${b.headerBtnInrSend}`}>
                    <span className={b.inrSendHeaderText}>{i18nT("inr_send_5c2a3e92")}</span>
                    <img className={b.inrSendHeaderLogo} src="/inrsend-logo-seul.png" alt="" aria-hidden />
                  </Link><ResponsiveActionButton desktopLabel={i18nT("fermer_5ab4ec64")} mobileIcon="✕" href="/dashboard" /></div></div>
          </header>

          <HelpModal open={helpOpen} title={i18nT("fideliser_8fa9e4f1")} onClose={() => setHelpOpen(false)}>
            <p style={{ marginTop: 0 }}>{i18nT("fideliser_vous_aide_a_faire_revenir_2dfec881")}</p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>{i18nT("restez_visible_apres_l_intervention_dd7b3122")}</li>
              <li>{i18nT("transformez_la_relation_client_en_recurrence_9c8a79b6")}</li>
              <li>{i18nT("debloquez_vos_ui_avec_le_multiplicateur_cd6abd6a")}</li>
            </ul>
            <div style={{ marginTop: 14, borderRadius: 14, padding: "12px 14px", border: "1px solid rgba(76,195,255,0.24)", background: "rgba(76,195,255,0.08)", lineHeight: 1.55 }}>
              <strong>{i18nT("toutes_vos_communications_sont_accessibles_dans_66e42690")}</strong><br />
              {i18nT("les_actions_lancees_depuis_fideliser_y_795ea881")}{" "}</div>
          </HelpModal>

          <section className={[styles.blockCard, b.missionBanner, data.missions.featureDone ? b.missionBannerDone : b.missionBannerTodo].join(" ")}>
            <div className={b.missionBannerLeft}>
              <div className={b.heroEyebrow}>{i18nT("mission_fideliser_4c1796f6")}</div>
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
              <div className={[b.triItem, b.triCyan].join(" ")}><div className={b.triLabel}>INFORMER</div></div>
              <div className={[b.triItem, b.triPurple].join(" ")}><div className={b.triLabel}>SUIVRE</div></div>
              <div className={[b.triItem, b.triPink].join(" ")}><div className={b.triLabel}>{i18nT("enqueter_9f2b15ae")}</div></div>
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
          title={active === "inform" ? "Informer" : active === "thanks" ? "Suivre" : "Enquêter"}
          moduleLabel={i18nT("module_fideliser_b309c73d")}
          onClose={requestCloseActiveModal}
          titleOnLeftOnMobile
          hideModuleLabelOnMobile
          headerStatus={workflowDraftMessage ? <span style={{ fontSize: 12, fontWeight: 800 }}>{workflowDraftMessage}</span> : null}
          headerStatusMobileHidden
          headerActions={
            <>
              <DetailSequenceNavigation
                label={`${activeThemeIndex + 1} / ${FIDELISER_THEMES.length}`}
                canPrevious={activeThemeIndex > 0}
                canNext={activeThemeIndex >= 0 && activeThemeIndex < FIDELISER_THEMES.length - 1}
                onPrevious={() => switchActiveTheme(-1)}
                onNext={() => switchActiveTheme(1)}
                ariaLabel={i18nT("navigation_entre_les_themes_fideliser_436ee375")}
              />
              <button type="button" className={`${styles.secondaryBtn} ${styles.aiHeaderBtn}`} onClick={() => setAiConfigurationOpen(true)} aria-label={i18nT("configuration_ia_f620c8d8")} title={i18nT("configuration_ia_f620c8d8")} style={{ width: isMobileHeader ? 32 : 38, minWidth: isMobileHeader ? 32 : 38, minHeight: isMobileHeader ? 32 : 36, padding: 0, fontSize: isMobileHeader ? 12 : 13, borderRadius: 999 }}><AiConfigurationIcon size={isMobileHeader ? 19 : 22} /></button>
              <button type="button" className={styles.secondaryBtn} onClick={() => void saveWorkflowDraftFromHeader()} disabled={workflowDraftSaving} title={i18nT("enregistrer_le_brouillon_6a319595")} aria-label={i18nT("enregistrer_le_brouillon_6a319595")} style={{ width: isMobileHeader ? 32 : 38, minWidth: isMobileHeader ? 32 : 38, minHeight: isMobileHeader ? 32 : 36, padding: 0, display: "inline-grid", placeItems: "center", fontSize: isMobileHeader ? 15 : 18, borderRadius: 999, opacity: workflowDraftSaving ? 0.64 : 1, cursor: workflowDraftSaving ? "wait" : "pointer" }}>
                {workflowDraftSaving ? "…" : "💾"}
              </button>
            </>
          }
        >
          {active === "inform" && <InformerModal styles={styles} onClose={requestCloseActiveModal} onDone={closeActiveModal} saveDraftActionRef={workflowDraftActionRef} onDraftStatusChange={setWorkflowDraftMessage} />}
          {active === "thanks" && <SuivreModal styles={styles} onClose={requestCloseActiveModal} onDone={closeActiveModal} saveDraftActionRef={workflowDraftActionRef} onDraftStatusChange={setWorkflowDraftMessage} />}
          {active === "satisfaction" && <EnqueterModal styles={styles} onClose={requestCloseActiveModal} onDone={closeActiveModal} saveDraftActionRef={workflowDraftActionRef} onDraftStatusChange={setWorkflowDraftMessage} />}
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
