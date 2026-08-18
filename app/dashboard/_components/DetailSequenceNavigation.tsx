"use client";

import { useTranslations } from "next-intl";


import styles from "./DetailSequenceNavigation.module.css";

type Props = {
  label: string;
  canPrevious: boolean;
  canNext: boolean;
  busy?: boolean;
  onPrevious: () => void | Promise<void>;
  onNext: () => void | Promise<void>;
  ariaLabel?: string;
};

export default function DetailSequenceNavigation({
  label,
  canPrevious,
  canNext,
  busy = false,
  onPrevious,
  onNext,
  ariaLabel = "Navigation entre les éléments",
}: Props) {
  const i18nT = useTranslations("shell");
  return (
    <div className={styles.root} aria-label={ariaLabel}>
      <button
        type="button"
        className={styles.button}
        onClick={() => void onPrevious()}
        disabled={busy || !canPrevious}
        aria-label={i18nT("element_precedent_358f9c1e")}
        title={i18nT("precedent_a527f171")}
      >
        ‹
      </button>
      <span className={styles.counter} aria-live="polite">
        {busy ? "…" : label}
      </span>
      <button
        type="button"
        className={styles.button}
        onClick={() => void onNext()}
        disabled={busy || !canNext}
        aria-label={i18nT("element_suivant_9d61e569")}
        title={i18nT("suivant_596d29a7")}
      >
        ›
      </button>
    </div>
  );
}
