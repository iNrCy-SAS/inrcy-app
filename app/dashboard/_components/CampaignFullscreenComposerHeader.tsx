"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import type { AiPreferredEngine } from "@/lib/aiEnginePreference";
import TemplateAiEngineSelector from "./TemplateAiEngineSelector";
import styles from "./CampaignFullscreenComposerHeader.module.css";

export type CampaignTemplateOption = {
  value: string;
  label: string;
};

type CampaignFullscreenComposerHeaderProps = {
  subject: string;
  onSubjectChange: (value: string) => void;
  selectedKey: string;
  onTemplateChange: (value: string) => void;
  options: CampaignTemplateOption[];
  aiEngine: AiPreferredEngine;
  defaultAiEngine: AiPreferredEngine;
  onAiEngineChange: (value: AiPreferredEngine) => void;
  aiGenerating: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  error?: string;
};

export default function CampaignFullscreenComposerHeader({
  subject,
  onSubjectChange,
  selectedKey,
  onTemplateChange,
  options,
  aiEngine,
  defaultAiEngine,
  onAiEngineChange,
  aiGenerating,
  canGenerate,
  onGenerate,
  error = "",
}: CampaignFullscreenComposerHeaderProps) {
  const i18nT = useTranslations("growth");
  const subjectId = useId();
  const templateId = useId();

  return (
    <section className={styles.shell} aria-label={i18nT("generer_avec_inrcy_58900495")}>
      <label className={`${styles.field} ${styles.subjectField}`} htmlFor={subjectId}>
        <span className={styles.label}>{i18nT("objet_3de621c5")}</span>
        <input
          id={subjectId}
          value={subject}
          onChange={(event) => onSubjectChange(event.target.value)}
          placeholder={i18nT("objet_3de621c5")}
          className={styles.control}
          autoComplete="off"
        />
      </label>

      <label className={styles.field} htmlFor={templateId}>
        <span className={styles.label}>{i18nT("modele_dedie_c1a52e79")}</span>
        <select
          id={templateId}
          value={selectedKey}
          onChange={(event) => onTemplateChange(event.target.value)}
          aria-label={i18nT("choisir_un_modele_426a410c")}
          className={styles.control}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.engineField}>
        <TemplateAiEngineSelector
          value={aiEngine}
          defaultValue={defaultAiEngine}
          onChange={onAiEngineChange}
          disabled={aiGenerating}
          isMobile
        />
      </div>

      <div className={styles.generateField}>
        <span className={styles.label} aria-hidden="true">
          &nbsp;
        </span>
        <button
          type="button"
          className={styles.generateButton}
          onClick={onGenerate}
          disabled={aiGenerating || !canGenerate}
          aria-busy={aiGenerating}
        >
          {aiGenerating
            ? i18nT("generation_ce4e3498")
            : i18nT("generer_avec_inrcy_58900495")}
        </button>
      </div>

      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}
