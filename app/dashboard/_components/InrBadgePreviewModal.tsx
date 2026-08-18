"use client";

import { useTranslations } from "next-intl";


import WorkflowBaseModal from "./WorkflowBaseModal";
import InrBadgeQrCode from "./InrBadgeQrCode";
import { createInrBadgeQrTrackingUrl, type InrBadgeProfileSummary } from "@/lib/inrBadge";
import styles from "../dashboard.module.css";

const INRBADGE_HEADER_LINE = "iNr'Badge";
const INRBADGE_ICON_SRC = "/icons/inrbadge-dashboard.png";

type Props = {
  profile: InrBadgeProfileSummary;
  publicUrl: string;
  onClose: () => void;
  onConfigure: () => void;
};

function getDisplayName(profile: InrBadgeProfileSummary) {
  return [profile.firstName, profile.lastName].map((part) => part.trim()).filter(Boolean).join(" ") || "Votre profil";
}

export default function InrBadgePreviewModal({ profile, publicUrl, onClose, onConfigure }: Props) {
  const i18nT = useTranslations("shell");
  const displayName = getDisplayName(profile);
  const company = profile.companyLegalName.trim() || "Votre entreprise";
  const qrUrl = createInrBadgeQrTrackingUrl(publicUrl);

  return (
    <WorkflowBaseModal
      title={INRBADGE_HEADER_LINE}
      moduleLabel={i18nT("canal_inrcy_9590b630")}
      onClose={onClose}
      compact
      maxWidth={560}
      headerActions={
        <button
          type="button"
          className={[styles.ghostBtn, styles.modalCloseButton].join(" ")}
          onClick={onConfigure}
          aria-label={i18nT("configurer_inr_badge_698fff09")}
          title={i18nT("configurer_inr_badge_698fff09")}
          style={{ borderRadius: 999, padding: "7px 12px", lineHeight: 1 }}
        >
          ⚙️
        </button>
      }
    >
      <div className={styles.inrBadgeModalCard}>
        <div className={styles.inrBadgeModalLogo} aria-hidden="true">
          <img
            src={INRBADGE_ICON_SRC}
            alt=""
            width={96}
            height={96}
            loading="eager"
            decoding="sync"
            fetchPriority="high"
          />
        </div>

        <div className={styles.inrBadgeModalIntro}>
          <strong>{company}</strong>
          <span>{displayName}</span>
        </div>

        <div className={styles.inrBadgeQrRealWrap}>
          {publicUrl ? (
            <InrBadgeQrCode value={qrUrl} label={i18nT("qr_code_inr_badge_value_0dc7b6f6", { value0: company })} />
          ) : (
            <div className={styles.inrBadgeQrUnavailable} role="img" aria-label={i18nT("qr_code_indisponible_7d1cdbea")}>
              {i18nT("qr_indisponible_cd24def2")}{" "}</div>
          )}
        </div>

        <div className={styles.inrBadgeModalText}>
          <strong>{INRBADGE_HEADER_LINE}</strong>
          {publicUrl ? (
            <span className={styles.inrBadgeModalUrl}>{publicUrl}</span>
          ) : (
            <span>{i18nT("completez_mon_profil_pour_generer_votre_7c08ad6c")}</span>
          )}
          <span>{i18nT("ce_qr_code_est_permanent_les_2c01ecd8")}</span>
        </div>
      </div>
    </WorkflowBaseModal>
  );
}
