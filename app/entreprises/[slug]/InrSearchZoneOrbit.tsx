"use client";

import { useTranslations } from "next-intl";


import { useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import styles from "./inrSearchPublic.module.css";

type Props = {
  companyName: string;
  city: string;
  profession: string;
  zones: string[];
};

type ZoneStyle = CSSProperties & {
  "--zone-angle": string;
  "--zone-distance": string;
  "--zone-accent": string;
};

const ZONE_ACCENTS = ["#38dcff", "#7b61ff", "#e95cff", "#4d92ff", "#36d8b5", "#ff9a62", "#ffd45f"];

function wrapIndex(index: number, length: number) {
  if (!length) return 0;
  return (index + length) % length;
}

function isDepartmentZone(zone: string) {
  return zone.toLocaleLowerCase("fr-FR").startsWith("département") || zone.toLocaleLowerCase("fr-FR").startsWith("departement");
}

function zoneName(zone: string) {
  return isDepartmentZone(zone) ? zone.replace(/^d[ée]partement\s*:\s*/i, "") : zone;
}

function zoneLayoutKey(zone: string) {
  const normalized = zoneName(zone)
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (normalized.includes("saint-nicolas")) return "saint-nicolas";
  if (normalized.includes("harnes")) return "harnes";
  if (normalized.includes("beaurains")) return "beaurains";
  if (normalized.includes("arras")) return "arras";
  if (normalized.includes("lens")) return "lens";
  if (isDepartmentZone(zone)) return "department";
  return "other";
}

function zoneStatus(zone: string, active: boolean, i18nT: (key: string) => string) {
  if (isDepartmentZone(zone)) return active ? i18nT("couverture_elargie_76d5864b") : i18nT("departement_3d7c87c2");
  return active ? i18nT("signal_actif_58c288e3") : i18nT("selectionner_ab31a36f");
}

function zoneActionText(zone: string, companyName: string, i18nT: (key: string, values?: Record<string, string>) => string) {
  if (isDepartmentZone(zone)) {
    return i18nT("contactez_value_pour_verifier_si_votre_6d0002ac", { value0: companyName });
  }
  return i18nT("vous_etes_a_value_presentez_votre_30978146", { value0: zone, value1: companyName });
}

export default function InrSearchZoneOrbit({ companyName, city, profession, zones }: Props) {
  const i18nT = useTranslations("public");
  const [activeIndex, setActiveIndex] = useState(0);
  const total = zones.length;
  const activeZone = zones[activeIndex] || zones[0] || city;

  const radarZones = useMemo(
    () =>
      zones.map((zone, index) => {
        const divisor = Math.min(total, 7);
        const visible = index < divisor;
        const position = index;
        const angle = divisor > 1
          ? -90 + 180 / divisor + (position * 360) / divisor
          : -90;
        const distance = "clamp(155px, 14vw, 195px)";
        return { zone, index, visible, angle, distance, position };
      }),
    [total, zones],
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
    <div className={styles.zoneOrbitExperience} onKeyDown={onKeyDown}>
      <div className={styles.zoneOrbitHeader}>
        <div>
          <span className={styles.zoneOrbitEyebrow}>{i18nT("radar_d_intervention_1c282298")}</span>
          <h2 id="zones-title">{i18nT("zone_d_intervention_de_value_fdb08d0c", { value0: companyName })}</h2>
          <p>{i18nT("consultez_les_villes_et_secteurs_couverts_e3600761", { value0: companyName })}</p>
        </div>
        <div className={styles.zoneOrbitNavigator} aria-label={i18nT("naviguer_entre_les_zones_d_intervention_d2676485")}>
          <button type="button" onClick={() => move(-1)} aria-label={i18nT("zone_precedente_b7e21ec3")}>←</button>
          <span><strong>{String(activeIndex + 1).padStart(2, "0")}</strong> / {String(total).padStart(2, "0")}</span>
          <button type="button" onClick={() => move(1)} aria-label={i18nT("zone_suivante_c4b2069d")}>→</button>
        </div>
      </div>

      <div className={styles.zoneOrbitStage} tabIndex={0} aria-label={i18nT("radar_des_zones_d_intervention_b33a4712")}>
        <div className={styles.zoneRadarCanvas}>
          <div className={styles.zoneOrbitRadar} aria-hidden="true"><span /><span /><span /><i /></div>
          <div className={styles.zoneOrbitCore}>
            <span className={styles.zoneOrbitCorePulse} aria-hidden="true" />
            <small>{i18nT("point_d_ancrage_083608b0")}</small>
            <strong>{city || activeZone}</strong>
            <em>{profession || i18nT("zone_principale_8fb59c5f")}</em>
          </div>

          <div className={styles.zoneOrbitSatellites} role="list" aria-label={i18nT("communes_desservies_sur_le_radar_a704309d")}>
            {radarZones.map(({ zone, index, visible, angle, distance, position }) => {
              const active = index === activeIndex;
              const style: ZoneStyle = {
                "--zone-angle": `${angle}deg`,
                "--zone-distance": distance,
                "--zone-accent": ZONE_ACCENTS[index % ZONE_ACCENTS.length],
              };
              return (
                <button
                  type="button"
                  className={styles.zoneOrbitSatellite}
                  data-active={active ? "true" : "false"}
                  data-orbit-position={String(position)}
                  data-zone-key={zoneLayoutKey(zone)}
                  data-visible={visible ? "true" : "false"}
                  style={style}
                  key={`${zone}-${index}`}
                  onClick={() => setActiveIndex(index)}
                  aria-current={active ? "true" : undefined}
                  aria-hidden={visible ? undefined : true}
                  tabIndex={visible ? 0 : -1}
                  aria-label={i18nT("afficher_la_zone_value_5453dc1e", { value0: zone })}
                  role="listitem"
                >
                  <span aria-hidden="true" />
                  <strong>{zoneName(zone)}</strong>
                  <small>{zoneStatus(zone, active, i18nT)}</small>
                </button>
              );
            })}
          </div>
        </div>

        <aside className={styles.zoneOrbitDetail} aria-live="polite">
          <span className={styles.zoneOrbitDetailIndex}>{String(activeIndex + 1).padStart(2, "0")}</span>
          <small>{i18nT("zone_selectionnee_763e64b2")}</small>
          <strong>{zoneName(activeZone)}</strong>
          <p>{zoneActionText(activeZone, companyName, i18nT)}</p>
          <a href="#contact" data-inrsearch-contact-trigger data-inrsearch-action="zone_contact" data-inrsearch-target="#contact-modal">
            {i18nT("presenter_mon_besoin_7ee41902")}{" "}<span aria-hidden="true">↗</span>
          </a>
          <div className={styles.zoneOrbitDetailPulse} aria-hidden="true"><span /><span /><span /></div>
        </aside>
      </div>

      <div className={styles.zoneOrbitRail} data-local-carousel aria-label={i18nT("toutes_les_zones_d_intervention_707112fd")}>
        {zones.map((zone, index) => (
          <button type="button" data-active={index === activeIndex ? "true" : "false"} key={`${zone}-rail`} onClick={() => setActiveIndex(index)}>
            <span /> {zone}
          </button>
        ))}
      </div>
      <div className={styles.zoneMobileSelector} aria-label={i18nT("selecteur_compact_des_zones_d_intervention_982e3d92")}>
        <div className={styles.mobileSelectorActive} aria-live="polite">
          <span>{String(activeIndex + 1).padStart(2, "0")}</span>
          <i aria-hidden="true" />
          <strong>{zoneName(activeZone)}</strong>
        </div>
        <div className={styles.mobileSelectorChoices}>
          {zones.map((zone, index) => index === activeIndex ? null : (
            <button
              type="button"
              key={`${zone}-mobile-index`}
              onClick={() => setActiveIndex(index)}
              aria-label={i18nT("afficher_la_zone_value_value_a57d386f", { value0: String(index + 1).padStart(2, "0"), value1: zoneName(zone) })}
              title={zoneName(zone)}
            >
              {String(index + 1).padStart(2, "0")}
            </button>
          ))}
        </div>
      </div>
      <p className={styles.zoneOrbitSeoCopy}>{i18nT("zone_d_intervention_de_value_value_89f67fe9", { value0: companyName, value1: zones.join(", ") })}</p>
    </div>
  );
}
