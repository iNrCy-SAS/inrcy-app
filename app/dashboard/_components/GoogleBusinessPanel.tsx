"use client";

import { useTranslations } from "next-intl";


import { useEffect, useMemo, useState } from "react";
import styles from "../dashboard.module.css";
import ConnectionPill from "./ConnectionPill";
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
  const gmbStatusLabel = gmbNeedsUpdate ? "À actualiser" : gmbConnected ? "Connecté" : gmbAccountConnected ? "Compte connecté" : "À connecter";
  const gmbStatusDot = gmbNeedsUpdate
    ? "rgba(245,158,11,0.95)"
    : gmbConnected
      ? "rgba(34,197,94,0.95)"
      : gmbAccountConnected
        ? "rgba(59,130,246,0.95)"
        : "rgba(148,163,184,0.9)";
  const gmbLocationActivity =
    gmbLocationBusy && gmbLocationAction === "disconnect"
      ? "disconnecting"
      : gmbLocationBusy || gmbLocationsPhase === "connecting"
        ? "connecting"
        : gmbLocationsPhase === "searching" || gmbLoadingList
          ? "searching"
          : undefined;
  const gmbLocationActivityLabel =
    gmbLocationActivity === "searching"
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
              background: gmbStatusDot,
            }}
          />
          {i18nT("statut_b20e7fc2")}{" "}<strong>{gmbStatusLabel}</strong>
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
          <ConnectionPill connected={gmbAccountConnected} status={gmbNeedsUpdate ? "needs_update" : undefined} />
        </div>
        <div className={styles.blockSub}>{i18nT("ce_compte_google_sert_a_acceder_80ee3ae0")}</div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={gmbAccountEmail || (gmbAccountConnected ? i18nT("compte_connecte_a442afe1") : "")}
            readOnly
            placeholder={gmbAccountConnected ? i18nT("compte_connecte_a442afe1") : i18nT("account_not_connected")}
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
              opacity: gmbAccountConnected ? 1 : 0.8,
            }}
          />

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

      {gmbAccountConnected ? (
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
            <div className={styles.blockTitle}>{i18nT("etablissement_a_connecter_264ce135")}</div>
            <ConnectionPill
              connected={gmbConfigured}
              status={gmbNeedsUpdate ? "needs_update" : undefined}
              activity={gmbLocationActivity}
              label={gmbLocationActivityLabel}
            />
          </div>
          <div className={styles.blockSub}>{i18nT("choisissez_la_fiche_google_business_a_ea2602ec")}</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
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
              value={selectedLocationName}
              onChange={(e) => setGmbLocationName(e.target.value)}
              disabled={gmbLoadingList || gmbLocationBusy || gmbPickerLocked}
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
            <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 12, marginTop: -2 }}>
              {i18nT("plusieurs_comptes_detectes_inrcy_utilise_actuell_fb1bcb5e")}{" "}<strong>{gmbAccountName || i18nT("non_defini_ca1771d6")}</strong>.
            </div>
          ) : null}

          {gmbListError && <StatusMessage variant="error">{gmbListError}</StatusMessage>}
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
          <ConnectionPill connected={gmbConfigured && !!gmbUrl?.trim()} />
        </div>
        <div className={styles.blockSub}>{i18nT("se_remplit_automatiquement_une_fois_l_27c3f226")}</div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={gmbUrl}
            readOnly
            placeholder={gmbConfigured ? "Lien récupéré automatiquement" : "Sélectionne un établissement pour générer le lien"}
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
              opacity: gmbUrl ? 1 : 0.8,
            }}
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
  );
}
