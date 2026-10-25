"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getClientUserFacingErrorMessage } from "@/lib/userFacingErrors";
import styles from "./mediaLibrary.module.css";

export type MediaMetadataFieldKind = "title" | "tags";

export function normalizeMediaMetadata(field: MediaMetadataFieldKind, value: string) {
  return field === "title"
    ? { title: value.trim().slice(0, 180) || null }
    : { tags: value.split(",").map((tag) => tag.trim().slice(0, 60).toLowerCase()).filter(Boolean).slice(0, 30) };
}

/** A field owns its draft until the server accepts it; refreshes cannot erase an edit. */
export default function MediaMetadataField({ field, value, disabled = false, onSave, onEditingChange }: {
  field: MediaMetadataFieldKind;
  value: string;
  disabled?: boolean;
  onSave: (field: MediaMetadataFieldKind, value: string) => Promise<void>;
  onEditingChange?: (editing: boolean) => void;
}) {
  const t = useTranslations("media");
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const editingChange = useRef(onEditingChange);
  editingChange.current = onEditingChange;
  const label = t(field === "title" ? "library_field_title" : "tags_848eed0f");
  const empty = t(field === "title" ? "media_sans_titre_e77f1871" : "aucun_tag_b6d9425d");

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; editingChange.current?.(false); }; }, []);

  useEffect(() => {
    if (editing) { input.current?.focus(); input.current?.select(); }
    else if (restoreFocus.current) { trigger.current?.focus(); restoreFocus.current = false; }
  }, [editing]);

  function startEditing() {
    if (disabled) return;
    setDraft(value); setError(""); setEditing(true); editingChange.current?.(true);
  }
  function cancel() {
    if (busy.current) return;
    setError(""); restoreFocus.current = true; setEditing(false); editingChange.current?.(false);
  }
  async function save() {
    if (busy.current || disabled) return;
    busy.current = true; setSaving(true); setError("");
    try {
      await onSave(field, draft);
      if (!mounted.current) return;
      restoreFocus.current = true; setEditing(false); editingChange.current?.(false);
    } catch (cause) {
      if (mounted.current) setError(getClientUserFacingErrorMessage(cause, t("library_edit_failed")));
    } finally { busy.current = false; if (mounted.current) setSaving(false); }
  }

  return <div className={styles.metadataField} data-media-field={field} data-editing={editing || undefined}>
    {editing ? <div className={styles.metadataEditor} aria-busy={saving}>
      <label htmlFor={id} className={styles.srOnly}>{label}</label>
      <input ref={input} id={id} className={styles.metadataInput} value={draft} disabled={saving}
        maxLength={field === "title" ? 180 : 1860}
        aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : field === "tags" ? `${id}-hint` : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") { event.preventDefault(); void save(); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); }
        }} />
      {field === "tags" ? <small id={`${id}-hint`} className={styles.metadataHint}>{t("library_tags_hint")}</small> : null}
      <div className={styles.metadataEditorActions}>
        <button type="button" disabled={saving || disabled} onClick={() => void save()}>{t(saving ? "library_edit_saving" : "library_edit_save")}</button>
        <button type="button" disabled={saving} onClick={cancel}>{t("annuler_49ba3292")}</button>
      </div>
      {error ? <small id={`${id}-error`} className={styles.metadataError} role="alert">{error}</small> : null}
    </div> : <button ref={trigger} type="button" className={styles.metadataBubble} disabled={disabled} onClick={startEditing}
      aria-label={t(field === "title" ? "library_edit_title" : "library_edit_tags", { value: value || empty })}>
      <span className={styles.metadataCopy}><small>{label}</small><span>{value || empty}</span></span>
      <svg className={styles.metadataPencil} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m15.5 4.5 4 4M4 20l4.6-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z" strokeLinejoin="round"/><path d="M13 20h7" strokeLinecap="round"/></svg>
    </button>}
  </div>;
}
