"use client";

import { useTranslations } from "next-intl";


import styles from "./documents.module.css";
import {
  DocumentDateInput,
  type ServiceDateMode,
} from "./documentEditorShared";

type ServiceDateFieldsProps = {
  radioName: string;
  mode: ServiceDateMode;
  onModeChange: (mode: ServiceDateMode) => void;
  serviceDate: string;
  onServiceDateChange: (value: string) => void;
  servicePeriodStart: string;
  onServicePeriodStartChange: (value: string) => void;
  servicePeriodEnd: string;
  onServicePeriodEndChange: (value: string) => void;
  disabled?: boolean;
};

export function ServiceDateFields({
  radioName,
  mode,
  onModeChange,
  serviceDate,
  onServiceDateChange,
  servicePeriodStart,
  onServicePeriodStartChange,
  servicePeriodEnd,
  onServicePeriodEndChange,
  disabled = false,
}: ServiceDateFieldsProps) {
  const i18nT = useTranslations("documents");
  return (
    <>
      <div
        className={styles.serviceDateModeSelector}
        role="radiogroup"
        aria-label={i18nT("type_de_date_de_prestation_22fb0ba7")}
      >
        <label
          className={`${styles.serviceDateModeOption} ${mode === "single" ? styles.serviceDateModeOptionActive : ""}`}
        >
          <input
            type="radio"
            name={radioName}
            value="single"
            checked={mode === "single"}
            onChange={() => onModeChange("single")}
            disabled={disabled}
          />
          <span>{i18nT("date_unique_8271a6b5")}</span>
        </label>
        <label
          className={`${styles.serviceDateModeOption} ${mode === "period" ? styles.serviceDateModeOptionActive : ""}`}
        >
          <input
            type="radio"
            name={radioName}
            value="period"
            checked={mode === "period"}
            onChange={() => onModeChange("period")}
            disabled={disabled}
          />
          <span>{i18nT("periode_de2110b7")}</span>
        </label>
      </div>

      {mode === "single" ? (
        <div className={styles.serviceDateSingleGrid}>
          <div className={styles.field}>
            <label>{i18nT("date_de_prestation_livraison_8a003167")}</label>
            <DocumentDateInput
              value={serviceDate}
              onChange={onServiceDateChange}
              disabled={disabled}
            />
          </div>
        </div>
      ) : (
        <div className={styles.serviceDateFieldsGrid}>
          <div className={styles.field}>
            <label>{i18nT("debut_de_prestation_faf6fc94")}</label>
            <DocumentDateInput
              value={servicePeriodStart}
              onChange={onServicePeriodStartChange}
              disabled={disabled}
            />
          </div>
          <div className={styles.field}>
            <label>{i18nT("fin_de_prestation_5ccfc947")}</label>
            <DocumentDateInput
              value={servicePeriodEnd}
              onChange={onServicePeriodEndChange}
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </>
  );
}

type NotesAndMentionsSectionProps = {
  notes: string;
  onNotesChange: (value: string) => void;
  mentionLabel: string;
  mention: string;
  onMentionChange: (value: string) => void;
  mentionPlaceholder: string;
  disabled?: boolean;
};

export function NotesAndMentionsSection({
  notes,
  onNotesChange,
  mentionLabel,
  mention,
  onMentionChange,
  mentionPlaceholder,
  disabled = false,
}: NotesAndMentionsSectionProps) {
  const i18nT = useTranslations("documents");
  return (
    <div className={styles.advancedSection}>
      <div className={styles.advancedSectionTitle}>{i18nT("notes_mentions_362f2f26")}</div>
      <div className={styles.twoCol}>
        <div className={styles.field}>
          <label>{i18nT("notes_70440046")}</label>
          <textarea
            className={styles.advancedTextArea}
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder={i18nT("ex_merci_pour_votre_confiance_2a2ef0a8")}
            disabled={disabled}
          />
        </div>
        <div className={styles.field}>
          <label>{mentionLabel}</label>
          <textarea
            className={styles.advancedTextArea}
            value={mention}
            onChange={(event) => onMentionChange(event.target.value)}
            placeholder={mentionPlaceholder}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
