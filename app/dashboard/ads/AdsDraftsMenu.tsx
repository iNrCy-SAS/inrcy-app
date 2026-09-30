"use client";

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
};

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Paris",
});

function displayDate(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? dateFormatter.format(parsed) : "date inconnue";
}

export default function AdsDraftsMenu({ refreshKey, onOpenDraft }: Props) {
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
      if (!response.ok) throw new Error(result?.error || "Impossible de charger les brouillons.");
      if (currentRequest !== requestId.current) return;
      const campaigns = Array.isArray(result?.campaigns)
        ? result.campaigns.filter((campaign) => campaign.status === "draft")
        : [];
      setDrafts(campaigns);
      setTotal(typeof result?.total === "number" ? result.total : campaigns.length);
    } catch (loadError) {
      if (currentRequest !== requestId.current) return;
      setError(loadError instanceof Error ? loadError.message : "Brouillons indisponibles.");
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, []);

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
      setError(openError instanceof Error ? openError.message : "Impossible d’ouvrir ce brouillon.");
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
      aria-label={total > 0 ? `Brouillons (${total})` : "Brouillons"}
      title="Brouillons"
      onClick={() => {
        const next = !open;
        setOpen(next);
        if (next) void loadDrafts();
      }}
    >
      <span className={styles.triggerIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M6 3.5h9l3 3V20.5H6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M15 3.5v3h3M9 11h6M9 15h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span>
      <span className={styles.triggerLabel}>Brouillons</span>
      {total > 0 ? <span className={styles.badge} aria-label={`${total} brouillon${total > 1 ? "s" : ""}`}>{total > 99 ? "99+" : total}</span> : null}
    </button>

    {open && <section id="ads-drafts-menu" className={styles.panel} role="dialog" aria-label="Brouillons de campagnes iNr’ADS">
      <header className={styles.panelHeader}>
        <div><strong>Campagnes en brouillon</strong><span>Reprenez directement à la validation, puis modifiez l’étape de votre choix.</span></div>
        <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Fermer les brouillons">✕</button>
      </header>
      <div className={styles.body}>
        {loading && drafts.length === 0 ? <p className={styles.feedback} role="status">Chargement des brouillons…</p>
          : error && drafts.length === 0 ? <p className={styles.feedback} role="alert">{error}<button type="button" onClick={() => void loadDrafts()}>Réessayer</button></p>
            : drafts.length === 0 ? <p className={styles.feedback}>Aucun brouillon en cours. Enregistrez une campagne à l’étape Validation pour la retrouver ici.</p>
              : <ul className={styles.list}>{drafts.map((campaign) => <li key={campaign.id}>
                <button type="button" className={styles.draft} disabled={Boolean(openingId)} onClick={() => void openDraft(campaign.id)}>
                  <strong>{campaign.name || "Campagne sans titre"}</strong>
                  <span className={styles.draftChannel}>{CHANNEL_LABELS[campaign.provider]}</span>
                  <span className={styles.draftMeta}>{openingId === campaign.id ? "Ouverture de la validation…" : `Créé le ${displayDate(campaign.created_at)} · reprendre et modifier`}</span>
                </button>
              </li>)}</ul>}
        {error && drafts.length > 0 ? <p className={styles.feedback} role="alert">{error}</p> : null}
      </div>
      <footer className={styles.footer}><span>{total} brouillon{total > 1 ? "s" : ""} dans iNr’Send</span><Link href="/dashboard/mails?folder=campagnes-ads&boxView=drafts">Voir tous les brouillons ↗</Link></footer>
    </section>}
  </div>;
}
