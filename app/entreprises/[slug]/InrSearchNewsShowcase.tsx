"use client";

import { useTranslations } from "next-intl";


import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { InrSearchPublication } from "@/lib/inrSearchPublic";
import styles from "./inrSearchPublic.module.css";

type Props = {
  companyName: string;
  publications: InrSearchPublication[];
};

function formatDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function wrapIndex(index: number, length: number) {
  if (!length) return 0;
  return (index + length) % length;
}

function excerpt(value: string, max = 220) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const sliced = clean.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  return `${sliced.slice(0, lastSpace > max * 0.7 ? lastSpace : max).trim()}…`;
}

export default function InrSearchNewsShowcase({ companyName, publications }: Props) {
  const i18nT = useTranslations("public");
  const shellT = useTranslations("shell");
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const total = publications.length;
  const activePublication = publications[activeIndex] || publications[0];
  const activeImageUrls = useMemo(() => {
    if (!activePublication) return [];
    const urls = Array.isArray(activePublication.imageUrls)
      ? activePublication.imageUrls.filter(Boolean)
      : [];
    if (urls.length) return urls;
    return activePublication.imageUrl ? [activePublication.imageUrl] : [];
  }, [activePublication]);
  const activeImageCount = activeImageUrls.length;
  const normalizedActiveImageIndex = wrapIndex(
    activeImageIndex,
    activeImageCount,
  );
  const activeImageUrl =
    activeImageUrls[normalizedActiveImageIndex] || null;

  const move = useCallback((offset: number) => {
    if (!total) return;
    setActiveImageIndex(0);
    setActiveIndex((current) => wrapIndex(current + offset, total));
  }, [total]);

  const moveImage = useCallback((offset: number) => {
    if (!activeImageCount) return;
    setActiveImageIndex((current) =>
      wrapIndex(current + offset, activeImageCount),
    );
  }, [activeImageCount]);

  const openModal = useCallback(() => {
    if (!activePublication) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setModalOpen(true);
  }, [activePublication]);

  const onStageKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if ((event.key === "Enter" || event.key === " ") && activePublication) {
      event.preventDefault();
      openModal();
    }
  };

  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setModalOpen(false);
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
  }, [modalOpen, move]);

  const renderImageNavigation = (context: "stage" | "modal") =>
    activeImageCount > 1 ? (
      <div
        className={styles.newsOrbitImageNavigation}
        data-context={context}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            moveImage(-1);
          }}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label={shellT("image_precedente_635f9e95")}
        >
          ←
        </button>
        <output aria-live="polite">
          {normalizedActiveImageIndex + 1} / {activeImageCount}
        </output>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            moveImage(1);
          }}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label={shellT("image_suivante_656228da")}
        >
          →
        </button>
      </div>
    ) : null;

  return (
    <div className={styles.newsOrbitExperience}>
      <div className={styles.newsOrbitHeader}>
        <div>
          <span className={styles.newsOrbitEyebrow}>{i18nT("l_entreprise_en_mouvement_080a5c95")}</span>
          <h2 id="actualites-title">{i18nT("les_actualites_de_value_d3ad6de3", { value0: companyName })}</h2>
          <p>{i18nT("decouvrez_les_dernieres_nouvelles_realisations_e_3175ec71", { value0: companyName })}</p>
        </div>
        {total ? (
          <div className={styles.newsOrbitNavigator} aria-label={i18nT("naviguer_entre_les_actualites_85b38268")}>
            <button type="button" onClick={() => move(-1)} aria-label={i18nT("actualite_precedente_8a78294e")}>←</button>
            <span><strong>{String(activeIndex + 1).padStart(2, "0")}</strong><i>/</i>{String(total).padStart(2, "0")}</span>
            <button type="button" onClick={() => move(1)} aria-label={i18nT("actualite_suivante_7d6d1ce1")}>→</button>
          </div>
        ) : null}
      </div>

      {activePublication ? (
        <div
          className={styles.newsOrbitStage}
          tabIndex={0}
          onKeyDown={onStageKeyDown}
          aria-label={i18nT("actualites_de_l_entreprise_utilisez_les_fab2ee3c")}
        >
          <div className={styles.newsPulseGenerator} aria-hidden="true"><span /><span /><i /></div>

          <div
            className={styles.newsOrbitFocus}
            onClick={openModal}
          >
            <div className={styles.newsOrbitFocusMedia}>
              {activePublication.videoUrl ? (
                <video
                  className={styles.newsOrbitFocusVideo}
                  src={activePublication.videoUrl}
                  poster={activePublication.videoThumbnailUrl || activePublication.imageUrl || undefined}
                  controls
                  muted
                  autoPlay
                  loop
                  playsInline
                  preload="metadata"
                  aria-label={i18nT("video_de_l_actualite_value_3926fdf3", { value0: activePublication.title })}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              ) : activeImageUrl ? (
                <Image key={`${activePublication.id}-${normalizedActiveImageIndex}`} src={activeImageUrl} alt={`${activePublication.title} – ${companyName} – ${normalizedActiveImageIndex + 1}/${activeImageCount}`} width={1600} height={1000} sizes="(max-width: 900px) 92vw, 720px" loading="eager" unoptimized />
              ) : (
                <span className={styles.newsOrbitFallback} aria-hidden="true"><b>✦</b><i /></span>
              )}
              {!activePublication.videoUrl ? renderImageNavigation("stage") : null}
              {!activePublication.videoUrl ? <span className={styles.newsOrbitFocusShade} /> : null}
            </div>
            <span className={styles.newsOrbitFocusContent}>
              <span className={styles.newsOrbitFocusMeta}>
                <small>{i18nT("dernier_signal_e6e228e7")}</small>
                {activePublication.createdAt ? <time dateTime={activePublication.createdAt}>{formatDate(activePublication.createdAt)}</time> : null}
              </span>
              <strong>{activePublication.title}</strong>
              {activePublication.content ? <span className={styles.newsOrbitFocusExcerpt}>{excerpt(activePublication.content, 250)}</span> : null}
              <span className={styles.newsOrbitRead}>{i18nT("lire_l_actualite_e8ce9eb5")}{" "}<b aria-hidden="true">↗</b></span>
            </span>
          </div>

        </div>
      ) : (
        <div className={styles.newsOrbitEmpty} role="status">
          <div className={styles.newsOrbitEmptyGenerator} aria-hidden="true"><span /><span /><i /></div>
          <small>{i18nT("signal_en_preparation_34b14ef0")}</small>
          <h3>{i18nT("les_prochaines_nouvelles_seront_publiees_ici_c9e19910")}</h3>
          <p>{i18nT("value_partagera_prochainement_ses_actualites_et_ca82e74a", { value0: companyName })}</p>
        </div>
      )}

      {total ? (
        <div className={styles.newsOrbitRail} data-local-carousel role="list" aria-label={i18nT("chronologie_des_actualites_7762b0d3")}>
          {publications.map((publication, index) => (
            <button
              type="button"
              className={styles.newsOrbitRailItem}
              data-active={index === activeIndex ? "true" : "false"}
              key={`${publication.id}-rail`}
              onClick={() => {
                setActiveImageIndex(0);
                setActiveIndex(index);
              }}
              role="listitem"
              aria-label={i18nT("afficher_value_94359678", { value0: publication.title })}
              aria-current={index === activeIndex ? "true" : undefined}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <span className={styles.newsOrbitAccessibleContent}>{publication.content}</span>
            </button>
          ))}
        </div>
      ) : null}

      {typeof document !== "undefined" && modalOpen && activePublication
        ? createPortal(
            <div
              className={styles.newsOrbitModalBackdrop}
              id="news-orbit-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="news-orbit-modal-title"
              aria-describedby="news-orbit-modal-content"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) setModalOpen(false);
              }}
            >
              <button ref={closeButtonRef} type="button" className={styles.newsOrbitModalClose} onClick={() => setModalOpen(false)} aria-label={i18nT("fermer_l_actualite_4578ea68")}>×</button>
              <button type="button" className={`${styles.newsOrbitModalArrow} ${styles.newsOrbitModalArrowPrevious}`} onClick={() => move(-1)} aria-label={i18nT("actualite_precedente_8a78294e")}>←</button>
              <article className={styles.newsOrbitModal}>
                {activePublication.videoUrl ? (
                  <div className={styles.newsOrbitModalMedia}>
                    <video
                      key={activePublication.id}
                      controls
                      playsInline
                      preload="metadata"
                      poster={activePublication.videoThumbnailUrl || activePublication.imageUrl || undefined}
                      aria-label={i18nT("video_de_l_actualite_value_3926fdf3", { value0: activePublication.title })}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <source src={activePublication.videoUrl} type={activePublication.videoMime || "video/mp4"} />
                    </video>
                    <span />
                  </div>
                ) : activeImageUrl ? (
                  <div className={styles.newsOrbitModalMedia}><Image key={`${activePublication.id}-modal-${normalizedActiveImageIndex}`} src={activeImageUrl} alt={`${activePublication.title} – ${companyName} – ${normalizedActiveImageIndex + 1}/${activeImageCount}`} width={1800} height={1200} sizes="(max-width: 920px) 94vw, 70vw" unoptimized /><span />{renderImageNavigation("modal")}</div>
                ) : null}
                <div className={styles.newsOrbitModalContent}>
                  <span className={styles.newsOrbitModalKicker}>{i18nT("actualite_de_value_6ebd8b93", { value0: companyName })}</span>
                  {activePublication.createdAt ? <time dateTime={activePublication.createdAt}>{formatDate(activePublication.createdAt)}</time> : null}
                  <h2 id="news-orbit-modal-title">{activePublication.title}</h2>
                  <p id="news-orbit-modal-content">{activePublication.content}</p>
                  <span className={styles.newsOrbitModalCount}>{String(activeIndex + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
                </div>
              </article>
              <button type="button" className={`${styles.newsOrbitModalArrow} ${styles.newsOrbitModalArrowNext}`} onClick={() => move(1)} aria-label={i18nT("actualite_suivante_7d6d1ce1")}>→</button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
