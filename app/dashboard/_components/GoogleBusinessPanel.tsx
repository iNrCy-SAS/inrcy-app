"use client";

import { useTranslations } from "next-intl";


import { useEffect, useMemo, useState } from "react";
import styles from "../dashboard.module.css";
import stepStyles from "./ChannelPanelSteps.module.css";
import ConnectionPill from "./ConnectionPill";
import GoogleOAuthConsentBanner from "./GoogleOAuthConsentBanner";
import StatusMessage from "./StatusMessage";

export default function GoogleBusinessPanel(props: any) {
  const i18nT = useTranslations("shell");
  const {
    gmbConnected,
    gmbAccountConnected,
    gmbConnectionStatus,
    gmbAccountEmail,
    connectGmbAccount,
    disconnectGmbAccount,
    gmbConfigured,
    gmbAccountName,
    gmbAccounts,
    gmbLoadingList,
    gmbLocationsPhase = "idle",
    loadGmbAccountsAndLocations,
    gmbLocationName,
    gmbLocationLabel,
    setGmbLocationName,
    gmbLocations,
    saveGmbLocation,
    gmbListError,
    gmbUrl,
    gmbUrlNotice,
    gmbUrlError,
    disconnectGmbBusiness,
    gmbAccountBusy,
    gmbLocationBusy,
    gmbLocationAction,
  } = props;

  const gmbNeedsUpdate = gmbConnectionStatus === "needs_update" && (gmbConnected || gmbAccountConnected);
  const gmbLocationDetected = gmbLocationsPhase === "connecting";
  const gmbLocationActivity =
    gmbLocationBusy && gmbLocationAction === "disconnect"
      ? "disconnecting"
      : gmbLocationBusy
        ? "connecting"
        : gmbLocationsPhase === "searching" || gmbLoadingList
          ? "searching"
          : undefined;
  const gmbLocationActivityLabel =
    gmbLocationDetected && !gmbLocationActivity
      ? i18nT("connecte_ce09957c")
      : gmbLocationActivity === "searching"
      ? "Recherche des établissements…"
      : gmbLocationActivity === "disconnecting"
        ? "Déconnexion en cours…"
        : gmbLocationActivity === "connecting"
          ? "Connexion en cours…"
          : undefined;

  const [gmbPickerUnlocked, setGmbPickerUnlocked] = useState(!gmbConfigured);
  const [gmbConnectedLocationName, setGmbConnectedLocationName] = useState("");
  const [gmbConnectedLocationLabel, setGmbConnectedLocationLabel] = useState("");

  useEffect(() => {
    if (!gmbConfigured) {
      setGmbPickerUnlocked(true);
      setGmbConnectedLocationName("");
      setGmbConnectedLocationLabel("");
      return;
    }

    if (!gmbPickerUnlocked && !gmbLocationBusy && gmbLocationName) {
      setGmbConnectedLocationName(gmbLocationName);
      setGmbConnectedLocationLabel((gmbLocationLabel || "").trim());
    }
  }, [gmbConfigured, gmbPickerUnlocked, gmbLocationBusy, gmbLocationName, gmbLocationLabel]);

  const gmbPickerLocked = gmbConfigured && !gmbPickerUnlocked;
  const selectedLocationName = gmbLocationName || gmbConnectedLocationName;

  const hasSelectedLocationInList = Boolean(
    selectedLocationName && gmbLocations.some((l: { name: string; title?: string | null }) => l.name === selectedLocationName)
  );

  const selectedLocationLabel = useMemo(() => {
    const picked = gmbLocations.find((l: { name: string; title?: string | null }) => l.name === selectedLocationName);
    return String(picked?.title || gmbConnectedLocationLabel || gmbLocationLabel || gmbUrl || selectedLocationName || "").trim();
  }, [gmbLocations, selectedLocationName, gmbConnectedLocationLabel, gmbLocationLabel, gmbUrl]);

  const canConnectLocation = Boolean(selectedLocationName) && !gmbLoadingList && !gmbLocationBusy;
  const canChangeLocation = Boolean(selectedLocationName) && selectedLocationName !== gmbConnectedLocationName && !gmbLoadingList && !gmbLocationBusy;

  const handleLocationConnect = async () => {
    const saved = await saveGmbLocation();
    if (saved) setGmbPickerUnlocked(false);
  };

  const handleLocationDisconnect = async () => {
    await disconnectGmbBusiness();
    setGmbPickerUnlocked(true);
  };

  return (
    <div className={`${stepStyles.panel} ${stepStyles.googlePanel}`}>
      <section className={stepStyles.stepCard} aria-labelledby="gmb-step-account">
        <div className={stepStyles.stepHeader}>
          <span className={stepStyles.stepNumber} aria-hidden>01</span>
          <div className={stepStyles.stepCopy}>
            <h3 id="gmb-step-account" className={stepStyles.stepTitle}>{i18nT("compte_connecte_a442afe1")}</h3>
            <p className={stepStyles.stepDescription}>{i18nT("ce_compte_google_sert_a_acceder_80ee3ae0")}</p>
          </div>
          <div className={stepStyles.stepStatus}>
            <ConnectionPill connected={gmbAccountConnected} status={gmbNeedsUpdate ? "needs_update" : undefined} />
          </div>
        </div>
        <div className={stepStyles.stepBody}>
          <div className={stepStyles.actionRow}>
            <input
              className={`${styles.channelConfigField} ${stepStyles.control} ${stepStyles.wideControl}`}
              value={gmbAccountEmail || (gmbAccountConnected ? i18nT("compte_connecte_a442afe1") : "")}
              readOnly
              placeholder={gmbAccountConnected ? i18nT("compte_connecte_a442afe1") : i18nT("account_not_connected")}
              style={{ opacity: gmbAccountConnected ? 1 : 0.8 }}
            />

            <GoogleOAuthConsentBanner panel="gmb" variant="inline" />

            {gmbAccountConnected ? (
              <>
                {gmbNeedsUpdate ? (
                  <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={connectGmbAccount} disabled={gmbAccountBusy}>
                    {i18nT("actualiser_9d3b2a7d")}{" "}</button>
                ) : null}
                <button type="button" className={`${styles.actionBtn} ${styles.disconnectBtn}`} onClick={() => void disconnectGmbAccount()} disabled={gmbAccountBusy}>
                  {gmbAccountBusy ? i18nT("deconnexion_f5a5666d") : i18nT("deconnexion_903dca17")}
                </button>
              </>
            ) : (
              <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={connectGmbAccount}>
                {i18nT("connecter_google_cfcf4fe1")}{" "}</button>
            )}
          </div>
        </div>
      </section>

      <section className={`${stepStyles.stepCard} ${stepStyles.stepSecondary}`} aria-labelledby="gmb-step-location">
        <div className={stepStyles.stepHeader}>
          <span className={stepStyles.stepNumber} aria-hidden>02</span>
          <div className={stepStyles.stepCopy}>
            <h3 id="gmb-step-location" className={stepStyles.stepTitle}>{i18nT("etablissement_a_connecter_264ce135")}</h3>
            <p className={stepStyles.stepDescription}>{i18nT("choisissez_la_fiche_google_business_a_ea2602ec")}</p>
          </div>
          <div className={stepStyles.stepStatus}>
            <ConnectionPill
              connected={gmbConfigured || gmbLocationDetected}
              status={gmbNeedsUpdate ? "needs_update" : undefined}
              activity={gmbLocationActivity}
              label={gmbLocationActivityLabel}
            />
          </div>
        </div>
        <div className={stepStyles.stepBody}>
          {gmbAccountConnected ? (
            <>
            <div className={stepStyles.actionRow}>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.secondaryBtn} ${gmbLocationsPhase === "connecting" ? styles.connectingActionBtn : gmbLocationsPhase === "searching" || gmbLoadingList ? styles.searchingActionBtn : ""}`}
                onClick={() => {
                  setGmbPickerUnlocked(true);
                  loadGmbAccountsAndLocations();
                }}
                disabled={gmbLoadingList || gmbLocationBusy}
              >
                {i18nT("charger_mes_etablissements_b636d3f7")}{" "}</button>

              <select
                className={`${styles.channelConfigField} ${styles.selectReadable} ${stepStyles.control} ${stepStyles.wideControl}`}
                value={selectedLocationName}
                onChange={(e) => setGmbLocationName(e.target.value)}
                disabled={gmbLoadingList || gmbLocationBusy || gmbPickerLocked}
                style={{
                  opacity: gmbPickerLocked ? 0.88 : 1,
                  cursor: gmbPickerLocked ? "not-allowed" : "pointer",
                }}
              >
                <option value="">{i18nT("selectionner_un_etablissement_432be24b")}</option>
                {!hasSelectedLocationInList && selectedLocationName ? <option value={selectedLocationName}>{selectedLocationLabel}</option> : null}
                {gmbLocations.map((l: { name: string; title?: string | null }) => (
                  <option key={l.name} value={l.name}>
                    {l.title || l.name}
                  </option>
                ))}
              </select>

              {gmbConfigured ? (
                <>
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.connectBtn} ${gmbLocationBusy && gmbLocationAction === "connect" ? styles.connectingActionBtn : ""}`}
                    onClick={() => void handleLocationConnect()}
                    disabled={!canChangeLocation}
                  >
                    {i18nT("changer_d_etablissement_5dc8231c")}{" "}</button>
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.disconnectBtn} ${gmbLocationBusy && gmbLocationAction === "disconnect" ? styles.connectingActionBtn : ""}`}
                    onClick={() => void handleLocationDisconnect()}
                    disabled={gmbLoadingList || gmbLocationBusy}
                  >
                    {i18nT("deconnecter_l_etablissement_074a7268")}{" "}</button>
                </>
              ) : (
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.connectBtn} ${gmbLocationBusy && gmbLocationAction === "connect" ? styles.connectingActionBtn : ""}`}
                  onClick={() => void handleLocationConnect()}
                  disabled={!canConnectLocation}
                >
                  {i18nT("connecter_l_etablissement_197a12c9")}{" "}</button>
              )}
            </div>

            {gmbAccounts?.length > 1 ? (
              <div className={stepStyles.hint}>
                {i18nT("plusieurs_comptes_detectes_inrcy_utilise_actuell_fb1bcb5e")}{" "}<strong>{gmbAccountName || i18nT("non_defini_ca1771d6")}</strong>.
              </div>
            ) : null}

            {gmbListError && <StatusMessage variant="error">{gmbListError}</StatusMessage>}
            </>
          ) : null}

          <div className={stepStyles.subsection}>
            <div className={stepStyles.subsectionHeader}>
              <h4 className={stepStyles.subsectionTitle}>{i18nT("lien_de_la_page_1f9f4b87")}</h4>
            </div>
            <div className={stepStyles.actionRow}>
              <input
                className={`${styles.channelConfigField} ${stepStyles.control} ${stepStyles.wideControl}`}
                value={gmbUrl}
                readOnly
                placeholder={gmbConfigured ? "Lien récupéré automatiquement" : "Sélectionne un établissement pour générer le lien"}
                style={{ opacity: gmbUrl ? 1 : 0.8 }}
              />

              <a
                href={gmbUrl || "#"}
                target="_blank"
                rel="noreferrer"
                className={`${styles.actionBtn} ${styles.viewBtn}`}
                style={{ pointerEvents: gmbUrl ? "auto" : "none", opacity: gmbUrl ? 1 : 0.5 }}
              >
                {i18nT("voir_la_page_82561348")}{" "}</a>
            </div>

            {gmbUrlNotice && <StatusMessage variant="success">{gmbUrlNotice}</StatusMessage>}
            {gmbUrlError && <StatusMessage variant="error">{gmbUrlError}</StatusMessage>}
          </div>
        </div>
      </section>
    </div>
  );
}
