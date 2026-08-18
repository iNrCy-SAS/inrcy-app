"use client";

import { useTranslations } from "next-intl";


import styles from "../dashboard.module.css";
import ConnectionPill from "./ConnectionPill";
import StatusMessage from "./StatusMessage";
import SiteActusWidgetCode from "./SiteActusWidgetCode";
import ActusWidgetControls from "./ActusWidgetControls";
import SaveIcon from "./SaveIcon";

export default function SiteInrcyPanel(props: any) {
  const i18nT = useTranslations("shell");
  const {
    siteInrcyOwnership,
    siteInrcyAllGreen,
    siteInrcyContactEmail,
    hasSiteInrcyUrl,
    siteInrcyUrl,
    setSiteInrcyUrl,
    saveSiteInrcyUrl,
    deleteSiteInrcyUrl,
    siteInrcyUrlBusy,
    draftSiteInrcyUrlMeta,
    siteInrcyUrlNotice,
    siteInrcyGa4Connected,
    ga4MeasurementId,
    ga4PropertyId,
    disconnectSiteInrcyGa4,
    siteInrcyGa4Busy,
    connectSiteInrcyGa4,
    canConnectSiteInrcyGoogle,
    canConfigureSite,
    siteInrcyGa4Notice,
    siteInrcyGscConnected,
    gscProperty,
    disconnectSiteInrcyGsc,
    siteInrcyGscBusy,
    connectSiteInrcyGsc,
    siteInrcyGscNotice,
    siteInrcyActusLayout,
    setSiteInrcyActusLayout,
    siteInrcyActusLimit,
    setSiteInrcyActusLimit,
    siteInrcyActusDesign,
    setSiteInrcyActusDesign,
    siteInrcyActusTheme,
    setSiteInrcyActusTheme,
    siteInrcyActusAccent,
    setSiteInrcyActusAccent,
    siteInrcySavedUrl,
    widgetTokenInrcySite,
    showSiteInrcyWidgetCode,
    setShowSiteInrcyWidgetCode,
    saveSiteInrcyActusWidgetSettings,
    siteInrcySettingsError,
    resetSiteInrcyAll,
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
              background:
                siteInrcyOwnership === "none"
                  ? "rgba(148,163,184,0.9)"
                  : siteInrcyAllGreen
                    ? "rgba(34,197,94,0.95)"
                    : "rgba(59,130,246,0.95)",
            }}
          />
          {i18nT("statut_b20e7fc2")}{" "}<strong>{siteInrcyOwnership === "none" ? i18nT("aucun_site_f874e141") : hasSiteInrcyUrl ? i18nT("connecte_ce09957c") : i18nT("a_connecter_dee8dcb4")}</strong>
        </span>

        {!!siteInrcyContactEmail && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(15,23,42,0.65)",
              colorScheme: "dark",
              padding: "8px 10px",
              borderRadius: 999,
              color: "rgba(255,255,255,0.85)",
              fontSize: 13,
            }}
          >
            {i18nT("email_f2f25a21")}{" "}<strong style={{ marginLeft: 6 }}>{siteInrcyContactEmail}</strong>
          </span>
        )}
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
          <ConnectionPill connected={siteInrcyOwnership !== "none" && hasSiteInrcyUrl} />
        </div>
        <div className={styles.blockSub}>
          {i18nT("le_bouton_f97378f8")}{" "}<strong>{i18nT("voir_le_site_5bf01317")}</strong> {" "}{i18nT("de_la_bulle_utilisera_ce_lien_f51f1013")}{" "}</div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={siteInrcyUrl}
            onChange={(e) => setSiteInrcyUrl(e.target.value)}
            disabled={siteInrcyOwnership === "none" || hasSiteInrcyUrl}
            placeholder="https://..."
            title={hasSiteInrcyUrl ? "Supprimez d'abord le lien enregistré pour en saisir un nouveau." : undefined}
            style={{
              flex: "1 1 280px",
              minWidth: 0,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(15,23,42,0.65)",
              colorScheme: "dark",
              padding: "10px 12px",
              color: siteInrcyOwnership === "none" ? "rgba(255,255,255,0.75)" : "white",
              outline: "none",
              cursor: siteInrcyOwnership === "none" || hasSiteInrcyUrl ? "not-allowed" : "text",
              opacity: hasSiteInrcyUrl ? 0.7 : 1,
            }}
          />

          {hasSiteInrcyUrl ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.disconnectBtn}`}
              onClick={() => void deleteSiteInrcyUrl()}
              disabled={siteInrcyOwnership === "none" || siteInrcyUrlBusy}
              title={i18nT("supprimer_le_lien_c9d6952c")}
              aria-label={i18nT("supprimer_le_lien_c9d6952c")}
              style={{ minWidth: 44, paddingInline: 0, fontSize: 22, fontWeight: 900, lineHeight: 1 }}
              aria-busy={siteInrcyUrlBusy}
            >
              {siteInrcyUrlBusy ? "…" : "×"}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.iconBtn}`}
              onClick={() => void saveSiteInrcyUrl()}
              disabled={siteInrcyOwnership === "none" || siteInrcyUrlBusy}
              title={
                siteInrcyOwnership === "none"
                  ? "Aucun site iNrCy associé"
                  : siteInrcyUrlBusy
                    ? "Enregistrement en cours"
                    : "Enregistrer le lien"
              }
              aria-label={siteInrcyUrlBusy ? "Enregistrement en cours" : "Enregistrer le lien"}
              aria-busy={siteInrcyUrlBusy}
            >
              {siteInrcyUrlBusy ? <span aria-hidden>…</span> : <SaveIcon />}
            </button>
          )}

          <a
            href={draftSiteInrcyUrlMeta?.normalizedUrl || "#"}
            target="_blank"
            rel="noreferrer"
            className={`${styles.actionBtn} ${styles.viewBtn}`}
            style={{ pointerEvents: draftSiteInrcyUrlMeta ? "auto" : "none", opacity: draftSiteInrcyUrlMeta ? 1 : 0.5 }}
          >
            {i18nT("voir_le_site_5bf01317")}{" "}</a>
        </div>
        {siteInrcyUrlNotice && <StatusMessage variant="success">{siteInrcyUrlNotice}</StatusMessage>}
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
          <ConnectionPill connected={siteInrcyGa4Connected} />
        </div>
        <div className={styles.blockSub}>{i18nT("remplissage_automatique_des_identifiants_ga4_apr_d79e4b21")}</div>

        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 13 }}>{i18nT("id_de_mesure_ex_g_xxxxxxxxxx_ab32feb7")}</span>
          <input
            value={ga4MeasurementId}
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
            value={ga4PropertyId}
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
          {siteInrcyGa4Connected ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.disconnectBtn}`}
              onClick={() => void disconnectSiteInrcyGa4()}
              disabled={siteInrcyOwnership === "none" || siteInrcyGa4Busy}
              title={siteInrcyOwnership === "none" ? "Aucun site iNrCy associé" : "Déconnecter (GA4)"}
            >
              {siteInrcyGa4Busy ? i18nT("deconnexion_f5a5666d") : i18nT("deconnecter_9c1ef392")}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.connectBtn}`}
              onClick={connectSiteInrcyGa4}
              disabled={!canConnectSiteInrcyGoogle}
              title={
                !canConfigureSite
                  ? "Aucun site iNrCy associé"
                  : !hasSiteInrcyUrl
                    ? "Renseigne le lien du site iNrCy avant de connecter Google Analytics."
                    : "Connecter Google Analytics"
              }
            >
              {i18nT("connecter_google_analytics_2a8cb23a")}{" "}</button>
          )}
        </div>
      </div>
      {siteInrcyGa4Notice && <StatusMessage variant="success">{siteInrcyGa4Notice}</StatusMessage>}
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
          <ConnectionPill connected={siteInrcyGscConnected} />
        </div>
        <div className={styles.blockSub}>{i18nT("remplissage_automatique_des_identifiants_gsc_apr_2a7727b1")}</div>

        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 13 }}>
            {i18nT("propriete_ex_2b3d54fc")}{" "}<code>sc-domain:monsite.fr</code> ou <code>https://monsite.fr/</code>)
          </span>
          <input
            value={gscProperty}
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
          {siteInrcyGscConnected ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.disconnectBtn}`}
              onClick={() => void disconnectSiteInrcyGsc()}
              disabled={siteInrcyOwnership === "none" || siteInrcyGscBusy}
              title={siteInrcyOwnership === "none" ? "Aucun site iNrCy associé" : "Déconnecter (GSC)"}
            >
              {siteInrcyGscBusy ? i18nT("deconnexion_f5a5666d") : i18nT("deconnecter_9c1ef392")}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.connectBtn}`}
              onClick={connectSiteInrcyGsc}
              disabled={!canConnectSiteInrcyGoogle}
              title={
                !canConfigureSite
                  ? "Aucun site iNrCy associé"
                  : !hasSiteInrcyUrl
                    ? "Renseigne le lien du site iNrCy avant de connecter Google Search Console."
                    : "Connecter Google Search Console"
              }
            >
              {i18nT("connecter_google_search_console_f3404063")}{" "}</button>
          )}
        </div>
      </div>
      {siteInrcyGscNotice && <StatusMessage variant="success">{siteInrcyGscNotice}</StatusMessage>}
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
          {i18nT("collez_ce_code_iframe_dans_votre_b1499310")}{" "}</div>

        <ActusWidgetControls
          layout={siteInrcyActusLayout}
          setLayout={setSiteInrcyActusLayout}
          limit={siteInrcyActusLimit}
          setLimit={setSiteInrcyActusLimit}
          design={siteInrcyActusDesign}
          setDesign={setSiteInrcyActusDesign}
          theme={siteInrcyActusTheme}
          setTheme={setSiteInrcyActusTheme}
          accent={siteInrcyActusAccent}
          setAccent={setSiteInrcyActusAccent}
        />

        <SiteActusWidgetCode
          savedUrl={siteInrcySavedUrl}
          source="inrcy_site"
          layout={siteInrcyActusLayout}
          limit={siteInrcyActusLimit}
          design={siteInrcyActusDesign}
          theme={siteInrcyActusTheme}
          accent={siteInrcyActusAccent}
          token={widgetTokenInrcySite}
          showCode={showSiteInrcyWidgetCode}
          onToggle={() => setShowSiteInrcyWidgetCode((prev: boolean) => !prev)}
          onHideCode={() => setShowSiteInrcyWidgetCode(false)}
          onGenerate={saveSiteInrcyActusWidgetSettings}
        />
      </div>

      {siteInrcySettingsError && (
        <div style={{ color: "rgba(248,113,113,0.95)", fontSize: 12 }}>{siteInrcySettingsError}</div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.resetBtn}`}
          onClick={resetSiteInrcyAll}
          disabled={siteInrcyOwnership === "none"}
          title={siteInrcyOwnership === "none" ? "Aucun site iNrCy" : "Réinitialiser (lien + GA4 + Search Console)"}
        >
          {i18nT("reinitialiser_e0e2ad54")}{" "}</button>
      </div>
    </div>
  );
}



