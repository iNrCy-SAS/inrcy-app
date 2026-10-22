"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AI_MEDIA_INSPIRATION_MAX_COUNT } from "@/lib/aiMediaGenerationContracts";
import styles from "./MediaGenerator.module.css";
import sharedStyles from "./MediaReferenceInputs.module.css";

export type MediaReferenceInputItem = {
  id: string; name?: string; previewUrl: string;
  role?: "character" | "environment" | "product" | "inspiration";
  usage?: "required" | "inspiration";
};

/** Shared insertion controls. The consumer owns storage, consent and scope. */
export default function MediaReferenceInputs(props: {
  references: MediaReferenceInputItem[];
  accept: string;
  disabled?: boolean;
  compact?: boolean;
  information?: ReactNode;
  characterVoices?: boolean;
  onFiles: (files: File[]) => void;
  onLibrary: () => void;
  onRemove: (index: number) => void;
  onRole: (index: number, role: "character" | "environment" | "product") => void;
  onUsage: (index: number, usage: "required" | "inspiration") => void;
  renderExtra?: (index: number) => ReactNode;
}) {
  const inputId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeId = props.references.some((item) => item.id === selectedId) ? selectedId : props.references[0]?.id;
  const t = useTranslations("media");
  const full = props.references.length >= AI_MEDIA_INSPIRATION_MAX_COUNT;
  const disabled = props.disabled || full;
  return <div className={sharedStyles.root} data-media-reference-inputs data-compact={props.compact || undefined}>
    <div className={`${styles.referenceDropzone} ${sharedStyles.dropzone}`} data-has-files={props.references.length ? "true" : "false"}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); if (!disabled) props.onFiles(Array.from(event.dataTransfer.files)); }}>
      <label className={styles.referenceDropzoneIcon} htmlFor={inputId} aria-label={t("ai_generator_free_import")}>+</label>
      <div className={styles.referenceDropzoneCopy}>
        <div className={styles.referenceDropzoneHeading}>
          <strong>{t("ai_generator_reference_drop_title")}</strong>
          {props.information ? <details className={styles.referenceInfo}>
            <summary aria-label={t("ai_generator_reference_information")}>i</summary><p>{props.information}</p>
          </details> : null}
        </div>
        <small>{t("ai_generator_reference_drop_hint")} · {props.references.length}/{AI_MEDIA_INSPIRATION_MAX_COUNT}</small>
      </div>
      <span className={styles.referenceDropzoneActions}>
        <label htmlFor={inputId}>{t("ai_generator_free_import")}</label>
        <input id={inputId} type="file" accept={props.accept} multiple disabled={disabled}
          onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; if (files.length) props.onFiles(files); }} />
        <button type="button" disabled={disabled} onClick={props.onLibrary}>{t("ai_generator_free_library")}</button>
      </span>
    </div>
    {props.compact && props.references.length > 1 ? <div className={sharedStyles.referenceTabs} aria-label={t("ai_generator_free_references_title")}>
      {props.references.map((reference, index) => <button key={reference.id} type="button" aria-pressed={activeId === reference.id}
        aria-label={t("ai_generator_free_reference", { index: index + 1 })} onClick={() => setSelectedId(reference.id)}>
        <img src={reference.previewUrl} alt="" /><span>{index + 1}</span>
      </button>)}
    </div> : null}
    {props.references.length ? <div className={`${styles.referenceCollection} ${sharedStyles.collection}`} aria-label={t("ai_generator_free_references_title")}
      data-character-voices={props.characterVoices ? "true" : undefined}>
      {props.references.map((reference, index) => <div key={reference.id} className={`${styles.referenceTile} ${sharedStyles.tile}`}
        data-active={activeId === reference.id}
        data-required={reference.usage === "required" ? "true" : "false"} data-reference-role={reference.role || "inspiration"}>
        <div className={`${styles.referenceTileHeader} ${sharedStyles.tileHeader}`}>
          <img src={reference.previewUrl} alt="" />
          <span className={styles.referenceTileCopy}>
            <strong>{t("ai_generator_free_reference", { index: index + 1 })}</strong><small>{reference.name}</small>
          </span>
        </div>
        <button type="button" className={styles.referenceTileRemove} disabled={props.disabled}
          aria-label={t("ai_generator_free_reference_remove", { index: index + 1 })} onClick={() => props.onRemove(index)}>×</button>
        <div className={`${styles.referenceTileControls} ${sharedStyles.tileControls}`}>
          <select className={styles.studioSelect} aria-label={t("ai_generator_free_reference_role", { index: index + 1 })}
            value={reference.role === "inspiration" || !reference.role ? "character" : reference.role} disabled={props.disabled}
            onChange={(event) => props.onRole(index, event.target.value as "character" | "environment" | "product")}>
            {(["character", "environment", "product"] as const).map((role) => <option key={role} value={role}>{t(`ai_generator_free_role_${role}`)}</option>)}
          </select>
          <select className={styles.studioSelect} aria-label={t("ai_generator_free_reference_usage", { index: index + 1 })}
            value={reference.usage || "inspiration"} disabled={props.disabled}
            onChange={(event) => props.onUsage(index, event.target.value as "required" | "inspiration")}>
            <option value="required">{t("ai_generator_free_usage_required")}</option>
            <option value="inspiration">{t("ai_generator_free_usage_inspiration")}</option>
          </select>
        </div>
        {props.renderExtra?.(index)}
      </div>)}
    </div> : null}
  </div>;
}
