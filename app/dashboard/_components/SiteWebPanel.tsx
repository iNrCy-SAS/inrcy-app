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

export default function SiteWebPanel(props: any) {
  const i18nT = useTranslations("shell");
  const {
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
    requestSiteWebWidgetToken,
    showSiteWebWidgetCode,
    setShowSiteWebWidgetCode,
    saveSiteWebActusWidgetSettings,
    siteWebSettingsError,
    resetSiteWebAll,
  } = props;

  return (
    <div className={panelStyles.panel}>
      <section className={`${panelStyles.card} ${panelStyles.cardWide}`}>
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("lien_du_site_760c2d8a")}</div>
          <ConnectionPill connected={hasSiteWebUrl} />
        </div>
        <div className={styles.blockSub}>
          {i18nT("le_bouton_f97378f8")}{" "}<strong>{i18nT("voir_le_site_5bf01317")}</strong> {" "}{i18nT("de_la_bulle_utilisera_ce_lien_f51f1013")}{" "}</div>

        <div className={panelStyles.urlRow}>
          <input
            value={siteWebUrl}
            onChange={(e) => setSiteWebUrl(e.target.value)}
            disabled={hasSiteWebUrl}
            placeholder="https://votre-site.fr"
            title={hasSiteWebUrl ? "Supprimez d'abord le lien enregistré pour en saisir un nouveau." : undefined}
            className={panelStyles.textInput}
          />

          {hasSiteWebUrl ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.disconnectBtn} ${panelStyles.compactAction}`}
              onClick={() => void deleteSiteWebUrl()}
              disabled={siteWebUrlBusy}
              title={i18nT("supprimer_le_lien_c9d6952c")}
              aria-label={i18nT("supprimer_le_lien_c9d6952c")}
              aria-busy={siteWebUrlBusy}
            >
              {siteWebUrlBusy ? "…" : i18nT("supprimer_le_lien_c9d6952c")}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.connectBtn} ${panelStyles.compactAction} ${panelStyles.saveAction}`}
              onClick={() => void saveSiteWebUrl()}
              disabled={siteWebUrlBusy}
              title={siteWebUrlBusy ? "Enregistrement en cours" : "Enregistrer le lien"}
              aria-label={siteWebUrlBusy ? "Enregistrement en cours" : "Enregistrer le lien"}
              aria-busy={siteWebUrlBusy}
            >
              {siteWebUrlBusy ? <span aria-hidden>…</span> : <><SaveIcon />{i18nT("enregistrer_f7c8bcd8")}</>}
            </button>
          )}

          <a
            href={draftSiteWebUrlMeta?.normalizedUrl || "#"}
            target="_blank"
            rel="noreferrer"
            className={`${styles.actionBtn} ${styles.viewBtn} ${panelStyles.compactAction}`}
            aria-disabled={!draftSiteWebUrlMeta}
            tabIndex={draftSiteWebUrlMeta ? 0 : -1}
            style={{ pointerEvents: draftSiteWebUrlMeta ? "auto" : "none", opacity: draftSiteWebUrlMeta ? 1 : 0.5 }}
          >
            {i18nT("voir_le_site_5bf01317")}{" "}</a>
        </div>
        {siteWebUrlNotice && <StatusMessage variant="success">{siteWebUrlNotice}</StatusMessage>}
      </section>
      <section className={panelStyles.card}>
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("google_analytics_ga4_f02551f4")}</div>
          <ConnectionPill connected={siteWebGa4Connected} />
        </div>
        <div className={styles.blockSub}>{i18nT("remplissage_automatique_des_identifiants_ga4_apr_d79e4b21")}</div>

        <div className={panelStyles.dataGrid}>
          <div className={panelStyles.dataItem}>
            <span>{i18nT("id_de_mesure_ex_g_xxxxxxxxxx_ab32feb7")}</span>
            <strong className={siteWebGa4MeasurementId ? undefined : panelStyles.emptyValue}>
              {siteWebGa4MeasurementId || i18nT("remplissage_automatique_apres_connexion_fc3ad543")}
            </strong>
          </div>
          <div className={panelStyles.dataItem}>
            <span>{i18nT("property_id_numerique_ex_123456789_c8dc0757")}</span>
            <strong className={siteWebGa4PropertyId ? undefined : panelStyles.emptyValue}>
              {siteWebGa4PropertyId || i18nT("remplissage_automatique_apres_connexion_fc3ad543")}
            </strong>
          </div>
        </div>

        <div className={panelStyles.googleActionRow}>
          <GoogleOAuthConsentBanner panel="site_web" product="ga4" variant="inline" />
          {siteWebGa4Connected ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.disconnectBtn} ${panelStyles.compactAction}`}
              onClick={() => void disconnectSiteWebGa4()}
              disabled={siteWebGa4Busy}
              title={i18nT("deconnecter_ga4_fcfefc0f")}
            >
              {siteWebGa4Busy ? i18nT("deconnexion_f5a5666d") : i18nT("deconnecter_9c1ef392")}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.connectBtn} ${panelStyles.compactAction}`}
              onClick={connectSiteWebGa4}
              disabled={!canConnectSiteWebGoogle}
              title={!hasSiteWebUrl ? "Renseigne le lien du site web avant de connecter Google Analytics." : "Connecter Google Analytics"}
            >
              {i18nT("connecter_google_analytics_2a8cb23a")}{" "}</button>
          )}
        </div>
        {siteWebGa4Notice && <div className={panelStyles.notice}><StatusMessage variant="success">{siteWebGa4Notice}</StatusMessage></div>}
      </section>

      <section className={panelStyles.card}>
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("google_search_console_fe6bf60d")}</div>
          <ConnectionPill connected={siteWebGscConnected} />
        </div>
        <div className={styles.blockSub}>{i18nT("remplissage_automatique_des_identifiants_gsc_apr_2a7727b1")}</div>

        <div className={`${panelStyles.dataGrid} ${panelStyles.dataGridSingle}`}>
          <div className={panelStyles.dataItem}>
            <span>{i18nT("propriete_ex_2b3d54fc")}</span>
            <strong className={siteWebGscProperty ? undefined : panelStyles.emptyValue}>
              {siteWebGscProperty || i18nT("remplissage_automatique_apres_connexion_fc3ad543")}
            </strong>
          </div>
        </div>

        <div className={panelStyles.googleActionRow}>
          <GoogleOAuthConsentBanner panel="site_web" product="gsc" variant="inline" />
          {siteWebGscConnected ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.disconnectBtn} ${panelStyles.compactAction}`}
              onClick={() => void disconnectSiteWebGsc()}
              disabled={siteWebGscBusy}
              title={i18nT("deconnecter_gsc_b1a8deae")}
            >
              {siteWebGscBusy ? i18nT("deconnexion_f5a5666d") : i18nT("deconnecter_9c1ef392")}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.connectBtn} ${panelStyles.compactAction}`}
              onClick={connectSiteWebGsc}
              disabled={!canConnectSiteWebGoogle}
              title={!hasSiteWebUrl ? "Renseigne le lien du site web avant de connecter Google Search Console." : "Connecter Google Search Console"}
            >
              {i18nT("connecter_google_search_console_f3404063")}{" "}</button>
          )}
        </div>
        {siteWebGscNotice && <div className={panelStyles.notice}><StatusMessage variant="success">{siteWebGscNotice}</StatusMessage></div>}
      </section>

      <section className={`${panelStyles.card} ${panelStyles.cardWide} ${panelStyles.widgetCard}`}>
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
          onRequestToken={requestSiteWebWidgetToken}
        />
      </section>

      <div className={`${panelStyles.panelFooter} ${panelStyles.cardWide}`}>
        {siteWebSettingsError && <div className={panelStyles.error}>{siteWebSettingsError}</div>}
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.resetBtn} ${panelStyles.compactAction}`}
          onClick={resetSiteWebAll}
          title={i18nT("reinitialiser_lien_ga4_search_console_4d090b8d")}
        >
          {i18nT("reinitialiser_e0e2ad54")}{" "}</button>
      </div>
    </div>
  );
}
