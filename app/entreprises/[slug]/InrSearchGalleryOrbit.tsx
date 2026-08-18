"use client";

import { useTranslations } from "next-intl";


import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import styles from "./inrSearchPublic.module.css";

type GalleryMedia = {
  id: string;
  title: string;
  url: string;
};

type Props = {
  companyName: string;
  profession: string;
  city: string;
  services: string[];
  zones: string[];
  media: GalleryMedia[];
};

function wrapIndex(index: number, length: number) {
  if (!length) return 0;
  return (index + length) % length;
}

function uniqueLabels(values: string[]) {
  return Array.from(new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean)));
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildMediaTitles(
  media: GalleryMedia[],
  companyName: string,
  profession: string,
  city: string,
  services: string[],
  zones: string[],
) {
  const servicePool = uniqueLabels(services.length ? services : [profession]);
  const zonePool = uniqueLabels(zones.length ? zones : [city]);
  const combinationCount = Math.max(servicePool.length, 1) * Math.max(zonePool.length, 1);
  const usedCombinations = new Set<number>();

  return media.map((item, index) => {
    const initialCombination = stableHash(`${companyName}:${item.id}`) % combinationCount;
    let combination = initialCombination;

    for (let attempt = 0; attempt < combinationCount; attempt += 1) {
      const candidate = (initialCombination + attempt) % combinationCount;
      if (!usedCombinations.has(candidate)) {
        combination = candidate;
        usedCombinations.add(candidate);
        break;
      }
    }

    const service = servicePool.length ? servicePool[combination % servicePool.length] : "";
    const zoneIndex = servicePool.length
      ? Math.floor(combination / servicePool.length)
      : combination;
    const zone = zonePool.length ? zonePool[zoneIndex % zonePool.length] : "";
    const subject = [service || profession, zone ? `à ${zone}` : ""].filter(Boolean).join(" ");
    const baseTitle = subject
      ? subject
      : `Réalisation de ${companyName}`;

    return index < combinationCount
      ? baseTitle
      : `${baseTitle} · ${String(index + 1).padStart(2, "0")}`;
  });
}

