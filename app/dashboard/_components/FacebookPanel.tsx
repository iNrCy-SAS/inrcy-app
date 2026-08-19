"use client";

import { useTranslations } from "next-intl";


import { useEffect, useState } from "react";
import styles from "../dashboard.module.css";
import ConnectionPill from "./ConnectionPill";
import StatusMessage from "./StatusMessage";

export default function FacebookPanel(props: any) {
  const i18nT = useTranslations("shell");
  const {
    facebookPageConnected,
    facebookAccountConnected,
    facebookConnectionStatus,
    facebookAccountEmail,
    connectFacebookAccount,
    connectFacebookBusinessAccount,
    disconnectFacebookAccount,
    fbPagesLoading,
    fbPagesPhase = "idle",
    loadFacebookPages,
    fbSelectedPageId,
    fbSelectedPageName,
    setFbSelectedPageId,
    fbPages,
    saveFacebookPage,
    fbPagesError,
    facebookUrl,
    facebookUrlNotice,
    facebookUrlError,
    disconnectFacebookPage,
    facebookAccountBusy,
    facebookPageBusy,
    facebookPageAction,
  } = props;

  const facebookNeedsUpdate = facebookConnectionStatus === "needs_update" && (facebookPageConnected || facebookAccountConnected);
  const facebookStatusLabel = facebookNeedsUpdate ? "À actualiser" : facebookPageConnected ? "Connecté" : facebookAccountConnected ? "Compte connecté" : "À connecter";
  const facebookStatusDot = facebookNeedsUpdate
    ? "rgba(245,158,11,0.95)"
    : facebookPageConnected
      ? "rgba(34,197,94,0.95)"
      : facebookAccountConnected
        ? "rgba(59,130,246,0.95)"
        : "rgba(148,163,184,0.9)";
  const facebookPageActivity =
    facebookPageBusy && facebookPageAction === "disconnect"
      ? "disconnecting"
      : facebookPageBusy || fbPagesPhase === "connecting"
        ? "connecting"
        : fbPagesPhase === "searching" || fbPagesLoading
          ? "searching"
          : undefined;
  const facebookPageActivityLabel =
    facebookPageActivity === "searching"
      ? "Recherche des pages…"
      : facebookPageActivity === "disconnecting"
        ? "Déconnexion en cours…"
        : facebookPageActivity === "connecting"
          ? "Connexion en cours…"
          : undefined;

  const [facebookPagePickerUnlocked, setFacebookPagePickerUnlocked] = useState(!facebookPageConnected);
  const [facebookConnectedPageId, setFacebookConnectedPageId] = useState("");
  const [facebookConnectedPageLabel, setFacebookConnectedPageLabel] = useState("");

  useEffect(() => {
    if (!facebookPageConnected) {
      setFacebookPagePickerUnlocked(true);
      setFacebookConnectedPageId("");
      setFacebookConnectedPageLabel("");
      return;
    }

    if (!facebookPagePickerUnlocked && !facebookPageBusy && fbSelectedPageId) {
      setFacebookConnectedPageId(fbSelectedPageId);
      setFacebookConnectedPageLabel((fbSelectedPageName || "").trim());
    }
  }, [facebookPageConnected, facebookPagePickerUnlocked, facebookPageBusy, fbSelectedPageId, fbSelectedPageName]);

  const facebookPagePickerLocked = facebookPageConnected && !facebookPagePickerUnlocked;
  const selectedPageValue = fbSelectedPageId || facebookConnectedPageId;
  const hasSelectedPageInList = Boolean(
    selectedPageValue && fbPages.some((p: { id: string; name?: string | null }) => p.id === selectedPageValue)
  );
  const selectedPageLabel = (fbSelectedPageName || facebookConnectedPageLabel || facebookUrl || selectedPageValue || "").trim();
  const canConnectFacebookPage = Boolean(selectedPageValue) && !fbPagesLoading && !facebookPageBusy;
  const canChangeFacebookPage = Boolean(selectedPageValue) && selectedPageValue !== facebookConnectedPageId && !fbPagesLoading && !facebookPageBusy;

  const startStandard = () => {
    connectFacebookAccount();
  };

  const startBusiness = () => {
    connectFacebookBusinessAccount();
  };

  const disconnectAll = () => {
    void disconnectFacebookAccount();
  };

  const handlePageConnect = async () => {
    const saved = await saveFacebookPage();
    if (saved) setFacebookPagePickerUnlocked(false);
  };

  const handlePageDisconnect = async () => {
    await disconnectFacebookPage();
    setFacebookPagePickerUnlocked(true);
  };

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
              background: facebookStatusDot,
            }}
          />
          {i18nT("statut_b20e7fc2")}{" "}<strong>{facebookStatusLabel}</strong>
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
          <ConnectionPill connected={facebookAccountConnected} status={facebookNeedsUpdate ? "needs_update" : undefined} />
        </div>
        <div className={styles.blockSub}>{i18nT("ce_compte_facebook_peut_cumuler_un_32c21e9e")}</div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={facebookAccountEmail}
            readOnly
            placeholder={facebookAccountConnected ? i18nT("compte_connecte_a442afe1") : i18nT("account_not_connected")}
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
              opacity: facebookAccountConnected ? 1 : 0.8,
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {facebookAccountConnected ? (
            <>
              {facebookNeedsUpdate ? (
                <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={startStandard} disabled={facebookAccountBusy}>
                  {i18nT("actualiser_9d3b2a7d")}{" "}</button>
              ) : null}
              <button type="button" className={`${styles.actionBtn} ${styles.disconnectBtn}`} onClick={disconnectAll} disabled={facebookAccountBusy}>
                {facebookAccountBusy ? i18nT("deconnexion_f5a5666d") : i18nT("deconnexion_903dca17")}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={startStandard}>
                {i18nT("connexion_standard_7718db4b")}{" "}</button>
              <button type="button" className={`${styles.actionBtn} ${styles.secondaryBtn}`} onClick={startBusiness}>
                {i18nT("connexion_business_fbb4bbc5")}{" "}</button>
            </>
          )}
        </div>
      </div>

      {facebookAccountConnected ? (
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
            <div className={styles.blockTitle}>{i18nT("page_a_connecter_88e541ee")}</div>
            <ConnectionPill
              connected={facebookPageConnected}
              status={facebookNeedsUpdate ? "needs_update" : undefined}
              activity={facebookPageActivity}
              label={facebookPageActivityLabel}
            />
          </div>
          <div className={styles.blockSub}>{i18nT("choisissez_la_page_facebook_a_analyser_218e2577")}</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.secondaryBtn} ${fbPagesPhase === "connecting" ? styles.connectingActionBtn : fbPagesPhase === "searching" || fbPagesLoading ? styles.searchingActionBtn : ""}`}
              onClick={() => {
                setFacebookPagePickerUnlocked(true);
                loadFacebookPages();
              }}
              disabled={fbPagesLoading || facebookPageBusy}
            >
              {i18nT("charger_mes_pages_df0e9c75")}{" "}</button>

            <select
              value={selectedPageValue}
              onChange={(e) => setFbSelectedPageId(e.target.value)}
              disabled={fbPagesLoading || facebookPageBusy || facebookPagePickerLocked}
              style={{
                flex: "1 1 260px",
                minWidth: 0,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(15,23,42,0.65)",
                colorScheme: "dark",
                padding: "10px 12px",
                color: "white",
                outline: "none",
                opacity: facebookPagePickerLocked ? 0.88 : 1,
                cursor: facebookPagePickerLocked ? "not-allowed" : "pointer",
              }}
            >
              <option value="">{i18nT("selectionner_une_page_36d5f135")}</option>
              {!hasSelectedPageInList && selectedPageValue ? <option value={selectedPageValue}>{selectedPageLabel}</option> : null}
              {fbPages.map((p: { id: string; name?: string | null }) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
                </option>
              ))}
            </select>

            {facebookPageConnected ? (
              <>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.connectBtn} ${facebookPageBusy && facebookPageAction === "connect" ? styles.connectingActionBtn : ""}`}
                  onClick={() => void handlePageConnect()}
                  disabled={!canChangeFacebookPage}
                >
                  {i18nT("changer_de_page_37d7e3f7")}{" "}</button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.disconnectBtn} ${facebookPageBusy && facebookPageAction === "disconnect" ? styles.connectingActionBtn : ""}`}
                  onClick={() => void handlePageDisconnect()}
                  disabled={fbPagesLoading || facebookPageBusy}
                >
                  {i18nT("deconnecter_la_page_45620524")}{" "}</button>
              </>
            ) : (
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.connectBtn} ${facebookPageBusy && facebookPageAction === "connect" ? styles.connectingActionBtn : ""}`}
                onClick={() => void handlePageConnect()}
                disabled={!canConnectFacebookPage}
              >
                {i18nT("connecter_la_page_5ca1c814")}{" "}</button>
            )}
          </div>

          {fbPagesError && <StatusMessage variant="error">{fbPagesError}</StatusMessage>}
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
          <div className={styles.blockTitle}>{i18nT("lien_de_la_page_1f9f4b87")}</div>
          <ConnectionPill connected={facebookPageConnected && !!facebookUrl?.trim()} />
        </div>
        <div className={styles.blockSub}>{i18nT("se_remplit_automatiquement_une_fois_la_4133d66e")}</div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={facebookUrl}
            readOnly
            placeholder={facebookPageConnected ? "Lien récupéré automatiquement" : "Sélectionne une page pour générer le lien"}
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
              opacity: facebookUrl ? 1 : 0.8,
            }}
          />

          <a
            href={facebookUrl || "#"}
            target="_blank"
            rel="noreferrer"
            className={`${styles.actionBtn} ${styles.viewBtn}`}
            style={{ pointerEvents: facebookUrl ? "auto" : "none", opacity: facebookUrl ? 1 : 0.5 }}
          >
            {i18nT("voir_la_page_82561348")}{" "}</a>
        </div>
        {facebookUrlNotice && <StatusMessage variant="success">{facebookUrlNotice}</StatusMessage>}
        {facebookUrlError && <StatusMessage variant="error">{facebookUrlError}</StatusMessage>}
      </div>
    </div>
  );
}
