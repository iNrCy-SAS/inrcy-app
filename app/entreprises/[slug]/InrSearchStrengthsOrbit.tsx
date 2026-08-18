"use client";

import { useTranslations } from "next-intl";


import { useState } from "react";
import { createInrBadgeQrMatrix } from "@/lib/inrBadgeQr";
import styles from "./inrSearchPublic.module.css";

type Props = {
  companyName: string;
  strengths: string[];
  inrBadgeUrl: string;
  inrBadgeQrUrl: string;
};

const NEWTON_SLOT_COUNT = 5;
const DEFAULT_STRENGTHS = ["Rapide", "Efficace", "Sérieux", "Proche", "À l’écoute"];

function normalizeStrength(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR");
}

function strengthDefinition(strength: string, companyName: string) {
  const normalized = normalizeStrength(strength);
  if (/rapide|reactif|reponse|vite/.test(normalized)) {
    return `${companyName} met en avant sa réactivité pour répondre aux demandes et faciliter les échanges.`;
  }
  if (/efficace|precis|solution|resultat/.test(normalized)) {
    return `${companyName} s’attache à comprendre le besoin et à proposer une réponse claire et adaptée.`;
  }
  if (/serieux|fiable|rigoureux|confiance/.test(normalized)) {
    return `${companyName} met en avant son sérieux et un accompagnement professionnel à chaque étape.`;
  }
  if (/proche|local|proximite|terrain/.test(normalized)) {
    return `${companyName} privilégie une relation de proximité et des échanges simples avec ses clients.`;
  }
  if (/ecoute|attentif|humain|conseil/.test(normalized)) {
    return `${companyName} prend le temps d’écouter le besoin avant de proposer une réponse adaptée.`;
  }
  return `${strength} fait partie des engagements mis en avant par ${companyName} pour accompagner ses clients.`;
}

function InrBadgeQr({ value, label }: { value: string; label: string }) {
  let matrix: boolean[][] = [];
  try {
    matrix = createInrBadgeQrMatrix(value);
  } catch {
    matrix = [];
  }
  if (!matrix.length) return null;

  const quietZone = 4;
  const viewBoxSize = matrix.length + quietZone * 2;
  const path = matrix
    .flatMap((row, rowIndex) =>
      row.map((dark, colIndex) =>
        dark ? `M${colIndex + quietZone},${rowIndex + quietZone}h1v1h-1z` : "",
      ),
    )
    .filter(Boolean)
    .join(" ");

  return (
    <svg className={styles.badgeQrSvg} viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={viewBoxSize} height={viewBoxSize} rx="2.5" className={styles.badgeQrBackground} />
      <path d={path} className={styles.badgeQrModules} />
    </svg>
  );
}

