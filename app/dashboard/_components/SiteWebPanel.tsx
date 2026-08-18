"use client";

import { useTranslations } from "next-intl";


import styles from "../dashboard.module.css";
import ConnectionPill from "./ConnectionPill";
import StatusMessage from "./StatusMessage";
import SiteActusWidgetCode from "./SiteActusWidgetCode";
import ActusWidgetControls from "./ActusWidgetControls";
import SaveIcon from "./SaveIcon";

export default function SiteWebPanel(props: any) {
  const i18nT = useTranslations("shell");
  const {
    siteWebAllGreen,
    hasSiteWebUrl,
    siteWebUrl,
    setSiteWebUrl,
    saveSiteWebUrl,
    deleteSiteWebUrl,
    siteWebUrlBusy,
    draftSiteWebUrlMeta,
    siteWebUrlNotice,
    siteWebGa4Connected,
    siteWebGa4MeasurementId,
    siteWebGa4PropertyId,
    disconnectSiteWebGa4,
    siteWebGa4Busy,
    connectSiteWebGa4,
    canConnectSiteWebGoogle,
    siteWebGa4Notice,
    siteWebGscConnected,
    siteWebGscProperty,
    disconnectSiteWebGsc,
    siteWebGscBusy,
    connectSiteWebGsc,
    siteWebGscNotice,
    siteWebActusLayout,
    setSiteWebActusLayout,
    siteWebActusLimit,
    setSiteWebActusLimit,
    siteWebActusDesign,
    setSiteWebActusDesign,
    siteWebActusTheme,
    setSiteWebActusTheme,
    siteWebActusAccent,
    setSiteWebActusAccent,
    siteWebSavedUrl,
    widgetTokenSiteWeb,
    showSiteWebWidgetCode,
    setShowSiteWebWidgetCode,
    saveSiteWebActusWidgetSettings,
    siteWebSettingsError,
    resetSiteWebAll,
  } = props;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(15,23,42,0.65)",
            colorScheme: "dark",
            padding: "8px 10px",
            borderRadius: 999,
            color: "rgba(255,255,255,0.92)",
            fontSize: 13,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: siteWebAllGreen
                ? "rgba(34,197,94,0.95)"
                : hasSiteWebUrl
                  ? "rgba(59,130,246,0.95)"
                  : "rgba(148,163,184,0.9)",
            }}
          />
          {i18nT("statut_b20e7fc2")}{" "}<strong>{hasSiteWebUrl ? (i18nT("connecte_ce09957c")) : i18nT("a_configurer_bde8227a")}</strong>
        </span>
      </div>

      <div
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.03)",
          borderRadius: 14,
          padding: 12,
          display: "grid",
          gap: 10,
        }}
      >
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("lien_du_site_760c2d8a")}</div>
          <ConnectionPill connected={hasSiteWebUrl} />
        </div>
        <div className={styles.blockSub}>
          {i18nT("le_bouton_f97378f8")}{" "}<strong>{i18nT("voir_le_site_5bf01317")}</strong> {" "}{i18nT("de_la_bulle_utilisera_ce_lien_f51f1013")}{" "}</div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={siteWebUrl}
            onChange={(e) => setSiteWebUrl(e.target.value)}
            disabled={hasSiteWebUrl}
            placeholder="https://votre-site.fr"
            title={hasSiteWebUrl ? "Supprimez d'abord le lien enregistré pour en saisir un nouveau." : undefined}
            style={{
              flex: "1 1 280px",
              minWidth: 0,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(15,23,42,0.65)",
              colorScheme: "dark",
              padding: "10px 12px",
              color: "white",
              outline: "none",
              cursor: hasSiteWebUrl ? "not-allowed" : "text",
              opacity: hasSiteWebUrl ? 0.7 : 1,
            }}
          />

          {hasSiteWebUrl ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.disconnectBtn}`}
              onClick={() => void deleteSiteWebUrl()}
              disabled={siteWebUrlBusy}
              title={i18nT("supprimer_le_lien_c9d6952c")}
              aria-label={i18nT("supprimer_le_lien_c9d6952c")}
              style={{ minWidth: 44, paddingInline: 0, fontSize: 22, fontWeight: 900, lineHeight: 1 }}
              aria-busy={siteWebUrlBusy}
            >
              {siteWebUrlBusy ? "…" : "×"}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.iconBtn}`}
              onClick={() => void saveSiteWebUrl()}
              disabled={siteWebUrlBusy}
              title={siteWebUrlBusy ? "Enregistrement en cours" : "Enregistrer le lien"}
              aria-label={siteWebUrlBusy ? "Enregistrement en cours" : "Enregistrer le lien"}
              aria-busy={siteWebUrlBusy}
            >
              {siteWebUrlBusy ? <span aria-hidden>…</span> : <SaveIcon />}
            </button>
          )}

          <a
            href={draftSiteWebUrlMeta?.normalizedUrl || "#"}
            target="_blank"
            rel="noreferrer"
            className={`${styles.actionBtn} ${styles.viewBtn}`}
            style={{ pointerEvents: draftSiteWebUrlMeta ? "auto" : "none", opacity: draftSiteWebUrlMeta ? 1 : 0.5 }}
          >
            {i18nT("voir_le_site_5bf01317")}{" "}</a>
        </div>
        {siteWebUrlNotice && <StatusMessage variant="success">{siteWebUrlNotice}</StatusMessage>}
      </div>
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.03)",
          borderRadius: 14,
          padding: 12,
          display: "grid",
          gap: 10,
        }}
      >
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("google_analytics_ga4_f02551f4")}</div>
          <ConnectionPill connected={siteWebGa4Connected} />
        </div>
        <div className={styles.blockSub}>{i18nT("remplissage_automatique_des_identifiants_ga4_apr_d79e4b21")}</div>

        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 13 }}>{i18nT("id_de_mesure_ex_g_xxxxxxxxxx_ab32feb7")}</span>
          <input
            value={siteWebGa4MeasurementId}
            readOnly
            aria-readonly="true"
            placeholder={i18nT("remplissage_automatique_apres_connexion_fc3ad543")}
            style={{
              width: "100%",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(15,23,42,0.4)",
              colorScheme: "dark",
              padding: "10px 12px",
              color: "rgba(255,255,255,0.88)",
              outline: "none",
              cursor: "not-allowed",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 13 }}>{i18nT("property_id_numerique_ex_123456789_c8dc0757")}</span>
          <input
            value={siteWebGa4PropertyId}
            readOnly
            aria-readonly="true"
            inputMode="numeric"
            placeholder={i18nT("remplissage_automatique_apres_connexion_fc3ad543")}
            style={{
              width: "100%",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(15,23,42,0.4)",
              colorScheme: "dark",
              padding: "10px 12px",
              color: "rgba(255,255,255,0.88)",
              outline: "none",
              cursor: "not-allowed",
            }}
          />
        </label>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {siteWebGa4Connected ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.disconnectBtn}`}
              onClick={() => void disconnectSiteWebGa4()}
              disabled={siteWebGa4Busy}
              title={i18nT("deconnecter_ga4_fcfefc0f")}
            >
              {siteWebGa4Busy ? i18nT("deconnexion_f5a5666d") : i18nT("deconnecter_9c1ef392")}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.connectBtn}`}
              onClick={connectSiteWebGa4}
              disabled={!canConnectSiteWebGoogle}
              title={!hasSiteWebUrl ? "Renseigne le lien du site web avant de connecter Google Analytics." : "Connecter Google Analytics"}
            >
              {i18nT("connecter_google_analytics_2a8cb23a")}{" "}</button>
          )}
        </div>
      </div>
      {siteWebGa4Notice && <StatusMessage variant="success">{siteWebGa4Notice}</StatusMessage>}

      <div
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.03)",
          borderRadius: 14,
          padding: 12,
          display: "grid",
          gap: 10,
        }}
      >
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("google_search_console_fe6bf60d")}</div>
          <ConnectionPill connected={siteWebGscConnected} />
        </div>
        <div className={styles.blockSub}>{i18nT("remplissage_automatique_des_identifiants_gsc_apr_2a7727b1")}</div>

        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 13 }}>
            {i18nT("propriete_ex_2b3d54fc")}{" "}<code>sc-domain:monsite.fr</code> ou <code>https://monsite.fr/</code>)
          </span>
          <input
            value={siteWebGscProperty}
            readOnly
            aria-readonly="true"
            placeholder={i18nT("remplissage_automatique_apres_connexion_fc3ad543")}
            style={{
              width: "100%",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(15,23,42,0.4)",
              colorScheme: "dark",
              padding: "10px 12px",
              color: "rgba(255,255,255,0.88)",
              outline: "none",
              cursor: "not-allowed",
            }}
          />
        </label>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {siteWebGscConnected ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.disconnectBtn}`}
              onClick={() => void disconnectSiteWebGsc()}
              disabled={siteWebGscBusy}
              title={i18nT("deconnecter_gsc_b1a8deae")}
            >
              {siteWebGscBusy ? i18nT("deconnexion_f5a5666d") : i18nT("deconnecter_9c1ef392")}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.connectBtn}`}
              onClick={connectSiteWebGsc}
              disabled={!canConnectSiteWebGoogle}
              title={!hasSiteWebUrl ? "Renseigne le lien du site web avant de connecter Google Search Console." : "Connecter Google Search Console"}
            >
              {i18nT("connecter_google_search_console_f3404063")}{" "}</button>
          )}
        </div>
      </div>
      {siteWebGscNotice && <StatusMessage variant="success">{siteWebGscNotice}</StatusMessage>}

      <div
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.03)",
          borderRadius: 14,
          padding: 12,
          display: "grid",
          gap: 10,
        }}
      >
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("widget_actus_13beb3e6")}</div>
        </div>
        <div className={styles.blockSub}>
          {i18nT("collez_ce_code_iframe_dans_votre_81743f90")}{" "}</div>

        <ActusWidgetControls
          layout={siteWebActusLayout}
          setLayout={setSiteWebActusLayout}
          limit={siteWebActusLimit}
          setLimit={setSiteWebActusLimit}
          design={siteWebActusDesign}
          setDesign={setSiteWebActusDesign}
          theme={siteWebActusTheme}
          setTheme={setSiteWebActusTheme}
          accent={siteWebActusAccent}
          setAccent={setSiteWebActusAccent}
        />

        <SiteActusWidgetCode
          savedUrl={siteWebSavedUrl}
          source="site_web"
          layout={siteWebActusLayout}
          limit={siteWebActusLimit}
          design={siteWebActusDesign}
          theme={siteWebActusTheme}
          accent={siteWebActusAccent}
          token={widgetTokenSiteWeb}
          showCode={showSiteWebWidgetCode}
          onToggle={() => setShowSiteWebWidgetCode((prev: boolean) => !prev)}
          onHideCode={() => setShowSiteWebWidgetCode(false)}
          onGenerate={saveSiteWebActusWidgetSettings}
        />
      </div>

      {siteWebSettingsError && (
        <div style={{ color: "rgba(248,113,113,0.95)", fontSize: 12 }}>{siteWebSettingsError}</div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.resetBtn}`}
          onClick={resetSiteWebAll}
          title={i18nT("reinitialiser_lien_ga4_search_console_4d090b8d")}
        >
          {i18nT("reinitialiser_e0e2ad54")}{" "}</button>
      </div>
    </div>
  );
}



