import { useLocale, useTranslations } from "next-intl";
import React from "react";
import styles from "../mails.module.css";
import {
  MAILBOX_PAGE_SIZE,
  campaignCounts,
  formatChannelLabel,
  isGroupedActionFolder,
  listGridTemplateColumns,
  getPublicationChannelStatuses,
  normalizeChannelKey,
  extractChannelPublications,
  extractAttachmentsFromPayload,
  isVideoAttachment,
  workflowActionLabelForItem,
  type Folder,
  type BoxView,
  type MailAccount,
  type OutboxItem,
} from "../_lib/mailboxPhase1";

type Props = {
  folder: Folder;
  boxView: BoxView;
  loading: boolean;
  visibleItems: OutboxItem[];
  selectedId: string | null;
  openItem: (item: OutboxItem) => void;
  openDetails: (item: OutboxItem) => void;
  mailAccounts: MailAccount[];
  itemMailAccountId: (item: OutboxItem) => string | null | undefined;
  filteredItemsLength: number;
  historyPage: number;
  historyTotalCount: number | null;
  historyHasMorePotential: boolean;
  historyPageCount: number;
  loadHistory: (opts?: { page?: number }) => Promise<unknown> | void;
  refreshHistory: () => Promise<unknown> | void;
  historyQuery: string;
};


function formatListDate(value: string | null | undefined, locale: string) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

type MailsTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

const FOLDER_MESSAGE_KEYS: Record<Folder, string> = {
  mails: "mails_8d79d3a8",
  factures: "factures_da35e4f2",
  devis: "devis_f7622f90",
  publications: "publications_0855684c",
  recoltes: "recoltes_4c5913ca",
  offres: "offres_1b2f74c2",
  propulsions: "propulsions_56a8a9ad",
  informations: "informations_54937b3a",
  suivis: "suivis_ba12ded5",
  enquetes: "enquetes_354b5a30",
  fidelisations: "fidelisations_34a35f2d",
  stats: "stats_be763e9a",
};

const EMPTY_FOLDER_MESSAGE_KEYS: Record<Folder, string> = {
  mails: "aucun_mail_pour_le_moment_df07f4a4",
  factures: "aucune_facture_envoyee_pour_le_moment_b51a7414",
  devis: "aucun_devis_envoye_pour_le_moment_71559e96",
  publications: "aucune_publication_pour_le_moment_466d87bd",
  recoltes: "aucune_recolte_pour_le_moment_0eadf488",
  offres: "aucune_offre_pour_le_moment_258a03cc",
  propulsions: "aucune_propulsion_pour_le_moment_280abf50",
  informations: "aucune_information_envoyee_pour_le_moment_582a0a75",
  suivis: "aucun_suivi_envoye_pour_le_moment_c2dd0b76",
  enquetes: "aucune_enquete_envoyee_pour_le_moment_d4318ed9",
  fidelisations: "aucune_fidelisation_pour_le_moment_8b4a88b0",
  stats: "aucun_bilan_statistique_pour_le_moment_272a2b7f",
};

function simpleStatusMessageKey(item: OutboxItem) {
  const rawStatus = String((item.raw as any)?.status || item.status || "").toLowerCase();
  if (rawStatus === "draft") return "brouillon_57d2d7a7";
  if (rawStatus === "queued") return "en_attente_5231158f";
  if (rawStatus === "processing") return "en_cours_bc9b533a";
  if (rawStatus === "paused") return "en_pause_3a366de4";
  if (rawStatus === "partial") return "partiel_4a6472db";
  if (rawStatus === "failed" || rawStatus === "error") return "erreur_ab546c23";
  if (rawStatus === "completed" || rawStatus === "sent") return "envoye_7b0a810d";
  return "historique_34f3a06a";
}


function stripWorkflowPrefix(value: string) {
  return String(value || "")
    .replace(/^(Valoriser|Récolter|Récolte|Offrir|Informer|Information|Suivre|Suivi|Enquêter|Enquête|Propulsion|Fidélisation)\s*[—–·-]\s*/i, "")
    .trim();
}

function isWorkflowLabel(value: string, label: string) {
  return value.trim().toLowerCase() === label.trim().toLowerCase();
}

