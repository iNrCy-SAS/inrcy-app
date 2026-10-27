import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { ChannelPublicationPreview, type PublicationPreview } from "@/app/dashboard/_components/ChannelImageAdapterTool";
import { PublicationPreviewDeviceTabs, type PublicationPreviewDevice } from "@/app/dashboard/_components/channel-image-adapter/native-publication-preview";
import { channelSupportsImages, getBoosterMaxImageCountForChannel, type ChannelKey, type ChannelMediaMode } from "../publishModal.shared";
import type { PublishFinalReviewItem } from "./PublishFinalReviewModal";
import { PUBLISH_CHANNEL_IDENTITY } from "./publishChannelIdentity";
import MediaSoundtrackSelector from "@/app/dashboard/_components/MediaSoundtrackSelector";
import type { MediaSoundtrackByChannel, MediaSoundtrackChannel } from "@/lib/mediaSoundtrackSelection";
import css from "./PublishValidationBoard.module.css";

type ReviewItem = PublishFinalReviewItem & { blockerCodes?: string[]; mediaBlockerCodes?: string[]; contentBlockers?: string[]; contentWarnings?: string[]; mediaBlockers?: string[]; mediaWarnings?: string[] };
type Props = {
  items: ReviewItem[]; imageKeys: string[]; previewByKey: Record<string, string>; videoPreviewUrl: string;
  getMode: (channel: ChannelKey) => ChannelMediaMode;
  getSelectedImageKeys: (channel: ChannelKey) => string[];
  onModeChange: (channel: ChannelKey, mode: ChannelMediaMode) => void;
  onToggleImage: (channel: ChannelKey, key: string) => void;
  onAddImage: (channel: ChannelKey, key: string) => void;
  onReorderImage: (channel: ChannelKey, key: string, target: string) => void;
  onOpenMediaPool: () => void;
  onSelectChannel: (channel: ChannelKey) => void;
  activePreview: PublicationPreview | null; disabled: boolean;
  soundtrackByChannel?: MediaSoundtrackByChannel;
  soundtrackScopeKey?: string;
  canSelectSoundtrack?: (channel: ChannelKey) => boolean;
  onSoundtrackChange?: (channel: MediaSoundtrackChannel, id: string | null) => void;
  isSoundtrackLocked?: (channel: MediaSoundtrackChannel) => boolean;
  renderChannelOptions?: (channel: ChannelKey) => ReactNode;
};

function Eye() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>; }

function ReviewStatus({ tone, label, hint, messages, id, open, onToggle }: {
  tone: "ready" | "warning" | "blocked"; label: string; hint?: string; messages: string[]; id: string; open: boolean; onToggle: () => void;
}) {
  if (tone === "ready") return <span className={css.state} data-tone="ready">{label}</span>;
  return <span className={css.warningWrap} data-tone={tone} data-open={open} data-validation-warning>
    <button type="button" className={css.warningButton} aria-label={[hint || label, ...messages].join(" · ")} aria-describedby={id} aria-controls={id} aria-expanded={open} onClick={onToggle}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.3 3.6 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></svg>
      {hint ? <span>{hint}</span> : null}
    </button>
    <span className={css.warningPanel} id={id} role="tooltip">{messages.length ? messages.map((message) => <span key={message}>{message}</span>) : label}</span>
  </span>;
}

