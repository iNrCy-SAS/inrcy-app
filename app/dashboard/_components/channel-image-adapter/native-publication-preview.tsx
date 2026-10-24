import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { FinalImageFrame, VideoPreviewFrame } from "./frames";
import { renderSafeSiteInlineHtml } from "./utils";
import type { PreviewImage, PreviewVideo, PublicationPreview } from "./types";
import css from "./native-publication-preview.module.css";

type IconName = "heart" | "comment" | "share" | "save" | "like" | "repeat" | "monitor" | "phone";
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    heart: <path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z" />,
    comment: <path d="M21 11.5a9 9 0 0 1-9 9 10 10 0 0 1-4-.9L3 21l1.4-4.8A9 9 0 1 1 21 11.5Z" />,
    share: <><path d="m21 3-7 18-4-7-7-4Z" /><path d="m10 14 5-5" /></>,
    save: <path d="M5 3h14v18l-7-4-7 4Z" />,
    like: <path d="M7 10v11H3V10Zm0 1 5-8c3 0 2 4 1 6h6c2 0 2 2 1 4l-2 7H7" />,
    repeat: <><path d="m16 3 4 4-4 4M20 7H6a3 3 0 0 0-3 3m5 11-4-4 4-4M4 17h14a3 3 0 0 0 3-3" /></>,
    monitor: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
    phone: <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M11 18h2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export type PublicationPreviewDevice = "desktop" | "mobile";

export function PublicationPreviewDeviceTabs({ device, onChange, panelId }: {
  device: PublicationPreviewDevice; onChange: (device: PublicationPreviewDevice) => void; panelId: string;
}) {
  const t = useTranslations("shell");
  return <div className={css.deviceTabs} role="tablist" aria-label={"PC / " + t("mobile_b1d70245")}>
    {(["desktop", "mobile"] as const).map((mode) => <button type="button" key={mode} id={`${panelId}-${mode}`} role="tab" aria-selected={device === mode} aria-controls={panelId} tabIndex={device === mode ? 0 : -1} onClick={() => onChange(mode)} onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "desktop" : event.key === "End" ? "mobile" : mode === "desktop" ? "mobile" : "desktop";
      onChange(next);
      document.getElementById(`${panelId}-${next}`)?.focus();
    }}><Icon name={mode === "desktop" ? "monitor" : "phone"} size={17} />{mode === "desktop" ? "PC" : t("mobile_b1d70245")}</button>)}
  </div>;
}

function NativeMedia({ images, video, channel, vertical, onOpen }: { images: PreviewImage[]; video: PreviewVideo | null; channel: string; vertical: boolean; onOpen: (index: number) => void }) {
  const t = useTranslations("shell");
  const [index, setIndex] = useState(0);
  const currentIndex = Math.min(index, Math.max(0, images.length - 1));
  if (video) return <div className={css.media}><VideoPreviewFrame video={video} aspectRatio={vertical ? "9 / 16" : video.aspectRatio || "16 / 9"} dark badge="" showMetadata={false} /></div>;
  if (!images.length) return null;
  const collage = ["facebook", "linkedin", "x"].includes(channel) && images.length > 1;
  const current = images[currentIndex];
  const dimensions = current.preset || current.imageMeta;
  const ratio = vertical ? "9 / 16" : dimensions?.width && dimensions.height ? `${dimensions.width} / ${dimensions.height}` : "1 / 1";
  return <div className={css.media}>
    {collage ? <div className={css.collage} data-count={images.length}>
      {images.map((image, position) => {
        const dimensions = image.preset || image.imageMeta;
        const canvasWidth = dimensions?.width || 1;
        const canvasHeight = dimensions?.height || 1;
        return <button type="button" key={position} onClick={() => onOpen(position)} aria-label={t("aller_a_l_image_value_869fd38d", { value0: position + 1 })}>
          <div className={css.collageCanvas} style={{ "--canvas-ratio": canvasWidth / canvasHeight } as CSSProperties}>
            <FinalImageFrame image={image} aspectRatio={`${canvasWidth} / ${canvasHeight}`} fallbackMode="black" />
          </div>
        </button>;
      })}
    </div> : <div className={css.carousel}>
      <button type="button" className={css.openImage} onClick={() => onOpen(currentIndex)} aria-label={t("aller_a_l_image_value_869fd38d", { value0: currentIndex + 1 })}><FinalImageFrame image={current} aspectRatio={ratio} fallbackMode="black" /></button>
      {images.length > 1 ? <>
        <span className={css.mediaCount}>{currentIndex + 1} / {images.length}</span>
        <button type="button" className={css.mediaPrevious} onClick={() => setIndex((currentIndex - 1 + images.length) % images.length)} aria-label={t("apercu_precedent_32003d48")}>‹</button>
        <button type="button" className={css.mediaNext} onClick={() => setIndex((currentIndex + 1) % images.length)} aria-label={t("apercu_suivant_6a2b57ef")}>›</button>
        <div className={css.mediaDots}>{images.map((_, position) => <button type="button" key={position} aria-label={t("aller_a_l_image_value_869fd38d", { value0: position + 1 })} aria-current={position === currentIndex ? "true" : undefined} data-active={position === currentIndex} onClick={() => setIndex(position)} />)}</div>
      </> : null}
    </div>}
  </div>;
}