function rowHeaderLabels(folder: Folder) {
  if (folder === "publications") return { title: "publication_e00441c4", meta: "canaux_27cb4473" };
  if (folder === "stats") return { title: "bilan_a80c4623", meta: "destinataire_56579042" };
  if (isGroupedActionFolder(folder)) return { title: "objet_3de621c5", meta: "cible_bebdb9b8" };
  if (folder === "factures") return { title: "facture_3953b9f5", meta: "statut_destinataire_cada55c5" };
  if (folder === "devis") return { title: "devis_f7622f90", meta: "statut_destinataire_cada55c5" };
  if (folder === "mails") return { title: "objet_3de621c5", meta: "destinataire_56579042" };
  return { title: FOLDER_MESSAGE_KEYS[folder], meta: "cible_bebdb9b8" };
}

function publicationChannelCount(item: OutboxItem): number {
  const payload = item.source === "app_events" ? (item.raw as any)?.payload : item.raw;
  const statuses = getPublicationChannelStatuses(payload || null, item.channels && item.channels.length ? item.channels : [item.target || ""]);
  return statuses.length || 0;
}

function isPublicationVideoItem(item: OutboxItem): boolean {
  const payload = item.source === "app_events" ? (item.raw as any)?.payload : item.raw;
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, any>;
  if (String(record.mediaType || record.media_type || "").toLowerCase() === "video") return true;
  return extractAttachmentsFromPayload(record).some((attachment) => isVideoAttachment(attachment));
}

function getRowTitle(
  item: OutboxItem,
  folder: Folder,
  translate: MailsTranslator,
) {
  if (folder === "publications") {
    const payload = item.source === "app_events" ? (item.raw as any)?.payload : item.raw;
    const channelTitle = extractChannelPublications(payload)?.find((entry) => String(entry.parts?.title || "").trim())?.parts?.title || "";
    return item.subTitle || channelTitle || item.subject || item.title || translate("publication_e00441c4");
  }
  if (folder === "factures") {
    const docNumber = String((item.raw as any)?.source_doc_number || "").trim();
    if (docNumber && !String(item.title || "").includes(docNumber)) {
      return translate("invoice_row_title", {
        number: docNumber,
        title: item.title || translate("sans_objet_e5ad6a39"),
      });
    }
  }
  if (folder === "devis") {
    const docNumber = String((item.raw as any)?.source_doc_number || "").trim();
    if (docNumber && !String(item.title || "").includes(docNumber)) {
      return translate("quote_row_title", {
        number: docNumber,
        title: item.title || translate("sans_objet_e5ad6a39"),
      });
    }
  }
  if (isGroupedActionFolder(folder)) {
    const actionLabel = workflowActionLabelForItem(item);
    let cleaned = stripWorkflowPrefix(item.title || item.subject || item.subTitle || "");
    if (isWorkflowLabel(cleaned, actionLabel)) cleaned = stripWorkflowPrefix(item.subject || item.subTitle || "");
    // Ne pas basculer sur item.preview : c'est souvent le corps du message.
    return cleaned || item.subject || item.subTitle || translate("sans_objet_e5ad6a39");
  }
  return item.title || item.subject || translate("sans_objet_e5ad6a39");
}

function getRowMetaText(opts: { item: OutboxItem; folder: Folder; accountLabel: string; midLabel: string; translate: MailsTranslator }) {
  const { item, folder, accountLabel, midLabel, translate } = opts;
  if (folder === "publications") return midLabel || translate("canal_non_renseigne_851613f7");

  if (folder === "factures" || folder === "devis") {
    const status = translate(simpleStatusMessageKey(item));
    return [status, item.target].filter(Boolean).join(" · ") || status;
  }

  if (folder === "stats") {
    const status = translate(simpleStatusMessageKey(item));
    return [status, item.target].filter(Boolean).join(" · ") || status;
  }

  if (isGroupedActionFolder(folder)) {
    const actionLabel = workflowActionLabelForItem(item);
    // Important : ne jamais utiliser item.preview ici, car preview = extrait du corps du message.
    // Les colonnes "Cible" / "Destinataire" doivent rester vides ou explicites si aucune cible n'existe.
    const target = stripWorkflowPrefix(String(item.target || midLabel || ""));
    return target && !isWorkflowLabel(target, actionLabel) ? target : translate("cible_non_renseignee_dc0abaea");
  }

  if (item.source === "mail_campaigns") {
    return String(item.target || "").trim();
  }

  if (folder === "mails") {
    return String(item.target || "").trim();
  }

  return [accountLabel || item.provider || "Mail", item.target || midLabel].filter(Boolean).join(" · ");
}

