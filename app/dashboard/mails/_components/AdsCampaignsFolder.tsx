"use client";
import { getClientUserFacingErrorMessage as getSafeClientErrorMessage } from "@/lib/userFacingErrors";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StoredAdsCampaign } from "@/app/dashboard/ads/AdsCampaignTracking";
import AdsCampaignDetailsModal from "./AdsCampaignDetailsModal";
import { adsChannelLabels, adsDateTime, adsStatusMessageKeys, type MailsTranslator } from "./adsCampaignsFolder.shared";
import mailboxStyles from "../mails.module.css";
import styles from "./AdsCampaignsFolder.module.css";

type AdsCampaignsResponse = {
  campaigns?: StoredAdsCampaign[];
  total?: number;
  nextOffset?: number | null;
  error?: string;
};

const PAGE_SIZE = 50;

async function loadCampaignPage(offset: number, draftOnly: boolean, translate: MailsTranslator): Promise<AdsCampaignsResponse> {
  const params = new URLSearchParams({ offset: String(offset) });
  if (draftOnly) params.set("status", "draft");
  const response = await fetch(`/api/ads/campaigns?${params.toString()}`, { cache: "no-store" });
  const result = await response.json().catch(() => null) as AdsCampaignsResponse | null;
  if (!response.ok) throw new Error(getSafeClientErrorMessage(result, translate("impossible_de_charger_les_campagnes_ads_af10c644")));
  return result || {};
}

