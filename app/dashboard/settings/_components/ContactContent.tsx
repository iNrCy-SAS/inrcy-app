"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import styles from "./ContactContent.module.css";

type Props = {
  mode?: "page" | "drawer";
};

function ContactIcon({ kind }: { kind: "email" | "phone" | "resources" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "email" ? <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m4 7 6.8 5.1a2 2 0 0 0 2.4 0L20 7" />
      </> : kind === "phone" ? <>
        <path d="M8.1 3.8 10 7.6a1.5 1.5 0 0 1-.3 1.7L8.4 10.6a12.2 12.2 0 0 0 5 5l1.3-1.3a1.5 1.5 0 0 1 1.7-.3l3.8 1.9a1.5 1.5 0 0 1 .8 1.6l-.5 2.2a1.5 1.5 0 0 1-1.6 1.2C10.7 20.1 3.9 13.3 3.1 5.1a1.5 1.5 0 0 1 1.2-1.6l2.2-.5a1.5 1.5 0 0 1 1.6.8Z" />
        <path d="M15 3a7 7 0 0 1 6 6M15 6a4 4 0 0 1 3 3" />
      </> : <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18M5 6.5h14M5 17.5h14" />
      </>}
    </svg>
  );
}

export default function ContactContent({ mode = "page" }: Props) {
  const i18nT = useTranslations("settings");
  const searchParams = useSearchParams();
  const premiumRequired = searchParams.get("premium") === "required";
  const EMAIL = "contact@inrcy.com";
  const PHONE_DISPLAY = "06.31.26.08.12";
  const PHONE_TEL = "+33631260812";
  const WHATSAPP_PHONE = "33631260812";
  const SITE = "https://inrcy.com";
  const WHATSAPP_URL = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(
    i18nT("bonjour_inrcy_je_vous_contacte_depuis_l_application_41a7e2cd"),
  )}`;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Copying must not interrupt the other contact actions.
    }
  };

  return (
    <div className={styles.contact} data-contact-mode={mode}>
      {premiumRequired ? (
        <section className={styles.premiumNotice}>
          <div className={styles.premiumLabel}>{i18nT("inrcy_premium_4c7d39c1")}</div>
          <h2>{i18nT("cette_fonctionnalite_fait_partie_de_premium_ab95c858")}</h2>
          <p>{i18nT("le_passage_a_premium_se_fait_1a6cbaaa")}</p>
        </section>
      ) : null}

      <header className={styles.intro}>
        <h2>{i18nT("contactez_nous_ec4802ef")}</h2>
        <p>{i18nT("besoin_d_aide_d_une_demo_1d13cfef")}</p>
        <div className={styles.badges}>
          <span>{i18nT("reponse_sous_48h_19d70d29")}</span>
          <span>{i18nT("mail_telephone_ed846f6c")}</span>
        </div>
      </header>

      <div className={styles.bubbles}>
        <section className={`${styles.bubble} ${styles.email}`}>
          <div className={styles.bubbleContent}>
            <span className={styles.icon}><ContactIcon kind="email" /></span>
            <h3>{i18nT("par_email_93b88caf")}</h3>
            <p className={styles.description}>{i18nT("adresse_745522e7")} <b>{EMAIL}</b></p>
            <div className={styles.actions}>
              <a href={`mailto:${EMAIL}?subject=${encodeURIComponent("Demande iNrCy")}`} className={styles.primaryAction}>
                {i18nT("envoyer_un_email_48feacc4")}
              </a>
              <button type="button" onClick={() => copy(EMAIL)} className={styles.copyAction}>
                {i18nT("copier_l_email_7b39b12c")}
              </button>
            </div>
          </div>
        </section>

        <section className={`${styles.bubble} ${styles.phone}`}>
          <div className={styles.bubbleContent}>
            <span className={styles.icon}><ContactIcon kind="phone" /></span>
            <h3>{i18nT("par_telephone_18b51791")}</h3>
            <p className={styles.description}>{i18nT("du_lundi_au_vendredi_fcc95644")} <b>{i18nT("10h_18h_ee119944")}</b></p>
            <div className={styles.actions}>
              <a href={`tel:${PHONE_TEL}`} className={styles.primaryAction}>
                {i18nT("appeler_value_f1b7ed8a", { value0: PHONE_DISPLAY })}
              </a>
              <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className={styles.secondaryAction}>
                {i18nT("ecrire_sur_whatsapp_c86e042a")}
              </a>
              <button type="button" onClick={() => copy(PHONE_DISPLAY)} className={styles.copyAction}>
                {i18nT("copier_le_numero_99c8d6c5")}
              </button>
            </div>
          </div>
        </section>

        <section className={`${styles.bubble} ${styles.resources}`}>
          <div className={styles.bubbleContent}>
            <span className={styles.icon}><ContactIcon kind="resources" /></span>
            <h3>{i18nT("ressources_926ac9d1")}</h3>
            <p className={styles.description}>{i18nT("decouvrir_inrcy_et_nos_solutions_03a2e799")}</p>
            <div className={styles.actions}>
              <a href={SITE} target="_blank" rel="noreferrer" className={styles.primaryAction}>
                {i18nT("visitez_notre_site_78ab4082")}
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