function localizedChannelLabel(channel: string, translate: MailsTranslator) {
  const normalized = normalizeChannelKey(channel);
  if (normalized === "inrcy_site") return translate("site_inrcy_57016d6f");
  if (normalized === "site_web") return translate("site_web_7e78af33");
  return formatChannelLabel(channel);
}

function localizedWorkflowActionLabel(
  item: OutboxItem,
  translate: MailsTranslator,
) {
  const action = String(item.workflowAction || "").toLowerCase();
  const messageKeys: Record<string, string> = {
    valoriser: "workflow_action_valoriser",
    recolter: "recolter_1d0f06aa",
    offrir: "offrir_48d9d533",
    informer: "informer_570ee22d",
    suivre: "suivre_7cca6c92",
    enqueter: "enqueter_4fd8cc8c",
  };
  const folderAction =
    item.folder === "recoltes"
      ? "recolter"
      : item.folder === "offres"
        ? "offrir"
        : item.folder === "informations"
          ? "informer"
          : item.folder === "suivis"
            ? "suivre"
            : item.folder === "enquetes"
              ? "enqueter"
              : "";
  return translate(messageKeys[action || folderAction] || "action_97c89a4d");
}

function localizedHistoryEmptyState(
  folder: Folder,
  view: BoxView,
  query: string,
  translate: MailsTranslator,
) {
  const trimmed = query.trim();
  if (trimmed) return translate("history_no_results", { query: trimmed });
  if (view === "drafts") {
    return translate("history_no_drafts", {
      folder: translate(FOLDER_MESSAGE_KEYS[folder]),
    });
  }
  return translate(EMPTY_FOLDER_MESSAGE_KEYS[folder]);
}

function localizedCampaignProgress(
  raw: Record<string, unknown>,
  locale: string,
  translate: MailsTranslator,
) {
  const counts = campaignCounts(raw);
  const formatNumber = new Intl.NumberFormat(locale).format;
  const parts = [
    translate("campaign_progress_accepted", {
      sent: formatNumber(counts.sent),
      total: formatNumber(counts.total || counts.sent),
    }),
  ];
  if (counts.processing > 0) {
    parts.push(translate("campaign_progress_processing", { count: counts.processing }));
  }
  if (counts.queued > 0) {
    parts.push(translate("campaign_progress_queued", { count: counts.queued }));
  }
  if (counts.failed > 0) {
    parts.push(translate("campaign_progress_failed", { count: counts.failed }));
  }
  return parts.join(" • ");
}

function localizedIndicatorTitle(
  kind: "failed" | "deleted" | "cancelled" | "warning" | "processing",
  translate: MailsTranslator,
) {
  const messageKeys = {
    failed: "echec_sur_ce_canal_9d5ea0f3",
    deleted: "publication_supprimee_sur_ce_canal_ea8177eb",
    cancelled: "publication_annulee_dans_inr_send_3a044f29",
    warning: "publication_publiee_avec_avertissement_1a7dc204",
    processing: "en_traitement_sur_ce_canal_bad018e7",
  } as const;
  return translate(messageKeys[kind]);
}

function renderLocalizedPublicationChannels(
  payload: unknown,
  fallbackChannels: string[],
  translate: MailsTranslator,
) {
  const channels = getPublicationChannelStatuses(payload, fallbackChannels);
  if (!channels.length) return null;
  return (
    <span className={styles.channelStatusInlineWrap}>
      {channels.map((entry, index) => (
        <span className={styles.channelStatusInline} key={`${entry.key}-${index}`}>
          <span className={styles.channelStatusLabel}>
            {localizedChannelLabel(entry.key, translate)}
          </span>
          {entry.indicator ? (
            <span
              className={entry.indicator.className}
              title={localizedIndicatorTitle(entry.indicator.kind, translate)}
              aria-label={localizedIndicatorTitle(entry.indicator.kind, translate)}
            />
          ) : null}
        </span>
      ))}
    </span>
  );
}