type Props = {
  preview: PublicationPreview;
  title: string; content: string; cta: string; hashtags: string[];
  images: PreviewImage[]; video: PreviewVideo | null;
  device: PublicationPreviewDevice; panelId: string;
  onOpen: (index: number) => void;
};

export default function NativePublicationPreview({ preview, title, content, cta, hashtags, images, video, device, panelId, onOpen }: Props) {
  const boosterT = useTranslations("booster");
  const shellT = useTranslations("shell");
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState({ width: 0, height: 0, scale: 1 });
  const channel = preview.channelKey;
  const [videoWidth, videoHeight] = String(video?.aspectRatio || "").split("/").map(Number);
  const isYoutubeShort = channel === "youtube_shorts" && Boolean(video) && videoWidth > 0 && videoHeight >= videoWidth && Number(video?.duration || 0) <= 180;
  const isVertical = channel === "tiktok" || isYoutubeShort;
  const isSite = channel === "site_web" || channel === "inr_search";
  const isInstagram = channel === "instagram";
  const isPinterest = channel === "pinterest";
  const naturalWidth = device === "mobile" ? 375 : isVertical ? 330 : isInstagram ? 850 : isPinterest ? 800 : isSite ? 860 : channel === "youtube_shorts" ? 760 : channel === "gmb" ? 480 : 560;
  useEffect(() => {
    const panel = panelRef.current, scene = sceneRef.current;
    if (!panel || !scene) return;
    let frame = 0;
    const measure = () => {
      const width = scene.offsetWidth, height = scene.offsetHeight;
      if (!width || !height || !panel.clientWidth || !panel.clientHeight) return;
      const scale = Math.max(.01, Math.min(1, (panel.clientWidth - 4) / width, (panel.clientHeight - 4) / height));
      const next = { width: width * scale, height: height * scale, scale };
      setFit((previous) => previous.width === next.width && previous.height === next.height && previous.scale === next.scale ? previous : next);
    };
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); });
    observer.observe(panel);
    observer.observe(scene);
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [naturalWidth, channel, device]);
  const account = preview.accountName || shellT("votre_entreprise_c001322f");
  const initial = account.replace(/^(?:https?:\/\/|@)/, "").charAt(0).toUpperCase();
  const handle = account.startsWith("@") ? account : "@" + account.toLowerCase().replace(/[^\p{L}\p{N}_.]/gu, "");
  const showAfterMedia = isInstagram || isPinterest || channel === "gmb";
  const media = <NativeMedia key={`${channel}-${device}`} images={images} video={video} channel={channel} vertical={isVertical} onOpen={onOpen} />;
  const avatar = <span className={css.avatar}>{initial}</span>;
  const accountHeader = <div className={css.accountHeader}>{avatar}<div><strong>{channel === "x" || channel === "threads" ? handle : account}</strong><small>{channel === "linkedin" ? preview.channelLabel : boosterT("wizard_preview_now")}<span aria-hidden="true"> · ◉</span></small></div><span className={css.moreMenu} aria-hidden="true">•••</span></div>;
  const copy = <div className={css.copy} data-expanded={expanded}>
    {isSite ? <>
      {title ? <h2 dangerouslySetInnerHTML={{ __html: renderSafeSiteInlineHtml(title) }} /> : null}
      {content ? <div className={css.contentText} dangerouslySetInnerHTML={{ __html: renderSafeSiteInlineHtml(content) }} /> : null}
    </> : <div className={css.contentText}>{isInstagram ? <strong>{handle} </strong> : null}{title ? <strong>{title}{content ? "\n\n" : ""}</strong> : null}{content}</div>}
    {(title.length + content.length > 350) && !expanded ? <button type="button" className={css.readMore} onClick={() => setExpanded(true)}>{boosterT("wizard_preview_more")}</button> : null}
    {hashtags.length ? <div className={css.hashtags}>{hashtags.map((tag) => `#${tag}`).join(" ")}</div> : null}
    {cta ? <span className={css.cta}>{cta}</span> : null}
  </div>;
  const actions = <div className={css.postActions} aria-hidden="true">
    <span><Icon name={channel === "facebook" || channel === "linkedin" ? "like" : "heart"} />{channel === "facebook" || channel === "linkedin" ? shellT("j_aime_b75f4622") : null}</span>
    <span><Icon name="comment" />{channel === "facebook" || channel === "linkedin" ? shellT("commenter_bf4df9c0") : null}</span>
    <span><Icon name={channel === "x" || channel === "threads" || channel === "linkedin" ? "repeat" : "share"} />{channel === "facebook" ? shellT("partager_cbcb7f0c") : channel === "linkedin" ? shellT("republier_d9aef6c4") : null}</span>
    <span className={css.saveAction}><Icon name="save" /></span>
  </div>;

  return <section className={css.preview}>
    <div className={css.devicePanel} ref={panelRef} id={panelId} role="tabpanel" aria-labelledby={`${panelId}-${device}`} tabIndex={0}>
      <div className={css.scaleFrame} style={{ width: fit.width, height: fit.height }}>
      <div className={css.scene} ref={sceneRef} data-channel={channel} data-device={device} style={{ width: naturalWidth, transform: `scale(${fit.scale})`, visibility: fit.height ? "visible" : "hidden" }}>
          <article className={css.post} data-vertical={isVertical}>
            {isVertical ? <>
              <div className={css.verticalStage}>{media}<div className={css.verticalCaption}>{avatar}<strong>{handle}</strong>{copy}</div><div className={css.verticalActions} aria-hidden="true"><Icon name="heart" size={27} /><Icon name="comment" size={25} /><Icon name="share" size={25} /><Icon name="save" size={25} /></div></div>
              {channel === "youtube_shorts" ? <div className={css.youtubeTitle}><span>{account}</span><span className={css.subscribe}>{boosterT("wizard_preview_subscribe")}</span></div> : null}
            </> : channel === "youtube_shorts" ? <>
              {media}{copy}<div className={css.youtubeAccount}>{accountHeader}<span className={css.subscribe}>{boosterT("wizard_preview_subscribe")}</span></div>{actions}
            </> : isSite ? <>
              <div className={css.siteHeading}><strong>{boosterT("wizard_preview_news")}</strong></div><div className={css.siteArticle}>{media}{copy}</div>
            </> : isPinterest ? <>
              <div className={css.pinMedia}>{media}</div><div className={css.pinDetails}><div className={css.pinToolbar}><Icon name="share" /><span className={css.pinSave}>{boosterT("wizard_preview_save")}</span></div>{copy}{accountHeader}</div>
            </> : isInstagram && device === "desktop" ? <>
              <div className={css.instagramMedia}>{media}</div><div className={css.instagramDetails}>{accountHeader}{copy}{actions}</div>
            </> : <>
              {accountHeader}{!showAfterMedia ? copy : null}
              {media}
              {isInstagram ? actions : null}{showAfterMedia ? copy : null}
              {channel !== "gmb" && !isInstagram ? actions : null}
            </>}
          </article>
      </div>
      </div>
    </div>
  </section>;
}
