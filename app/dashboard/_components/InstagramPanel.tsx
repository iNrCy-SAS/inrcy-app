"use client";

import { useTranslations } from "next-intl";


import { useEffect, useState } from "react";
import styles from "../dashboard.module.css";
import ConnectionPill from "./ConnectionPill";
import socialStyles from "./SocialSettingsSteps.module.css";
import StatusMessage from "./StatusMessage";
import {
  DEFAULT_INSTAGRAM_PUBLICATION_PREFERENCES,
  type InstagramPublicationPlacement,
} from "@/lib/instagramPublicationPreferences";

export default function InstagramPanel(props: any) {
  const i18nT = useTranslations("shell");
  const {
    instagramConnected,
    instagramAccountConnected,
    instagramConnectionStatus,
    instagramUsername,
    connectInstagramAccount,
    connectInstagramBusinessAccount,
    disconnectInstagramAccount,
    igAccountsLoading,
    igAccountsPhase = "idle",
    loadInstagramAccounts,
    igSelectedPageId,
    setIgSelectedPageId,
    igAccounts,
    saveInstagramProfile,
    igAccountsError,
    instagramUrl,
    instagramUrlNotice,
    instagramUrlError,
    disconnectInstagramProfile,
    instagramAccountBusy,
    instagramProfileBusy,
    instagramProfileAction,
    instagramPublicationPreferences =
      DEFAULT_INSTAGRAM_PUBLICATION_PREFERENCES,
    instagramPublicationPreferencesLoading = false,
    instagramPublicationPreferencesSaving = false,
    instagramPublicationPreferencesNotice,
    instagramPublicationPreferencesError,
    updateInstagramPublicationPreferences,
    saveInstagramPublicationPreferences,
  } = props;

  const startStandard = () => {
    connectInstagramAccount();
  };

  const repairStandardAuthorization = () => {
    connectInstagramAccount({ repair: true });
  };

  const startBusiness = () => {
    connectInstagramBusinessAccount();
  };

  const disconnectAll = () => {
    void disconnectInstagramAccount();
  };

  const instagramNeedsUpdate = instagramConnectionStatus === "needs_update" && (instagramConnected || instagramAccountConnected);
  const instagramProfileDetected = igAccountsPhase === "connecting";
  const instagramProfileActivity =
    instagramProfileBusy && instagramProfileAction === "disconnect"
      ? "disconnecting"
      : instagramConnected
        ? undefined
        : instagramProfileBusy
        ? "connecting"
        : igAccountsPhase === "searching" || igAccountsLoading
          ? "searching"
          : undefined;
  const instagramProfileActivityLabel =
    instagramProfileDetected && !instagramProfileActivity
      ? i18nT("connecte_ce09957c")
      : instagramProfileActivity === "searching"
      ? "Recherche des comptes…"
      : instagramProfileActivity === "disconnecting"
        ? "Déconnexion en cours…"
        : instagramProfileActivity === "connecting"
          ? "Connexion en cours…"
          : undefined;

  const [instagramPickerUnlocked, setInstagramPickerUnlocked] = useState(!instagramConnected);
  const [instagramConnectedPageId, setInstagramConnectedPageId] = useState("");

  useEffect(() => {
    if (!instagramConnected) {
      setInstagramPickerUnlocked(true);
      setInstagramConnectedPageId("");
      return;
    }

    if (!instagramPickerUnlocked && !instagramProfileBusy && igSelectedPageId) {
      setInstagramConnectedPageId(igSelectedPageId);
    }
  }, [instagramConnected, instagramPickerUnlocked, instagramProfileBusy, igSelectedPageId]);

  const instagramPickerLocked = instagramConnected && !instagramPickerUnlocked;
  const selectedInstagramPageId = igSelectedPageId || instagramConnectedPageId;
  const canConnectInstagramProfile = Boolean(selectedInstagramPageId) && !igAccountsLoading && !instagramProfileBusy;
  const canChangeInstagramProfile = Boolean(selectedInstagramPageId) && selectedInstagramPageId !== instagramConnectedPageId && !igAccountsLoading && !instagramProfileBusy;
  const displayAccountsError = !instagramConnected && !instagramAccountConnected ? null : igAccountsError;

  const singleFieldStyle = {
    width: "auto" as const,
    flex: "1 1 260px",
    minWidth: 0,
    maxWidth: "100%",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(15,23,42,0.65)",
    colorScheme: "dark" as const,
    padding: "10px 12px",
    color: "white",
    outline: "none",
  };

  const responsiveActionsRow = {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
    width: "100%",
  } as const;

  const handleProfileConnect = async () => {
    const saved = await saveInstagramProfile();
    if (saved) setInstagramPickerUnlocked(false);
  };

  const handleProfileDisconnect = async () => {
    await disconnectInstagramProfile();
    setInstagramPickerUnlocked(true);
  };

  return (
    <div className={`${socialStyles.journey} ${socialStyles.instagram}`}>
      <section className={`${socialStyles.stepCard} ${socialStyles.instagram}`}>
        <div className={socialStyles.stepHeader}>
          <span className={socialStyles.stepNumber} aria-hidden="true">01</span>
          <div className={socialStyles.stepCopy}>
            <div className={styles.blockTitle}>{i18nT("compte_connecte_a442afe1")}</div>
            <div className={styles.blockSub}>
              {i18nT("instagram_peut_etre_connecte_en_32ac6030")}{" "}<strong>standard</strong> {" "}{i18nT("ou_en_d680c328")}{" "}<strong>{i18nT("business_via_facebook_business_eb4c034d")}</strong>{i18nT("pour_la_selection_du_profil_un_7c8dbfce")}{" "}<strong>{i18nT("business_creator_e28ea3ce")}</strong> {" "}{i18nT("relie_a_une_page_facebook_reste_5141f18f")}{" "}
            </div>
          </div>
          <div className={socialStyles.stepStatus}>
            <ConnectionPill connected={instagramAccountConnected} status={instagramNeedsUpdate ? "needs_update" : undefined} />
          </div>
        </div>
        <div className={socialStyles.stepBody}>
          <div style={{ ...responsiveActionsRow, justifyItems: "stretch" }}>
            <input
              value={instagramUsername}
              readOnly
              placeholder={instagramAccountConnected ? i18nT("compte_connecte_a442afe1") : i18nT("account_not_connected")}
              style={{
                ...singleFieldStyle,
                opacity: instagramAccountConnected ? 1 : 0.8,
              }}
            />
            {instagramAccountConnected ? (
              <>
                {instagramNeedsUpdate ? (
                  <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={repairStandardAuthorization} disabled={instagramAccountBusy}>
                    {i18nT("actualiser_9d3b2a7d")}{" "}</button>
                ) : null}
                <button type="button" className={`${styles.actionBtn} ${styles.disconnectBtn}`} onClick={disconnectAll} disabled={instagramAccountBusy}>
                  {instagramAccountBusy ? i18nT("deconnexion_f5a5666d") : i18nT("deconnexion_903dca17")}
                </button>
              </>
            ) : (
              <>
                <button type="button" className={`${styles.actionBtn} ${styles.secondaryBtn}`} onClick={startStandard}>
                  {i18nT("connexion_standard_7718db4b")}{" "}</button>
                <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={startBusiness}>
                  {i18nT("connexion_business_fbb4bbc5")}{" "}</button>
              </>
            )}
          </div>
        </div>
      </section>

      {instagramAccountConnected ? (
        <section className={`${socialStyles.stepCard} ${socialStyles.instagram}`}>
          <div className={socialStyles.stepHeader}>
            <span className={socialStyles.stepNumber} aria-hidden="true">02</span>
            <div className={socialStyles.stepCopy}>
              <div className={styles.blockTitle}>{i18nT("compte_instagram_a_connecter_fe4d850a")}</div>
              <div className={styles.blockSub}>{i18nT("on_liste_les_pages_facebook_qui_bf01d3e9")}</div>
            </div>
            <div className={socialStyles.stepStatus}>
              <ConnectionPill
                connected={instagramConnected || instagramProfileDetected}
                status={instagramNeedsUpdate ? "needs_update" : undefined}
                activity={instagramProfileActivity}
                label={instagramProfileActivityLabel}
              />
            </div>
          </div>
          <div className={socialStyles.stepBody}>
            <div style={responsiveActionsRow}>
            <select
              value={selectedInstagramPageId}
              onChange={(e) => setIgSelectedPageId(e.target.value)}
              disabled={igAccountsLoading || instagramProfileBusy || instagramPickerLocked}
              style={{
                ...singleFieldStyle,
                opacity: instagramPickerLocked ? 0.88 : 1,
                cursor: instagramPickerLocked ? "not-allowed" : "pointer",
              }}
            >
              <option value="">{i18nT("selectionner_un_compte_9009d2c1")}</option>
              {igAccounts.map((a: { page_id: string; username?: string | null; page_name?: string | null }) => (
                <option key={a.page_id} value={a.page_id}>
                  @{a.username || "instagram"} — {a.page_name || a.page_id}
                </option>
              ))}
            </select>

            <button
              type="button"
              className={`${styles.actionBtn} ${styles.secondaryBtn} ${!instagramConnected && igAccountsPhase === "connecting" ? styles.connectingActionBtn : !instagramConnected && (igAccountsPhase === "searching" || igAccountsLoading) ? styles.searchingActionBtn : ""}`}
              onClick={() => {
                setInstagramPickerUnlocked(true);
                loadInstagramAccounts();
              }}
              disabled={igAccountsLoading || instagramProfileBusy}
            >
              {i18nT("charger_mes_comptes_feac3a8e")}{" "}</button>

            {instagramConnected ? (
              <>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.connectBtn} ${!instagramConnected && instagramProfileBusy && instagramProfileAction === "connect" ? styles.connectingActionBtn : ""}`}
                  onClick={() => void handleProfileConnect()}
                  disabled={!canChangeInstagramProfile}
                >
                  {i18nT("changer_de_compte_6a10073f")}{" "}</button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.disconnectBtn} ${instagramProfileBusy && instagramProfileAction === "disconnect" ? styles.connectingActionBtn : ""}`}
                  onClick={() => void handleProfileDisconnect()}
                  disabled={igAccountsLoading || instagramProfileBusy}
                >
                  {i18nT("deconnecter_le_compte_d78850d1")}{" "}</button>
              </>
            ) : (
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.connectBtn} ${!instagramConnected && instagramProfileBusy && instagramProfileAction === "connect" ? styles.connectingActionBtn : ""}`}
                onClick={() => void handleProfileConnect()}
                disabled={!canConnectInstagramProfile}
              >
                {i18nT("connecter_le_compte_a88dc864")}{" "}</button>
            )}
            </div>

            {displayAccountsError ? (
              <div style={{ display: "grid", gap: 8 }}>
                <StatusMessage variant="error">{displayAccountsError}</StatusMessage>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.secondaryBtn}`}
                  onClick={repairStandardAuthorization}
                  disabled={igAccountsLoading || instagramProfileBusy}
                >
                  {i18nT("actualiser_les_autorisations_meta_85e7f589")}{" "}</button>
              </div>
            ) : null}
            {instagramConnected || instagramUrl ? (
              <div style={responsiveActionsRow}>
                <input
                  value={instagramUrl}
                  readOnly
                  aria-label={i18nT("lien_du_compte_890d040b")}
                  placeholder="Lien récupéré automatiquement"
                  style={{
                    ...singleFieldStyle,
                    opacity: instagramUrl ? 1 : 0.8,
                  }}
                />
                <a
                  href={instagramUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className={`${styles.actionBtn} ${styles.viewBtn}`}
                  style={{ pointerEvents: instagramUrl ? "auto" : "none", opacity: instagramUrl ? 1 : 0.5 }}
                >
                  {i18nT("voir_le_compte_1cbd7501")}{" "}
                </a>
              </div>
            ) : null}
            {instagramUrlNotice && <StatusMessage variant="success">{instagramUrlNotice}</StatusMessage>}
            {instagramUrlError && <StatusMessage variant="error">{instagramUrlError}</StatusMessage>}
          </div>
        </section>
      ) : null}

      <section className={`${socialStyles.stepCard} ${socialStyles.instagram}`}>
        <div className={socialStyles.stepHeader}>
          <span className={socialStyles.stepNumber} aria-hidden="true">03</span>
          <div className={socialStyles.stepCopy}>
            <div className={styles.blockTitle}>
              {i18nT("instagram_publication_modes_title")}
            </div>
            <div className={styles.blockSub}>
              {i18nT("instagram_publication_modes_help")}
            </div>
          </div>
        </div>
        <div className={socialStyles.stepBody}>
        <div className={socialStyles.choiceGrid}>
          <label className={socialStyles.choiceCard}>
            <span className={socialStyles.choiceCopy}>
              <strong>{i18nT("instagram_classic_mode")}</strong>
              <span>{i18nT("instagram_classic_mode_help")}</span>
            </span>
            <input className={socialStyles.choiceInput} type="checkbox" checked disabled />
            <span className={socialStyles.choiceIndicator} aria-hidden="true">✓</span>
          </label>

          <label className={socialStyles.choiceCard}>
            <span className={socialStyles.choiceCopy}>
              <strong>{i18nT("instagram_reels_mode")}</strong>
              <span>{i18nT("instagram_reels_mode_help")}</span>
            </span>
            <input
              className={socialStyles.choiceInput}
              type="checkbox"
              checked={instagramPublicationPreferences.reelsEnabled}
              disabled={
                instagramPublicationPreferencesLoading ||
                instagramPublicationPreferencesSaving
              }
              onChange={(event) =>
                updateInstagramPublicationPreferences?.({
                  reelsEnabled: event.target.checked,
                  ...(instagramPublicationPreferences.defaultMode === "reel" &&
                  !event.target.checked
                    ? { defaultMode: "classic" }
                    : {}),
                })
              }
            />
            <span className={socialStyles.choiceIndicator} aria-hidden="true">✓</span>
          </label>

          <label className={socialStyles.choiceCard}>
            <span className={socialStyles.choiceCopy}>
              <strong>{i18nT("instagram_stories_mode")}</strong>
              <span>{i18nT("instagram_stories_mode_help")}</span>
            </span>
            <input
              className={socialStyles.choiceInput}
              type="checkbox"
              checked={instagramPublicationPreferences.storiesEnabled}
              disabled={
                instagramPublicationPreferencesLoading ||
                instagramPublicationPreferencesSaving
              }
              onChange={(event) =>
                updateInstagramPublicationPreferences?.({
                  storiesEnabled: event.target.checked,
                  ...(instagramPublicationPreferences.defaultMode === "story" &&
                  !event.target.checked
                    ? { defaultMode: "classic" }
                    : {}),
                })
              }
            />
            <span className={socialStyles.choiceIndicator} aria-hidden="true">✓</span>
          </label>
        </div>

        <div style={responsiveActionsRow}>
          <label style={{ display: "grid", gap: 6, minWidth: 0 }}>
            <strong style={{ fontSize: 13 }}>
              {i18nT("instagram_default_publication_mode")}
            </strong>
            <select
              value={instagramPublicationPreferences.defaultMode}
              disabled={
                instagramPublicationPreferencesLoading ||
                instagramPublicationPreferencesSaving
              }
              onChange={(event) =>
                updateInstagramPublicationPreferences?.({
                  defaultMode: event.target
                    .value as InstagramPublicationPlacement,
                })
              }
              style={{ ...singleFieldStyle, cursor: "pointer" }}
            >
              <option value="classic">
                {i18nT("instagram_classic_mode")}
              </option>
              {instagramPublicationPreferences.reelsEnabled ? (
                <option value="reel">
                  {i18nT("instagram_reels_mode")}
                </option>
              ) : null}
              {instagramPublicationPreferences.storiesEnabled ? (
                <option value="story">
                  {i18nT("instagram_stories_mode")}
                </option>
              ) : null}
            </select>
          </label>

          <button
            type="button"
            className={`${styles.actionBtn} ${styles.connectBtn}`}
            disabled={
              instagramPublicationPreferencesLoading ||
              instagramPublicationPreferencesSaving
            }
            onClick={() => void saveInstagramPublicationPreferences?.()}
            style={{ alignSelf: "end" }}
          >
            {instagramPublicationPreferencesSaving
              ? i18nT("instagram_publication_modes_saving")
              : i18nT("instagram_publication_modes_save")}
          </button>
        </div>

        {instagramPublicationPreferencesNotice ? (
          <StatusMessage variant="success">
            {instagramPublicationPreferencesNotice}
          </StatusMessage>
        ) : null}
        {instagramPublicationPreferencesError ? (
          <StatusMessage variant="error">
            {instagramPublicationPreferencesError}
          </StatusMessage>
        ) : null}
        </div>
      </section>
    </div>
  );
}
