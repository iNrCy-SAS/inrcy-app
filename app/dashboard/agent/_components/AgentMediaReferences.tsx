"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import MediaReferenceInputs from "../../_components/MediaReferenceInputs";
import MediaLibraryPickerModal, { type MediaLibraryPickerItem } from "../../_components/MediaLibraryPickerModal";
import { prepareMediaGenerationImageReference, prepareVideoReferenceFrame } from "@/lib/mediaGenerationReferenceClient";
import { AI_MEDIA_INSPIRATION_MAX_COUNT } from "@/lib/aiMediaGenerationContracts";
import { INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS, INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES, INR_MEDIA_ALLOWED_VIDEO_EXTENSIONS,
  INR_MEDIA_ALLOWED_VIDEO_MIME_TYPES, isInrMediaVideoFile } from "@/lib/mediaRules";
import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import { INR_AGENT_VIDEO_ENGINE } from "@/lib/inrAgentVideoPolicy";
import { emptyInrAgentMediaReferences, inrAgentReferencePreviewUrl,
  type InrAgentMediaReference, type InrAgentMediaReferences } from "@/lib/inrAgentMediaReferences";
import styles from "./AgentMediaReferences.module.css";

const ACCEPT = [...INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES, ...INR_MEDIA_ALLOWED_VIDEO_MIME_TYPES,
  ...[...INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS, ...INR_MEDIA_ALLOWED_VIDEO_EXTENSIONS].map((extension) => `.${extension}`)].join(",");

export default function AgentMediaReferences(props: {
  value?: InrAgentMediaReferences; disabled?: boolean; videoEnabled: boolean;
  onChange: (references: InrAgentMediaReferences) => void; onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations("agent");
  const mediaT = useTranslations("media");
  const value = props.value || emptyInrAgentMediaReferences();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const uploadingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    const cancel = () => { controllerRef.current?.abort(); };
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, cancel);
    return () => { mountedRef.current = false; cancel(); window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, cancel); };
  }, []);
  function changeItems(items: InrAgentMediaReference[]) {
    setError(""); props.onChange({ version: 1, items, authorized: false, animationProviderConsent: null });
  }
  async function addFiles(files: File[] | MediaLibraryPickerItem[]) {
    if (uploadingRef.current || props.disabled) return;
    uploadingRef.current = true;
    const controller = new AbortController(); controllerRef.current = controller;
    setBusy(true); props.onBusyChange(true); setError("");
    const added: InrAgentMediaReference[] = [];
    try {
      const accountId = resolveActiveBrowserUserId("");
      if (!accountId) throw new Error(t("media_references_error"));
      for (const source of files.slice(0, AI_MEDIA_INSPIRATION_MAX_COUNT - value.items.length)) {
        controller.signal.throwIfAborted();
        let file: File;
        if (source instanceof File) file = source;
        else {
          if (!source.signed_url) throw new Error(mediaT("ai_generator_inspiration_library_unavailable"));
          const response = await fetch(source.signed_url, { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error(mediaT("ai_generator_inspiration_library_unavailable"));
          file = new File([await response.blob()], source.original_file_name || source.title || "reference.jpg", { type: source.mime_type || "image/jpeg" });
        }
        const image = isInrMediaVideoFile(file) ? await prepareVideoReferenceFrame(file) : await prepareMediaGenerationImageReference(file);
        controller.signal.throwIfAborted();
        const response = await fetch("/api/agent/media-references", { method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, image }), signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || !payload.id) throw new Error(payload.error || t("media_references_error"));
        added.push({ id: payload.id, name: image.name || file.name, role: "character", usage: "required" });
      }
    } catch (caught) {
      if (!controller.signal.aborted && mountedRef.current) setError(caught instanceof Error ? caught.message : t("media_references_error"));
    } finally {
      if (!controller.signal.aborted && mountedRef.current) {
        if (added.length) props.onChange({ version: 1, items: [...value.items, ...added], authorized: false, animationProviderConsent: null });
      }
      if (mountedRef.current) setBusy(false);
      uploadingRef.current = false; props.onBusyChange(false);
    }
  }
  const locked = busy || props.disabled;
  const teamAnimation = props.videoEnabled && value.items.filter((item) => item.role === "character" && item.usage === "required").length > 1;
  const tooManyCharacters = value.items.filter((item) => item.role === "character" && item.usage === "required").length > 3;
  return <section className={styles.panel} aria-label={t("media_references_title")}>
    <header><strong>{t("media_references_title")}</strong>
      <details className={styles.information}><summary aria-label={mediaT("ai_generator_reference_information")}>i</summary><p>{t("media_references_hint")}</p></details>
      <span>{value.items.length}/{AI_MEDIA_INSPIRATION_MAX_COUNT}</span></header>
    <p>{t("media_references_summary")}</p>
    <MediaReferenceInputs references={value.items.map((item) => ({ ...item, previewUrl: inrAgentReferencePreviewUrl(item.id) }))}
      accept={ACCEPT} compact disabled={locked} information={mediaT("ai_generator_essential_new_scene_image")}
      onFiles={(files) => { void addFiles(files); }} onLibrary={() => setLibraryOpen(true)}
      onRemove={(index) => changeItems(value.items.filter((_, current) => current !== index))}
      onRole={(index, role) => changeItems(value.items.map((item, current) => current === index ? { ...item, role } : item))}
      onUsage={(index, usage) => changeItems(value.items.map((item, current) => current === index ? { ...item, usage } : item))} />
    {busy ? <p role="status">{t("media_references_import_busy")}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {tooManyCharacters ? <p className={styles.error} role="alert">{t("media_references_character_limit")}</p> : null}
    {value.items.length ? <label className={styles.consent}>
      <input type="checkbox" checked={value.authorized} disabled={locked}
        onChange={(event) => props.onChange({ ...value, authorized: event.target.checked, animationProviderConsent: null })} />
      <span>{t("media_references_consent")}</span>
    </label> : null}
    {teamAnimation ? <label className={styles.consent}>
      <input type="checkbox" checked={value.animationProviderConsent === INR_AGENT_VIDEO_ENGINE} disabled={locked || !value.authorized}
        onChange={(event) => props.onChange({ ...value, animationProviderConsent: event.target.checked ? INR_AGENT_VIDEO_ENGINE : null })} />
      <span>{t("media_references_animation_consent", { provider: "Google Veo Lite" })}</span>
    </label> : null}
    <MediaLibraryPickerModal open={libraryOpen} accept="all" multiple maxSelection={Math.max(1, AI_MEDIA_INSPIRATION_MAX_COUNT - value.items.length)}
      title={mediaT("ai_generator_inspiration_library_title")} subtitle={mediaT("ai_generator_inspiration_library_subtitle")}
      confirmLabel={mediaT("ai_generator_inspiration_library_confirm")} onClose={() => setLibraryOpen(false)} onConfirm={(items) => addFiles(items)} />
  </section>;
}
