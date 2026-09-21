"use client";

import { useTranslations } from "next-intl";


import styles from "../dashboard.module.css";
import ConnectionPill from "./ConnectionPill";
import GoogleOAuthConsentBanner from "./GoogleOAuthConsentBanner";
import StatusMessage from "./StatusMessage";
import SiteActusWidgetCode from "./SiteActusWidgetCode";
import ActusWidgetControls from "./ActusWidgetControls";
import SaveIcon from "./SaveIcon";
import panelStyles from "./SiteSettingsPanels.module.css";

export default function SiteInrcyPanel(props: any) {
  const i18nT = useTranslations("shell");
  const {
    siteInrcyOwnership,
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
    <div className={panelStyles.panel}>
      <section className={`${panelStyles.card} ${panelStyles.cardWide}`}>
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("lien_du_site_760c2d8a")}</div>
          <ConnectionPill connected={siteInrcyOwnership !== "none" && hasSiteInrcyUrl} />
        </div>
        <div className={styles.blockSub}>
          {i18nT("le_bouton_f97378f8")}{" "}<strong>{i18nT("voir_le_site_5bf01317")}</strong> {" "}{i18nT("de_la_bulle_utilisera_ce_lien_f51f1013")}{" "}</div>

        {!!siteInrcyContactEmail && (
          <p className={panelStyles.contactMeta}>
            {i18nT("email_f2f25a21")} <strong>{siteInrcyContactEmail}</strong>
          </p>
        )}

        <div className={panelStyles.urlRow}>
          <input
            value={siteInrcyUrl}
            onChange={(e) => setSiteInrcyUrl(e.target.value)}
            disabled={siteInrcyOwnership === "none" || hasSiteInrcyUrl}
            placeholder="https://..."
            title={hasSiteInrcyUrl ? "Supprimez d'abord le lien enregistré pour en saisir un nouveau." : undefined}
            className={panelStyles.textInput}
          />

          {hasSiteInrcyUrl ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.disconnectBtn} ${panelStyles.compactAction}`}
              onClick={() => void deleteSiteInrcyUrl()}
              disabled={siteInrcyOwnership === "none" || siteInrcyUrlBusy}
              title={i18nT("supprimer_le_lien_c9d6952c")}
              aria-label={i18nT("supprimer_le_lien_c9d6952c")}
              aria-busy={siteInrcyUrlBusy}
            >
              {siteInrcyUrlBusy ? "…" : i18nT("supprimer_le_lien_c9d6952c")}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.connectBtn} ${panelStyles.compactAction} ${panelStyles.saveAction}`}
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
              {siteInrcyUrlBusy ? <span aria-hidden>…</span> : <><SaveIcon />{i18nT("enregistrer_f7c8bcd8")}</>}
            </button>
          )}

          <a
            href={draftSiteInrcyUrlMeta?.normalizedUrl || "#"}
            target="_blank"
            rel="noreferrer"
            className={`${styles.actionBtn} ${styles.viewBtn} ${panelStyles.compactAction}`}
            aria-disabled={!draftSiteInrcyUrlMeta}
            tabIndex={draftSiteInrcyUrlMeta ? 0 : -1}
            style={{ pointerEvents: draftSiteInrcyUrlMeta ? "auto" : "none", opacity: draftSiteInrcyUrlMeta ? 1 : 0.5 }}
          >
            {i18nT("voir_le_site_5bf01317")}{" "}</a>
        </div>
        {siteInrcyUrlNotice && <StatusMessage variant="success">{siteInrcyUrlNotice}</StatusMessage>}
      </section>
      <section className={panelStyles.card}>
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("google_analytics_ga4_f02551f4")}</div>
          <ConnectionPill connected={siteInrcyGa4Connected} />
        </div>
        <div className={styles.blockSub}>{i18nT("remplissage_automatique_des_identifiants_ga4_apr_d79e4b21")}</div>

        <div className={panelStyles.dataGrid}>
          <div className={panelStyles.dataItem}>
            <span>{i18nT("id_de_mesure_ex_g_xxxxxxxxxx_ab32feb7")}</span>
            <strong className={ga4MeasurementId ? undefined : panelStyles.emptyValue}>
              {ga4MeasurementId || i18nT("remplissage_automatique_apres_connexion_fc3ad543")}
            </strong>
          </div>
          <div className={panelStyles.dataItem}>
            <span>{i18nT("property_id_numerique_ex_123456789_c8dc0757")}</span>
            <strong className={ga4PropertyId ? undefined : panelStyles.emptyValue}>
              {ga4PropertyId || i18nT("remplissage_automatique_apres_connexion_fc3ad543")}
            </strong>
          </div>
        </div>

        <div className={panelStyles.googleActionRow}>
          <GoogleOAuthConsentBanner panel="site_inrcy" product="ga4" variant="inline" />
          {siteInrcyGa4Connected ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.disconnectBtn} ${panelStyles.compactAction}`}
              onClick={() => void disconnectSiteInrcyGa4()}
              disabled={siteInrcyOwnership === "none" || siteInrcyGa4Busy}
              title={siteInrcyOwnership === "none" ? "Aucun site iNrCy associé" : "Déconnecter (GA4)"}
            >
              {siteInrcyGa4Busy ? i18nT("deconnexion_f5a5666d") : i18nT("deconnecter_9c1ef392")}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.connectBtn} ${panelStyles.compactAction}`}
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
        {siteInrcyGa4Notice && <div className={panelStyles.notice}><StatusMessage variant="success">{siteInrcyGa4Notice}</StatusMessage></div>}
      </section>
      <section className={panelStyles.card}>
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("google_search_console_fe6bf60d")}</div>
          <ConnectionPill connected={siteInrcyGscConnected} />
        </div>
        <div className={styles.blockSub}>{i18nT("remplissage_automatique_des_identifiants_gsc_apr_2a7727b1")}</div>

        <div className={`${panelStyles.dataGrid} ${panelStyles.dataGridSingle}`}>
          <div className={panelStyles.dataItem}>
            <span>{i18nT("propriete_ex_2b3d54fc")}</span>
            <strong className={gscProperty ? undefined : panelStyles.emptyValue}>
              {gscProperty || i18nT("remplissage_automatique_apres_connexion_fc3ad543")}
            </strong>
          </div>
        </div>

        <div className={panelStyles.googleActionRow}>
          <GoogleOAuthConsentBanner panel="site_inrcy" product="gsc" variant="inline" />
          {siteInrcyGscConnected ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.disconnectBtn} ${panelStyles.compactAction}`}
              onClick={() => void disconnectSiteInrcyGsc()}
              disabled={siteInrcyOwnership === "none" || siteInrcyGscBusy}
              title={siteInrcyOwnership === "none" ? "Aucun site iNrCy associé" : "Déconnecter (GSC)"}
            >
              {siteInrcyGscBusy ? i18nT("deconnexion_f5a5666d") : i18nT("deconnecter_9c1ef392")}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.connectBtn} ${panelStyles.compactAction}`}
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
        {siteInrcyGscNotice && <div className={panelStyles.notice}><StatusMessage variant="success">{siteInrcyGscNotice}</StatusMessage></div>}
      </section>
      <section className={`${panelStyles.card} ${panelStyles.cardWide} ${panelStyles.widgetCard}`}>
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
      </section>

      <div className={`${panelStyles.panelFooter} ${panelStyles.cardWide}`}>
        {siteInrcySettingsError && <div className={panelStyles.error}>{siteInrcySettingsError}</div>}
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.resetBtn} ${panelStyles.compactAction}`}
          onClick={resetSiteInrcyAll}
          disabled={siteInrcyOwnership === "none"}
          title={siteInrcyOwnership === "none" ? "Aucun site iNrCy" : "Réinitialiser (lien + GA4 + Search Console)"}
        >
          {i18nT("reinitialiser_e0e2ad54")}{" "}</button>
      </div>
    </div>
  );
}