export default function AdsCampaignsFolder({ onCountChange, draftOnly = false }: { onCountChange: (count: number) => void; draftOnly?: boolean }) {
  const i18nT = useTranslations("mails");
  const locale = useLocale();
  const router = useRouter();
  const mounted = useRef(true);
  const [campaigns, setCampaigns] = useState<StoredAdsCampaign[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await loadCampaignPage(0, draftOnly, i18nT);
      if (!mounted.current) return false;
      const loaded = Array.isArray(result.campaigns) ? result.campaigns : [];
      const count = typeof result.total === "number" ? result.total : loaded.length;
      setCampaigns(loaded);
      setTotal(count);
      setPage(1);
      setNextOffset(typeof result.nextOffset === "number" ? result.nextOffset : null);
      setSelectedId((current) => current && loaded.some((campaign) => campaign.id === current) ? current : null);
      onCountChange(count);
      return true;
    } catch (error) {
      if (mounted.current) setLoadError(getSafeClientErrorMessage(error, i18nT("campagnes_indisponibles_7e03ff61")));
      return false;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [draftOnly, i18nT, onCountChange]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  async function loadMore() {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    setLoadError("");
    try {
      const result = await loadCampaignPage(nextOffset, draftOnly, i18nT);
      if (!mounted.current) return;
      const loaded = Array.isArray(result.campaigns) ? result.campaigns : [];
      setCampaigns((current) => {
        const known = new Set(current.map((campaign) => campaign.id));
        return [...current, ...loaded.filter((campaign) => !known.has(campaign.id))];
      });
      const count = typeof result.total === "number" ? result.total : total;
      setTotal(count);
      setNextOffset(typeof result.nextOffset === "number" ? result.nextOffset : null);
      setPage((current) => current + 1);
      onCountChange(count);
    } catch (error) {
      if (mounted.current) setLoadError(getSafeClientErrorMessage(error, i18nT("campagnes_suivantes_indisponibles_c3625613")));
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  }

  const visibleCampaigns = campaigns.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return <div className={styles.root}>
    <div className={styles.toolbar}>
      <div><h2>{draftOnly ? i18nT("brouillons_ads_6d7765ff") : "ADS"}</h2><span>{i18nT(draftOnly ? "ads_draft_campaign_count" : "ads_recorded_campaign_count", { count: total })}</span></div>
      <div className={styles.toolbarActions}>
        <button type="button" className={`${mailboxStyles.btnGhost} ${draftOnly ? styles.activeFilter : ""}`} onClick={() => router.replace(draftOnly ? "/dashboard/mails?folder=campagnes-ads" : "/dashboard/mails?folder=campagnes-ads&boxView=drafts", { scroll: false })}>{draftOnly ? i18nT("toutes_les_campagnes_7fb3d8e3") : i18nT("brouillons_a55f3cd9")}</button>
        <button type="button" className={mailboxStyles.btnGhost} disabled={loading} onClick={() => void refresh()} aria-label={i18nT("actualiser_les_campagnes_ads_33d1c173")}>{i18nT("actualiser_12d54c85")}</button>
      </div>
    </div>
    {loadError && <p className={styles.error} role="alert">{loadError} <button type="button" onClick={() => void refresh()}>{i18nT("reessayer_895d416b")}</button></p>}
    <div className={mailboxStyles.scrollArea}>
      <div className={mailboxStyles.list}>
        <div className={mailboxStyles.listHeader}><div className={`${mailboxStyles.listHeaderGrid} ${styles.columns}`}>
          <span className={mailboxStyles.listHeaderCell}>{i18nT("campagne_objet_9904389b")}</span>
          <span className={`${mailboxStyles.listHeaderCell} ${mailboxStyles.listHeaderCellCenter}`}>{i18nT("canal_61f21e6f")}</span>
          <span className={`${mailboxStyles.listHeaderCell} ${mailboxStyles.listHeaderCellCenter}`}>{i18nT("statut_659499f3")}</span>
          <span className={`${mailboxStyles.listHeaderCell} ${mailboxStyles.listHeaderCellCenter}`}>{i18nT("date_heure_12c2d703")}</span>
          <span className={`${mailboxStyles.listHeaderCell} ${mailboxStyles.listHeaderCellAction}`}>{i18nT("details_aaa029e6")}</span>
        </div></div>
        {loading && campaigns.length === 0 ? <p className={styles.empty} role="status">{i18nT("chargement_de_vos_campagnes_77c8a03c")}</p>
          : loadError && campaigns.length === 0 ? <p className={styles.empty}>{i18nT("la_liste_des_campagnes_est_momentanement_7c05a509")}</p>
            : visibleCampaigns.length === 0 ? <div className={styles.empty}>{draftOnly ? i18nT("aucun_brouillon_inr_ads_en_cours_3b83dafa") : i18nT("aucune_campagne_enregistree_pour_le_moment_6dc2bf68")} <button type="button" className={mailboxStyles.btnGhost} onClick={() => router.push("/dashboard/ads")}>{draftOnly ? i18nT("creer_une_campagne_e8dbeefe") : i18nT("voir_les_canaux_69ffcfb5")}</button></div>
            : visibleCampaigns.map((campaign) => <div key={campaign.id} className={mailboxStyles.item}>
              <div className={`${mailboxStyles.itemTop} ${styles.columns} ${styles.row}`}>
                <div className={`${mailboxStyles.fromRow} ${styles.rowTitle}`}>{campaign.status === "draft"
                  ? <button type="button" className={styles.draftOpenButton} title={i18nT("reprendre_value_a_la_validation_763087fc", { value0: campaign.name || "la campagne" })} onClick={() => router.push(`/dashboard/ads?channel=${encodeURIComponent(campaign.provider)}&editCampaign=${encodeURIComponent(campaign.id)}`)}>{campaign.name || i18nT("campagne_sans_titre_c9c3142d")}</button>
                  : <span className={mailboxStyles.from} title={campaign.name}>{campaign.name || i18nT("campagne_sans_titre_c9c3142d")}</span>}</div>
                <div className={`${mailboxStyles.itemMid} ${styles.channel}`}>
                  <span>{adsChannelLabels[campaign.provider] || campaign.provider}</span>
                  <span className={styles.mobileSummary}> · {i18nT(adsStatusMessageKeys[campaign.status] || "a_verifier_8f5f7255")} · {adsDateTime(campaign.created_at, locale)}</span>
                </div>
                <div className={styles.statusCell}><span className={styles.status} data-status={campaign.status}>{i18nT(adsStatusMessageKeys[campaign.status] || "a_verifier_8f5f7255")}</span></div>
                <div className={mailboxStyles.itemDateCell}><time className={mailboxStyles.date} dateTime={campaign.created_at}>{adsDateTime(campaign.created_at, locale)}</time></div>
                <div className={mailboxStyles.rowActions}><button type="button" className={`${mailboxStyles.iconBtnSmall} ${mailboxStyles.iconBtnSmallGhost} ${mailboxStyles.detailsBtn}`}
                  aria-label={i18nT("details_de_value_4c6b0b39", { value0: campaign.name || "la campagne" })} title={i18nT("details_aaa029e6")} onClick={(event) => { event.stopPropagation(); setSelectedId(campaign.id); }}><span className={mailboxStyles.detailsBtnIcon} aria-hidden="true">↗</span></button></div>
              </div>
            </div>)}
      </div>
    </div>
    <div className={mailboxStyles.listFooter}>
      <div className={mailboxStyles.listFooterPagerRow}>
        <button type="button" className={mailboxStyles.listFooterArrowButton} disabled={page <= 1 || loading || loadingMore} onClick={() => setPage((current) => current - 1)} aria-label={i18nT("page_precedente_9e15ded9")}>‹</button>
        <span className={mailboxStyles.listFooterPageText}>{page} / {pageCount}</span>
        <button type="button" className={mailboxStyles.listFooterArrowButton} disabled={(page >= pageCount && nextOffset === null) || loading || loadingMore}
          onClick={() => { if (page * PAGE_SIZE < campaigns.length) setPage((current) => current + 1); else void loadMore(); }} aria-label={i18nT("page_suivante_86b1be40")}>›</button>
      </div>
      <div className={mailboxStyles.listFooterMetaRow}><span>{total ? `${(page - 1) * PAGE_SIZE + 1} – ${(page - 1) * PAGE_SIZE + visibleCampaigns.length} / ${total}` : "0 / 0"}</span></div>
    </div>
    <AdsCampaignDetailsModal campaigns={visibleCampaigns} selectedId={selectedId} onSelect={setSelectedId} onClose={() => setSelectedId(null)} onRefresh={refresh} />
  </div>;
}
