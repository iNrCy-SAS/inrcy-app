"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StoredAdsCampaign } from "@/app/dashboard/ads/AdsCampaignTracking";
import AdsCampaignDetailsModal from "./AdsCampaignDetailsModal";
import { adsChannelLabels, adsDateTime, adsStatusLabels } from "./adsCampaignsFolder.shared";
import mailboxStyles from "../mails.module.css";
import styles from "./AdsCampaignsFolder.module.css";

type AdsCampaignsResponse = {
  campaigns?: StoredAdsCampaign[];
  total?: number;
  nextOffset?: number | null;
  error?: string;
};

const PAGE_SIZE = 50;

async function loadCampaignPage(offset = 0): Promise<AdsCampaignsResponse> {
  const response = await fetch(`/api/ads/campaigns?offset=${offset}`, { cache: "no-store" });
  const result = await response.json().catch(() => null) as AdsCampaignsResponse | null;
  if (!response.ok) throw new Error(result?.error || "Impossible de charger les campagnes Ads.");
  return result || {};
}

export default function AdsCampaignsFolder({ onCountChange }: { onCountChange: (count: number) => void }) {
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

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await loadCampaignPage();
      if (!mounted.current) return;
      const loaded = Array.isArray(result.campaigns) ? result.campaigns : [];
      const count = typeof result.total === "number" ? result.total : loaded.length;
      setCampaigns(loaded);
      setTotal(count);
      setPage(1);
      setNextOffset(typeof result.nextOffset === "number" ? result.nextOffset : null);
      setSelectedId((current) => current && loaded.some((campaign) => campaign.id === current) ? current : null);
      onCountChange(count);
    } catch (error) {
      if (mounted.current) setLoadError(error instanceof Error ? error.message : "Campagnes indisponibles.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [onCountChange]);

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
      const result = await loadCampaignPage(nextOffset);
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
      if (mounted.current) setLoadError(error instanceof Error ? error.message : "Campagnes suivantes indisponibles.");
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  }

  const visibleCampaigns = campaigns.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return <div className={styles.root}>
    <div className={styles.toolbar}>
      <div><h2>Campagnes Ads</h2><span>{total} campagne{total > 1 ? "s" : ""} enregistrée{total > 1 ? "s" : ""}</span></div>
      <button type="button" className={mailboxStyles.btnGhost} disabled={loading} onClick={() => void refresh()} aria-label="Actualiser les campagnes Ads">↻ Actualiser</button>
    </div>
    {loadError && <p className={styles.error} role="alert">{loadError} <button type="button" onClick={() => void refresh()}>Réessayer</button></p>}
    <div className={mailboxStyles.scrollArea}>
      <div className={mailboxStyles.list}>
        <div className={mailboxStyles.listHeader}><div className={`${mailboxStyles.listHeaderGrid} ${styles.columns}`}>
          <span className={mailboxStyles.listHeaderCell}>Campagne / objet</span>
          <span className={`${mailboxStyles.listHeaderCell} ${mailboxStyles.listHeaderCellCenter}`}>Canal</span>
          <span className={`${mailboxStyles.listHeaderCell} ${mailboxStyles.listHeaderCellCenter}`}>Statut</span>
          <span className={`${mailboxStyles.listHeaderCell} ${mailboxStyles.listHeaderCellCenter}`}>Date / heure</span>
          <span className={`${mailboxStyles.listHeaderCell} ${mailboxStyles.listHeaderCellAction}`}>Détails</span>
        </div></div>
        {loading && campaigns.length === 0 ? <p className={styles.empty} role="status">Chargement de vos campagnes…</p>
          : loadError && campaigns.length === 0 ? <p className={styles.empty}>La liste des campagnes est momentanément indisponible.</p>
            : visibleCampaigns.length === 0 ? <div className={styles.empty}>Aucune campagne enregistrée pour le moment. <button type="button" className={mailboxStyles.btnGhost} onClick={() => router.push("/dashboard/ads")}>Voir les canaux</button></div>
            : visibleCampaigns.map((campaign) => <div key={campaign.id} className={mailboxStyles.item} role="button" tabIndex={0}
              onClick={() => setSelectedId(campaign.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(campaign.id); } }}>
              <div className={`${mailboxStyles.itemTop} ${styles.columns} ${styles.row}`}>
                <div className={`${mailboxStyles.fromRow} ${styles.rowTitle}`}><span className={mailboxStyles.from} title={campaign.name}>{campaign.name || "Campagne sans titre"}</span></div>
                <div className={`${mailboxStyles.itemMid} ${styles.channel}`}>
                  <span>{adsChannelLabels[campaign.provider] || campaign.provider}</span>
                  <span className={styles.mobileSummary}> · {adsStatusLabels[campaign.status] || "À vérifier"} · {adsDateTime(campaign.created_at)}</span>
                </div>
                <div className={styles.statusCell}><span className={styles.status} data-status={campaign.status}>{adsStatusLabels[campaign.status] || "À vérifier"}</span></div>
                <div className={mailboxStyles.itemDateCell}><time className={mailboxStyles.date} dateTime={campaign.created_at}>{adsDateTime(campaign.created_at)}</time></div>
                <div className={mailboxStyles.rowActions}><button type="button" className={`${mailboxStyles.iconBtnSmall} ${mailboxStyles.iconBtnSmallGhost} ${mailboxStyles.detailsBtn}`}
                  aria-label={`Détails de ${campaign.name || "la campagne"}`} title="Détails" onClick={(event) => { event.stopPropagation(); setSelectedId(campaign.id); }}><span className={mailboxStyles.detailsBtnIcon} aria-hidden="true">↗</span></button></div>
              </div>
            </div>)}
      </div>
    </div>
    <div className={mailboxStyles.listFooter}>
      <div className={mailboxStyles.listFooterPagerRow}>
        <button type="button" className={mailboxStyles.listFooterArrowButton} disabled={page <= 1 || loading || loadingMore} onClick={() => setPage((current) => current - 1)} aria-label="Page précédente">‹</button>
        <span className={mailboxStyles.listFooterPageText}>{page} / {pageCount}</span>
        <button type="button" className={mailboxStyles.listFooterArrowButton} disabled={(page >= pageCount && nextOffset === null) || loading || loadingMore}
          onClick={() => { if (page * PAGE_SIZE < campaigns.length) setPage((current) => current + 1); else void loadMore(); }} aria-label="Page suivante">›</button>
      </div>
      <div className={mailboxStyles.listFooterMetaRow}><span>{total ? `${(page - 1) * PAGE_SIZE + 1} – ${(page - 1) * PAGE_SIZE + visibleCampaigns.length} / ${total}` : "0 / 0"}</span></div>
    </div>
    <AdsCampaignDetailsModal campaigns={visibleCampaigns} selectedId={selectedId} onSelect={setSelectedId} onClose={() => setSelectedId(null)} onRefresh={refresh} />
  </div>;
}
