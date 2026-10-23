"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import css from "./MediaPoolImagePreview.module.css";

export default function MediaPoolImagePreview({ images, initialIndex, onClose }: {
  images: { src: string; name: string }[];
  initialIndex: number;
  onClose: () => void;
}) {
  const t = useTranslations("shell");
  const [index, setIndex] = useState(initialIndex);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const count = images.length;
  const currentIndex = Math.min(index, Math.max(0, count - 1));
  const current = images[currentIndex];

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      const activeDialog = document.activeElement?.closest('[aria-modal="true"]');
      if (!dialog || (activeDialog && activeDialog !== dialog)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      } else if (count > 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setIndex((value) => (value + (event.key === "ArrowLeft" ? -1 : 1) + count) % count);
      } else if (event.key === "Tab") {
        const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const first = buttons[0];
        const last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [count, onClose]);

  if (!current) return null;
  return createPortal(
    <div className={css.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className={css.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} data-gallery={count > 1}>
        <header className={css.header}>
          <h2 id={titleId} title={current.name}>{current.name}</h2>
          <span className={css.counter} aria-live="polite">{currentIndex + 1} / {count}</span>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("fermer_5ab4ec64")}>×</button>
        </header>
        <div className={css.visual}>
          <img src={current.src} alt={current.name} draggable={false} />
          {count > 1 ? <>
            <button className={css.previous} type="button" onClick={() => setIndex((currentIndex - 1 + count) % count)} aria-label={t("voir_l_image_value_71740aa0", { value0: (currentIndex - 1 + count) % count + 1 })}>‹</button>
            <button className={css.next} type="button" onClick={() => setIndex((currentIndex + 1) % count)} aria-label={t("voir_l_image_value_71740aa0", { value0: (currentIndex + 1) % count + 1 })}>›</button>
          </> : null}
        </div>
        {count > 1 ? <div className={css.thumbnails}>
          {images.map((image, imageIndex) => <button key={`${image.src}-${imageIndex}`} type="button" aria-label={t("voir_l_image_value_71740aa0", { value0: imageIndex + 1 })} aria-pressed={imageIndex === currentIndex} onClick={() => setIndex(imageIndex)}>
            <img src={image.src} alt="" draggable={false} />
            <span aria-hidden="true">{imageIndex + 1}</span>
          </button>)}
        </div> : null}
      </section>
    </div>,
    document.body,
  );
}
