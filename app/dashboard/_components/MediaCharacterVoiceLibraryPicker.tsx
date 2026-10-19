"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES } from "@/lib/aiMediaCharacterVoices";
import styles from "./MediaCharacterVoiceInput.module.css";

type AudioItem = { id: string; title: string | null; duration_seconds: number | null; size_bytes: number | null; signed_url: string | null };

export default function MediaCharacterVoiceLibraryPicker({ onClose, onSelect }: {
  onClose: () => void; onSelect: (id: string) => void;
}) {
  const t = useTranslations("media");
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<AudioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [previewErrors, setPreviewErrors] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const controller = new AbortController();
    void fetch("/api/media-library/items?type=audio&includeAudio=true&active=active&limit=120", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || body?.ok !== true || !Array.isArray(body.items)) throw new Error();
        if (!controller.signal.aborted) setItems(body.items);
      }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); element?.close(); };
  }, []);
  return <dialog ref={dialog} className={styles.libraryDialog} aria-labelledby={`${id}-title`} onCancel={onClose}>
    <div className={styles.libraryHeader}><h3 id={`${id}-title`}>{t("ai_generator_character_voice_library_title")}</h3><button type="button" onClick={onClose} aria-label={t("ai_generator_character_voice_record_cancel")}>×</button></div>
    <p>{t("ai_generator_character_voice_library_subtitle")}</p>
    {loading ? <p role="status">{t("ai_generator_character_voice_library_loading")}</p> : null}
    {error ? <p role="alert">{t("ai_generator_character_voice_library_unavailable")}</p> : null}
    {!loading && !error && !items.length ? <p>{t("ai_generator_character_voice_library_empty")}</p> : null}
    <div className={styles.libraryList}>{items.map((item) => {
      const duration = Number(item.duration_seconds);
      const compatible = duration >= 1 && duration <= 10 && Number(item.size_bytes) > 0 && Number(item.size_bytes) <= AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES;
      const title = item.title || t("library_audio");
      return <div key={item.id} className={styles.libraryItem}>
        <strong>{title}</strong>
        {Number.isFinite(duration) && duration > 0 ? <small>{t("library_audio_duration")}: {Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, "0")}</small> : null}
        {item.signed_url ? <audio controls preload="metadata" src={item.signed_url} aria-label={t("library_audio_preview", { name: title })} onError={() => setPreviewErrors((previous) => ({ ...previous, [item.id]: true }))} /> : null}
        {previewErrors[item.id] || !item.signed_url ? <small role="alert">{t("ai_generator_character_voice_library_unavailable")}</small> : null}
        {!compatible ? <small>{t("ai_generator_character_voice_library_duration_error")}</small> : null}
        <button type="button" disabled={!compatible} onClick={() => onSelect(item.id)}>{t("ai_generator_character_voice_library_confirm")}</button>
      </div>;
    })}</div>
    <div className={styles.actions}><button type="button" onClick={onClose}>{t("ai_generator_character_voice_record_cancel")}</button></div>
  </dialog>;
}