export default function PublishValidationBoard({ items, imageKeys, previewByKey, videoPreviewUrl, getMode, getSelectedImageKeys, onModeChange, onToggleImage, onAddImage, onReorderImage, onOpenMediaPool, onSelectChannel, activePreview, disabled, soundtrackByChannel, soundtrackScopeKey, canSelectSoundtrack, onSoundtrackChange, isSoundtrackLocked, renderChannelOptions }: Props) {
  const t = useTranslations("booster");
  const [modal, setModal] = useState<"preview" | null>(null);
  const [previewDevice, setPreviewDevice] = useState<PublicationPreviewDevice>("desktop");
  const previewPanelId = useId();
  const [addingSlot, setAddingSlot] = useState<{ channel: ChannelKey; index: number } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const warningId = useId();
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const dragRef = useRef<{ channel: ChannelKey; key: string } | null>(null);
  useEffect(() => {
    if (!warning) return;
    const dismiss = (event: globalThis.PointerEvent) => { if (event.target instanceof Element && !event.target.closest('[data-validation-warning]')) setWarning(null); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.stopImmediatePropagation(); setWarning(null); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape, true); };
  }, [warning]);
  useEffect(() => {
    if (!addingSlot) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('[data-validation-add]')) setAddingSlot(null);
    };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.stopImmediatePropagation(); setAddingSlot(null); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape, true); };
  }, [addingSlot]);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!modal) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    const keydown = (event: globalThis.KeyboardEvent) => {
      const activeDialog = document.activeElement?.closest('[aria-modal="true"]');
      if (activeDialog && activeDialog !== dialogRef.current) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); setModal(null); return; }
      if (event.key !== "Tab") return;
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), a[href], video[controls], [tabindex="0"]') || []).filter((node) => node.getClientRects().length > 0);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); previousFocus?.focus({ preventScroll: true }); };
  }, [modal]);
  const open = (channel: ChannelKey) => { onSelectChannel(channel); setPreviewDevice(window.matchMedia("(max-width: 640px)").matches ? "mobile" : "desktop"); setModal("preview"); };
  const finishDrag = (channel: ChannelKey, key: string) => {
    const source = dragRef.current;
    if (!disabled && source?.channel === channel && source.key !== key) onReorderImage(channel, source.key, key);
    dragRef.current = null;
    setDragTarget(null);
  };
  const status = (tone: "ready" | "warning" | "blocked") => t(tone === "ready" ? "wizard_ready_to_publish" : tone === "blocked" ? "wizard_to_complete" : "wizard_to_check");
  const previewIdentity = items.find((item) => item.channel === activePreview?.channelKey);
  const activeIdentity = previewIdentity ? PUBLISH_CHANNEL_IDENTITY[previewIdentity.channel] : null;
  return <>
    <div className={css.board} data-publish-validation-board>
      {items.map((item) => {
        const identity = PUBLISH_CHANNEL_IDENTITY[item.channel];
        const mode = getMode(item.channel);
        const keys = mode === "images" ? getSelectedImageKeys(item.channel).filter((key) => imageKeys.includes(key)) : [];
        const contentBlockers = item.contentBlockers || item.blockers.filter((_message, index) => !(item.mediaBlockerCodes || []).includes(item.blockerCodes?.[index] || ""));
        const contentWarnings = item.contentWarnings || [];
        const mediaBlockers = item.mediaBlockers || [];
        const mediaWarnings = item.mediaWarnings || [];
        const contentTone = contentBlockers.length ? "blocked" : contentWarnings.length || !item.hasText ? "warning" : "ready";
        const mediaTone = item.mediaBlockerCodes?.length ? "blocked" : mediaWarnings.length ? "warning" : mode === "none" || mode === "images" && keys.length || mode === "video" && videoPreviewUrl ? "ready" : "blocked";
        const contentMessages = [...contentBlockers, ...contentWarnings];
        const mediaMessages = [...mediaBlockers, ...mediaWarnings];
        const maxImages = getBoosterMaxImageCountForChannel(item.channel);
        const availableImages = channelSupportsImages(item.channel) ? imageKeys.filter((key) => !keys.includes(key)) : [];
        const videoSelected = mode === "video" && Boolean(videoPreviewUrl);
        const slotCount = mode === "video" || !channelSupportsImages(item.channel) ? 1 : maxImages;
        const emptySlots = Math.max(0, slotCount - (videoSelected ? 1 : keys.length));
        const musicChannel: MediaSoundtrackChannel | null = item.channel === "facebook" || item.channel === "instagram" ? item.channel : null;
        return <article key={item.channel} className={css.card} data-channel={item.channel} data-has-options={Boolean(renderChannelOptions)} style={{ "--channel-color": identity.color, "--channel-rgb": identity.rgb, "--channel-gradient": identity.gradient } as CSSProperties}>
          <header><div className={css.brand}><span className={css.logo}><img src={identity.icon} alt="" /></span><strong>{item.label}</strong></div><div className={css.cardActions}>
            {musicChannel && onSoundtrackChange ? <MediaSoundtrackSelector
              compact channelLabel={item.label} soundtrackId={soundtrackByChannel?.[musicChannel] ?? null}
              channelStyle={{ "--channel-color": identity.color, "--channel-rgb": identity.rgb, "--channel-gradient": identity.gradient } as CSSProperties}
              onChange={(id) => onSoundtrackChange(musicChannel, id)}
              unavailableHint={mode === "images" && canSelectSoundtrack?.(musicChannel) ? undefined : t("publication_music_reserved_hint")}
              scopeKey={`${soundtrackScopeKey || ""}:${musicChannel}`} disabled={disabled} selectionLocked={isSoundtrackLocked?.(musicChannel)} /> : null}
            <button type="button" onClick={() => open(item.channel)} aria-label={t("wizard_preview_channel", { channel: item.label })} title={t("wizard_preview_channel", { channel: item.label })}><Eye /></button>
          </div></header>
          {renderChannelOptions ? <div className={css.channelOptions}>{renderChannelOptions(item.channel)}</div> : null}
          <div className={css.statusLine}><span>{t("contenu_f3cb82af")}</span><ReviewStatus tone={contentTone} label={status(contentTone)} messages={contentMessages} id={`${warningId}-${item.channel}-content`} open={warning === `${item.channel}-content`} onToggle={() => setWarning(warning === `${item.channel}-content` ? null : `${item.channel}-content`)} /></div>
          <div className={css.statusLine}><span className={css.mediaLabel}>{t("wizard_step_media")}
            {channelSupportsImages(item.channel) ? <span className={css.mediaChoice} role="group" aria-label={t("wizard_channel_media_type", { channel: item.label })}>
              <button type="button" disabled={disabled || !imageKeys.length} data-active={mode === "images"} aria-pressed={mode === "images"} aria-label={t("wizard_pool_images")} title={t("wizard_pool_images")} onClick={() => onModeChange(item.channel, "images")}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/></svg></button>
              <button type="button" disabled={disabled || !videoPreviewUrl} data-active={mode === "video"} aria-pressed={mode === "video"} aria-label={t("video_304f6ca4")} title={t("video_304f6ca4")} onClick={() => onModeChange(item.channel, "video")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="2" y="5" width="13" height="14" rx="3"/><path d="m15 10 7-4v12l-7-4"/></svg></button>
            </span> : null}
          </span><ReviewStatus tone={mediaTone} label={status(mediaTone)} hint={item.channel === "youtube_shorts" && item.mediaBlockerCodes?.includes("youtube_video_required") ? t("wizard_video_required") : undefined} messages={mediaMessages} id={`${warningId}-${item.channel}-media`} open={warning === `${item.channel}-media`} onToggle={() => setWarning(warning === `${item.channel}-media` ? null : `${item.channel}-media`)} /></div>
          <div className={css.thumbnails}>
            {keys.map((key, index) => {
              return <div key={key} className={css.image} data-validation-image={key} data-drag-over={dragTarget === key} draggable={!disabled && keys.length > 1}
                onDragStart={(event) => { dragRef.current = { channel: item.channel, key }; event.dataTransfer.setData("text/plain", key); event.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(event) => { if (dragRef.current?.channel === item.channel) { event.preventDefault(); setDragTarget(key); } }}
                onDrop={(event) => { event.preventDefault(); finishDrag(item.channel, key); }} onDragEnd={() => { dragRef.current = null; setDragTarget(null); }}>
                <img src={previewByKey[key]} alt={`${t("wizard_pool_image")} ${index + 1}`} draggable={false} />
                <button type="button" className={css.remove} onClick={() => onToggleImage(item.channel, key)} disabled={disabled} aria-label={t("wizard_remove_channel_image", { channel: item.label, number: index + 1 })}>×</button>
                <button type="button" className={css.grip} disabled={disabled || keys.length < 2} aria-label={t("wizard_reorder_image", { number: index + 1 })} title={t("wizard_drag_to_reorder")}
                  onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { channel: item.channel, key }; }}
                  onPointerMove={(event) => { if (!dragRef.current) return; const target = document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-validation-image]'); setDragTarget(target?.closest('[data-channel]')?.getAttribute('data-channel') === item.channel ? target?.dataset.validationImage || null : null); }}
                  onPointerUp={(event) => { if (dragTarget) finishDrag(item.channel, dragTarget); else dragRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
                  onPointerCancel={() => { dragRef.current = null; setDragTarget(null); }}
                  onKeyDown={(event) => { const nextIndex = index + (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0); if (nextIndex !== index && keys[nextIndex]) { event.preventDefault(); onReorderImage(item.channel, key, keys[nextIndex]); } }}><span aria-hidden="true">⠿</span><span>{index + 1}</span></button>
              </div>;
            })}
            {videoPreviewUrl && mode === "video" ? <div className={css.video} title={t("video_304f6ca4")}>
              <video src={videoPreviewUrl} preload="metadata" muted playsInline />
              <button type="button" className={css.remove} disabled={disabled} onClick={() => onModeChange(item.channel,"none")} aria-label={t("wizard_remove_channel_video", { channel: item.label })}>×</button>
              <span aria-hidden="true">▷</span>
            </div> : null}
            {Array.from({ length: emptySlots }, (_, index) => <div className={css.addWrap} data-validation-add key={index}>
              <button type="button" className={css.add} disabled={disabled} aria-expanded={addingSlot?.channel === item.channel && addingSlot.index === index} aria-label={t("wizard_add_channel_media", { channel: item.label }) + ` · ${keys.length + index + 1}`} title={t("wizard_add_available_media")} onClick={() => setAddingSlot(addingSlot?.channel === item.channel && addingSlot.index === index ? null : { channel: item.channel, index })}>＋</button>
              {addingSlot?.channel === item.channel && addingSlot.index === index ? <div className={css.available} role="group" aria-label={t("wizard_available_media")}><span>{t("wizard_available_media")}</span><div className={css.availableItems}>
                {availableImages.map((key) => <button key={key} type="button" disabled={disabled || (mode === "images" && keys.length >= maxImages)} onClick={() => { onAddImage(item.channel,key); setAddingSlot(null); }} aria-label={t("wizard_add_channel_image", { channel: item.label, number: imageKeys.indexOf(key)+1 })}><img src={previewByKey[key]} alt="" /><span>{imageKeys.indexOf(key)+1}</span></button>)}
                {videoPreviewUrl && mode !== "video" ? <button type="button" disabled={disabled} onClick={() => { onModeChange(item.channel,"video"); setAddingSlot(null); }} aria-label={t("wizard_add_channel_video", { channel: item.label })}><video src={videoPreviewUrl} preload="metadata" muted playsInline /><span>▷</span></button> : null}
              </div>{!availableImages.length && !(videoPreviewUrl && mode !== "video") ? <div className={css.noAvailableMedia}><span>{t("wizard_no_available_media")}</span><button type="button" onClick={() => { setAddingSlot(null); onOpenMediaPool(); }}>{t("wizard_go_to_media")}</button></div> : null}</div> : null}
            </div>)}
          </div>
        </article>;
      })}
    </div>
    {modal ? createPortal(<div className={css.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
      <div className={css.dialog} ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1} aria-label={activePreview?.channelLabel || t("wizard_step_media")} style={activeIdentity ? { "--channel-color": activeIdentity.color, "--channel-rgb": activeIdentity.rgb, "--channel-gradient": activeIdentity.gradient } as CSSProperties : undefined}>
        <header><strong className={css.previewBrand}>{activeIdentity ? <span><img src={activeIdentity.icon} alt="" /></span> : null}<span>{activePreview?.channelLabel}</span></strong><PublicationPreviewDeviceTabs device={previewDevice} onChange={setPreviewDevice} panelId={previewPanelId} /><button type="button" onClick={() => setModal(null)} aria-label={t("fermer_5ab4ec64")}>×</button></header>
        <div className={css.dialogBody}>{activePreview ? <ChannelPublicationPreview preview={activePreview} presentation="native" device={previewDevice} panelId={previewPanelId} /> : <span>{t("wizard_empty_content")}</span>}</div>
      </div>
    </div>, document.body) : null}
  </>;
}
