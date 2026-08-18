"use client";

import { useTranslations } from "next-intl";


import { useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import styles from "./inrSearchPublic.module.css";

type ServiceItem = {
  name: string;
  description: string;
};

type Props = {
  companyName: string;
  services: ServiceItem[];
  audiences: string[];
};

type ServiceStyle = CSSProperties & {
  "--service-angle": string;
  "--service-accent": string;
  "--service-order": string;
};

const ACCENTS = [
  "#35d8ff",
  "#8b6cff",
  "#ef5cff",
  "#5c8cff",
  "#34d6b4",
  "#ff8b62",
  "#ffd45c",
  "#9b7cff",
];

function wrapIndex(index: number, length: number) {
  if (!length) return 0;
  return (index + length) % length;
}

function ServiceGlyph({ index }: { index: number }) {
  const variants = [
    <path key="a" d="M5 12h14M12 5v14" />,
    <path key="b" d="M5 7h14M5 12h10M5 17h12" />,
    <path key="c" d="m6 15 4-4 3 3 5-6" />,
    <path key="d" d="M6 6h12v12H6zM9 9h6v6H9z" />,
    <path key="e" d="M12 4v16M4 12h16M7 7l10 10M17 7 7 17" />,
    <path key="f" d="M5 16c3-7 11-7 14 0M8 9a4 4 0 1 1 8 0" />,
  ];

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {variants[index % variants.length]}
      </g>
    </svg>
  );
}

export default function InrSearchServicesOrbit({ companyName, services, audiences }: Props) {
  const i18nT = useTranslations("public");
  const [activeIndex, setActiveIndex] = useState(0);
  const total = services.length;
  const activeService = services[activeIndex] || services[0];

  const orbitServices = useMemo(
    () =>
      services.map((service, index) => {
        const forward = wrapIndex(index - activeIndex, total);
        const signed = forward > total / 2 ? forward - total : forward;
        const visible = total <= 7 || Math.abs(signed) <= 3;
        const position = total <= 7 ? forward : signed + 3;
        const divisor = Math.min(7, total);
        const angle = divisor > 1 ? -90 + (position * 360) / divisor : -90;
        return { service, index, signed, visible, angle, position };
      }),
    [activeIndex, services, total],
  );

  const move = (offset: number) => {
    setActiveIndex((current) => wrapIndex(current + offset, total));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, total - 1));
    }
  };

  return (
    <div className={styles.servicesOrbitExperience} onKeyDown={onKeyDown}>
      <div className={styles.servicesOrbitHeader}>
        <div>
          <span className={styles.servicesOrbitEyebrow}>{i18nT("accelerateur_d_expertises_5ff474b0")}</span>
          <h2 id="prestations-title">{i18nT("les_prestations_de_value_39d5ec75", { value0: companyName })}</h2>
          <p>
            {i18nT("decouvrez_les_services_proposes_par_value_cc6de04f", { value0: companyName })}</p>
        </div>

        <div className={styles.servicesOrbitNavigator} aria-label={i18nT("naviguer_entre_les_expertises_a3d64bb8")}>
          <button type="button" onClick={() => move(-1)} aria-label={i18nT("expertise_precedente_16fa7ea6")}>←</button>
          <span><strong>{String(activeIndex + 1).padStart(2, "0")}</strong> / {String(total).padStart(2, "0")}</span>
          <button type="button" onClick={() => move(1)} aria-label={i18nT("expertise_suivante_6b902217")}>→</button>
        </div>
      </div>

      <div className={styles.servicesOrbitStage}>
        <article className={styles.servicesOrbitFocus} aria-live="polite">
          <span className={styles.servicesOrbitFocusBeam} aria-hidden="true" />
          <div className={styles.servicesOrbitFocusTopline}>
            <span className={styles.servicesOrbitGlyph}><ServiceGlyph index={activeIndex} /></span>
            <span>{String(activeIndex + 1).padStart(2, "0")}</span>
          </div>
          <small>{i18nT("expertise_selectionnee_3ab52571")}</small>
          <h3>{activeService?.name}</h3>
          <p>{activeService?.description}</p>
          <a href="#contact" data-inrsearch-contact-trigger data-inrsearch-action="service_contact" data-inrsearch-target="#contact-modal">
            {i18nT("activer_cette_expertise_3f1a78c0")}{" "}<span aria-hidden="true">↗</span>
          </a>
        </article>

        <div className={styles.servicesAccelerator} role="list" aria-label={i18nT("expertises_proposees_dd812af6")}>
          <div className={styles.servicesAcceleratorRings} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className={styles.servicesAcceleratorCore} aria-hidden="true">
            <span>{i18nT("inr_fe1e1b8a")}</span>
            <i />
          </div>

          {orbitServices.map(({ service, index, signed, visible, angle, position }) => {
            const active = index === activeIndex;
            const style: ServiceStyle = {
              "--service-angle": `${angle}deg`,
              "--service-order": String(signed),
              "--service-accent": ACCENTS[index % ACCENTS.length],
            };

            return (
              <button
                type="button"
                key={`${service.name}-${index}`}
                className={styles.servicesOrbitCard}
                data-active={active ? "true" : "false"}
                data-visible={visible ? "true" : "false"}
                data-orbit-position={String(position)}
                style={style}
                onClick={() => setActiveIndex(index)}
                role="listitem"
                tabIndex={visible ? 0 : -1}
                aria-hidden={visible ? undefined : true}
                aria-current={active ? "true" : undefined}
                aria-label={i18nT("selectionner_value_b74d84aa", { value0: service.name })}
              >
                <span className={styles.servicesOrbitGlyph}><ServiceGlyph index={index} /></span>
                <strong>{service.name}</strong>
                <i aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.servicesOrbitFooter}>
        <div className={styles.servicesOrbitIndexList} data-local-carousel aria-label={i18nT("acces_direct_aux_expertises_a8f804fa")}>
          {services.map((service, index) => (
            <button
              type="button"
              data-active={index === activeIndex ? "true" : "false"}
              key={`${service.name}-index`}
              onClick={() => setActiveIndex(index)}
            >
              {String(index + 1).padStart(2, "0")} · {service.name}
            </button>
          ))}
        </div>
        <div className={styles.servicesMobileSelector} aria-label={i18nT("selecteur_compact_des_expertises_d0423415")}>
          <div className={styles.mobileSelectorActive} aria-live="polite">
            <span>{String(activeIndex + 1).padStart(2, "0")}</span>
            <i aria-hidden="true" />
            <strong>{activeService?.name}</strong>
          </div>
          <div className={styles.mobileSelectorChoices}>
            {services.map((service, index) => index === activeIndex ? null : (
              <button
                type="button"
                key={`${service.name}-mobile-index`}
                onClick={() => setActiveIndex(index)}
                aria-label={i18nT("afficher_l_expertise_value_value_5f93e456", { value0: String(index + 1).padStart(2, "0"), value1: service.name })}
                title={service.name}
              >
                {String(index + 1).padStart(2, "0")}
              </button>
            ))}
          </div>
        </div>
        {audiences.length ? (
          <div className={styles.servicesOrbitAudience}>
            <span>{i18nT("concu_notamment_pour_a022b173")}</span>
            <div>{audiences.slice(0, 4).map((audience) => <strong key={audience}>{audience}</strong>)}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
