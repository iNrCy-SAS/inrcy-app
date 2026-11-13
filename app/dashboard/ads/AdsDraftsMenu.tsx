"use client";

import { useLocale, useTranslations } from "next-intl";


import { createAdsApiRequestError } from "./adsClientHttp";
import { useAdsErrorMessage } from "./useAdsErrorMessage";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StoredAdsCampaign } from "./AdsCampaignTracking";
import styles from "./AdsDraftsMenu.module.css";

type DraftsResponse = {
  campaigns?: StoredAdsCampaign[];
  total?: number;
  error?: string;
};

type Props = {
  refreshKey: number;
  onOpenDraft: (campaignId: string) => Promise<void>;
};

const CHANNEL_LABELS: Record<StoredAdsCampaign["provider"], string> = {
  google: "Google Ads",
  meta: "Meta Ads",
  linkedin: "LinkedIn Ads",
  tiktok: "TikTok Ads",
  pinterest: "Pinterest Ads",
  x: "X Ads",
  openai: "ChatGPT Ads",
};

export default function AdsDraftsMenu({ refreshKey, onOpenDraft }: Props) {
  const i18nT = useTranslations("booster");
  const locale = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Paris" });
  const displayDate = (value: string) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? dateFormatter.format(parsed) : i18nT("ads_unknown_date");
  };
  const errorMessage = useAdsErrorMessage();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestId = useRef(0);
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<StoredAdsCampaign[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState("");

  const loadDrafts = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ads/campaigns?status=draft", { cache: "no-store" });
      const result = await response.json().catch(() => null) as DraftsResponse | null;
      if (!response.ok) throw createAdsApiRequestError(result, response.status);
      if (currentRequest !== requestId.current) return;
      const campaigns = Array.isArray(result?.campaigns)
        ? result.campaigns.filter((campaign) => campaign.status === "draft")
        : [];
      setDrafts(campaigns);
      setTotal(typeof result?.total === "number" ? result.total : campaigns.length);
    } catch (loadError) {
      if (currentRequest !== requestId.current) return;
      setError(errorMessage(loadError, "shell.ads_error_d98e167559"));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [errorMessage]);

  useEffect(() => {
    void loadDrafts();
    return () => { requestId.current += 1; };
  }, [loadDrafts, refreshKey]);

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function openDraft(campaignId: string) {
    if (openingId) return;
    setOpeningId(campaignId);
    setError("");
    try {
      await onOpenDraft(campaignId);
      setOpen(false);
    } catch (openError) {
      setError(errorMessage(openError, "shell.ads_error_9c1ed5c11b"));
      await loadDrafts();
    } finally {
      setOpeningId("");
    }
  }

  return <div className={styles.root} ref={rootRef}>
    <button
      type="button"
      className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="ads-drafts-menu"
      aria-label={total > 0 ? i18nT("brouillons_value_c6cbd50c", { value0: total }) : i18nT("brouillons_a55f3cd9")}
      title={i18nT("brouillons_a55f3cd9")}
      onClick={() => {
        const next = !open;
        setOpen(next);
        if (next) void loadDrafts();
      }}
    >
      <span className={styles.triggerIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M6 3.5h9l3 3V20.5H6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M15 3.5v3h3M9 11h6M9 15h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span>
      <span className={styles.triggerLabel}>{i18nT("brouillons_a55f3cd9")}</span>
      {total > 0 ? <span className={styles.badge} aria-label={i18nT("ads_count_drafts", { count: total })}>{total > 99 ? "99+" : total}</span> : null}
    </button>

    {open && <section id="ads-drafts-menu" className={styles.panel} role="dialog" aria-label={i18nT("brouillons_de_campagnes_inr_ads_3c825c45")}>
      <header className={styles.panelHeader}>
        <div><strong>{i18nT("campagnes_en_brouillon_3ac7efe4")}</strong><span>{i18nT("reprenez_directement_a_la_validation_puis_60f575e7")}</span></div>
        <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label={i18nT("fermer_les_brouillons_d7b96b60")}>✕</button>
      </header>
      <div className={styles.body}>
        {loading && drafts.length === 0 ? <p className={styles.feedback} role="status">{i18nT("chargement_des_brouillons_1ee406e9")}</p>
          : error && drafts.length === 0 ? <p className={styles.feedback} role="alert">{error}<button type="button" onClick={() => void loadDrafts()}>{i18nT("reessayer_895d416b")}</button></p>
            : drafts.length === 0 ? <p className={styles.feedback}>{i18nT("aucun_brouillon_en_cours_enregistrez_une_05927192")}</p>
              : <ul className={styles.list}>{drafts.map((campaign) => <li key={campaign.id}>
                <button type="button" className={styles.draft} disabled={Boolean(openingId)} onClick={() => void openDraft(campaign.id)}>
                  <strong>{campaign.name || i18nT("campagne_sans_titre_c9c3142d")}</strong>
                  <span className={styles.draftChannel}>{CHANNEL_LABELS[campaign.provider]}</span>
                  <span className={styles.draftMeta}>{openingId === campaign.id ? i18nT("ouverture_de_la_validation_1caddb91") : i18nT("cree_le_value_reprendre_et_modifier_c739ead0", { value0: displayDate(campaign.created_at) })}</span>
                </button>
              </li>)}</ul>}
        {error && drafts.length > 0 ? <p className={styles.feedback} role="alert">{error}</p> : null}
      </div>
      <footer className={styles.footer}><span>{i18nT("ads_drafts_in_send", { count: total })}</span><Link href="/dashboard/mails?folder=campagnes-ads&boxView=drafts">{i18nT("voir_tous_les_brouillons_5dd56285")}</Link></footer>
    </section>}
  </div>;
}
