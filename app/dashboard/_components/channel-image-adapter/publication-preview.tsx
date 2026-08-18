import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";

import type { BackgroundMode, PreviewImage, PreviewVideo, PublicationPreview } from "./types";

import { useViewportWidth } from "./hooks";

import { FinalImageFrame, PublicationPreviewLightbox, VideoPreviewFrame } from "./frames";

import { clampNumber, cleanNetworkText, cleanText, renderSafeSiteInlineHtml } from "./utils";


function PreviewBlockShell({
  eyebrow,
  title,
  formatLabel,
  children,
  note,
}: {
  eyebrow: string;
  title: string;
  formatLabel?: string;
  children: React.ReactNode;
  note?: string;
}) {
  const viewportWidth = useViewportWidth();
  const isMobile = viewportWidth <= 640;
  const technicalInfo = [eyebrow, formatLabel].filter(Boolean).join(" · ");

  return (
    <section
      style={{
        display: "grid",
        gap: isMobile ? 10 : 12,
        padding: isMobile ? 12 : 16,
        borderRadius: isMobile ? 18 : 22,
        border: "1px solid rgba(76,195,255,0.18)",
        background: "linear-gradient(180deg, rgba(76,195,255,0.090), rgba(255,255,255,0.030))",
        boxShadow: "0 18px 55px rgba(2,6,23,0.18)",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "baseline",
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        <div
          style={{
            color: "#ffffff",
            fontWeight: 950,
            fontSize: isMobile ? 15 : 16,
            lineHeight: 1.2,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        {technicalInfo ? (
          <div
            style={{
              color: "rgba(226,232,240,0.76)",
              fontSize: isMobile ? 11 : 12,
              lineHeight: 1.25,
            }}
          >
            — {technicalInfo}
          </div>
        ) : null}
      </div>
      {children}
      {note && !isMobile ? <div style={{ fontSize: 11, opacity: 0.62 }}>{note}</div> : null}
    </section>
  );
}

function DeviceGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
      {children}
    </div>
  );
}

function DeviceCard({ label, children, compact = false }: { label: string; children: React.ReactNode; compact?: boolean }) {
  return (
    <div style={{ display: "grid", gap: compact ? 7 : 8, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.68 }}>{label}</div>
      {children}
    </div>
  );
}

function DevicePreviewSwitcher({ desktop, mobile }: { desktop: React.ReactNode; mobile: React.ReactNode }) {
  const i18nT = useTranslations("shell");
  const viewportWidth = useViewportWidth();
  const isMobileViewport = viewportWidth <= 640;
  const [active, setActive] = useState<"mobile" | "desktop">("mobile");
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  if (!isMobileViewport) {
    return (
      <DeviceGrid>
        <DeviceCard label={i18nT("desktop_532c67fe")}>{desktop}</DeviceCard>
        <DeviceCard label={i18nT("mobile_b1d70245")}>{mobile}</DeviceCard>
      </DeviceGrid>
    );
  }

  const showDesktop = active === "desktop";
  const activeLabel = showDesktop ? "Desktop" : "Mobile";
  const goPrevious = () => setActive((value) => (value === "mobile" ? "desktop" : "mobile"));
  const goNext = goPrevious;

  return (
    <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 4, borderRadius: 999, background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.08)" }}>
        {(["mobile", "desktop"] as const).map((mode) => {
          const selected = active === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setActive(mode)}
              style={{
                minHeight: 34,
                border: selected ? "1px solid rgba(76,195,255,0.42)" : "1px solid transparent",
                borderRadius: 999,
                background: selected ? "rgba(76,195,255,0.18)" : "transparent",
                color: "#fff",
                fontWeight: 900,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {mode === "mobile" ? i18nT("mobile_b1d70245") : i18nT("desktop_532c67fe")}
            </button>
          );
        })}
      </div>

      <div
        onTouchStart={(event) => setTouchStartX(event.touches[0]?.clientX ?? null)}
        onTouchEnd={(event) => {
          if (touchStartX === null) return;
          const endX = event.changedTouches[0]?.clientX ?? touchStartX;
          const delta = endX - touchStartX;
          if (Math.abs(delta) > 42) setActive(delta < 0 ? "desktop" : "mobile");
          setTouchStartX(null);
        }}
        style={{
          position: "relative",
          minWidth: 0,
          borderRadius: 18,
          padding: 10,
          background: "rgba(2,6,23,0.24)",
          border: "1px solid rgba(255,255,255,0.08)",
          overflow: "hidden",
          touchAction: "pan-y",
        }}
      >
        <DeviceCard label={activeLabel} compact>{showDesktop ? desktop : mobile}</DeviceCard>

        <button type="button" onClick={goPrevious} aria-label={i18nT("apercu_precedent_32003d48")} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: 999, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(2,6,23,0.54)", color: "#fff", cursor: "pointer" }}>‹</button>
        <button type="button" onClick={goNext} aria-label={i18nT("apercu_suivant_6a2b57ef")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: 999, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(2,6,23,0.54)", color: "#fff", cursor: "pointer" }}>›</button>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: 7 }}>
        <button type="button" onClick={() => setActive("mobile")} aria-label={i18nT("voir_l_apercu_mobile_5b1b11ea")} style={{ width: active === "mobile" ? 18 : 7, height: 7, borderRadius: 999, border: 0, padding: 0, background: active === "mobile" ? "#ffffff" : "rgba(255,255,255,0.42)", cursor: "pointer", transition: "width 160ms ease" }} />
        <button type="button" onClick={() => setActive("desktop")} aria-label={i18nT("voir_l_apercu_desktop_58cf1dca")} style={{ width: active === "desktop" ? 18 : 7, height: 7, borderRadius: 999, border: 0, padding: 0, background: active === "desktop" ? "#ffffff" : "rgba(255,255,255,0.42)", cursor: "pointer", transition: "width 160ms ease" }} />
      </div>
    </div>
  );
}

function SocialCarouselPreview({
  images,
  aspectRatio,
  fallbackMode,
  dark = false,
  onOpen,
}: {
  images: PreviewImage[];
  aspectRatio: string;
  fallbackMode: BackgroundMode;
  dark?: boolean;
  onOpen: (index: number) => void;
}) {
  const i18nT = useTranslations("shell");
  const [index, setIndex] = useState(0);
  const safeImages = images.length ? images : [];

  useEffect(() => {
    if (!safeImages.length) return;
    setIndex((prev) => clampNumber(prev, 0, safeImages.length - 1));
  }, [safeImages.length]);

  if (!safeImages.length) {
    return <div style={{ borderRadius: 18, overflow: "hidden" }}><FinalImageFrame image={null} aspectRatio={aspectRatio} fallbackMode={fallbackMode} /></div>;
  }

  const current = safeImages[clampNumber(index, 0, safeImages.length - 1)] || safeImages[0];

  return (
    <div style={{ position: "relative", borderRadius: 18, overflow: "hidden", minWidth: 0 }}>
      <button type="button" onClick={() => onOpen(index)} style={{ display: "block", width: "100%", border: 0, padding: 0, background: "transparent", cursor: "pointer" }}>
        <FinalImageFrame image={current} aspectRatio={aspectRatio} fallbackMode={fallbackMode} badge={safeImages.length > 1 ? `Carousel ${index + 1} / ${safeImages.length}` : "Cliquez"} />
      </button>
      {safeImages.length > 1 ? (
        <>
          <button type="button" onClick={() => setIndex((prev) => (prev - 1 + safeImages.length) % safeImages.length)} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 34, height: 34, borderRadius: 999, border: "1px solid rgba(255,255,255,0.14)", background: dark ? "rgba(2,6,23,0.68)" : "rgba(255,255,255,0.92)", color: dark ? "#fff" : "#111827", cursor: "pointer" }}>‹</button>
          <button type="button" onClick={() => setIndex((prev) => (prev + 1) % safeImages.length)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 34, height: 34, borderRadius: 999, border: "1px solid rgba(255,255,255,0.14)", background: dark ? "rgba(2,6,23,0.68)" : "rgba(255,255,255,0.92)", color: dark ? "#fff" : "#111827", cursor: "pointer" }}>›</button>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 10, display: "flex", justifyContent: "center", gap: 6 }}>
            {safeImages.map((_, dotIndex) => (
              <button key={dotIndex} type="button" onClick={() => setIndex(dotIndex)} style={{ width: 7, height: 7, borderRadius: 999, border: 0, padding: 0, background: dotIndex === index ? "#ffffff" : "rgba(255,255,255,0.45)", cursor: "pointer" }} aria-label={i18nT("aller_a_l_image_value_869fd38d", { value0: dotIndex + 1 })} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function StackedImageGridPreview({
  images,
  aspectRatio,
  fallbackMode,
  onOpen,
}: {
  images: PreviewImage[];
  aspectRatio: string;
  fallbackMode: BackgroundMode;
  onOpen: (index: number) => void;
}) {
  const safeImages = images.length ? images : [];
  if (!safeImages.length) {
    return <div style={{ borderRadius: 18, overflow: "hidden" }}><FinalImageFrame image={null} aspectRatio={aspectRatio} fallbackMode={fallbackMode} /></div>;
  }
  if (safeImages.length === 1) {
    return (
      <div style={{ borderRadius: 18, overflow: "hidden" }}>
        <button type="button" onClick={() => onOpen(0)} style={{ display: "block", width: "100%", border: 0, padding: 0, background: "transparent", cursor: "pointer" }}>
          <FinalImageFrame image={safeImages[0]} aspectRatio={aspectRatio} fallbackMode={fallbackMode} badge="Cliquez" />
        </button>
      </div>
    );
  }
  const visible = safeImages.slice(0, 4);
  const extraCount = safeImages.length - visible.length;
  const largeFirst = visible.length === 3;
  return (
    <div style={{ display: "grid", gap: 4, gridTemplateColumns: largeFirst ? "1.15fr 1fr" : "repeat(2, minmax(0, 1fr))", minWidth: 0 }}>
      {visible.map((img, index) => {
        const cell = (
          <button type="button" onClick={() => onOpen(index)} style={{ position: "relative", display: "block", width: "100%", border: 0, padding: 0, background: "transparent", cursor: "pointer" }}>
            <div style={{ borderRadius: index === 0 ? 18 : 14, overflow: "hidden" }}>
              <FinalImageFrame image={img} aspectRatio={largeFirst ? "1 / 1" : aspectRatio} fallbackMode={fallbackMode} />
            </div>
            {extraCount > 0 && index === visible.length - 1 ? <div style={{ position: "absolute", inset: 0, borderRadius: 14, background: "rgba(2,6,23,0.45)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 900, fontSize: 28 }}>+{extraCount}</div> : null}
          </button>
        );
        if (!largeFirst) return <div key={index}>{cell}</div>;
        if (index === 0) return <div key={index} style={{ gridRow: "1 / span 2" }}>{cell}</div>;
        return <div key={index}>{cell}</div>;
      })}
    </div>
  );
}

function SitePreviewCard({
  mode,
  title,
  content,
  cta,
  images,
  video,
  isInrcySite,
  onOpen,
}: {
  mode: "desktop" | "mobile";
  title: string;
  content: string;
  cta: string;
  images: PreviewImage[];
  video?: PreviewVideo | null;
  isInrcySite: boolean;
  onOpen: (index: number) => void;
}) {
  const i18nT = useTranslations("shell");
  const accent = isInrcySite ? "#4cc3ff" : "#111827";
  const isMobile = mode === "mobile";
  const safeImages = images.length ? images : [];
  const mediaAspectRatio = isMobile ? "4 / 3" : "16 / 10";
  return (
    <div style={{ width: "100%", maxWidth: isMobile ? 360 : 680, margin: "0 auto", borderRadius: isMobile ? 24 : 18, background: "#ffffff", color: "#111827", padding: isMobile ? 12 : 14, boxShadow: "0 16px 45px rgba(0,0,0,0.22)", minWidth: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: isMobile ? 14 : 15, fontWeight: 900 }}>{i18nT("actualites_a3baa78e")}</div>
        <div style={{ fontSize: 10, fontWeight: 900, color: accent, textTransform: "uppercase", letterSpacing: 0.4 }}>{isMobile ? i18nT("mobile_b1d70245") : i18nT("desktop_532c67fe")}</div>
      </div>
      <article style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 0.95fr) minmax(0, 1fr)", gap: isMobile ? 10 : 14, alignItems: "start", minWidth: 0 }}>
        <div style={{ borderRadius: isInrcySite ? 16 : 10, overflow: "hidden", background: "#eef2f7", minWidth: 0 }}>
          {video?.previewUrl ? (
            <VideoPreviewFrame video={video} aspectRatio={mediaAspectRatio} badge="Vidéo site" />
          ) : safeImages.length > 1 ? (
            <SocialCarouselPreview images={safeImages} aspectRatio={mediaAspectRatio} fallbackMode="color" onOpen={onOpen} />
          ) : (
            <button type="button" onClick={() => onOpen(0)} style={{ display: "block", width: "100%", border: 0, padding: 0, background: "transparent", cursor: safeImages[0] ? "pointer" : "default" }}>
              <FinalImageFrame image={safeImages[0] || null} aspectRatio={mediaAspectRatio} fallbackMode="color" badge={safeImages[0] ? "Cliquez" : undefined} />
            </button>
          )}
        </div>
        <div style={{ minWidth: 0, display: "grid", gap: isMobile ? 7 : 8 }}>
          <h3
            style={{ fontSize: isMobile ? 15 : 18, lineHeight: 1.15, margin: 0, color: "#0f172a", display: "-webkit-box", WebkitLineClamp: isMobile ? 2 : 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}
            dangerouslySetInnerHTML={{ __html: renderSafeSiteInlineHtml(title) }}
          />
          <p
            style={{ fontSize: isMobile ? 12 : 13, lineHeight: isMobile ? 1.42 : 1.45, margin: 0, color: "#475569", display: "-webkit-box", WebkitLineClamp: isMobile ? 4 : 5, WebkitBoxOrient: "vertical", overflow: "hidden" }}
            dangerouslySetInnerHTML={{ __html: renderSafeSiteInlineHtml(content) }}
          />
          {cta ? <span style={{ justifySelf: "start", marginTop: 1, padding: isMobile ? "7px 10px" : "8px 12px", borderRadius: isInrcySite ? 999 : 8, background: accent, color: "#fff", fontSize: isMobile ? 11 : 12, fontWeight: 800 }}>{cta}</span> : null}
        </div>
      </article>
    </div>
  );
}

function GoogleBusinessPreviewCard({ mode, title, content, cta, image, video, onOpen }: { mode: "desktop" | "mobile"; title: string; content: string; cta: string; image: PreviewImage | null; video?: PreviewVideo | null; onOpen: () => void }) {
  const i18nT = useTranslations("shell");
  const isMobile = mode === "mobile";
  return (
    <article style={{ width: "100%", maxWidth: isMobile ? 360 : 620, margin: "0 auto", borderRadius: isMobile ? 24 : 22, background: "#ffffff", color: "#111827", overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "0 16px 45px rgba(0,0,0,0.22)", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: isMobile ? "12px" : "12px 14px" }}>
        <div style={{ width: isMobile ? 26 : 28, height: isMobile ? 26 : 28, borderRadius: 999, background: "#e5e7eb" }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 900 }}>{i18nT("votre_entreprise_c001322f")}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>{i18nT("google_business_profile_b3776811")}</div>
        </div>
      </div>
      <div style={{ padding: isMobile ? "0 12px" : "0 14px" }}>
        <div style={{ borderRadius: 16, overflow: "hidden", background: "#eef2f7" }}>
          {video?.previewUrl ? (
            <VideoPreviewFrame video={video} aspectRatio="4 / 3" badge="Vidéo" />
          ) : (
            <button type="button" onClick={onOpen} style={{ display: "block", width: "100%", border: 0, padding: 0, background: "transparent", cursor: image ? "pointer" : "default" }}>
              <FinalImageFrame image={image} aspectRatio="4 / 3" fallbackMode="color" />
            </button>
          )}
        </div>
      </div>
      <div style={{ display: "grid", gap: 9, padding: isMobile ? 12 : 16 }}>
        <div style={{ fontSize: isMobile ? 15 : 16, fontWeight: 900, lineHeight: 1.25 }}>{title}</div>
        <div style={{ fontSize: isMobile ? 13 : 14, lineHeight: 1.55, whiteSpace: "pre-wrap", color: "#374151", display: "-webkit-box", WebkitLineClamp: isMobile ? 5 : 7, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{content}</div>
        {cta ? <div style={{ justifySelf: "start", padding: "8px 12px", borderRadius: 999, background: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 800 }}>{cta}</div> : null}
      </div>
    </article>
  );
}

function InstagramPreviewCard({
  mode,
  titleValue,
  title,
  content,
  cta,
  hashtags,
  images,
  video,
  onOpen,
}: {
  mode: "desktop" | "mobile";
  titleValue: string;
  title: string;
  content: string;
  cta: string;
  hashtags: string[];
  images: PreviewImage[];
  video?: PreviewVideo | null;
  onOpen: (index: number) => void;
}) {
  const i18nT = useTranslations("shell");
  const isMobile = mode === "mobile";
  const caption = titleValue ? `${title}\n\n${content}` : content;
  const hasVideo = !!video?.previewUrl;

  if (isMobile) {
    return (
      <article style={{ width: "100%", maxWidth: 360, margin: "0 auto", borderRadius: 24, background: "#ffffff", color: "#111827", overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "0 16px 45px rgba(0,0,0,0.22)", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 12px 10px" }}>
          <div style={{ width: 32, height: 32, borderRadius: 999, background: "#f3f4f6" }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 13 }}>{i18nT("votre_entreprise_c001322f")}</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>{i18nT("instagram_5721bbef")}</div>
          </div>
        </div>
        {hasVideo ? (
          <VideoPreviewFrame video={video} aspectRatio="4 / 5" badge="Vidéo Instagram" dark />
        ) : (
          <SocialCarouselPreview images={images} aspectRatio="4 / 5" fallbackMode="black" dark onOpen={onOpen} />
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 12px 0", fontSize: 18 }}>
          <div style={{ display: "flex", gap: 12 }}><span>♡</span><span>💬</span><span>➤</span></div><span>⌑</span>
        </div>
        <div style={{ display: "grid", gap: 8, padding: "8px 12px 14px" }}>
          <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 8, WebkitBoxOrient: "vertical", overflow: "hidden" }}><span style={{ fontWeight: 900 }}>{i18nT("votre_entreprise_c001322f")}</span> {caption}</div>
          {cta ? <div style={{ fontSize: 12, fontWeight: 800, color: "#2563eb" }}>{cta}</div> : null}
          {hashtags.length ? <div style={{ fontSize: 12, lineHeight: 1.5, color: "#2563eb" }}>{hashtags.map((tag) => `#${tag}`).join(" ")}</div> : null}
        </div>
      </article>
    );
  }

  return (
    <article style={{ width: "100%", maxWidth: 880, margin: "0 auto", borderRadius: 22, background: "#ffffff", color: "#111827", overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "0 16px 45px rgba(0,0,0,0.22)", display: "grid", gridTemplateColumns: "minmax(0, 1.08fr) minmax(0, 0.92fr)", minWidth: 0 }}>
      <div style={{ minWidth: 0, background: "#000" }}>
        {hasVideo ? (
          <VideoPreviewFrame video={video} aspectRatio="4 / 5" badge="Vidéo Instagram" dark />
        ) : (
          <SocialCarouselPreview images={images} aspectRatio="4 / 5" fallbackMode="black" dark onOpen={onOpen} />
        )}
      </div>
      <div style={{ minWidth: 0, display: "grid", gridTemplateRows: "auto 1fr auto", maxHeight: 560 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ width: 36, height: 36, borderRadius: 999, background: "#f3f4f6" }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 14 }}>{i18nT("votre_entreprise_c001322f")}</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{i18nT("instagram_5721bbef")}</div>
          </div>
        </div>
        <div style={{ padding: 16, overflow: "hidden", display: "grid", gap: 10, alignContent: "start" }}>
          <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 12, WebkitBoxOrient: "vertical", overflow: "hidden" }}><span style={{ fontWeight: 900 }}>{i18nT("votre_entreprise_c001322f")}</span> {caption}</div>
          {cta ? <div style={{ fontSize: 13, fontWeight: 800, color: "#2563eb" }}>{cta}</div> : null}
          {hashtags.length ? <div style={{ fontSize: 13, lineHeight: 1.5, color: "#2563eb" }}>{hashtags.map((tag) => `#${tag}`).join(" ")}</div> : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px", borderTop: "1px solid #e5e7eb", color: "#6b7280", fontSize: 12 }}>
          <div style={{ display: "flex", gap: 12 }}><span>♡</span><span>💬</span><span>➤</span></div>
          <div>{hasVideo ? i18nT("1_video_33cad806") : images.length > 1 ? `${images.length} photos` : i18nT("1_photo_ce70caaa")}</div>
        </div>
      </div>
    </article>
  );
}

function FeedPreviewCard({ mode, channel, title, content, cta, hashtags = [], images, video, onOpen }: { mode: "desktop" | "mobile"; channel: "facebook" | "linkedin" | "tiktok" | "youtube_shorts"; title: string; content: string; cta: string; hashtags?: string[]; images: PreviewImage[]; video?: PreviewVideo | null; onOpen: (index: number) => void }) {
  const i18nT = useTranslations("shell");
  const isMobile = mode === "mobile";
  const isLinkedin = channel === "linkedin";
  const isTiktok = channel === "tiktok";
  const isYoutubeShorts = channel === "youtube_shorts";
  const normalizedVideoAspect = String(video?.aspectRatio || "").replace(/\s+/g, "");
  const isVerticalVideo = normalizedVideoAspect === "9/16";
  const isSquareVideo = normalizedVideoAspect === "1/1";
  const videoDuration = Number(video?.duration || 0);
  const isLikelyYoutubeShort = isYoutubeShorts && (isVerticalVideo || isSquareVideo) && (!Number.isFinite(videoDuration) || videoDuration <= 0 || videoDuration <= 180);
  const isShortVideoChannel = isTiktok || isLikelyYoutubeShort;
  const label = isYoutubeShorts ? "YouTube" : isTiktok ? "TikTok" : isLinkedin ? "LinkedIn" : "Facebook";
  const maxWidth = isShortVideoChannel
    ? (isMobile ? 230 : 260)
    : isVerticalVideo
      ? (isMobile ? 292 : 340)
      : isSquareVideo
        ? (isMobile ? 330 : 500)
        : (isMobile ? 350 : 620);
  const avatarSize = isShortVideoChannel ? (isMobile ? 28 : 34) : (isMobile ? 34 : 40);
  return (
    <article style={{ width: "100%", maxWidth, margin: "0 auto", borderRadius: isMobile ? 24 : 22, background: "#ffffff", color: "#111827", overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "0 16px 45px rgba(0,0,0,0.22)", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: isShortVideoChannel ? 8 : 10, padding: isShortVideoChannel ? (isMobile ? "9px 10px 6px" : "10px 12px 7px") : (isMobile ? "12px 12px 8px" : "14px 16px 10px") }}>
        <div style={{ width: avatarSize, height: avatarSize, borderRadius: 999, background: "#e5e7eb", flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: isShortVideoChannel ? (isMobile ? 11.5 : 12.5) : (isMobile ? 13 : 14), fontWeight: 900 }}>{isLinkedin ? i18nT("votre_entreprise_1er_8b45e231") : isTiktok ? i18nT("votreentreprise_5efc2bb5") : isYoutubeShorts ? i18nT("votre_chaine_1c8c877f") : i18nT("votre_entreprise_c001322f")}</div>
          <div style={{ fontSize: isShortVideoChannel ? 10.5 : 12, color: "#6b7280" }}>{label}</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: isShortVideoChannel ? 8 : 12, padding: isShortVideoChannel ? (isMobile ? "0 10px 10px" : "0 12px 12px") : (isMobile ? "0 12px 12px" : "0 16px 14px") }}>
        <div style={{ fontSize: isShortVideoChannel ? (isMobile ? 11.5 : 12.5) : (isMobile ? 13 : 14), lineHeight: isShortVideoChannel ? 1.45 : 1.55, whiteSpace: "pre-wrap", color: "#111827" }}>
          <div style={{ fontWeight: 900, marginBottom: isShortVideoChannel ? 5 : 8 }}>{title}</div>
          <div style={{ display: "-webkit-box", WebkitLineClamp: isShortVideoChannel ? (isMobile ? 3 : 4) : (isMobile ? 5 : 7), WebkitBoxOrient: "vertical", overflow: "hidden" }}>{content}</div>
          {cta ? <div style={{ marginTop: isShortVideoChannel ? 6 : 10, fontWeight: 800, color: isShortVideoChannel ? "#111827" : isLinkedin ? "#0a66c2" : "#1877f2" }}>{cta}</div> : null}
          {hashtags.length ? <div style={{ marginTop: isShortVideoChannel ? 5 : 8, fontWeight: 800, color: isShortVideoChannel ? "#111827" : isLinkedin ? "#0a66c2" : "#1877f2" }}>{hashtags.map((tag) => `#${tag}`).join(" ")}</div> : null}
        </div>
        {video?.previewUrl ? <div style={{ borderRadius: isTiktok ? 14 : 18, overflow: "hidden", background: isShortVideoChannel ? "#000" : undefined }}><VideoPreviewFrame video={video} aspectRatio={isShortVideoChannel ? (video.aspectRatio || "9 / 16") : (video.aspectRatio || "1 / 1")} badge={`Vidéo ${label}`} /></div> : <StackedImageGridPreview images={images} aspectRatio={isShortVideoChannel ? "9 / 16" : "1 / 1"} fallbackMode={isShortVideoChannel ? "black" : "color"} onOpen={onOpen} />}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: isShortVideoChannel ? 7 : 10, paddingTop: 4, borderTop: "1px solid #e5e7eb", color: "#6b7280", fontSize: isShortVideoChannel ? 10.5 : 12, flexWrap: "wrap" }}>
          <div>{video?.previewUrl ? i18nT("1_video_33cad806") : images.length > 1 ? i18nT("value_photos_cliquez_pour_ouvrir_e8f5fc98", { value0: images.length }) : i18nT("1_photo_cliquez_pour_ouvrir_0db64f1f")}</div>
          <div style={{ display: "flex", gap: 12 }}>
            <span>{i18nT("j_aime_b75f4622")}</span>
            <span>{i18nT("commenter_bf4df9c0")}</span>
            <span>{isLinkedin ? i18nT("republier_d9aef6c4") : i18nT("partager_cbcb7f0c")}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

export function ChannelPublicationPreview({ preview }: { preview: PublicationPreview }) {
  const key = String(preview.channelKey || "");
  const isSite = key === "inrcy_site" || key === "site_web" || key === "site";
  const isInstagram = key === "instagram";
  const isLinkedin = key === "linkedin";
  const isTiktok = key === "tiktok";
  const normalizedKey = key.replace(/[\s-]+/g, "_");
  const isYoutubeShorts = normalizedKey === "youtube_shorts" || normalizedKey === "youtube" || normalizedKey === "youtube_short";
  const isGmb = key === "gmb" || key === "google_business" || key === "google_business_profile";
  const rawTitleValue = isSite ? String(preview.title || "").trim() : cleanText(preview.title);
  const rawContentValue = isSite ? String(preview.content || "").trim() : cleanText(preview.content);
  const titleValue = isSite ? rawTitleValue : cleanNetworkText(rawTitleValue);
  const contentValue = isSite ? rawContentValue : cleanNetworkText(rawContentValue);
  const title = titleValue || "Titre de la publication";
  const content = contentValue || "Le contenu apparaîtra ici.";
  const cta = isSite ? cleanText(preview.cta) : cleanNetworkText(preview.cta);
  const hashtags = (preview.hashtags || []).map((tag) => String(tag || "").replace(/^#+/, "").trim()).filter(Boolean).slice(0, 8);
  const fallbackPreset = isSite ? { width: 1440, height: 900 } : (isTiktok || isYoutubeShorts) ? { width: 1080, height: 1920 } : isInstagram ? { width: 1080, height: 1350 } : isGmb ? { width: 1200, height: 900 } : { width: 1200, height: 1200 };
  const rawImages = (preview.images || []).filter((item) => item?.previewUrl);
  const image = preview.image ? { ...preview.image, preset: preview.image.preset || fallbackPreset } : null;
  const images = (rawImages.length ? rawImages : image ? [image] : []).map((item) => ({ ...item, preset: item.preset || fallbackPreset }));
  const firstImage = images[0] || image || null;
  const video = preview.mediaType === "video" && preview.video?.previewUrl ? preview.video : null;
  const hasVideo = !!video;
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);

  if (isSite) {
    const isInrcySite = key === "inrcy_site";
    return (
      <>
        <PreviewBlockShell eyebrow="rendu iframe intégré" title={preview.channelLabel} note={hasVideo ? "Aperçu séparé desktop/mobile avec lecteur vidéo intégré." : "Aperçu séparé desktop/mobile. Dès qu’il y a 2 images ou plus, le site passe en carousel. Cliquez sur une image pour l’ouvrir en grand."}>
          <DevicePreviewSwitcher
            desktop={<SitePreviewCard mode="desktop" title={title} content={content} cta={cta} images={images} video={video} isInrcySite={isInrcySite} onOpen={openLightbox} />}
            mobile={<SitePreviewCard mode="mobile" title={title} content={content} cta={cta} images={images} video={video} isInrcySite={isInrcySite} onOpen={openLightbox} />}
          />
        </PreviewBlockShell>
        {!hasVideo ? <PublicationPreviewLightbox open={lightboxIndex !== null} images={images} initialIndex={lightboxIndex || 0} aspectRatio="16 / 10" fallbackMode="color" onClose={closeLightbox} /> : null}
      </>
    );
  }

  if (isInstagram) {
    return (
      <>
        <PreviewBlockShell eyebrow={preview.formatLabel || "image finale"} title={preview.channelLabel} note={hasVideo ? "Instagram : lecteur vidéo à gauche en desktop, vidéo puis légende en mobile." : "Instagram : desktop avec média à gauche et légende à droite. Mobile : image puis contenu en dessous. Carousel simulé si plusieurs photos."}>
          <DevicePreviewSwitcher
            desktop={<InstagramPreviewCard mode="desktop" titleValue={titleValue} title={title} content={content} cta={cta} hashtags={hashtags} images={images} video={video} onOpen={openLightbox} />}
            mobile={<InstagramPreviewCard mode="mobile" titleValue={titleValue} title={title} content={content} cta={cta} hashtags={hashtags} images={images} video={video} onOpen={openLightbox} />}
          />
        </PreviewBlockShell>
        {!hasVideo ? <PublicationPreviewLightbox open={lightboxIndex !== null} images={images} initialIndex={lightboxIndex || 0} aspectRatio="4 / 5" fallbackMode="black" onClose={closeLightbox} /> : null}
      </>
    );
  }

  if (isGmb) {
    return (
      <>
        <PreviewBlockShell eyebrow={preview.formatLabel || "image finale"} title={preview.channelLabel} note={hasVideo ? "Google Business : aperçu vidéo en haut, contenu en dessous. Compatibilité publication API à valider à l’étape canaux." : "Google Business : photo en haut, contenu en dessous, en desktop comme en mobile."}>
          <DevicePreviewSwitcher
            desktop={<GoogleBusinessPreviewCard mode="desktop" title={title} content={content} cta={cta} image={firstImage} video={video} onOpen={() => openLightbox(0)} />}
            mobile={<GoogleBusinessPreviewCard mode="mobile" title={title} content={content} cta={cta} image={firstImage} video={video} onOpen={() => openLightbox(0)} />}
          />
        </PreviewBlockShell>
        {!hasVideo ? <PublicationPreviewLightbox open={lightboxIndex !== null} images={images} initialIndex={lightboxIndex || 0} aspectRatio="4 / 3" fallbackMode="color" onClose={closeLightbox} /> : null}
      </>
    );
  }

  if (isTiktok) {
    return (
      <>
        <PreviewBlockShell eyebrow={preview.formatLabel || "format TikTok"} title={preview.channelLabel} note={hasVideo ? "TikTok : aperçu desktop + mobile en version compacte, format vertical recommandé." : "TikTok : aperçu desktop + mobile compact. Clic sur les photos = carousel."}>
          <DevicePreviewSwitcher
            desktop={<FeedPreviewCard mode="desktop" channel="tiktok" title={title} content={content} cta={cta} hashtags={hashtags} images={images} video={video} onOpen={openLightbox} />}
            mobile={<FeedPreviewCard mode="mobile" channel="tiktok" title={title} content={content} cta={cta} hashtags={hashtags} images={images} video={video} onOpen={openLightbox} />}
          />
        </PreviewBlockShell>
        {!hasVideo ? <PublicationPreviewLightbox open={lightboxIndex !== null} images={images} initialIndex={lightboxIndex || 0} aspectRatio="9 / 16" fallbackMode="black" onClose={closeLightbox} /> : null}
      </>
    );
  }

  if (isYoutubeShorts) {
    return (
      <>
        <PreviewBlockShell eyebrow={preview.formatLabel || "format YouTube"} title={preview.channelLabel} note={hasVideo ? "YouTube : aperçu de la vidéo publiée. Si elle est courte et verticale/carrée, YouTube peut l’afficher au format court." : "YouTube : ce canal attend une vidéo."}>
          <DevicePreviewSwitcher
            desktop={<FeedPreviewCard mode="desktop" channel="youtube_shorts" title={title} content={content} cta={cta} hashtags={hashtags} images={images} video={video} onOpen={openLightbox} />}
            mobile={<FeedPreviewCard mode="mobile" channel="youtube_shorts" title={title} content={content} cta={cta} hashtags={hashtags} images={images} video={video} onOpen={openLightbox} />}
          />
        </PreviewBlockShell>
        {!hasVideo ? <PublicationPreviewLightbox open={lightboxIndex !== null} images={images} initialIndex={lightboxIndex || 0} aspectRatio="9 / 16" fallbackMode="black" onClose={closeLightbox} /> : null}
      </>
    );
  }

  const networkLabel = isLinkedin ? "LinkedIn" : "Facebook";
  const feedChannel = isLinkedin ? "linkedin" : "facebook";
  return (
    <>
      <PreviewBlockShell eyebrow={preview.formatLabel || "image finale"} title={preview.channelLabel} note={hasVideo ? `${networkLabel} : aperçu vertical avec texte et lecteur vidéo.` : `${networkLabel} : aperçu vertical photos/vidéo. Clic sur les photos = carousel.`}>
        <DevicePreviewSwitcher
          desktop={<FeedPreviewCard mode="desktop" channel={feedChannel} title={title} content={content} cta={cta} hashtags={hashtags} images={images} video={video} onOpen={openLightbox} />}
          mobile={<FeedPreviewCard mode="mobile" channel={feedChannel} title={title} content={content} cta={cta} hashtags={hashtags} images={images} video={video} onOpen={openLightbox} />}
        />
      </PreviewBlockShell>
      {!hasVideo ? <PublicationPreviewLightbox open={lightboxIndex !== null} images={images} initialIndex={lightboxIndex || 0} aspectRatio="1 / 1" fallbackMode="color" onClose={closeLightbox} /> : null}
    </>
  );
}
