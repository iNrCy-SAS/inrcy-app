import { useLocale, useTranslations } from "next-intl";
import React, { useState } from "react";
import styles from "./stats.module.css";
import { fmtInt, type CubeModel } from "./stats.shared";

function Donut({ segments }: { segments: Array<{ label: string; value: number; colorVar: string }> }) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const visibleSegments = segments.filter((segment) => segment.value > 0);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const seamOverlap = 0.35;
  let offset = 0;

  return (
    <div className={styles.donutWrap}>
      <div className={styles.donut} aria-hidden>
        <svg className={styles.donutSvg} viewBox="0 0 100 100" focusable="false">
          <circle className={styles.donutTrack} cx="50" cy="50" r={radius} />
          {total > 0
            ? visibleSegments.map((segment, index) => {
                const rawLength = index === visibleSegments.length - 1 ? circumference - offset : (segment.value / total) * circumference;
                const dashLength = Math.max(0, Math.min(circumference, rawLength + seamOverlap));
                const strokeDashoffset = -offset;
                offset += rawLength;

                return (
                  <circle
                    key={`${segment.label}-${index}`}
                    className={styles.donutArc}
                    cx="50"
                    cy="50"
                    r={radius}
                    style={{
                      stroke: `var(${segment.colorVar})`,
                      strokeDasharray: `${dashLength} ${circumference}`,
                      strokeDashoffset,
                    }}
                  />
                );
              })
            : null}
        </svg>
        <div className={styles.donutHole} />
      </div>
      <div className={styles.legend}>
        {segments.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <div key={s.label} className={styles.legendRow}>
              <span className={styles.legendDot} style={{ background: `var(${s.colorVar})` }} aria-hidden />
              <span className={styles.legendLabel}>{s.label}</span>
              <span className={styles.legendVal}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RingScore({ value, tone }: { value: number; tone: "low" | "ok" | "solid" | "excellent" }) {
  const deg = Math.round(Math.max(0, Math.min(1, value / 100)) * 360);
  return (
    <div className={`${styles.ring} ${styles[`ring_${tone}`]}`} style={{ ["--deg" as any]: `${deg}deg` }}>
      <div className={styles.ringInner}>
        <div className={styles.ringValue}>{value}</div>
        <div className={styles.ringSub}>/100</div>
      </div>
    </div>
  );
}

function StatusPill({ tone, label }: { tone: "on" | "reconnect" | "off"; label: string }) {
  return <span className={`${styles.pill} ${tone === "on" ? styles.pillOn : tone === "reconnect" ? styles.pillReconnect : styles.pillOff}`}>{label}</span>;
}

function normalizeMobileIdentityLabel(label: string) {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[.!…]+$/g, "");
}

function getMobileChannelAccountLabel(model: CubeModel, technicalLabels: string[]) {
  const label = String(model.accountLabel || "").trim();
  if (!label) return undefined;

  const normalizedLabel = normalizeMobileIdentityLabel(label);
  const normalizedTechnicalLabels = technicalLabels.map(normalizeMobileIdentityLabel);

  // En version mobile, le badge de statut est déjà affiché juste dessous.
  // On masque uniquement les libellés techniques purs pour éviter "Connecté" en doublon,
  // tout en gardant les vraies identités de canal : URL, page Facebook, compte, boîte 1/4, etc.
  if (normalizedTechnicalLabels.includes(normalizedLabel)) {
    return undefined;
  }

  return label;
}

function actionPillClassKey(actionKey: CubeModel["action"]["key"]) {
  if (actionKey === "connect" || actionKey === "loading") return "connexion";
  if (actionKey === "propulser_action") return "propulser";
  if (actionKey === "mail_simple") return "mail_simple";
  if (actionKey.startsWith("fideliser_")) return "fideliser";
  return "booster";
}

function ActionToolPill({
  action,
  label,
  premiumLockTitle,
}: {
  action: CubeModel["action"];
  label: string;
  premiumLockTitle?: string;
}) {
  const premiumLocked = action.premiumLocked === true;
  const pillKey = actionPillClassKey(action.key);

  return (
    <span
      className={`${styles.actionPill} ${styles[`action_${pillKey}`]} ${premiumLocked ? styles.actionPillPremiumLocked : ""}`}
      title={premiumLockTitle}
      aria-label={premiumLockTitle}
    >
      {premiumLocked ? <span className={styles.premiumLockIcon} aria-hidden="true">🔒</span> : null}
      {label}
    </span>
  );
}


function MiniMetricGrid({ items }: { items: Array<{ label: string; value: string; subValue?: string }> }) {
  const i18nT = useTranslations("stats");
  if (!items.length) {
    return <div className={styles.metricEmpty}>{i18nT("donnees_non_exploitables_pour_le_moment_418dc0c4")}</div>;
  }

  const densityClass =
    items.length === 1 ? styles.metricMiniGridSingle : items.length === 2 ? styles.metricMiniGridTwo : "";

  return (
    <div className={`${styles.metricMiniGrid} ${densityClass}`}>
      {items.map((item) => (
        <div key={item.label} className={styles.metricMiniCard}>
          <span>{item.label}</span>
          <div className={styles.metricMiniValueRow}>
            <b>{item.value}</b>
            {item.subValue ? <small>{item.subValue}</small> : null}
          </div>
        </div>
      ))}
    </div>
  );
}



function InrcyActivityBlock({ model }: { model: CubeModel }) {
  const locale = useLocale();
  const i18nT = useTranslations("stats");
  const formatInt = (value: number) => fmtInt(value, locale);
  const stats = model.inrcyActivityStats;
  if (!stats) return null;

  const title = model.key === "inrbadge"
    ? i18nT("activity_inrbadge")
    : model.key === "inr_search"
      ? i18nT("activity_inr_search")
      : i18nT("activity_sent_via_inrcy");
  const items = model.key === "mails"
    ? [
        { label: i18nT("campagnes_ef527e85"), data: stats.publications },
        { label: i18nT("mails_simples_608d9dcf"), data: stats.photos },
        { label: i18nT("destinataires_51610ad7"), data: stats.videos },
      ]
    : model.key === "inrbadge"
      ? [
          { label: i18nT("vues_fiche_6d715930"), data: stats.publications },
          { label: i18nT("scans_qr_a36ab7c7"), data: stats.photos },
          { label: i18nT("actions_c3cd636a"), data: stats.videos },
        ]
      : model.key === "inr_search"
        ? [
            { label: i18nT("vues_ff576f2b"), data: stats.publications },
            { label: i18nT("actions_c3cd636a"), data: stats.photos },
            { label: i18nT("contacts_b0dd615c"), data: stats.videos },
          ]
      : model.key === "youtube_shorts"
        ? [
            { label: i18nT("publications_0855684c"), data: stats.publications },
            { label: i18nT("videos_courtes_ceab3daf"), data: stats.videos },
            { label: i18nT("videos_classiques_f048cd71"), data: stats.photos },
          ]
        : [
            { label: i18nT("publications_0855684c"), data: stats.publications },
            { label: i18nT("photos_c8b2e864"), data: stats.photos },
            { label: i18nT("videos_ea129238"), data: stats.videos },
          ];

  return (
    <div className={`${styles.block} ${styles.inrcyActivityBlock}`}>
      <div className={styles.inrcyActivityTitle}>{title}</div>
      <div className={styles.inrcyActivityItems}>
        {items.map((item) => (
          <div key={item.label} className={styles.inrcyActivityItem}>
            <span>{item.label}</span>
            <b>{formatInt(item.data.week)}</b>
            <small>{i18nT("7j_bf2371a9")}</small>
            <b>{formatInt(item.data.month)}</b>
            <small>{i18nT("30j_30690e0d")}</small>
            <b>{formatInt(item.data.total)}</b>
            <small>{i18nT("total_b25928c6")}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlugIcon() {
  return (
    <svg className={styles.plugSvgIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 3v5" />
      <path d="M15 3v5" />
      <path d="M8 8h8v4a4 4 0 0 1-4 4h0a4 4 0 0 1-4-4V8Z" />
      <path d="M12 16v5" />
      <path d="M9.5 21h5" />
    </svg>
  );
}


export function SummaryBar({
  centralPotential30,
  summaryDisplayReady,
  centralByCube,
  summaryActionsOpen,
  onToggleActions,
  onScrollTo,
  summaryActionItems,
}: {
  centralPotential30: number;
  summaryDisplayReady: boolean;
  centralByCube: Record<import("./stats.shared").CubeKey, number>;
  summaryActionsOpen: boolean;
  onToggleActions: () => void;
  onScrollTo: (key: import("./stats.shared").CubeKey) => void;
  summaryActionItems: Array<{
    key: import("./stats.shared").CubeKey;
    opportunities: number;
    revenue: number;
    label: string;
    kicker: string;
    motive: string;
    badge: string;
  }>;
}) {
  const locale = useLocale();
  const i18nT = useTranslations("stats");
  const formatInt = (value: number) => fmtInt(value, locale);
  return (
    <div className={styles.summaryBar} aria-label={i18nT("recapitulatif_inrstats_e18fbec8")}>
      <div className={styles.summaryMain}>
        <span
          className={styles.summaryValueBubble}
          aria-label={summaryDisplayReady
            ? i18nT("summary_ready_aria", { value0: formatInt(centralPotential30) })
            : i18nT("summary_loading_aria")}
        >
          <span className={styles.summaryValue}>{summaryDisplayReady ? `+${formatInt(centralPotential30)}` : "—"}</span>
        </span>
        <span className={styles.summaryLabel}>{i18nT("opportunites_a_activer_pour_generer_de_d14e7cf6")}</span>
        <span className={styles.summarySub}>{i18nT("projection_sur_30_jours_si_actions_52a41622")}</span>
      </div>
      <div className={styles.summaryModules}>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("mails")}>
          <span>{i18nT("mails_8d79d3a8")}</span>
          <b>{summaryDisplayReady ? `+${formatInt(centralByCube.mails)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("site_inrcy")}>
          <span>{i18nT("site_inrcy_57016d6f")}</span>
          <b>{summaryDisplayReady ? `+${formatInt(centralByCube.site_inrcy)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("site_web")}>
          <span>{i18nT("site_web_c72c13ef")}</span>
          <b>{summaryDisplayReady ? `+${formatInt(centralByCube.site_web)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("gmb")}>
          <span>{i18nT("google_business_a605b655")}</span>
          <b>{summaryDisplayReady ? `+${formatInt(centralByCube.gmb)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("facebook")}>
          <span>{i18nT("facebook_82da67b2")}</span>
          <b>{summaryDisplayReady ? `+${formatInt(centralByCube.facebook)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("instagram")}>
          <span>{i18nT("instagram_5721bbef")}</span>
          <b>{summaryDisplayReady ? `+${formatInt(centralByCube.instagram)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("linkedin")}>
          <span>{i18nT("linkedin_6b6390a4")}</span>
          <b>{summaryDisplayReady ? `+${formatInt(centralByCube.linkedin)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("tiktok")}>
          <span>{i18nT("tiktok_fc49f156")}</span>
          <b>{summaryDisplayReady ? `+${formatInt(centralByCube.tiktok)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("youtube_shorts")}>
          <span>{i18nT("youtube_558865a1")}</span>
          <b>{summaryDisplayReady ? `+${formatInt(centralByCube.youtube_shorts)}` : "—"}</b>
        </button>
      </div>
      <div className={styles.summaryActionsWrap}>
        <button
          type="button"
          className={styles.summaryActionsToggle}
          onClick={onToggleActions}
          aria-expanded={summaryActionsOpen}
        >
          {summaryActionsOpen ? i18nT("masquer_les_actions_ef4d0d52") : i18nT("voir_les_actions_e884560d")}
        </button>

        {summaryActionsOpen ? (
          <div className={styles.summaryActionsPanel}>
            {summaryActionItems.map((item) => (
              <div key={item.key} className={styles.summaryActionItem}>
                <div className={styles.summaryActionTopRow}>
                  <div className={styles.summaryActionLeft}>
                    <div className={styles.summaryActionBadge}>{item.badge}</div>
                    <div className={styles.summaryActionTitleBlock}>
                      <div className={styles.summaryActionTitleRow}>
                        <span className={styles.summaryActionTitle}>{item.label}</span>
                        {item.opportunities > 0 ? (
                          <span className={styles.summaryActionOpp}>{i18nT("value_opportunites_a_capter_9304bbae", { value0: formatInt(item.opportunities) })}</span>
                        ) : (
                          <span className={styles.summaryActionOpp}>{i18nT("potentiel_non_exploite_f8810f1e")}</span>
                        )}
                      </div>
                      <div className={styles.summaryActionKicker}>{item.kicker}</div>
                    </div>
                  </div>
                  {item.opportunities > 0 ? (
                    <div className={styles.summaryActionRevenueBubble}>+{formatInt(item.revenue)} €</div>
                  ) : (
                    <div className={styles.summaryActionRevenueGhost}>{i18nT("a_activer_15406658")}</div>
                  )}
                </div>
                <div className={styles.summaryActionMeta}>{item.motive}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function getForcedCubeContextKey(key: CubeModel["key"]) {
  switch (key) {
    case "site_inrcy":
    case "site_web":
      return "url_associee_92573a3c";
    case "gmb":
      return "fiche_google_e09af4c2";
    case "inr_search":
      return "page_publique_67483055";
    case "facebook":
      return "page_facebook_5017637f";
    case "instagram":
      return "compte_instagram_8792fadf";
    case "linkedin":
      return "compte_linkedin_9168ff7a";
    case "mails":
      return "boites_d_envoi_0dce5119";
    case "tiktok":
      return "compte_tiktok_0099e07c";
    case "youtube_shorts":
      return "chaine_youtube_1e7246ac";
    default:
      return "canal_associe_6f8463ec";
  }
}

export function Cube({
  model,
  onNavigate,
  forceOpen = false,
  hideDetailsToggle = false,
  estimatedRevenue = 0,
}: {
  model: CubeModel;
  onNavigate: (href: string) => void;
  forceOpen?: boolean;
  hideDetailsToggle?: boolean;
  estimatedRevenue?: number;
}) {
  const locale = useLocale();
  const i18nT = useTranslations("stats");
  const formatInt = (value: number) => fmtInt(value, locale);
  const [open, setOpen] = useState(false);
  const detailsOpen = forceOpen || open;
  const isSite = model.key === "site_inrcy" || model.key === "site_web";
  const action = model.action;
  const localizedPill = action.pill;
  const premiumLocked = action.premiumLocked === true;
  const premiumLockTitle = premiumLocked
    ? i18nT("stats_premium_action_locked", { tool: localizedPill })
    : undefined;

  const connectionPending = model.connectionStatus === "unavailable" || (model.key === "mails" && !!model.connectionPending);
  const connectionOk = (connectionPending || (isSite
    ? !!model.connections.ga4 || !!model.connections.gsc
    : !!model.connections.main));
  const reconnectRequired = model.connectionStatus === "needs_update";
  const connectionTone = reconnectRequired ? "reconnect" : connectionOk ? "on" : "off";
  const actionDisabled = model.loading || !action.href || premiumLocked;
  const actionButtonLabel = premiumLocked
    ? i18nT("stats_go_locked")
    : connectionOk
      ? i18nT("go_bb63fc96")
      : <>{i18nT("go_f63f96ef")}{" "}<PlugIcon /></>;
  const headerTitle = hideDetailsToggle ? i18nT(getForcedCubeContextKey(model.key)) : model.title;
  const mobileChannelAccountLabel = getMobileChannelAccountLabel(model, [
    i18nT("connecte_ce09957c"),
    i18nT("deconnecte_3a67fd80"),
    i18nT("analysis_status"),
    i18nT("verification_bb27abfb"),
    i18nT("verification_in_progress"),
  ]);

  return (
    <section className={`${styles.cube} ${styles[`cube_${model.key}`] ?? ""} ${reconnectRequired ? styles.cubeReconnect : connectionOk ? styles.cubeOn : styles.cubeOff}`} aria-label={model.title}>
      <div className={`${styles.cubeTop} ${hideDetailsToggle ? styles.cubeTopCompact : ""}`}>
        <div className={hideDetailsToggle ? styles.cubeHeaderInline : undefined}>
          {hideDetailsToggle ? (
            <>
              <div className={styles.cubeTitleInlineGroup}>
                <h2 className={styles.cubeTitle}>{`${headerTitle} :`}</h2>
                {model.loading ? <span className={styles.spinner} aria-hidden /> : null}
              </div>
              {model.accountLabel ? <div className={styles.cubeIdentityInline}>{model.accountLabel}</div> : null}
            </>
          ) : (
            <>
              <div className={styles.cubeTitleRow}>
                <h2 className={styles.cubeTitle}>{headerTitle}</h2>
                {model.loading ? <span className={styles.spinner} aria-hidden /> : null}
              </div>
              {model.accountLabel ? <div className={styles.cubeIdentity}>{model.accountLabel}</div> : null}
              <div className={styles.cubeSub}>{model.subtitle}</div>
            </>
          )}
        </div>

        <div className={styles.cubeBadges}>
          <div className={styles.pills}>
            {isSite ? (
              <>
                <StatusPill tone={model.connections.ga4 ? "on" : "off"} label={i18nT("ga4_5a2211b7")} />
                <StatusPill tone={model.connections.gsc ? "on" : "off"} label={i18nT("gsc_ea8e44e6")} />
              </>
            ) : (
              <StatusPill tone={connectionTone} label={reconnectRequired ? i18nT("a_reconnecter_bb56a9d2") : connectionPending ? i18nT("verification_bb27abfb") : model.connections.main ? i18nT("connecte_ce09957c") : i18nT("deconnecte_3a67fd80")} />
            )}
          </div>
          {!hideDetailsToggle ? (
            <button
              type="button"
              className={styles.detailsBtn}
              onClick={() => setOpen((v) => !v)}
              aria-expanded={detailsOpen}
            >
              {detailsOpen ? i18nT("masquer_les_details_38362ba9") : i18nT("voir_les_details_21f2c65d")}
            </button>
          ) : null}
        </div>
      </div>

      {model.error ? <div className={styles.error}>{i18nT("stats_load_error")}</div> : null}

      {hideDetailsToggle ? (
        <div className={styles.mobileChannelHero}>
          <div className={styles.mobileChannelEyebrow}>{i18nT("canal_actif_09801074")}</div>
          <h2 className={styles.mobileChannelTitle}>{model.title}</h2>
          <p className={styles.mobileChannelSub}>{model.subtitle}</p>

          {mobileChannelAccountLabel ? (
            <div className={styles.mobileChannelLink}>{mobileChannelAccountLabel}</div>
          ) : null}

          <div className={styles.mobileChannelPills}>
            {isSite ? (
              <>
                <StatusPill tone={model.connections.ga4 ? "on" : "off"} label={i18nT("ga4_5a2211b7")} />
                <StatusPill tone={model.connections.gsc ? "on" : "off"} label={i18nT("gsc_ea8e44e6")} />
              </>
            ) : (
              <StatusPill tone={connectionTone} label={reconnectRequired ? i18nT("a_reconnecter_bb56a9d2") : connectionPending ? i18nT("verification_bb27abfb") : model.connections.main ? i18nT("connecte_ce09957c") : i18nT("deconnecte_3a67fd80")} />
            )}
          </div>

          <div className={styles.mobileChannelMetricGrid}>
            <div>
              <span>{i18nT("opportunites_0dbfa3c5")}</span>
              <b>+{formatInt(model.opportunity30)}</b>
            </div>
            <div>
              <span>{i18nT("ca_potentiel_fc9eeae4")}</span>
              <b>+{formatInt(estimatedRevenue)} €</b>
            </div>
            {model.key !== "mails" ? (
              <>
                <div>
                  <span>{i18nT("demandes_captees_7j_15a42cdd")}</span>
                  <b>{model.capturedLeadsUnavailable ? "—" : formatInt(model.capturedLeads.week)}</b>
                </div>
                <div>
                  <span>{i18nT("demandes_captees_30j_0cdf7d86")}</span>
                  <b>{model.capturedLeadsUnavailable ? "—" : formatInt(model.capturedLeads.month)}</b>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {!hideDetailsToggle ? (
        <div className={styles.actionCompact}>
          <div className={styles.actionLeft}>
            <div className={styles.actionTopRow}>
              <ActionToolPill action={action} label={localizedPill} premiumLockTitle={premiumLockTitle} />

              {action.key === "connect" || action.key === "loading" ? (
                <div className={styles.actionTopText}>
                  <span className={styles.actionTitle}>{action.title}</span>
                </div>
              ) : null}

              {action.effort ? (
                <span className={`${styles.effort} ${styles[`effort_${action.effort.level}`]}`}>{action.effort.label}</span>
              ) : null}
            </div>

            <div className={styles.actionDetail}>{action.detail}</div>
          </div>

          <button
            type="button"
            className={`${styles.actionBtn} ${connectionOk ? styles.actionBtnOn : styles.actionBtnOff} ${premiumLocked ? styles.actionBtnDisabled : ""}`}
            onClick={() => (!actionDisabled ? onNavigate(action.href) : undefined)}
            disabled={actionDisabled}
            aria-disabled={actionDisabled}
            aria-label={premiumLockTitle}
            title={premiumLockTitle}
          >
            <span className={styles.actionBtnDesktop}>{actionButtonLabel}</span>
            <span className={styles.actionBtnMobile}>{actionButtonLabel}</span>
          </button>
        </div>
      ) : null}

      {detailsOpen ? (
        <div className={`${styles.cubeBody} ${model.inrcyActivityStats ? styles.cubeBodyWithInrcyActivity : ""}`}>
          <div className={styles.detailTopRow}>
            <div className={`${styles.block} ${styles.metricOverviewBlock}`}>
              <div className={styles.blockTitle}>{model.key === "mails" ? i18nT("activite_mail_64533c94") : model.key === "inrbadge" ? i18nT("configuration_badge_9ef560ae") : model.key === "inr_search" ? i18nT("visibilite_de_la_page_78765df2") : i18nT("visibilite_du_canal_98d32499")}</div>
              <MiniMetricGrid items={model.visibilityStats} />
            </div>

            <div className={`${styles.block} ${styles.provenanceCompactBlock}`}>
              <div className={styles.blockTitle}>{model.key === "mails" ? i18nT("repartition_des_actions_mail_0df3dda5") : model.key === "inrbadge" ? i18nT("suivi_inrbadge_6ec1c532") : model.key === "inr_search" ? i18nT("sources_de_trafic_d908c5ca") : i18nT("provenance_dd35a816")}</div>
              <Donut segments={model.provenance} />
              {model.provenanceHint ? <div className={styles.provenanceHint}>{model.provenanceHint}</div> : null}
            </div>
          </div>

          <div className={styles.blockRow}>
            <div className={styles.block}>
              <div className={styles.blockTitle}>{i18nT("qualite_2b2b1120")}</div>
              <div className={styles.qualityRow}>
                <RingScore value={model.qualityScore} tone={model.qualityTone} />
                <div>
                  <div className={styles.qualityLabel}>{model.qualityLabel}</div>
                  <div className={styles.qualitySub}>{i18nT("structure_exploitabilite_083b0b6d")}</div>
                </div>
              </div>
            </div>

            <div className={`${styles.block} ${styles.metricOverviewBlock}`}>
              <div className={styles.blockTitle}>{model.key === "mails" ? i18nT("automatiques_business_71d9b6ff") : model.key === "inrbadge" ? i18nT("actions_rapides_abe69a9c") : model.key === "inr_search" ? i18nT("actions_de_contact_c544170f") : i18nT("actions_utiles_08ea2bac")}</div>
              <MiniMetricGrid items={model.actionStats} />
            </div>
          </div>

          <InrcyActivityBlock model={model} />

          <div className={`${styles.block} ${hideDetailsToggle ? styles.lectureBusinessActionBlock : ""}`}>
            <div className={styles.lectureBusinessContent}>
              <div className={styles.blockTitle}>{i18nT("lecture_business_8b7d2470")}</div>
              <ul className={styles.bullets}>
                {model.insights.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>

            {hideDetailsToggle ? (
              <>
                <div className={styles.lectureBusinessToolCol}>
                  <ActionToolPill action={action} label={localizedPill} premiumLockTitle={premiumLockTitle} />
                </div>

                <div className={styles.lectureBusinessEffortCol}>
                  {action.effort ? (
                    <span className={`${styles.effort} ${styles[`effort_${action.effort.level}`]}`}>{action.effort.label}</span>
                  ) : (
                    <span className={styles.lectureBusinessEffortPlaceholder}>{i18nT("pret_a_lancer_fb802548")}</span>
                  )}
                </div>

                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.lectureBusinessGoButton} ${connectionOk ? styles.actionBtnOn : styles.actionBtnOff} ${premiumLocked ? styles.actionBtnDisabled : ""}`}
                  onClick={() => (!actionDisabled ? onNavigate(action.href) : undefined)}
                  disabled={actionDisabled}
                  aria-disabled={actionDisabled}
                  aria-label={premiumLockTitle}
                  title={premiumLockTitle}
                >
                  <span className={styles.actionBtnDesktop}>{actionButtonLabel}</span>
                  <span className={styles.actionBtnMobile}>{actionButtonLabel}</span>
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
