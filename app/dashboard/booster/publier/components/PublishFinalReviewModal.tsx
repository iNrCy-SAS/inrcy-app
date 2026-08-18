import { useTranslations } from "next-intl";
import type { ChannelKey, PublicationMediaType } from "../publishModal.shared";

export type PublishFinalReviewItem = {
  channel: ChannelKey;
  label: string;
  mediaType: PublicationMediaType;
  mediaLabel: string;
  imageCount: number;
  warnings: string[];
  blockers: string[];
  publishable?: boolean;
  tiktokParametersValidated?: boolean;
  hasContent: boolean;
  hasTitle: boolean;
  hasText: boolean;
  hasImage: boolean;
};

type PublishModalStyles = Readonly<Record<string, string>>;

type PublishFinalReviewModalProps = {
  open: boolean;
  styles: PublishModalStyles;
  items: PublishFinalReviewItem[];
  showSiteNotice: boolean;
  hasBlockers: boolean;
  publishableCount: number;
  isMobile: boolean;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export default function PublishFinalReviewModal({
  open,
  styles,
  items,
  showSiteNotice,
  hasBlockers,
  publishableCount,
  isMobile,
  saving,
  onClose,
  onConfirm,
}: PublishFinalReviewModalProps) {
  const i18nT = useTranslations("booster");
  if (!open) return null;

  return (
    <div
      className={styles.fullscreenModalOverlay}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10012,
        background: "rgba(4, 8, 18, 0.74)",
        backdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        overflowY: "auto",
        overscrollBehavior: "contain",
      }}
    >
      <div
        className={styles.blockCard}
        style={{
          width: "min(760px, 100%)",
          maxHeight:
            "calc(100dvh - var(--inrcy-mobile-bottom-nav-total-height, calc(50px + env(safe-area-inset-bottom, 0px))) - 32px)",
          overflowY: "auto",
          display: "grid",
          gap: 16,
          background: "#111827",
          backgroundImage: "none",
          border: "1px solid rgba(148, 163, 184, 0.28)",
          boxShadow: "0 30px 90px rgba(0,0,0,0.62)",
          backdropFilter: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 22 }}>✅</div>
            <div className={styles.blockTitle} style={{ marginBottom: 0 }}>
              {i18nT("verification_avant_publication_8ff13190")}{" "}</div>
            <div
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.72)",
                lineHeight: 1.5,
              }}
            >
              {i18nT("controlez_les_canaux_les_medias_et_01e0e60d")}{" "}</div>
          </div>
          <div
            style={{
              fontSize: 12,
              padding: "7px 10px",
              borderRadius: 999,
              background: "rgba(76,195,255,0.10)",
              border: "1px solid rgba(76,195,255,0.22)",
              color: "rgba(255,255,255,0.86)",
            }}
          >
            {i18nT("value_canal_aux_selectionne_s_e508e84f", { value0: items.length })}</div>
        </div>

        {showSiteNotice ? (
          <div
            style={{
              borderRadius: 14,
              padding: 12,
              background: "rgba(76,195,255,0.08)",
              border: "1px solid rgba(76,195,255,0.18)",
              color: "rgba(255,255,255,0.82)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {i18nT("site_inrcy_et_site_web_ont_8098e8ca")}{" "}</div>
        ) : null}

        <div style={{ display: "grid", gap: 10 }}>
          {items.map((item) => {
            const hasMessages = item.warnings.length || item.blockers.length;
            return (
              <div
                key={item.channel}
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile
                    ? "1fr"
                    : "minmax(150px, 0.85fr) minmax(190px, 0.9fr) minmax(0, 1.05fr)",
                  gap: 10,
                  alignItems: "center",
                  borderRadius: 16,
                  padding: 12,
                  background: "rgba(255,255,255,0.04)",
                  border: item.blockers.length
                    ? "1px solid rgba(248,113,113,0.34)"
                    : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ minWidth: 0, display: "grid", gap: 5 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ fontWeight: 900, color: "#fff" }}>
                      {item.label}
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 900,
                        padding: "4px 7px",
                        borderRadius: 999,
                        background: item.blockers.length
                          ? "rgba(248,113,113,0.14)"
                          : "rgba(34,197,94,0.14)",
                        color: item.blockers.length ? "#fecaca" : "#bbf7d0",
                        border: item.blockers.length
                          ? "1px solid rgba(248,113,113,0.25)"
                          : "1px solid rgba(34,197,94,0.25)",
                      }}
                    >
                      {item.blockers.length ? i18nT("bloquant_c05c5176") : i18nT("pret_c5e3c29f")}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.58)",
                    }}
                  >
                    {i18nT("canal_selectionne_a989eaec")}{" "}</div>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: isMobile ? "wrap" : "nowrap",
                    alignItems: "center",
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      padding: "6px 9px",
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.07)",
                      color: "rgba(255,255,255,0.84)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.mediaLabel}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      padding: "6px 9px",
                      borderRadius: 999,
                      background: item.hasContent
                        ? "rgba(34,197,94,0.12)"
                        : "rgba(251,191,36,0.12)",
                      color: item.hasContent ? "#bbf7d0" : "#fde68a",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.hasContent ? i18nT("texte_ok_e490a202") : i18nT("texte_vide_5e1fe6d5")}
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gap: 6,
                    fontSize: 12,
                    lineHeight: 1.45,
                  }}
                >
                  {!hasMessages ? (
                    <span style={{ color: "#bbf7d0" }}>
                      {item.tiktokParametersValidated ? i18nT("pret_parametres_valides_8c17cc93") : i18nT("pret_a_publier_a82b75ce")}
                    </span>
                  ) : null}
                  {item.tiktokParametersValidated && !item.blockers.length ? (
                    <span style={{ color: "#bbf7d0" }}>
                      {i18nT("parametres_tiktok_valides_aab3d118")}{" "}</span>
                  ) : null}
                  {item.warnings.map((warning) => (
                    <span key={warning} style={{ color: "#fde68a" }}>
                      ⚠️ {warning}
                    </span>
                  ))}
                  {item.blockers.map((blocker) => (
                    <span key={blocker} style={{ color: "#fecaca" }}>
                      ⛔ {blocker}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {hasBlockers ? (
          <div
            style={{
              borderRadius: 14,
              padding: 12,
              background: "rgba(248,113,113,0.10)",
              border: "1px solid rgba(248,113,113,0.24)",
              color: "#fecaca",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {i18nT("les_canaux_rouges_seront_inscrits_en_6ff68b36")}{" "}</div>
        ) : null}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            flexWrap: "wrap",
            position: "sticky",
            bottom: -1,
            paddingTop: 4,
            background: "#111827",
          }}
        >
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onClose}
          >
            {i18nT("retour_modifier_ee98859e")}{" "}</button>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={onConfirm}
            disabled={!publishableCount || saving}
            style={{
              opacity: !publishableCount || saving ? 0.58 : 1,
            }}
          >
            {saving
              ? i18nT("publication_en_cours_09ec4187")
              : hasBlockers
                ? i18nT("publier_les_value_canal_aux_prets_400cb943", { value0: publishableCount })
                : i18nT("confirmer_la_publication_dbfb1790")}
          </button>
        </div>
      </div>
    </div>
  );
}
