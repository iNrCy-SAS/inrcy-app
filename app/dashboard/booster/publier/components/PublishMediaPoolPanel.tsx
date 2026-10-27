import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BOOSTER_MAX_IMAGE_COUNT, makeImageKey, getLocalizedBoosterImageLimits, getLocalizedBoosterImageFormats, getLocalizedBoosterVideoLimits, getLocalizedBoosterVideoFormats, getLocalizedBoosterRecommendedVideoDuration } from "../publishModal.shared";
import MediaPoolImagePreview from "./MediaPoolImagePreview";
import css from "./PublishMediaPoolPanel.module.css";

type MediaKind = "image" | "video";
type Props = {
  images: File[]; imagePreviews: string[]; videoFile: File | null; videoPreviewUrl: string;
  isMobile: boolean; error?: string;
  onPickImages: () => void; onPickVideo: () => void;
  onGenerate: (kind: MediaKind) => void; onLibrary: (kind: MediaKind) => void;
  onCamera: () => void; onRemoveImage: (index: number) => void; onRemoveVideo: () => void;
  onReorderImage: (imageKey: string, targetImageKey: string) => void;
  onModifyImage: (index: number) => void; onRetouchImage: (index: number) => void;
  onRetouchVideo: () => void;
};

export default function PublishMediaPoolPanel({
  images, imagePreviews, videoFile, videoPreviewUrl, isMobile, error,
  onPickImages, onPickVideo, onGenerate, onLibrary, onCamera, onRemoveImage, onRemoveVideo,
  onReorderImage, onModifyImage, onRetouchImage,
  onRetouchVideo,
}: Props) {
  const t = useTranslations("booster");
  const shellT = useTranslations("shell");
  const runtimeT = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  const [expandedSlot, setExpandedSlot] = useState(0);
  const [videoActionsOpen, setVideoActionsOpen] = useState(true);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const poolRef = useRef<HTMLDivElement>(null);
  const dragSourceRef = useRef<string | null>(null);
  const dragTargetRef = useRef<string | null>(null);
  const closePreview = useCallback(() => setPreviewKey(null), []);
  const imageKeys = images.map(makeImageKey);
  const previewIndex = previewKey ? imageKeys.indexOf(previewKey) : -1;
  const hasVideo = Boolean(videoFile || videoPreviewUrl);
  const firstEmpty = images.length < BOOSTER_MAX_IMAGE_COUNT ? images.length : -1;
  const activeSlot = expandedSlot < 0 ? -1 : images[expandedSlot] ? firstEmpty : expandedSlot;
  const imageHelp = getLocalizedBoosterImageLimits(runtimeT) + " · " + getLocalizedBoosterImageFormats(runtimeT);
  const videoHelp = getLocalizedBoosterVideoLimits(runtimeT) + " · " + getLocalizedBoosterVideoFormats(runtimeT) + " · " + getLocalizedBoosterRecommendedVideoDuration(runtimeT);

  const markDragTarget = (key: string | null) => { dragTargetRef.current = key; setDragTarget(key); };
  const finishDrag = (targetKey: string | null) => {
    const sourceKey = dragSourceRef.current;
    dragSourceRef.current = null;
    markDragTarget(null);
    if (sourceKey && targetKey && sourceKey !== targetKey) onReorderImage(sourceKey, targetKey);
  };
  const pointerTarget = (x: number, y: number) => {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-pool-image-key]");
    return target && poolRef.current?.contains(target) ? target.dataset.poolImageKey || null : null;
  };

  const actions = (kind: MediaKind) => <div className={css.slotActions}>
    <button type="button" className={css.add} onClick={kind === "image" ? onPickImages : onPickVideo} title={kind === "image" ? imageHelp : videoHelp}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>{t("wizard_add_media")}</button>
    <button type="button" className={css.generate} onClick={() => onGenerate(kind)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /></svg>{t("wizard_generate_media")}</button>
    <button type="button" className={css.library} onClick={() => onLibrary(kind)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="5" y="3" width="16" height="16" rx="3"/><path d="M3 7v12a2 2 0 0 0 2 2h12m-11-8 4-4 3 3 2-2 5 5"/><circle cx="16" cy="7" r="1"/></svg>{t("wizard_media_library")}</button>
    {isMobile && kind === "image" ? <button type="button" className={css.camera} onClick={onCamera}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m8 5 1-2h6l1 2h3a2 2 0 0 1 2 2v12H3V7a2 2 0 0 1 2-2h3Z"/><circle cx="12" cy="12" r="4"/></svg>{t("wizard_camera")}</button> : null}
  </div>;

  return <>
    <div ref={poolRef} className={css.pool} data-publish-media-pool>
      {error ? <div role="alert" className={css.error}>{error}</div> : null}
      <div className={css.workspace}>
      <section className={css.imageGroup} aria-label={t("wizard_pool_images")}>
      <div className={css.count}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/></svg><span>{t("wizard_pool_images")}</span><strong>{images.length} <span>/ {BOOSTER_MAX_IMAGE_COUNT}</span></strong></div>
      <div className={css.images}>
        {Array.from({ length: BOOSTER_MAX_IMAGE_COUNT }, (_, index) => images[index] ? (
          <figure key={imageKeys[index]} className={css.image} data-pool-image-key={imageKeys[index]} data-drag-over={dragTarget === imageKeys[index]} draggable={images.length > 1}
            onDragStart={(event) => { dragSourceRef.current = imageKeys[index]; event.dataTransfer.setData("text/plain", imageKeys[index]); event.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(event) => { if (dragSourceRef.current) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; markDragTarget(imageKeys[index]); } }}
            onDrop={(event) => { if (dragSourceRef.current) { event.preventDefault(); finishDrag(imageKeys[index]); } }}
            onDragEnd={() => finishDrag(null)}>
            <img src={imagePreviews[index]} alt={images[index].name} draggable={false} />
            <button type="button" className={`${css.position} ${css.grip}`} disabled={images.length < 2} aria-label={t("wizard_reorder_image", { number: index + 1 })} title={t("wizard_drag_to_reorder")}
              onPointerDown={(event) => { if (images.length < 2 || event.button !== 0) return; event.preventDefault(); dragSourceRef.current = imageKeys[index]; markDragTarget(null); event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={(event) => { if (dragSourceRef.current) markDragTarget(pointerTarget(event.clientX, event.clientY)); }}
              onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); finishDrag(dragTargetRef.current); }}
              onPointerCancel={() => finishDrag(null)}
              onKeyDown={(event) => {
                const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : 0;
                const targetKey = imageKeys[index + direction];
                if (direction && targetKey) { event.preventDefault(); event.stopPropagation(); onReorderImage(imageKeys[index], targetKey); }
              }}><span aria-hidden="true">⠿</span>{index + 1}</button>
            <button type="button" className={css.remove} onClick={() => onRemoveImage(index)} aria-label={t("wizard_pool_remove_image") + " " + images[index].name}>×</button>
            <figcaption><span title={images[index].name}>{images[index].name}</span><div className={css.imageTools}>
              <button type="button" className={css.viewTool} onClick={() => setPreviewKey(imageKeys[index])} aria-label={shellT("voir_l_image_value_71740aa0", { value0: index + 1 })} title={shellT("voir_l_image_value_71740aa0", { value0: index + 1 })}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button>
              <button type="button" className={css.modifyTool} onClick={() => onModifyImage(index)} aria-label={t("wizard_modify_image", { number: index + 1 })} title={t("wizard_modify_image", { number: index + 1 })}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></svg></button>
              <button type="button" className={css.retouchTool} onClick={() => onRetouchImage(index)} aria-label={t("wizard_retouch_image", { number: index + 1 })} title={t("wizard_retouch_image", { number: index + 1 })}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0 0-3l-1-1a2 2 0 0 0-3 0L5 15l-1 5Z"/></svg></button>
            </div></figcaption>
          </figure>
        ) : <div key={index} className={css.emptyImage} data-active={activeSlot === index}>
          <span className={css.position}>{index + 1}</span>
          <button className={activeSlot === index ? css.collapse : css.expand} type="button" onClick={() => setExpandedSlot(activeSlot === index ? -1 : index)} aria-label={activeSlot === index ? t("wizard_close_media_actions") : t("wizard_open_media_actions", { number: index + 1 })} aria-expanded={activeSlot === index}>{activeSlot === index ? "×" : "＋"}</button>
          {activeSlot === index ? <>
            <div className={css.slotHeading}><svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/></svg><strong>{t("wizard_pool_image")}</strong></div>
            {actions("image")}
          </> : null}
        </div>)}
      </div>
      </section>
      <section className={css.videoGroup} aria-label={t("video_304f6ca4")}>
        <div className={css.count}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="2" y="5" width="13" height="14" rx="3"/><path d="m15 10 7-4v12l-7-4"/></svg><span>{t("video_304f6ca4")}</span><strong>{hasVideo ? 1 : 0} <span>/ 1</span></strong></div>
        <div className={css.video} data-filled={hasVideo} data-active={!hasVideo && videoActionsOpen}>
          {hasVideo ? <>
            <div className={css.videoVisual}><video src={videoPreviewUrl} controls playsInline preload="metadata" /></div>
            <button type="button" className={css.remove} onClick={() => { setVideoActionsOpen(true); onRemoveVideo(); }} aria-label={t("wizard_pool_remove_video")}>×</button>
            <div className={css.videoCaption}><span title={videoFile?.name}>{videoFile?.name || t("video_selected")}</span><button type="button" onClick={onRetouchVideo}>✦ {t("wizard_retouch_video")}</button></div>
          </> : videoActionsOpen ? <>
            <button className={css.collapse} type="button" onClick={() => setVideoActionsOpen(false)} aria-label={t("wizard_close_media_actions")} aria-expanded={true}>×</button>
            <div className={css.slotHeading}><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="2" y="5" width="13" height="14" rx="3"/><path d="m15 10 7-4v12l-7-4"/></svg></div>
            {actions("video")}
            <p className={css.videoHelp}>{t("wizard_pool_video_help")}</p>
          </> : <button type="button" className={css.expand} onClick={() => setVideoActionsOpen(true)} aria-label={`${t("wizard_add_media")} · ${t("video_304f6ca4")}`} aria-expanded={false}>＋</button>}
        </div>
      </section>
      </div>
    </div>
    {previewIndex >= 0 ? <MediaPoolImagePreview images={images.map((file, index) => ({ src: imagePreviews[index], name: file.name }))} initialIndex={previewIndex} onClose={closePreview} /> : null}
  </>;
}
