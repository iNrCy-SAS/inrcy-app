"use client";

import { useTranslations } from "next-intl";


import { useEffect, useState } from "react";
import styles from "../dashboard.module.css";
import ConnectionPill from "./ConnectionPill";
import StatusMessage from "./StatusMessage";

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
  const instagramStatusLabel = instagramNeedsUpdate ? "À actualiser" : instagramConnected ? "Connecté" : instagramAccountConnected ? "Compte connecté" : "À connecter";
  const instagramStatusDot = instagramNeedsUpdate
    ? "rgba(245,158,11,0.95)"
    : instagramConnected
      ? "rgba(34,197,94,0.95)"
      : instagramAccountConnected
        ? "rgba(59,130,246,0.95)"
        : "rgba(148,163,184,0.9)";
  const instagramProfileActivity =
    instagramProfileBusy && instagramProfileAction === "disconnect"
      ? "disconnecting"
      : instagramProfileBusy || igAccountsPhase === "connecting"
        ? "connecting"
        : igAccountsPhase === "searching" || igAccountsLoading
          ? "searching"
          : undefined;
  const instagramProfileActivityLabel =
    instagramProfileActivity === "searching"
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
    width: "100%" as const,
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
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
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
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
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
              background: instagramStatusDot,
            }}
          />
          {i18nT("statut_b20e7fc2")}{" "}<strong>{instagramStatusLabel}</strong>
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
          <div className={styles.blockTitle}>{i18nT("compte_connecte_a442afe1")}</div>
          <ConnectionPill connected={instagramAccountConnected} status={instagramNeedsUpdate ? "needs_update" : undefined} />
        </div>
        <div className={styles.blockSub}>
          {i18nT("instagram_peut_etre_connecte_en_32ac6030")}{" "}<strong>standard</strong> {" "}{i18nT("ou_en_d680c328")}{" "}<strong>{i18nT("business_via_facebook_business_eb4c034d")}</strong>{i18nT("pour_la_selection_du_profil_un_7c8dbfce")}{" "}<strong>{i18nT("business_creator_e28ea3ce")}</strong> {" "}{i18nT("relie_a_une_page_facebook_reste_5141f18f")}{" "}</div>

        <div style={{ width: "100%", minWidth: 0 }}>
          <input
            value={instagramUsername}
            readOnly
            placeholder={instagramAccountConnected ? "Compte connecté" : "Aucun compte connecté"}
            style={{
              ...singleFieldStyle,
              opacity: instagramAccountConnected ? 1 : 0.8,
            }}
          />
        </div>

        <div style={{ ...responsiveActionsRow, justifyItems: "stretch" }}>
          {instagramAccountConnected ? (
            <>
              {instagramNeedsUpdate ? (
                <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={repairStandardAuthorization} disabled={instagramAccountBusy} style={{ width: "100%" }}>
                  {i18nT("actualiser_9d3b2a7d")}{" "}</button>
              ) : null}
              <button type="button" className={`${styles.actionBtn} ${styles.disconnectBtn}`} onClick={disconnectAll} disabled={instagramAccountBusy} style={{ width: "100%" }}>
                {instagramAccountBusy ? i18nT("deconnexion_f5a5666d") : i18nT("deconnexion_903dca17")}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={`${styles.actionBtn} ${styles.secondaryBtn}`} onClick={startStandard} style={{ width: "100%" }}>
                {i18nT("connexion_standard_7718db4b")}{" "}</button>
              <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={startBusiness} style={{ width: "100%" }}>
                {i18nT("connexion_business_fbb4bbc5")}{" "}</button>
            </>
          )}
        </div>
      </div>

      {instagramAccountConnected ? (
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
            <div className={styles.blockTitle}>{i18nT("compte_instagram_a_connecter_fe4d850a")}</div>
            <ConnectionPill
              connected={instagramConnected}
              status={instagramNeedsUpdate ? "needs_update" : undefined}
              activity={instagramProfileActivity}
              label={instagramProfileActivityLabel}
            />
          </div>
          <div className={styles.blockSub}>{i18nT("on_liste_les_pages_facebook_qui_bf01d3e9")}</div>

          <div style={responsiveActionsRow}>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.secondaryBtn} ${igAccountsPhase === "connecting" ? styles.connectingActionBtn : igAccountsPhase === "searching" || igAccountsLoading ? styles.searchingActionBtn : ""}`}
              onClick={() => {
                setInstagramPickerUnlocked(true);
                loadInstagramAccounts();
              }}
              disabled={igAccountsLoading || instagramProfileBusy}
              style={{ width: "100%" }}
            >
              {i18nT("charger_mes_comptes_feac3a8e")}{" "}</button>

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

            {instagramConnected ? (
              <>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.connectBtn} ${instagramProfileBusy && instagramProfileAction === "connect" ? styles.connectingActionBtn : ""}`}
                  onClick={() => void handleProfileConnect()}
                  disabled={!canChangeInstagramProfile}
                  style={{ width: "100%" }}
                >
                  {i18nT("changer_de_compte_6a10073f")}{" "}</button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.disconnectBtn} ${instagramProfileBusy && instagramProfileAction === "disconnect" ? styles.connectingActionBtn : ""}`}
                  onClick={() => void handleProfileDisconnect()}
                  disabled={igAccountsLoading || instagramProfileBusy}
                  style={{ width: "100%" }}
                >
                  {i18nT("deconnecter_le_compte_d78850d1")}{" "}</button>
              </>
            ) : (
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.connectBtn} ${instagramProfileBusy && instagramProfileAction === "connect" ? styles.connectingActionBtn : ""}`}
                onClick={() => void handleProfileConnect()}
                disabled={!canConnectInstagramProfile}
                style={{ width: "100%" }}
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
                style={{ width: "100%" }}
              >
                {i18nT("actualiser_les_autorisations_meta_85e7f589")}{" "}</button>
            </div>
          ) : null}
        </div>
      ) : null}

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
          <div className={styles.blockTitle}>{i18nT("lien_du_compte_890d040b")}</div>
          <ConnectionPill connected={instagramConnected && !!instagramUrl?.trim()} />
        </div>
        <div className={styles.blockSub}>{i18nT("se_remplit_automatiquement_apres_selection_2e5c819f")}</div>

        <div style={responsiveActionsRow}>
          <input
            value={instagramUrl}
            readOnly
            placeholder={instagramConnected ? "Lien récupéré automatiquement" : "Sélectionne un compte pour générer le lien"}
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
            style={{ pointerEvents: instagramUrl ? "auto" : "none", opacity: instagramUrl ? 1 : 0.5, width: "100%" }}
          >
            {i18nT("voir_le_compte_1cbd7501")}{" "}</a>
        </div>

        {instagramUrlNotice && <StatusMessage variant="success">{instagramUrlNotice}</StatusMessage>}
        {instagramUrlError && <StatusMessage variant="error">{instagramUrlError}</StatusMessage>}
      </div>
    </div>
  );
}
