"use client";

import { useTranslations } from "next-intl";


import { useEffect } from "react";
import styles from "../dashboard.module.css";

type ReferralPanelProps = {
  referralName: string;
  referralPhone: string;
  referralEmail: string;
  referralFrom: string;
  referralSubmitting: boolean;
  referralNotice: string | null;
  referralError: string | null;
  onReferralNameChange: (value: string) => void;
  onReferralPhoneChange: (value: string) => void;
  onReferralEmailChange: (value: string) => void;
  onReferralFromChange: (value: string) => void;
  onSubmit: () => void;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
};

const inputStyle = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(15,23,42,0.72)",
  colorScheme: "dark" as const,
  padding: "12px 14px",
  color: "white",
  outline: "none",
};

export default function ReferralPanel({
  referralName,
  referralPhone,
  referralEmail,
  referralFrom,
  referralSubmitting,
  referralNotice,
  referralError,
  onReferralNameChange,
  onReferralPhoneChange,
  onReferralEmailChange,
  onReferralFromChange,
  onSubmit,
  onUnsavedChange,
}: ReferralPanelProps) {
  const i18nT = useTranslations("shell");
  const hasUnsavedChanges = Boolean(referralName || referralPhone || referralEmail || referralFrom);

  useEffect(() => {
    onUnsavedChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChange]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          border: "1px solid rgba(96,165,250,0.22)",
          background:
            "linear-gradient(135deg, rgba(14,25,56,0.96) 0%, rgba(33,16,66,0.92) 52%, rgba(10,21,53,0.96) 100%)",
          borderRadius: 20,
          padding: 18,
          display: "grid",
          gap: 16,
          boxShadow: "0 20px 60px rgba(2,6,23,0.32), inset 0 1px 0 rgba(255,255,255,0.06)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            right: -36,
            top: -36,
            width: 140,
            height: 140,
            borderRadius: 999,
            background: "radial-gradient(circle, rgba(236,72,153,0.26) 0%, rgba(236,72,153,0.04) 55%, transparent 72%)",
            pointerEvents: "none",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: -50,
            bottom: -56,
            width: 170,
            height: 170,
            borderRadius: 999,
            background: "radial-gradient(circle, rgba(59,130,246,0.24) 0%, rgba(59,130,246,0.04) 58%, transparent 76%)",
            pointerEvents: "none",
          }}
        />

        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", position: "relative", zIndex: 1 }}>
          <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                width: "fit-content",
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.06)",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 0.3,
                color: "rgba(255,255,255,0.92)",
              }}
            >
              {i18nT("programme_de_parrainage_inrcy_ab7c7302")}{" "}</div>
            <div style={{ fontSize: 26, lineHeight: 1.08, fontWeight: 800, color: "white" }}>
              {i18nT("recommandez_un_professionnel_et_debloquez_b0df4e25")}{" "}<span style={{ color: "#f9a8d4" }}>50 €</span> {" "}{i18nT("de_cheque_cadeau_1c7fe645")}{" "}</div>
            <div style={{ color: "rgba(226,232,240,0.9)", fontSize: 14, lineHeight: 1.65 }}>
              {i18nT("des_qu_un_client_recommande_rejoint_1851aabd")}{" "}<strong>{i18nT("6_mois_1242b310")}</strong>{i18nT("nous_validons_votre_recompense_remplissez_le_4af97166")}{" "}</div>
          </div>

          <div
            style={{
              minWidth: 0,
              flex: "0 1 250px",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.06)",
              borderRadius: 18,
              padding: 14,
              display: "grid",
              gap: 10,
              alignSelf: "start",
            }}
          >
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.68)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              {i18nT("conditions_5506eb61")}{" "}</div>
            <div style={{ display: "grid", gap: 8, color: "white", fontSize: 14, lineHeight: 1.45 }}>
              <div>{i18nT("1_contact_recommande_qualifie_0c1b9a17")}</div>
              <div>{i18nT("50_de_cheque_cadeau_apres_validation_7f358de6")}</div>
              <div>{i18nT("client_engage_au_minimum_6_mois_68e0f36c")}</div>
              <div>{i18nT("envoi_direct_a_l_equipe_inrcy_4fd0cfce")}</div>
            </div>
          </div>
        </div>

        <div
          style={{
            position: "relative",
            zIndex: 1,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(8,15,32,0.48)",
            borderRadius: 18,
            padding: 16,
            display: "grid",
            gap: 14,
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div className={styles.blockTitle}>{i18nT("coordonnees_a_transmettre_4457c831")}</div>
            <div className={styles.blockSub}>
              {i18nT("les_informations_seront_envoyees_automatiquement_e4770777")}{" "}<strong>parrainage@inrcy.com</strong>.
            </div>
          </div>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
            <input
              value={referralName}
              onChange={(e) => onReferralNameChange(e.target.value)}
              placeholder={i18nT("nom_prenom_ou_raison_sociale_77093731")}
              style={inputStyle}
            />

            <input
              value={referralPhone}
              onChange={(e) => onReferralPhoneChange(e.target.value)}
              placeholder={i18nT("telephone_d3b023ea")}
              inputMode="tel"
              style={inputStyle}
            />

            <input
              value={referralEmail}
              onChange={(e) => onReferralEmailChange(e.target.value)}
              placeholder={i18nT("mail_92379cbb")}
              inputMode="email"
              style={inputStyle}
            />

            <input
              value={referralFrom}
              onChange={(e) => onReferralFromChange(e.target.value)}
              placeholder={i18nT("parrain_de_la_part_de_a4306cbb")}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ color: "rgba(255,255,255,0.66)", fontSize: 12, lineHeight: 1.5 }}>
              {i18nT("votre_recommandation_est_transmise_a_l_eb58d6c9")}{" "}</div>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.connectBtn}`}
              onClick={onSubmit}
              disabled={referralSubmitting}
            >
              {referralSubmitting ? i18nT("envoi_5a377e56") : i18nT("envoyer_la_recommandation_b9cb2f31")}
            </button>
          </div>

          {referralNotice && <div className={styles.successNote}>{referralNotice}</div>}
          {referralError && <div style={{ color: "rgba(248,113,113,0.95)", fontSize: 13 }}>{referralError}</div>}
        </div>
      </div>
    </div>
  );
}
