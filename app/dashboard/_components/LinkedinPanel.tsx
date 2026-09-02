"use client";

import { useTranslations } from "next-intl";


import { useEffect, useState } from "react";
import styles from "../dashboard.module.css";
import ConnectionPill from "./ConnectionPill";
import StatusMessage from "./StatusMessage";

const cardStyle = {
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.03)",
  borderRadius: 14,
  padding: 12,
  display: "grid",
  gap: 10,
} as const;

const inputStyle = {
  flex: "1 1 260px",
  minWidth: 0,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(15,23,42,0.65)",
  colorScheme: "dark",
  padding: "10px 12px",
  color: "white",
  outline: "none",
} as const;

export default function LinkedinPanel(props: any) {
  const i18nT = useTranslations("shell");
  const {
    linkedinAccountConnected,
    linkedinConnectionStatus,
    linkedinDisplayName,
    connectLinkedinAccount,
    connectLinkedinBusinessAccount,
    disconnectLinkedinAccount,
    disconnectLinkedinOrganization,
    linkedinUrl,
    setLinkedinUrl,
    saveLinkedinProfileUrl,
    linkedinUrlNotice,
    linkedinUrlError,
    setLinkedinUrlNotice,
    linkedinAccountBusy,
    linkedinUrlBusy,
    linkedinOrganizations = [],
    linkedinOrganizationsLoading,
    linkedinOrganizationsPhase = "idle",
    linkedinOrganizationBusy,
    linkedinOrganizationAction,
    linkedinSelectedOrganizationId,
    linkedinSelectedOrganizationName,
    linkedinOrganizationPickerOpen,
    linkedinShareToPersonalProfile,
    linkedinShareToPersonalProfileBusy,
    updateLinkedinShareToPersonalProfile,
    loadLinkedinOrganizations,
    selectLinkedinOrganization,
  } = props;

  const [linkedinPendingOrganizationId, setLinkedinPendingOrganizationId] = useState(linkedinSelectedOrganizationId || "");

  useEffect(() => {
    if (!linkedinOrganizationPickerOpen) {
      setLinkedinPendingOrganizationId(linkedinSelectedOrganizationId || "");
    }
  }, [linkedinOrganizationPickerOpen, linkedinSelectedOrganizationId]);

  const hasCompanyPage = !!linkedinSelectedOrganizationId || !!linkedinSelectedOrganizationName;
  const profileReady = !!linkedinAccountConnected;
  const linkedinNeedsUpdate = linkedinConnectionStatus === "needs_update" && linkedinAccountConnected;
  const linkedinStatusLabel = linkedinNeedsUpdate ? "À actualiser" : hasCompanyPage ? "Profil + page connectés" : profileReady ? "Profil connecté" : "À connecter";
  const linkedinStatusDot = linkedinNeedsUpdate
    ? "rgba(245,158,11,0.95)"
    : profileReady
      ? "rgba(34,197,94,0.95)"
      : "rgba(148,163,184,0.9)";
  const linkedinOrganizationDetected = linkedinOrganizationsPhase === "connecting";
  const linkedinOrganizationActivity =
    linkedinOrganizationBusy && linkedinOrganizationAction === "disconnect"
      ? "disconnecting"
      : linkedinOrganizationsPhase === "searching" || linkedinOrganizationsLoading
          ? "searching"
          : undefined;
  const linkedinOrganizationActivityLabel =
    linkedinOrganizationDetected && !linkedinOrganizationActivity
      ? i18nT("connecte_ce09957c")
      : linkedinOrganizationActivity === "searching"
      ? "Recherche des pages…"
      : linkedinOrganizationActivity === "disconnecting"
        ? "Déconnexion en cours…"
        : linkedinOrganizationActivity === "connecting"
          ? "Connexion en cours…"
          : undefined;

  const linkBlockTitle = hasCompanyPage ? "Lien page entreprise LinkedIn" : "Lien profil personnel LinkedIn";
  const linkBlockHelp = hasCompanyPage
    ? "Lien public de la page entreprise utilisée dans iNrStats et dans le bouton Voir."
    : "Lien public du profil personnel utilisé dans iNrStats et dans le bouton Voir.";
  const linkPlaceholder = hasCompanyPage ? "Lien de la page entreprise LinkedIn" : "Lien du profil LinkedIn";
  const canApplyLinkedinOrganization = Boolean(linkedinPendingOrganizationId) && (!hasCompanyPage || linkedinPendingOrganizationId !== linkedinSelectedOrganizationId) && !linkedinOrganizationsLoading && linkedinOrganizationsPhase === "idle" && !linkedinOrganizationBusy;

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
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: linkedinStatusDot }} />
          {i18nT("statut_b20e7fc2")}{" "}<strong>{linkedinStatusLabel}</strong>
        </span>
      </div>

      {!profileReady ? (
        <div style={cardStyle}>
          <div className={styles.blockTitle}>{i18nT("choisissez_le_type_de_connexion_f1ff9d4f")}</div>
          <div className={styles.blockSub}>
            {i18nT("la_connexion_linkedin_permet_l_analyse_cec215a5")}{" "}</div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.connectBtn}`}
              onClick={() => void connectLinkedinAccount?.("profile")}
              style={{ justifyContent: "center", padding: "8px 16px", width: "auto" }}
            >
              {i18nT("profil_personnel_8e5d4316")}{" "}</button>

            <button
              type="button"
              className={`${styles.actionBtn} ${styles.connectBtn}`}
              onClick={() => void connectLinkedinBusinessAccount?.()}
              style={{ justifyContent: "center", padding: "8px 16px", width: "auto" }}
            >
              {i18nT("page_entreprise_a6ed751d")}{" "}</button>
          </div>
        </div>
      ) : (
        <div style={cardStyle}>
          <div className={styles.blockHeaderRow}>
            <div className={styles.blockTitle}>{i18nT("profil_personnel_linkedin_c520fcd0")}</div>
            <ConnectionPill connected={profileReady} status={linkedinNeedsUpdate ? "needs_update" : undefined} />
          </div>
          <div className={styles.blockSub}>
            {hasCompanyPage
              ? i18nT("profil_connecte_pour_autoriser_et_piloter_e456d337")
              : i18nT("canal_actif_publication_et_donnees_exploitees_f35e73a2")}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input value={linkedinDisplayName} readOnly placeholder={i18nT("profil_connecte_c77184e6")} style={{ ...inputStyle, opacity: 1 }} />

            {linkedinNeedsUpdate ? (
              <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={() => void connectLinkedinAccount?.("profile")} disabled={linkedinAccountBusy}>
                {i18nT("actualiser_9d3b2a7d")}{" "}</button>
            ) : null}

            <button type="button" className={`${styles.actionBtn} ${styles.disconnectBtn}`} onClick={() => void disconnectLinkedinAccount()} disabled={linkedinAccountBusy}>
              {linkedinAccountBusy ? i18nT("deconnexion_f5a5666d") : i18nT("deconnecter_9c1ef392")}
            </button>
          </div>
        </div>
      )}

      {profileReady ? (
        <div style={cardStyle}>
          <div className={styles.blockHeaderRow}>
            <div className={styles.blockTitle}>{hasCompanyPage ? i18nT("page_entreprise_linkedin_8da517e0") : i18nT("connecter_une_page_entreprise_e6a59e95")}</div>
            <ConnectionPill
              connected={hasCompanyPage || linkedinOrganizationDetected}
              activity={linkedinOrganizationActivity}
              label={linkedinOrganizationActivityLabel}
            />
          </div>
          <div className={styles.blockSub}>
            {hasCompanyPage
              ? i18nT("canal_actif_publication_et_donnees_exploitees_33649201")
              : i18nT("selectionnez_la_page_entreprise_a_connecter_71a46f47")}
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={linkedinSelectedOrganizationName || ""}
                readOnly
                placeholder={i18nT("aucune_page_entreprise_connectee_cc9aa3eb")}
                style={{ ...inputStyle, opacity: linkedinSelectedOrganizationName ? 1 : 0.8 }}
              />

              <button
                type="button"
                className={`${styles.actionBtn} ${styles.secondaryBtn} ${linkedinOrganizationsPhase === "connecting" ? styles.connectingActionBtn : linkedinOrganizationsPhase === "searching" || linkedinOrganizationsLoading ? styles.searchingActionBtn : ""}`}
                onClick={() => void loadLinkedinOrganizations?.()}
                disabled={linkedinOrganizationsLoading || linkedinOrganizationsPhase !== "idle" || linkedinOrganizationBusy}
              >
                {i18nT("charger_mes_pages_df0e9c75")}{" "}</button>
            </div>

            {hasCompanyPage ? (
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  width: "fit-content",
                  maxWidth: "100%",
                  color: "rgba(255,255,255,0.86)",
                  fontSize: 13,
                  lineHeight: 1.3,
                  cursor: linkedinShareToPersonalProfileBusy ? "wait" : "pointer",
                  opacity: linkedinShareToPersonalProfileBusy ? 0.72 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={!!linkedinShareToPersonalProfile}
                  onChange={(event) => void updateLinkedinShareToPersonalProfile?.(event.target.checked)}
                  disabled={linkedinShareToPersonalProfileBusy || linkedinOrganizationsLoading || linkedinOrganizationsPhase !== "idle" || linkedinOrganizationBusy}
                  style={{ width: 16, height: 16, accentColor: "#0A66C2" }}
                />
                {i18nT("autoriser_le_partage_auto_sur_mon_babf8408")}{" "}</label>
            ) : null}

            {linkedinOrganizationPickerOpen && linkedinOrganizations.length > 1 ? (
              <select
                value={linkedinPendingOrganizationId || ""}
                onChange={(event) => setLinkedinPendingOrganizationId(event.target.value)}
                disabled={linkedinOrganizationsLoading || linkedinOrganizationsPhase !== "idle" || linkedinOrganizationBusy}
                style={{
                  width: "100%",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(15,23,42,0.95)",
                  colorScheme: "dark",
                  padding: "10px 12px",
                  color: "white",
                  outline: "none",
                }}
              >
                <option value="">{i18nT("selectionner_la_page_entreprise_827e4855")}</option>
                {linkedinOrganizations.map((org: any) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            ) : null}

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {hasCompanyPage ? (
                <>
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.connectBtn} ${linkedinOrganizationsPhase === "connecting" ? styles.connectingActionBtn : ""}`}
                    onClick={() => void selectLinkedinOrganization?.(linkedinPendingOrganizationId)}
                    disabled={!canApplyLinkedinOrganization}
                    style={{ width: "fit-content" }}
                  >
                    {i18nT("changer_de_page_37d7e3f7")}{" "}</button>
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.disconnectBtn} ${linkedinOrganizationAction === "disconnect" ? styles.connectingActionBtn : ""}`}
                    onClick={() => void disconnectLinkedinOrganization?.()}
                    disabled={linkedinOrganizationsLoading || linkedinOrganizationsPhase !== "idle" || linkedinOrganizationBusy}
                    style={{ width: "fit-content" }}
                  >
                    {i18nT("deconnecter_la_page_45620524")}{" "}</button>
                </>
              ) : (
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.connectBtn} ${linkedinOrganizationsPhase === "connecting" ? styles.connectingActionBtn : ""}`}
                  onClick={() => void selectLinkedinOrganization?.(linkedinPendingOrganizationId)}
                  disabled={!canApplyLinkedinOrganization}
                  style={{ width: "fit-content" }}
                >
                  {i18nT("connecter_la_page_5ca1c814")}{" "}</button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div style={cardStyle}>
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{linkBlockTitle}</div>
          <ConnectionPill connected={!!linkedinUrl?.trim()} />
        </div>
        <div className={styles.blockSub}>{linkBlockHelp}</div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={linkedinUrl}
            onChange={(e) => {
              setLinkedinUrlNotice(null);
              setLinkedinUrl(e.target.value);
            }}
            placeholder={linkPlaceholder}
            style={{ ...inputStyle, opacity: linkedinUrl ? 1 : 0.8 }}
          />

          <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={() => void saveLinkedinProfileUrl()} disabled={linkedinUrlBusy}>
            {linkedinUrlBusy ? i18nT("enregistrement_9bf1058a") : i18nT("enregistrer_f7c8bcd8")}
          </button>

          <a
            href={linkedinUrl || "#"}
            target="_blank"
            rel="noreferrer"
            className={`${styles.actionBtn} ${styles.viewBtn}`}
            style={{ pointerEvents: linkedinUrl ? "auto" : "none", opacity: linkedinUrl ? 1 : 0.5 }}
          >
            {i18nT("voir_8a754f1f")}{" "}</a>
        </div>

        {linkedinUrlNotice && <StatusMessage variant="success">{linkedinUrlNotice}</StatusMessage>}
        {linkedinUrlError && <StatusMessage variant="error">{linkedinUrlError}</StatusMessage>}
      </div>
    </div>
  );
}
