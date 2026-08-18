"use client";

import { useTranslations } from "next-intl";


import Image from "next/image";
import { useMemo, useState, type CSSProperties } from "react";
import InrSearchLogo from "./InrSearchLogo";
import styles from "./inrSearchPublic.module.css";

type SocialLink = {
  key: string;
  label: string;
  url: string;
};

type Props = {
  companyName: string;
  logoUrl: string;
  profession: string;
  city: string;
  links: SocialLink[];
};

type OrbitStyle = CSSProperties & {
  "--social-angle": string;
  "--social-speed": string;
  "--social-distance": string;
};

const NETWORK_ICONS: Record<string, string> = {
  google: "/icons/google.jpg",
  facebook: "/icons/facebook.png",
  instagram: "/icons/instagram.jpg",
  linkedin: "/icons/linkedin.png",
  tiktok: "/icons/tiktok.png",
  youtube: "/icons/youtube-shorts.png",
  pinterest: "/icons/pinterest-logo-128.png",
};

export default function InrSearchSocialOrbit({ companyName, logoUrl, profession, city, links }: Props) {
  const i18nT = useTranslations("public");
  const [activeIndex, setActiveIndex] = useState(0);
  const activeLink = links[activeIndex] || links[0];
  const total = links.length;

  const planets = useMemo(() => {
    return links.map((link, index) => {
      const ring = index % 3;
      // Une couronne synchronisée conserve un écart constant entre toutes les
      // planètes : elles tournent vraiment, sans jamais se superposer.
      const phase = (index * 360) / Math.max(1, links.length);
      const distance = "clamp(174px, 17vw, 220px)";
      const speed = 34;
      return { link, index, ring, phase, distance, speed };
    });
  }, [links]);

  return (
    <div className={styles.socialOrbitExperience}>
      <div className={styles.socialOrbitHeader}>
        <div>
          <span className={styles.socialOrbitEyebrow}>{i18nT("systeme_solaire_numerique_4e1f35c0")}</span>
          <h2>{i18nT("presence_en_ligne_de_value_c04e82ab", { value0: companyName })}</h2>
          <p>{i18nT("retrouvez_value_sur_son_site_internet_3da59f2d", { value0: companyName })}</p>
        </div>
        <span className={styles.socialOrbitCount}><strong>{String(total).padStart(2, "0")}</strong> {" "}{i18nT("presence_7367bf2b")}{total > 1 ? "s" : ""} {" "}{i18nT("en_ligne_84b3c260")}</span>
      </div>

      <div className={styles.socialOrbitStage}>
        <div className={styles.socialSolarSystem} role="list" aria-label={i18nT("presence_en_ligne_de_l_entreprise_7ca041fe")}>
          <div className={styles.socialOrbitRings} aria-hidden="true"><span /><span /><span /></div>
          <div className={styles.socialOrbitCore}>
            <span className={styles.socialOrbitCoreGlow} aria-hidden="true" />
            <InrSearchLogo
              src={logoUrl}
              alt=""
              companyName={companyName}
              width={132}
              height={132}
              fallbackClassName={styles.socialOrbitFallback}
            />
            <small>{profession || i18nT("entreprise_d03e74b6")}</small>
            <strong>{companyName}</strong>
            {city ? <em>{city}</em> : null}
          </div>

          <div className={styles.socialOrbitNodes}>
            {planets.map(({ link, index, ring, phase, distance, speed }) => {
              const style: OrbitStyle = {
                "--social-angle": `${phase}deg`,
                "--social-speed": `${speed}s`,
                "--social-distance": distance,
              };
              const icon = NETWORK_ICONS[link.key];
              return (
                <div className={styles.socialOrbitTrack} data-ring={ring} style={style} key={link.key}>
                  <a
                    className={styles.socialOrbitNode}
                    data-network={link.key}
                    data-active={index === activeIndex ? "true" : "false"}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    role="listitem"
                    data-inrsearch-action={link.key}
                    data-inrsearch-target={link.url}
                    onMouseEnter={() => setActiveIndex(index)}
                    onFocus={() => setActiveIndex(index)}
                  >
                    <span className={`${styles.socialOrbitGlyph} ${styles[`social_${link.key}`] || ""}`}>
                      {icon ? <Image src={icon} alt="" width={38} height={38} /> : link.key === "website" ? "◎" : link.label.slice(0, 1).toUpperCase()}
                    </span>
                    <strong>{link.label}</strong>
                  </a>
                </div>
              );
            })}
          </div>
        </div>

        {activeLink ? (
          <aside className={styles.socialOrbitDetail} aria-live="polite">
            <span className={`${styles.socialOrbitDetailGlyph} ${styles[`social_${activeLink.key}`] || ""}`}>
              {NETWORK_ICONS[activeLink.key] ? <Image src={NETWORK_ICONS[activeLink.key]} alt="" width={48} height={48} /> : activeLink.key === "website" ? "◎" : activeLink.label.slice(0, 1).toUpperCase()}
            </span>
            <small>{i18nT("planete_selectionnee_0c005848")}</small>
            <strong>{activeLink.label}</strong>
            <p>{i18nT("consultez_value_pour_decouvrir_les_contenus_20c3952b", { value0: activeLink.label, value1: companyName })}</p>
            <a href={activeLink.url} target="_blank" rel="noopener noreferrer" data-inrsearch-action={activeLink.key} data-inrsearch-target={activeLink.url}>
              {i18nT("decouvrir_8969b8d1")}{" "}<span aria-hidden="true">↗</span>
            </a>
            <div className={styles.socialOrbitDetailCoordinates} aria-hidden="true"><span /> ORBITE {String(activeIndex + 1).padStart(2, "0")}</div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
