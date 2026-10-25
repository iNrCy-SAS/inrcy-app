"use client";

import { useTranslations } from "next-intl";


import { useEffect, useId } from "react";
import referralStyles from "./ReferralPanel.module.css";

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

function ReferralIcon({ kind }: { kind: "gift" | "contact" | "send" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {kind === "gift" ? <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v9h14v-9M12 8v13M12 8H8a2.5 2.5 0 1 1 2.4-3.2L12 8Zm0 0h4a2.5 2.5 0 1 0-2.4-3.2L12 8Z" /></> : null}
      {kind === "contact" ? <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2" /></> : null}
      {kind === "send" ? <><path d="m3 11 18-8-8 18-3-8-7-2Z" /><path d="m10 13 6-6" /></> : null}
    </svg>
  );
}

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
  const referralId = useId();
  const hasUnsavedChanges = Boolean(referralName || referralPhone || referralEmail || referralFrom);

  useEffect(() => {
    onUnsavedChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChange]);

  return (
    <div className={referralStyles.panel}>
      <div className={referralStyles.surface}>
        <section className={referralStyles.intro} aria-labelledby={`${referralId}-reward`}>
          <span className={referralStyles.programme}>{i18nT("programme_de_parrainage_inrcy_ab7c7302")}</span>
          <span className={referralStyles.giftArtwork} aria-hidden="true"><ReferralIcon kind="gift" /></span>
          <h2 id={`${referralId}-reward`} className={referralStyles.rewardTitle}>
            {i18nT("recommandez_un_professionnel_et_debloquez_b0df4e25")}
            <strong className={referralStyles.rewardAmount}>50 €</strong>
            <span>{i18nT("de_cheque_cadeau_1c7fe645")}</span>
          </h2>
          <p className={referralStyles.introText}>
            {i18nT("des_qu_un_client_recommande_rejoint_1851aabd")} <strong>{i18nT("3_mois_d07765c5")}</strong>{i18nT("nous_validons_votre_recompense_remplissez_le_4af97166")}
          </p>
          <section className={referralStyles.conditions} aria-labelledby={`${referralId}-conditions`}>
            <h3 id={`${referralId}-conditions`}>{i18nT("conditions_5506eb61")}</h3>
            <ul>
              <li>{i18nT("1_contact_recommande_qualifie_0c1b9a17")}</li>
              <li>{i18nT("50_de_cheque_cadeau_apres_validation_7f358de6")}</li>
              <li>{i18nT("client_engage_au_minimum_3_mois_7337b4c1")}</li>
              <li>{i18nT("envoi_direct_a_l_equipe_inrcy_4fd0cfce")}</li>
            </ul>
          </section>
        </section>

        <section className={referralStyles.formCard} aria-labelledby={`${referralId}-contact`}>
          <div className={referralStyles.formHeading}>
            <span className={referralStyles.contactIcon}><ReferralIcon kind="contact" /></span>
            <h2 id={`${referralId}-contact`}>{i18nT("coordonnees_a_transmettre_4457c831")}</h2>
          </div>
          <p className={referralStyles.formDescription}>{i18nT("les_informations_seront_envoyees_automatiquement_e4770777")} <strong>parrainage@inrcy.com</strong>.</p>

          <div className={referralStyles.fields}>
            <label className={referralStyles.field} htmlFor={`${referralId}-name`}>
              <span>{i18nT("nom_prenom_ou_raison_sociale_77093731")}</span>
              <input id={`${referralId}-name`} value={referralName} onChange={(e) => onReferralNameChange(e.target.value)}
                placeholder={i18nT("nom_prenom_ou_raison_sociale_77093731")} />
            </label>
            <label className={referralStyles.field} htmlFor={`${referralId}-phone`}>
              <span>{i18nT("telephone_d3b023ea")}</span>
              <input id={`${referralId}-phone`} value={referralPhone} onChange={(e) => onReferralPhoneChange(e.target.value)}
                placeholder={i18nT("telephone_d3b023ea")} inputMode="tel" />
            </label>
            <label className={referralStyles.field} htmlFor={`${referralId}-email`}>
              <span>{i18nT("mail_92379cbb")}</span>
              <input id={`${referralId}-email`} value={referralEmail} onChange={(e) => onReferralEmailChange(e.target.value)}
                placeholder={i18nT("mail_92379cbb")} inputMode="email" />
            </label>
            <label className={referralStyles.field} htmlFor={`${referralId}-from`}>
              <span>{i18nT("parrain_de_la_part_de_a4306cbb")}</span>
              <input id={`${referralId}-from`} value={referralFrom} onChange={(e) => onReferralFromChange(e.target.value)}
                placeholder={i18nT("parrain_de_la_part_de_a4306cbb")} />
            </label>
          </div>

          <div className={referralStyles.submitRow}>
            <p>{i18nT("votre_recommandation_est_transmise_a_l_eb58d6c9")}</p>
            <button type="button" className={referralStyles.submit} onClick={onSubmit} disabled={referralSubmitting} aria-busy={referralSubmitting || undefined}>
              <span><ReferralIcon kind="send" /></span>
              {referralSubmitting ? i18nT("envoi_5a377e56") : i18nT("envoyer_la_recommandation_b9cb2f31")}
            </button>
          </div>

          {referralNotice ? <p className={referralStyles.success} role="status">{referralNotice}</p> : null}
          {referralError ? <p className={referralStyles.error} role="alert">{referralError}</p> : null}
        </section>
      </div>
    </div>
  );
}
