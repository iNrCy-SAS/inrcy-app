"use client";

import { useId, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { buildDashboardPanelProps } from "../dashboard.panel-props";
import EditableChannelUrlField from "./EditableChannelUrlField";
import { getChannelPopoverPlacement } from "./channel-popover-position";
import styles from "./DashboardChannelBubble.module.css";

export type SiteWebBubbleProps = ReturnType<typeof buildDashboardPanelProps>["siteWebPanelProps"];

export function SiteGoogleConnectionButton({ product, connected, busy, canConnect, details, onConnect, onDisconnect }: {
  product: "GA4" | "GSC";
  connected: boolean;
  busy: boolean;
  canConnect: boolean;
  details: { label: string; value: string }[];
  onConnect: () => unknown;
  onDisconnect: () => unknown | Promise<unknown>;
}) {
  const t = useTranslations("dashboard.channelBubble");
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const place = () => { if (trigger.current) setPosition(getChannelPopoverPlacement(trigger.current, menu.current, 320)); };
  const disconnect = async () => {
    if (busy || inFlight.current) return;
    inFlight.current = true; setPending(true); setError("");
    try { await onDisconnect(); }
    catch { setError(t("failed")); }
    finally { inFlight.current = false; setPending(false); }
  };
  return <div className={styles.siteGoogleCard} data-connected={connected}>
    <button ref={trigger} type="button" className={styles.siteGoogleButton} disabled={busy || pending || (!connected && !canConnect)} popoverTarget={connected ? id : undefined} onClick={connected ? undefined : () => { onConnect(); }} aria-label={`${connected ? t("connectedAccount") : t("connect")} — ${product}`} title={connected ? `${product} — ${details.map(detail => `${detail.label} : ${detail.value}`).join(" · ")}` : !canConnect ? t("saveSiteFirst") : `${t("connect")} ${product}`}>
      <strong><span className={styles.siteGoogleDot} aria-hidden="true" />{product}</strong><small>{busy || pending ? t("loading") : connected ? t("connectedShort") : t("connect")}</small>
    </button>
    {connected ? <button type="button" className={styles.siteGoogleDisconnect} aria-label={`${t("disconnect")} ${product}`} title={`${t("disconnect")} ${product}`} disabled={busy || pending} onClick={() => void disconnect()}>×</button> : null}
    {connected ? <div ref={menu} id={id} popover="auto" role="group" aria-label={`${product} — ${t("connectedShort")}`} className={`${styles.typesMenu} ${styles.siteGoogleDetails}`} style={position} onBeforeToggle={event => { if (event.newState === "open") place(); }} onToggle={event => { if (event.newState === "open") place(); }}>
      <header className={styles.popoverHeader}><strong>{product === "GA4" ? "Google Analytics 4" : "Google Search Console"}</strong><button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label={t("close")}>×</button></header>
      <dl>{details.map(detail => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value || "—"}</dd></div>)}</dl>
    </div> : null}
    {error ? <span className={styles.typesError} role="alert">{error}</span> : null}
  </div>;
}

export default function SiteWebBubbleControls({ site, onDirtyChange }: { site: SiteWebBubbleProps; onDirtyChange: (dirty: boolean) => void }) {
  const t = useTranslations("dashboard.channelBubble");
  const shell = useTranslations("shell");
  return <div className={styles.siteControls}>
    <div className={styles.siteUrlField}><EditableChannelUrlField channel="site_web" value={site.siteWebSavedUrl || ""} onSaved={site.applySiteWebPublicUrlSaved} onDirtyChange={onDirtyChange} ariaLabel={shell("lien_du_site_760c2d8a")} placeholder="https://votre-site.fr" viewLabel={shell("voir_le_site_5bf01317")} editorOnly={!site.hasSiteWebUrl} saveAsIcon disabled={site.siteWebUrlBusy} /></div>
    <div className={styles.siteGoogleGrid}>
      <SiteGoogleConnectionButton product="GA4" connected={Boolean(site.siteWebGa4Connected)} busy={Boolean(site.siteWebGa4Busy)} canConnect={Boolean(site.canConnectSiteWebGoogle)} onConnect={site.connectSiteWebGa4} onDisconnect={site.disconnectSiteWebGa4} details={[{ label: shell("id_de_mesure_ex_g_xxxxxxxxxx_ab32feb7"), value: site.siteWebGa4MeasurementId || "" }, { label: shell("property_id_numerique_ex_123456789_c8dc0757"), value: site.siteWebGa4PropertyId || "" }]} />
      <SiteGoogleConnectionButton product="GSC" connected={Boolean(site.siteWebGscConnected)} busy={Boolean(site.siteWebGscBusy)} canConnect={Boolean(site.canConnectSiteWebGoogle)} onConnect={site.connectSiteWebGsc} onDisconnect={site.disconnectSiteWebGsc} details={[{ label: shell("propriete_ex_2b3d54fc"), value: site.siteWebGscProperty || "" }]} />
    </div>
    {!site.hasSiteWebUrl ? <p className={styles.siteFirstHint}>{t("saveSiteFirst")}</p> : null}
  </div>;
}
