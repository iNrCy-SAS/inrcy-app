"use client";

import { useTranslations } from "next-intl";


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
  width: "100%",
  minWidth: 0,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(15,23,42,0.65)",
  colorScheme: "dark" as const,
  padding: "10px 12px",
  color: "white",
  outline: "none",
} as const;

export default function TiktokPanel(props: any) {
  const i18nT = useTranslations("shell");
  const {
    tiktokConnected,
    tiktokUsername,
    tiktokProfileUrl,
    setTiktokProfileUrl,
    tiktokProfileUrlNotice,
    tiktokProfileUrlError,
    tiktokLoading,
    connectTiktok,
    disconnectTiktok,
    saveTiktokProfileUrl,
  } = props;

  const statusLabel = tiktokConnected ? "Connecté" : "À connecter";
  const statusColor = tiktokConnected ? "rgba(34,197,94,0.95)" : "rgba(148,163,184,0.9)";

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
            padding: "8px 10px",
            borderRadius: 999,
            color: "rgba(255,255,255,0.92)",
            fontSize: 13,
          }}
        >
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: statusColor }} />
          {i18nT("statut_b20e7fc2")}{" "}<strong>{statusLabel}</strong>
        </span>
      </div>

      <div style={cardStyle}>
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("compte_tiktok_0099e07c")}</div>
          <ConnectionPill connected={tiktokConnected} />
        </div>
        <div className={styles.blockSub}>
          {i18nT("connexion_officielle_tiktok_le_pro_autorise_1d5dce46")}{" "}</div>

        <input
          value={tiktokConnected ? tiktokUsername : ""}
          readOnly
          placeholder={tiktokConnected ? "Compte connecté" : "Aucun compte connecté"}
          style={{ ...inputStyle, opacity: tiktokConnected ? 1 : 0.8 }}
        />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {!tiktokConnected ? (
            <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={() => void connectTiktok?.()} disabled={tiktokLoading}>
              {tiktokLoading ? i18nT("connexion_7adf849f") : i18nT("connecter_tiktok_bce38f69")}
            </button>
          ) : (
            <>
              <button type="button" className={`${styles.actionBtn} ${styles.secondaryBtn}`} onClick={() => void connectTiktok?.()} disabled={tiktokLoading}>
                {tiktokLoading ? i18nT("chargement_a209b664") : i18nT("reconnecter_tiktok_125091e5")}
              </button>
              <button type="button" className={`${styles.actionBtn} ${styles.disconnectBtn}`} onClick={() => void disconnectTiktok?.()} disabled={tiktokLoading}>
                {tiktokLoading ? i18nT("deconnexion_f5a5666d") : i18nT("deconnecter_9c1ef392")}
              </button>
            </>
          )}
        </div>
      </div>

      <div style={cardStyle}>
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("lien_du_compte_890d040b")}</div>
          <ConnectionPill connected={Boolean(tiktokConnected && tiktokProfileUrl?.trim())} />
        </div>
        <div className={styles.blockSub}>
          {i18nT("lien_public_du_compte_tiktok_utilise_42d781f2")}{" "}<strong>{i18nT("voir_le_compte_1cbd7501")}</strong> {" "}{i18nT("dans_la_bulle_du_dashboard_689d3e85")}{" "}</div>

        <div style={{ display: "grid", gap: 10 }}>
          <input
            value={tiktokProfileUrl}
            onChange={(event) => setTiktokProfileUrl(event.target.value)}
            placeholder="https://www.tiktok.com/@moncompte"
            style={inputStyle}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={() => void saveTiktokProfileUrl?.()} disabled={tiktokLoading}>
              {tiktokLoading ? i18nT("enregistrement_9bf1058a") : i18nT("enregistrer_f7c8bcd8")}
            </button>
            <a
              href={tiktokProfileUrl || "#"}
              target="_blank"
              rel="noreferrer"
              className={`${styles.actionBtn} ${styles.viewBtn}`}
              style={{ pointerEvents: tiktokProfileUrl ? "auto" : "none", opacity: tiktokProfileUrl ? 1 : 0.5 }}
            >
              {i18nT("voir_le_compte_1cbd7501")}{" "}</a>
          </div>
        </div>

        {tiktokProfileUrlNotice ? <StatusMessage variant="success">{tiktokProfileUrlNotice}</StatusMessage> : null}
        {tiktokProfileUrlError ? <StatusMessage variant="error">{tiktokProfileUrlError}</StatusMessage> : null}
      </div>

      <div style={cardStyle}>
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("publication_tiktok_a6d8d0b0")}</div>
        </div>
        <div className={styles.blockSub}>
          {i18nT("les_parametres_sensibles_tiktok_ne_sont_0863053b")}{" "}</div>
      </div>
    </div>
  );
}