export default function MailboxList(props: Props) {
  const i18nT = useTranslations("mails");
  const locale = useLocale();
  const runtimeT = i18nT as unknown as MailsTranslator;
  const {
    folder,
    boxView,
    loading,
    visibleItems,
    selectedId,
    openItem,
    openDetails,
    mailAccounts,
    itemMailAccountId,
    filteredItemsLength,
    historyPage,
    historyTotalCount,
    historyHasMorePotential,
    historyPageCount,
    loadHistory,
    refreshHistory,
    historyQuery,
  } = props;

  const historyPageTotalLabel = historyTotalCount != null
    ? String(historyPageCount)
    : historyHasMorePotential
      ? "…"
      : String(historyPageCount);
  const historyRangeLabel = (() => {
    if (filteredItemsLength <= 0) {
      return `0 / ${historyTotalCount ?? 0}`;
    }
    const start = (historyPage - 1) * MAILBOX_PAGE_SIZE + 1;
    const end = start + filteredItemsLength - 1;
    return `${start} – ${end} / ${historyTotalCount ?? "…"}`;
  })();
  const showInitialLoading = loading && visibleItems.length === 0;

  return (
    <>
      <div className={styles.scrollArea}>
        {showInitialLoading ? (
          <div style={{ padding: 14, color: "rgba(255,255,255,0.75)" }}>{i18nT("chargement_01cba1df")}</div>
        ) : (
          <div className={styles.list}>
            <div className={styles.listHeader}>
              {(() => {
                const labels = rowHeaderLabels(folder);
                return (
                  <div className={styles.listHeaderGrid} style={{ gridTemplateColumns: listGridTemplateColumns(folder) }}>
                    <div className={styles.listHeaderCell}>{runtimeT(labels.title)}</div>
                    {isGroupedActionFolder(folder) ? (
                      <div className={`${styles.listHeaderCell} ${styles.listHeaderCellCenter} ${styles.workflowActionHeader}`}>{i18nT("action_97c89a4d")}</div>
                    ) : null}
                    <div className={`${styles.listHeaderCell} ${styles.listHeaderCellCenter}`}>{runtimeT(labels.meta)}</div>
                    <div className={`${styles.listHeaderCell} ${styles.listHeaderCellRight}`}>{i18nT("date_eb9a4bc1")}</div>
                    <div className={`${styles.listHeaderCell} ${styles.listHeaderCellAction}`}>{i18nT("details_aaa029e6")}</div>
                  </div>
                );
              })()}
            </div>
            {visibleItems.length === 0 ? (
              <div style={{ padding: 14, color: "rgba(255,255,255,0.65)" }}>{localizedHistoryEmptyState(folder, boxView, historyQuery, runtimeT)}</div>
            ) : visibleItems.map((it) => {
              const active = it.id === selectedId;
              const historyKey = `${it.source}:${it.id}`;

              const accountLabel = (() => {
                const acc = mailAccounts.find((a) => a.id === itemMailAccountId(it));
                if (!acc) return "";
                return (acc.display_name ? `${acc.display_name} — ` : "") + acc.email_address;
              })();

              const midLabel =
                it.source === "send_items" || it.source === "mail_campaigns"
                  ? [accountLabel, it.source === "mail_campaigns" ? localizedCampaignProgress((it.raw || {}) as any, locale, runtimeT) : ""].filter(Boolean).join(" • ")
                  : (it.channels && it.channels.length
                      ? it.channels.map((channel) => localizedChannelLabel(channel, runtimeT)).join(" / ")
                      : localizedChannelLabel(it.target || "", runtimeT));
              const midLabelNode = folder === "publications" && it.source === "app_events"
                ? (renderLocalizedPublicationChannels((it as any)?.raw?.payload || null, it.channels && it.channels.length ? it.channels : [it.target], runtimeT) || (midLabel || ""))
                : (midLabel || "");
              const rowTitle = getRowTitle(it, folder, runtimeT);
              const rowMetaText = getRowMetaText({ item: it, folder, accountLabel, midLabel, translate: runtimeT });
              const rowMetaNode = folder === "publications" ? midLabelNode : rowMetaText;
              const rowDate = formatListDate(it.created_at, locale);
              const publicationMobileMeta = folder === "publications"
                ? `${runtimeT("channel_count", { count: publicationChannelCount(it) })} · ${rowDate}`
                : "";
              const showWorkflowAction = isGroupedActionFolder(folder);
              const workflowActionLabel = localizedWorkflowActionLabel(it, runtimeT);
              const isVideoPublication = folder === "publications" && it.source === "app_events" && isPublicationVideoItem(it);
              const isInrAgentOrigin = it.originSource === "inr_agent";
              const isScheduledOrigin = !isInrAgentOrigin && [
                "booster_scheduled",
                "inrsend_scheduled",
                "propulser_scheduled",
                "fideliser_scheduled",
              ].includes(String(it.originSource || ""));

              return (
                <div
                  key={historyKey}
                  className={`${styles.item} ${active ? styles.itemActive : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openItem(it)}
                  onDoubleClick={() => openDetails(it)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openItem(it);
                    }
                  }}
                >
                  <div className={styles.itemTop} style={{ gridTemplateColumns: listGridTemplateColumns(folder) }}>
                    <div className={styles.fromRow}>
                      <div className={styles.from} title={rowTitle}>{rowTitle}</div>
                      {isVideoPublication ? <span className={styles.publicationMediaBadge}>{i18nT("video_712dab2a")}</span> : null}
                    </div>

                    {showWorkflowAction ? (
                      <div className={styles.workflowActionCell} title={workflowActionLabel}>
                        <span className={styles.workflowActionBadge}>{workflowActionLabel}</span>
                      </div>
                    ) : null}

                    <div className={`${styles.itemMid} ${folder === "publications" ? styles.publicationChannelsCell : ""}`} title={rowMetaText || midLabel || it.target}>
                      <span className={`${styles.itemMidContent} ${showWorkflowAction || folder === "publications" ? styles.itemMidContentDesktopOnly : ""}`}>{rowMetaNode}</span>
                      {folder === "publications" ? (
                        <span className={styles.mobilePublicationMeta}>{publicationMobileMeta}</span>
                      ) : null}
                      {showWorkflowAction ? (
                        <span className={styles.mobileWorkflowMeta}>
                          {workflowActionLabel} · {rowMetaText}
                        </span>
                      ) : null}
                      {folder !== "publications" ? <span className={styles.mobileMetaDate}> · {rowDate}</span> : null}
                    </div>

                    <div className={styles.itemDateCell}>
                      <div className={styles.date}>{rowDate}</div>
                    </div>

                    <div className={styles.rowActions}>
                      {isInrAgentOrigin ? (
                        <span
                          className={styles.inrAgentOriginIcon}
                          title={i18nT("cree_par_inr_agent_31bbe816")}
                          aria-label={i18nT("cree_par_inr_agent_31bbe816")}
                          role="img"
                        >
                          <img src="/icons/inr-agent.png" alt="" aria-hidden="true" />
                        </span>
                      ) : isScheduledOrigin ? (
                        <span
                          className={styles.scheduledOriginIcon}
                          title={i18nT("action_scheduled")}
                          aria-label={i18nT("action_scheduled")}
                          role="img"
                        >
                          <span aria-hidden="true">🕒</span>
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className={`${styles.iconBtnSmall} ${styles.iconBtnSmallGhost} ${styles.detailsBtn}`}
                        title={i18nT("details_aaa029e6")}
                        aria-label={i18nT("afficher_les_details_de_value_43765a4c", { value0: rowTitle || i18nT("this_item") })}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openDetails(it);
                        }}
                      >
                        <span className={styles.detailsBtnIcon} aria-hidden="true">↗</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className={styles.listFooter}>
        <div className={styles.listFooterPagerRow}>
          <button
            type="button"
            className={styles.listFooterArrowButton}
            onClick={() => {
              const prevPage = Math.max(1, historyPage - 1);
              void loadHistory({ page: prevPage });
            }}
            disabled={historyPage <= 1 || loading}
            aria-label={i18nT("page_precedente_9e15ded9")}
            title={i18nT("page_precedente_9e15ded9")}
          >
            {"<"}
          </button>
          <div className={styles.listFooterPageText} aria-live="polite">
            {historyPage} / {historyPageTotalLabel}
          </div>
          <button
            type="button"
            className={styles.listFooterArrowButton}
            onClick={() => {
              const nextPage = historyPage + 1;
              void loadHistory({ page: nextPage });
            }}
            disabled={!historyHasMorePotential || loading}
            aria-label={i18nT("page_suivante_86b1be40")}
            title={i18nT("page_suivante_86b1be40")}
          >
            {">"}
          </button>
        </div>
        <div className={styles.listFooterMetaRow}>
          <span>{historyRangeLabel}</span>
          <button
            type="button"
            className={styles.listFooterRefreshButton}
            onClick={() => void refreshHistory()}
            disabled={loading}
            aria-label={loading ? i18nT("refreshing_list") : i18nT("refresh_list")}
            title={loading ? i18nT("refreshing_list") : i18nT("refresh_list")}
          >
            <span
              className={loading ? styles.listFooterRefreshIconActive : styles.listFooterRefreshIcon}
              aria-hidden="true"
            >
              ↻
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
