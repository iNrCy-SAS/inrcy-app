import { useTranslations } from "next-intl";
import React from "react";
import styles from "../mails.module.css";

type MailboxSearchPanelProps = {
  open: boolean;
  value: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onClose: () => void;
  onClear: () => void;
};

export default function MailboxSearchPanel({ open, value, inputRef, onChange, onClose, onClear }: MailboxSearchPanelProps) {
  const i18nT = useTranslations("mails");
  if (!open) return null;

  return (
    <div className={styles.searchPanel}>
      <div className={styles.searchPanelInner}>
        <input
          ref={inputRef}
          className={styles.searchInputInline}
          placeholder={i18nT("rechercher_un_envoi_5200f657")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {value.trim() ? (
          <button
            className={styles.searchClearBtn}
            type="button"
            onClick={onClear}
            title={i18nT("effacer_fe23de7b")}
            aria-label={i18nT("effacer_fe23de7b")}
          >
            ×
          </button>
        ) : null}
        <button
          className={styles.searchCloseBtn}
          type="button"
          onClick={onClose}
          title={i18nT("fermer_5ab4ec64")}
          aria-label={i18nT("fermer_5ab4ec64")}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
