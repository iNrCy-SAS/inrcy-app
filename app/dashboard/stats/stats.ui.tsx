import React, { useState } from "react";
import styles from "./stats.module.css";
import { getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
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

function getMobileChannelAccountLabel(model: CubeModel, connectionPending: boolean) {
  const label = String(model.accountLabel || "").trim();
  if (!label) return undefined;

  const normalizedLabel = normalizeMobileIdentityLabel(label);
  const statusLabel = normalizeMobileIdentityLabel(connectionPending ? "Vérification" : model.connections.main ? "Connecté" : "Déconnecté");

  // En version mobile, le badge de statut est déjà affiché juste dessous.
  // On masque uniquement les libellés techniques purs pour éviter "Connecté" en doublon,
  // tout en gardant les vraies identités de canal : URL, page Facebook, compte, boîte 1/4, etc.
  if (normalizedLabel === statusLabel || ["connecte", "deconnecte", "analyse", "verification", "verification en cours"].includes(normalizedLabel)) {
    return undefined;
  }

  return label;
}

function actionPillClassKey(label: string) {
  return String(label || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}


function MiniMetricGrid({ items }: { items: Array<{ label: string; value: string; subValue?: string }> }) {
  if (!items.length) {
    return <div className={styles.metricEmpty}>Données non exploitables pour le moment.</div>;
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
  const stats = model.inrcyActivityStats;
  if (!stats) return null;

  const title = model.key === "inrbadge" ? "Activité iNrBadge" : model.key === "inr_search" ? "Activité iNr'Search" : "Envoyé via iNrCy";
  const items = model.key === "mails"
    ? [
        { label: "Campagnes", data: stats.publications },
        { label: "Mails simples", data: stats.photos },
        { label: "Destinataires", data: stats.videos },
      ]
    : model.key === "inrbadge"
      ? [
          { label: "Vues fiche", data: stats.publications },
          { label: "Scans QR", data: stats.photos },
          { label: "Actions", data: stats.videos },
        ]
      : model.key === "inr_search"
        ? [
            { label: "Vues", data: stats.publications },
            { label: "Actions", data: stats.photos },
            { label: "Contacts", data: stats.videos },
          ]
      : model.key === "youtube_shorts"
        ? [
            { label: "Publications", data: stats.publications },
            { label: "Vidéos courtes", data: stats.videos },
            { label: "Vidéos classiques", data: stats.photos },
          ]
        : [
            { label: "Publications", data: stats.publications },
            { label: "Photos", data: stats.photos },
            { label: "Vidéos", data: stats.videos },
          ];

  return (
    <div className={`${styles.block} ${styles.inrcyActivityBlock}`}>
      <div className={styles.inrcyActivityTitle}>{title}</div>
      <div className={styles.inrcyActivityItems}>
        {items.map((item) => (
          <div key={item.label} className={styles.inrcyActivityItem}>
            <span>{item.label}</span>
            <b>{fmtInt(item.data.week)}</b>
            <small>7j</small>
            <b>{fmtInt(item.data.month)}</b>
            <small>30j</small>
            <b>{fmtInt(item.data.total)}</b>
            <small>Total</small>
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
  return (
    <div className={styles.summaryBar} aria-label="Récapitulatif iNrStats">
      <div className={styles.summaryMain}>
        <span
          className={styles.summaryValueBubble}
          aria-label={summaryDisplayReady
            ? `+${fmtInt(centralPotential30)} opportunités à activer pour générer + de clients et + de CA potentiel`
            : "Opportunités en cours de chargement"}
        >
          <span className={styles.summaryValue}>{summaryDisplayReady ? `+${fmtInt(centralPotential30)}` : "—"}</span>
        </span>
        <span className={styles.summaryLabel}>opportunités à activer pour générer + de clients et + de CA potentiel</span>
        <span className={styles.summarySub}>projection sur 30 jours si actions menées</span>
      </div>
      <div className={styles.summaryModules}>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("mails")}>
          <span>Mails</span>
          <b>{summaryDisplayReady ? `+${fmtInt(centralByCube.mails)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("site_inrcy")}>
          <span>Site iNrCy</span>
          <b>{summaryDisplayReady ? `+${fmtInt(centralByCube.site_inrcy)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("site_web")}>
          <span>Site Web</span>
          <b>{summaryDisplayReady ? `+${fmtInt(centralByCube.site_web)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("gmb")}>
          <span>Google Business</span>
          <b>{summaryDisplayReady ? `+${fmtInt(centralByCube.gmb)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("facebook")}>
          <span>Facebook</span>
          <b>{summaryDisplayReady ? `+${fmtInt(centralByCube.facebook)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("instagram")}>
          <span>Instagram</span>
          <b>{summaryDisplayReady ? `+${fmtInt(centralByCube.instagram)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("linkedin")}>
          <span>LinkedIn</span>
          <b>{summaryDisplayReady ? `+${fmtInt(centralByCube.linkedin)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("tiktok")}>
          <span>TikTok</span>
          <b>{summaryDisplayReady ? `+${fmtInt(centralByCube.tiktok)}` : "—"}</b>
        </button>
        <button type="button" className={styles.summaryItem} onClick={() => onScrollTo("youtube_shorts")}>
          <span>YouTube</span>
          <b>{summaryDisplayReady ? `+${fmtInt(centralByCube.youtube_shorts)}` : "—"}</b>
        </button>
      </div>
      <div className={styles.summaryActionsWrap}>
        <button
          type="button"
          className={styles.summaryActionsToggle}
          onClick={onToggleActions}
          aria-expanded={summaryActionsOpen}
        >
          {summaryActionsOpen ? "Masquer les actions" : "Voir les actions"}
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
                          <span className={styles.summaryActionOpp}>{fmtInt(item.opportunities)} opportunités à capter</span>
                        ) : (
                          <span className={styles.summaryActionOpp}>potentiel non exploité</span>
                        )}
                      </div>
                      <div className={styles.summaryActionKicker}>{item.kicker}</div>
                    </div>
                  </div>
                  {item.opportunities > 0 ? (
                    <div className={styles.summaryActionRevenueBubble}>+{fmtInt(item.revenue)} €</div>
                  ) : (
                    <div className={styles.summaryActionRevenueGhost}>À activer</div>
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

function getForcedCubeContextLabel(key: CubeModel["key"]) {
  switch (key) {
    case "site_inrcy":
    case "site_web":
      return "URL associée";
    case "gmb":
      return "Fiche Google";
    case "inr_search":
      return "Page publique";
    case "facebook":
      return "Page Facebook";
    case "instagram":
      return "Compte Instagram";
    case "linkedin":
      return "Compte LinkedIn";
    case "mails":
      return "Boîtes d’envoi";
    case "tiktok":
      return "Compte TikTok";
    case "youtube_shorts":
      return "Chaîne YouTube";
    default:
      return "Canal associé";
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
  const [open, setOpen] = useState(false);
  const detailsOpen = forceOpen || open;
  const isSite = model.key === "site_inrcy" || model.key === "site_web";
  const action = (model as any).action ?? ({ key: "connect", title: "Connexion", detail: "", href: "#", pill: "Connexion" } as const);
  const pill = (action as any)?.pill ?? "Connexion";
  const pillKey = actionPillClassKey(pill);

  const connectionPending = model.connectionStatus === "unavailable" || (model.key === "mails" && !!model.connectionPending);
  const connectionOk = (connectionPending || (isSite
    ? !!model.connections.ga4 || !!model.connections.gsc
    : !!model.connections.main));
  const reconnectRequired = model.connectionStatus === "needs_update";
  const connectionTone = reconnectRequired ? "reconnect" : connectionOk ? "on" : "off";
  const headerTitle = hideDetailsToggle ? getForcedCubeContextLabel(model.key) : model.title;
  const mobileChannelAccountLabel = getMobileChannelAccountLabel(model, connectionPending);

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
                <StatusPill tone={model.connections.ga4 ? "on" : "off"} label="GA4" />
                <StatusPill tone={model.connections.gsc ? "on" : "off"} label="GSC" />
              </>
            ) : (
              <StatusPill tone={connectionTone} label={reconnectRequired ? "À reconnecter" : connectionPending ? "Vérification" : model.connections.main ? "Connecté" : "Déconnecté"} />
            )}
          </div>
          {!hideDetailsToggle ? (
            <button
              type="button"
              className={styles.detailsBtn}
              onClick={() => setOpen((v) => !v)}
              aria-expanded={detailsOpen}
            >
              {detailsOpen ? "Masquer les détails" : "Voir les détails"}
            </button>
          ) : null}
        </div>
      </div>

      {model.error ? <div className={styles.error}>{getSimpleFrenchErrorMessage(model.error, "Impossible de charger les statistiques pour le moment.")}</div> : null}

      {hideDetailsToggle ? (
        <div className={styles.mobileChannelHero}>
          <div className={styles.mobileChannelEyebrow}>Canal actif</div>
          <h2 className={styles.mobileChannelTitle}>{model.title}</h2>
          <p className={styles.mobileChannelSub}>{model.subtitle}</p>

          {mobileChannelAccountLabel ? (
            <div className={styles.mobileChannelLink}>{mobileChannelAccountLabel}</div>
          ) : null}

          <div className={styles.mobileChannelPills}>
            {isSite ? (
              <>
                <StatusPill tone={model.connections.ga4 ? "on" : "off"} label="GA4" />
                <StatusPill tone={model.connections.gsc ? "on" : "off"} label="GSC" />
              </>
            ) : (
              <StatusPill tone={connectionTone} label={reconnectRequired ? "À reconnecter" : connectionPending ? "Vérification" : model.connections.main ? "Connecté" : "Déconnecté"} />
            )}
          </div>

          <div className={styles.mobileChannelMetricGrid}>
            <div>
              <span>Opportunités</span>
              <b>+{fmtInt(model.opportunity30)}</b>
            </div>
            <div>
              <span>CA potentiel</span>
              <b>+{fmtInt(estimatedRevenue)} €</b>
            </div>
            {model.key !== "mails" ? (
              <>
                <div>
                  <span>Demandes captées 7j</span>
                  <b>{model.capturedLeadsUnavailable ? "—" : fmtInt(model.capturedLeads.week)}</b>
                </div>
                <div>
                  <span>Demandes captées 30j</span>
                  <b>{model.capturedLeadsUnavailable ? "—" : fmtInt(model.capturedLeads.month)}</b>
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
              <span className={`${styles.actionPill} ${styles[`action_${pillKey}`]}`}>{pill}</span>

              {pill === "Connexion" ? (
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
            className={`${styles.actionBtn} ${connectionOk ? styles.actionBtnOn : styles.actionBtnOff}`}
            onClick={() => (action.href ? onNavigate(action.href) : undefined)}
            disabled={model.loading || !action.href}
            aria-disabled={model.loading || !action.href}
          >
            <span className={styles.actionBtnDesktop}>{connectionOk ? "GO ⚡" : <>GO <PlugIcon /></>}</span>
            <span className={styles.actionBtnMobile}>{connectionOk ? "GO ⚡" : <>GO <PlugIcon /></>}</span>
          </button>
        </div>
      ) : null}

      {detailsOpen ? (
        <div className={`${styles.cubeBody} ${model.inrcyActivityStats ? styles.cubeBodyWithInrcyActivity : ""}`}>
          <div className={styles.detailTopRow}>
            <div className={`${styles.block} ${styles.metricOverviewBlock}`}>
              <div className={styles.blockTitle}>{model.key === "mails" ? "Activité mail" : model.key === "inrbadge" ? "Configuration badge" : model.key === "inr_search" ? "Visibilité de la page" : "Visibilité du canal"}</div>
              <MiniMetricGrid items={model.visibilityStats} />
            </div>

            <div className={`${styles.block} ${styles.provenanceCompactBlock}`}>
              <div className={styles.blockTitle}>{model.key === "mails" ? "Répartition des actions mail" : model.key === "inrbadge" ? "Suivi iNrBadge" : model.key === "inr_search" ? "Sources de trafic" : "Provenance"}</div>
              <Donut segments={model.provenance} />
              {model.provenanceHint ? <div className={styles.provenanceHint}>{model.provenanceHint}</div> : null}
            </div>
          </div>

          <div className={styles.blockRow}>
            <div className={styles.block}>
              <div className={styles.blockTitle}>Qualité</div>
              <div className={styles.qualityRow}>
                <RingScore value={model.qualityScore} tone={model.qualityTone} />
                <div>
                  <div className={styles.qualityLabel}>{model.qualityLabel}</div>
                  <div className={styles.qualitySub}>Structure & exploitabilité</div>
                </div>
              </div>
            </div>

            <div className={`${styles.block} ${styles.metricOverviewBlock}`}>
              <div className={styles.blockTitle}>{model.key === "mails" ? "Automatiques & business" : model.key === "inrbadge" ? "Actions rapides" : model.key === "inr_search" ? "Actions de contact" : "Actions utiles"}</div>
              <MiniMetricGrid items={model.actionStats} />
            </div>
          </div>

          <InrcyActivityBlock model={model} />

          <div className={`${styles.block} ${hideDetailsToggle ? styles.lectureBusinessActionBlock : ""}`}>
            <div className={styles.lectureBusinessContent}>
              <div className={styles.blockTitle}>Lecture business</div>
              <ul className={styles.bullets}>
                {model.insights.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>

            {hideDetailsToggle ? (
              <>
                <div className={styles.lectureBusinessToolCol}>
                  <span className={`${styles.actionPill} ${styles[`action_${pillKey}`]}`}>{pill}</span>
                </div>

                <div className={styles.lectureBusinessEffortCol}>
                  {action.effort ? (
                    <span className={`${styles.effort} ${styles[`effort_${action.effort.level}`]}`}>{action.effort.label}</span>
                  ) : (
                    <span className={styles.lectureBusinessEffortPlaceholder}>Prêt à lancer</span>
                  )}
                </div>

                <button
                  className={`${styles.actionBtn} ${styles.lectureBusinessGoButton} ${connectionOk ? styles.actionBtnOn : styles.actionBtnOff}`}
                  onClick={() => (action.href ? onNavigate(action.href) : undefined)}
                  disabled={model.loading || !action.href}
                  aria-disabled={model.loading || !action.href}
                >
                  <span className={styles.actionBtnDesktop}>{connectionOk ? "GO ⚡" : <>GO <PlugIcon /></>}</span>
                  <span className={styles.actionBtnMobile}>{connectionOk ? "GO ⚡" : <>GO <PlugIcon /></>}</span>
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