export default function InrSearchStrengthsOrbit({ companyName, strengths, inrBadgeUrl, inrBadgeQrUrl }: Props) {
  const i18nT = useTranslations("public");
  const normalizedStrengths = strengths.map((strength) => strength.trim()).filter(Boolean);
  const completedStrengths = [...normalizedStrengths];
  for (const fallback of DEFAULT_STRENGTHS) {
    if (completedStrengths.length >= NEWTON_SLOT_COUNT) break;
    if (!completedStrengths.some((strength) => strength.toLocaleLowerCase("fr-FR") === fallback.toLocaleLowerCase("fr-FR"))) {
      completedStrengths.push(fallback);
    }
  }
  const visibleStrengths = completedStrengths.slice(0, NEWTON_SLOT_COUNT);
  const cradleSlots = visibleStrengths;
  const [activeIndex, setActiveIndex] = useState(0);
  const [impulse, setImpulse] = useState(0);
  const activeStrength = cradleSlots[activeIndex] || visibleStrengths[0];
  const impulseDirection = activeIndex <= Math.floor(NEWTON_SLOT_COUNT / 2) ? "left" : "right";

  const activate = (index: number) => {
    if (!cradleSlots[index]) return;
    setActiveIndex(index);
    setImpulse((value) => value + 1);
  };

  return (
    <div className={styles.strengthOrbitExperience}>
      <div className={styles.strengthOrbitHeader}>
        <div>
          <span className={styles.strengthOrbitEyebrow}>{i18nT("confiance_en_mouvement_0260d16e")}</span>
          <h2 id="points-forts-title">{i18nT("les_points_forts_de_value_738c4c2a", { value0: companyName })}</h2>
          <p>{i18nT("decouvrez_les_qualites_et_engagements_que_c5e7d321", { value0: companyName })}</p>
        </div>
      </div>

      <div className={styles.strengthOrbitStage}>
        <div className={styles.strengthNewtonScene} data-direction={impulseDirection}>
          <div className={styles.strengthNewtonFrame} aria-hidden="true"><span /><span /></div>
          <div className={styles.strengthDesktopList} aria-label={i18nT("liste_des_points_forts_e4946a4f")}>
            {cradleSlots.map((strength, index) => (
              <button
                type="button"
                key={`${strength || "empty"}-desktop-list-${index}`}
                data-active={Boolean(strength) && index === activeIndex ? "true" : "false"}
                onClick={() => activate(index)}
                aria-current={Boolean(strength) && index === activeIndex ? "true" : undefined}
                disabled={!strength}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{strength}</strong>
              </button>
            ))}
          </div>
          <div
            className={styles.strengthNewtonBalls}
            key={impulse}
            data-direction={impulseDirection}
            role="list"
            aria-label={i18nT("points_forts_de_l_entreprise_92f8266f")}
          >
            <span className={styles.strengthNewtonImpulse} aria-hidden="true"><i /></span>
            {cradleSlots.map((strength, index) => (
              <button
                type="button"
                className={styles.strengthNewtonBall}
                data-active={Boolean(strength) && index === activeIndex ? "true" : "false"}
                data-filled={strength ? "true" : "false"}
                data-edge={index === 0 ? "left" : index === NEWTON_SLOT_COUNT - 1 ? "right" : "center"}
                key={`${strength || "empty"}-${index}`}
                onClick={() => activate(index)}
                role="listitem"
                aria-current={Boolean(strength) && index === activeIndex ? "true" : undefined}
                aria-disabled={strength ? undefined : true}
                disabled={!strength}
              >
                <span className={styles.strengthNewtonPendulum} aria-hidden="true">
                  <span className={styles.strengthNewtonString} />
                  <span className={styles.strengthNewtonSphere}><i>{strength ? String(index + 1).padStart(2, "0") : ""}</i></span>
                </span>
                <strong>{strength || ""}</strong>
              </button>
            ))}
          </div>

          <article className={styles.strengthNewtonDetail} aria-live="polite">
            <small>{i18nT("engagement_selectionne_a9da550d")}</small>
            <strong>{activeStrength}</strong>
            <p>{strengthDefinition(activeStrength || "", companyName)}</p>
            <span>{i18nT("un_engagement_mis_en_avant_par_2c973413")}</span>
          </article>
        </div>

        <aside className={styles.strengthBadgeCard}>
          <span className={styles.strengthBadgeHalo} aria-hidden="true" />
          <div className={styles.strengthBadgeLabel}><i /> {" "}{i18nT("passeport_inrbadge_14c9bcc1")}</div>
          {inrBadgeQrUrl ? (
            <a
              className={styles.strengthBadgeQr}
              href={inrBadgeUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-inrsearch-action="inrbadge"
              data-inrsearch-target={inrBadgeUrl}
              aria-label={i18nT("ouvrir_l_inrbadge_de_value_d8d65b8c", { value0: companyName })}
            >
              <InrBadgeQr value={inrBadgeQrUrl} label={i18nT("qr_code_inrbadge_de_value_d902c8a7", { value0: companyName })} />
            </a>
          ) : <span className={styles.strengthBadgeFallback}>{i18nT("inr_fe1e1b8a")}</span>}
          <small>{i18nT("scannez_pour_garder_le_contact_0a7fcd31")}</small>
          <strong>{companyName}</strong>
          {inrBadgeUrl ? (
            <a
              className={styles.strengthBadgeAction}
              href={inrBadgeUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-inrsearch-action="inrbadge"
              data-inrsearch-target={inrBadgeUrl}
            >
              {i18nT("ouvrir_l_inrbadge_682716ab")}{" "}<span aria-hidden="true">↗</span>
            </a>
          ) : null}
        </aside>
      </div>

      {normalizedStrengths.length > visibleStrengths.length ? (
        <div className={styles.strengthOrbitAll} aria-label={i18nT("tous_les_points_forts_0c2c917b")}>
          {normalizedStrengths.map((strength) => <span key={strength}>{strength}</span>)}
        </div>
      ) : null}
    </div>
  );
}
