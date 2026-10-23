"use client";

import { useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { createInrBadgeQrMatrix } from "@/lib/inrBadgeQr";
import { createInrBadgeQrTrackingUrl, type InrBadgeProfileSummary } from "@/lib/inrBadge";
import { getChannelPopoverPlacement } from "./channel-popover-position";
import styles from "./DashboardChannelBubble.module.css";

function BadgeActionIcon({ kind }: { kind: "qr" | "download" | "link" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "download" ? <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></> : kind === "link" ? <><path d="m10 13 4-4m-6 7-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0)" /></> : <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><rect x="3" y="15" width="6" height="6" rx="1" /><path d="M15 15h3v3h3m-6 3v-3m6-3v-3M3 12h3m6-9v3m0 6h3" /></>}
  </svg>;
}

function useBadgePopover(width: number) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const place = (event: { newState: string }) => {
    if (event.newState === "open" && trigger.current) setPosition(getChannelPopoverPlacement(trigger.current, menu.current, width));
  };
  return { id, trigger, menu, position, place };
}

export function InrBadgeQrButton({ publicUrl, companyName }: { publicUrl: string; companyName?: string }) {
  const t = useTranslations("settings");
  const bubble = useTranslations("dashboard.channelBubble");
  const { id, trigger, menu, position, place } = useBadgePopover(380);
  const matrix = useMemo(() => {
    if (!publicUrl) return [];
    try { return createInrBadgeQrMatrix(createInrBadgeQrTrackingUrl(publicUrl)); }
    catch { return []; }
  }, [publicUrl]);
  const size = matrix.length + 8;
  return <div className={styles.resourceGroup}>
    <button ref={trigger} type="button" className={`${styles.resourcePill} ${styles.badgeQrTrigger}`} disabled={!matrix.length} popoverTarget={id}><BadgeActionIcon kind="qr" />{t("qr_code_44742187")}</button>
    <div ref={menu} id={id} popover="auto" role="group" aria-label={t("qr_code_44742187")} className={`${styles.typesMenu} ${styles.badgeQrFrame}`} style={position} onBeforeToggle={place} onToggle={place}>
      <header className={`${styles.popoverHeader} ${styles.badgeQrHeader}`}><strong>{t("qr_code_44742187")}</strong><span className={styles.badgeQrCompany} title={companyName}>{companyName}</span><button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label={bubble("close")}>×</button></header>
      <figure className={styles.badgeQrPaper}><svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${t("qr_code_44742187")} — ${companyName || "iNrCy"}`} className={styles.badgeQrCode} shapeRendering="crispEdges"><rect width={size} height={size} fill="white" /><path fill="#111827" d={matrix.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${x + 4} ${y + 4}h1v1h-1z`] : [])).join("")} /></svg></figure>
    </div>
  </div>;
}

export function InrBadgeDownloadButton({ publicUrl, profile }: { publicUrl: string; profile: InrBadgeProfileSummary }) {
  const t = useTranslations("settings");
  const bubble = useTranslations("dashboard.channelBubble");
  const { id, trigger, menu, position, place } = useBadgePopover(240);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const download = async (format: "png" | "pdf") => {
    if (!publicUrl || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const { downloadInrBadgeQr } = await import("../settings/_components/InrBadgeSettingsContent");
      await downloadInrBadgeQr(publicUrl, profile, format);
      menu.current?.hidePopover();
    } catch { setError(bubble("failed")); }
    finally { pending.current = false; setBusy(false); }
  };
  return <>
    <button ref={trigger} type="button" className={styles.iconAction} aria-label={t("telecharger_b332d06d")} title={t("telecharger_b332d06d")} popoverTarget={id} disabled={!publicUrl || busy}><BadgeActionIcon kind="download" /><span className={styles.actionText} aria-hidden="true">{t("telecharger_b332d06d")}</span></button>
    <div ref={menu} id={id} popover="auto" role="group" aria-label={t("choisir_un_format_de_telechargement_42324b61")} className={styles.typesMenu} style={position} onBeforeToggle={place} onToggle={place}>
      <header className={styles.popoverHeader}><strong>{t("telecharger_b332d06d")}</strong><button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label={bubble("close")}>×</button></header>
      <div className={styles.badgeDownloadChoices}>{(["png", "pdf"] as const).map(format => <button key={format} type="button" disabled={busy} onClick={() => void download(format)}>{format.toUpperCase()}</button>)}</div>
      {error ? <p role="alert" className={styles.typesError}>{error}</p> : null}
    </div>
  </>;
}

export function InrBadgeCopyButton({ publicUrl }: { publicUrl: string }) {
  const t = useTranslations("settings");
  const bubble = useTranslations("dashboard.channelBubble");
  const [notice, setNotice] = useState("");
  return <div className={styles.badgeCopyAction}>
    <button type="button" className={styles.iconAction} aria-label={t("copier_le_lien_2b135d8c")} title={t("copier_le_lien_2b135d8c")} disabled={!publicUrl} onClick={async () => {
      try { await navigator.clipboard.writeText(publicUrl); setNotice(t("lien_copie_8f514dc0")); }
      catch { setNotice(t("impossible_de_copier_automatiquement_selectionne_df13c396")); }
    }}><BadgeActionIcon kind="link" /><span className={styles.actionText} aria-hidden="true">{bubble("linkShort")}</span></button>
    {notice ? <span role="status" className={styles.badgeCopyNotice}>{notice}</span> : null}
  </div>;
}