export default function InrSearchGalleryOrbit({
  companyName,
  profession,
  city,
  services,
  zones,
  media,
}: Props) {
  const i18nT = useTranslations("public");
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const total = media.length;
  const activeMedia = media[activeIndex] || media[0];
  const mediaTitles = buildMediaTitles(media, companyName, profession, city, services, zones);
  const activeTitle = mediaTitles[activeIndex] || `Réalisation de ${companyName}`;
  const context = [profession, city].filter(Boolean).join(" · ");

  const move = useCallback((offset: number) => {
    setActiveIndex((current) => wrapIndex(current + offset, total));
  }, [total]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setLightboxOpen(false);
      if (event.key === "ArrowRight") move(1);
      if (event.key === "ArrowLeft") move(-1);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
  }, [lightboxOpen, move]);

  const openLightbox = () => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setLightboxOpen(true);
  };

  const onStageKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openLightbox();
    }
  };

  return (
    <div className={styles.galleryOrbitExperience}>
      <div className={styles.galleryOrbitHeader}>
        <div>
          <span className={styles.galleryOrbitEyebrow}>{i18nT("observatoire_creatif_b85cabe2")}</span>
          <h2 id="realisations-title">{i18nT("les_realisations_de_value_71b2c270", { value0: companyName })}</h2>
          <p>{i18nT("parcourez_les_photos_de_value_pour_cc3adef6", { value0: companyName })}</p>
        </div>
        <div className={styles.galleryOrbitCounter} aria-label={i18nT("navigation_dans_la_galerie_d7ebd2cd")}>
          <button type="button" onClick={() => move(-1)} aria-label={i18nT("realisation_precedente_4e3eb3f6")}>←</button>
          <span><strong>{String(activeIndex + 1).padStart(2, "0")}</strong><i>/</i>{String(total).padStart(2, "0")}</span>
          <button type="button" onClick={() => move(1)} aria-label={i18nT("realisation_suivante_651c82ac")}>→</button>
        </div>
      </div>

      <div
        className={styles.galleryOrbitStage}
        tabIndex={0}
        onKeyDown={onStageKeyDown}
        aria-label={i18nT("observatoire_des_realisations_utilisez_les_flech_a58b0d19")}
      >
        <div className={styles.galleryOrbitAperture} aria-hidden="true"><span /><span /><span /></div>

        <button
          type="button"
          className={styles.galleryOrbitFocus}
          onClick={openLightbox}
          aria-label={i18nT("agrandir_value_c5fb7dc9", { value0: activeTitle })}
          aria-haspopup="dialog"
          aria-controls="gallery-lightbox"
        >
          <span className={styles.galleryOrbitFocusGlow} aria-hidden="true" />
          {activeMedia ? <Image src={activeMedia.url} alt={activeTitle} width={1600} height={1000} sizes="(max-width: 900px) 92vw, 650px" loading="eager" unoptimized /> : null}
          <span className={styles.galleryOrbitFocusShade} />
        </button>

        <article className={styles.galleryOrbitMeta} aria-live="polite">
          <span className={styles.galleryOrbitMetaSignal}><i /> {" "}{i18nT("signal_27bed13a")}{" "}{String(activeIndex + 1).padStart(2, "0")}</span>
          <small>{context || i18nT("realisation_3c113b14")}</small>
          <h3>{activeTitle}</h3>
          <p>{i18nT("cette_photo_vous_permet_de_mieux_fc6e4c78", { value0: companyName })}</p>
          <button type="button" onClick={openLightbox}>{i18nT("voir_en_plein_ecran_f3c9424d")}{" "}<span aria-hidden="true">↗</span></button>
        </article>

        <div className={styles.galleryOrbitTrajectory} aria-hidden="true"><span /></div>
      </div>

      <div className={styles.galleryOrbitRail} data-local-carousel role="list" aria-label={i18nT("toutes_les_realisations_be2a832b")}>
        {media.map((item, index) => {
          const itemTitle = mediaTitles[index] || `Réalisation de ${companyName}`;
          return (
            <button
              type="button"
              className={styles.galleryOrbitRailItem}
              data-active={activeIndex === index ? "true" : "false"}
              key={`${item.id}-rail`}
              onClick={() => setActiveIndex(index)}
              role="listitem"
              aria-label={i18nT("afficher_value_94359678", { value0: itemTitle })}
            >
              <Image src={item.url} alt={`${itemTitle} — ${companyName}`} width={320} height={220} sizes="128px" loading="lazy" unoptimized />
              <span>{itemTitle}</span>
            </button>
          );
        })}
      </div>

      {typeof document !== "undefined" && lightboxOpen && activeMedia
        ? createPortal(
            <div
              className={styles.galleryLightbox}
              id="gallery-lightbox"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gallery-lightbox-title"
              aria-describedby="gallery-lightbox-context"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) setLightboxOpen(false);
              }}
            >
              <button ref={closeButtonRef} type="button" className={styles.galleryLightboxClose} onClick={() => setLightboxOpen(false)} aria-label={i18nT("fermer_la_galerie_cc4d5290")}>×</button>
              <button type="button" className={`${styles.galleryLightboxArrow} ${styles.galleryLightboxArrowPrevious}`} onClick={() => move(-1)} aria-label={i18nT("realisation_precedente_4e3eb3f6")}>←</button>
              <figure className={styles.galleryLightboxFigure}>
                <Image src={activeMedia.url} alt={activeTitle} width={1800} height={1200} sizes="86vw" unoptimized />
                <figcaption>
                  <small id="gallery-lightbox-context">{context || companyName}</small>
                  <strong id="gallery-lightbox-title">{activeTitle}</strong>
                  <span>{String(activeIndex + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
                </figcaption>
              </figure>
              <button type="button" className={`${styles.galleryLightboxArrow} ${styles.galleryLightboxArrowNext}`} onClick={() => move(1)} aria-label={i18nT("realisation_suivante_651c82ac")}>→</button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
