"use client";

import { useTranslations } from "next-intl";


import styles from "../dashboard.module.css";
import stepStyles from "./ChannelPanelSteps.module.css";
import ConnectionPill from "./ConnectionPill";
import StatusMessage from "./StatusMessage";

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

  return (
    <div className={`${stepStyles.panel} ${stepStyles.tiktokPanel}`}>
      <section className={stepStyles.stepCard} aria-labelledby="tiktok-step-account">
        <div className={stepStyles.stepHeader}>
          <span className={stepStyles.stepNumber} aria-hidden>01</span>
          <div className={stepStyles.stepCopy}>
            <h3 id="tiktok-step-account" className={stepStyles.stepTitle}>{i18nT("compte_tiktok_0099e07c")}</h3>
            <p className={stepStyles.stepDescription}>
              {i18nT("connexion_officielle_tiktok_le_pro_autorise_1d5dce46")}
            </p>
          </div>
          <div className={stepStyles.stepStatus}>
            <ConnectionPill connected={tiktokConnected} />
          </div>
        </div>
        <div className={stepStyles.stepBody}>
          <div className={stepStyles.actionRow}>
            <input
              className={`${stepStyles.control} ${stepStyles.wideControl}`}
              value={tiktokConnected ? tiktokUsername : ""}
              readOnly
              placeholder={tiktokConnected ? i18nT("compte_connecte_a442afe1") : i18nT("account_not_connected")}
              style={{ ...inputStyle, opacity: tiktokConnected ? 1 : 0.8 }}
            />

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

          <div className={stepStyles.subsection}>
            <div className={stepStyles.subsectionHeader}>
              <h4 className={stepStyles.subsectionTitle}>{i18nT("lien_du_compte_890d040b")}</h4>
            </div>

            <div className={stepStyles.actionRow}>
              <input
                className={`${stepStyles.control} ${stepStyles.wideControl}`}
                value={tiktokProfileUrl}
                onChange={(event) => setTiktokProfileUrl(event.target.value)}
                placeholder="https://www.tiktok.com/@moncompte"
                style={inputStyle}
              />

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

            {tiktokProfileUrlNotice ? <StatusMessage variant="success">{tiktokProfileUrlNotice}</StatusMessage> : null}
            {tiktokProfileUrlError ? <StatusMessage variant="error">{tiktokProfileUrlError}</StatusMessage> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
