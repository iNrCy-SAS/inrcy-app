"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from "react";
import styles from "../dashboard.module.css";
import bubbleStyles from "./DashboardChannelBubble.module.css";
import HelpButton from "./HelpButton";
import DashboardFluxBubble, { type DashboardFluxBubbleData } from "./DashboardFluxBubble";
import DashboardModulesCard from "./DashboardModulesCard";
import DashboardStandardModulesCard from "./DashboardStandardModulesCard";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";

type DashboardPanelName =
  | "contact"
  | "profil"
  | "inrbadge"
  | "compte"
  | "activite"
  | "abonnement"
  | "mails"
  | "agenda"
  | "site_inrcy"
  | "site_web"
  | "instagram"
  | "linkedin"
  | "gmb"
  | "inr_search"
  | "facebook"
  | "tiktok"
  | "youtube_shorts"
  | "pinterest"
  | "legal"
  | "rgpd"
  | "inertie"
  | "boutique"
  | "notifications"
  | "parrainage"
  | "documents";

type BubbleViewMode = "list" | "carousel";

type ChannelPillTone = "connected" | "available" | "warning" | "disabled";

const SITE_CHANNEL_KEYS = new Set(["site_inrcy", "site_web"]);

function WarningTriangle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path d="M12 3.5 21 20H3L12 3.5Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 8.5v5.7" stroke="#241204" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="12" cy="17.2" r="1.15" fill="#241204" />
    </svg>
  );
}

function getChannelPillLabel(item: DashboardFluxBubbleData) {
  if (!SITE_CHANNEL_KEYS.has(item.key)) return item.name;

  const progressMatch = item.bubbleStatusText.match(/(\d\/3)/);
  return progressMatch ? `${item.name} ${progressMatch[1]}` : item.name;
}

function getChannelPillTone(item: DashboardFluxBubbleData): ChannelPillTone {
  if (item.bubbleStatus === "reconnect") return "warning";
  if (item.bubbleStatus === "coming") return "disabled";

  const normalizedStatusText = item.bubbleStatusText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (
    normalizedStatusText.includes("reconnect") ||
    normalizedStatusText.includes("reconnexion") ||
    normalizedStatusText.includes("reconectar") ||
    normalizedStatusText.includes("ricolleg") ||
    normalizedStatusText.includes("neu verbinden") ||
    normalizedStatusText.includes("opnieuw") ||
    normalizedStatusText.includes("religar") ||
    normalizedStatusText.includes("actual") ||
    normalizedStatusText.includes("update") ||
    normalizedStatusText.includes("aktual") ||
    normalizedStatusText.includes("bijwerk") ||
    normalizedStatusText.includes("expire") ||
    normalizedStatusText.includes("token") ||
    normalizedStatusText.includes("attention")
  ) {
    return "warning";
  }

  return item.bubbleStatus === "connected" ? "connected" : "available";
}

type DashboardChannelsSectionProps = {
  fluxBubbleItems: DashboardFluxBubbleData[];
  goToModule: (path: string) => void;
  openPanel: (panel: DashboardPanelName) => void;
  requiredSetupAccessAllowed: boolean;
  requiredSetupLockVisible: boolean;
  onRequiredSetupBlocked: () => void;
  onOpenChannelsHelp: () => void;
  onOpenStats?: () => void;
  onOpenBoosterPublish?: () => void;
  onOpenBoosterStats?: () => void;
  standardMode?: boolean;
};

export default function DashboardChannelsSection({
  fluxBubbleItems,
  goToModule,
  openPanel,
  requiredSetupAccessAllowed,
  requiredSetupLockVisible,
  onRequiredSetupBlocked,
  onOpenChannelsHelp,
  onOpenStats,
  onOpenBoosterPublish,
  onOpenBoosterStats,
  standardMode = false,
}: DashboardChannelsSectionProps) {
  const t = useDashboardI18n();
  const [bubbleView, setBubbleView] = useState<BubbleViewMode>("carousel");
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(1);
  const [carouselTransition, setCarouselTransition] = useState(true);
  const [activeChannelIndex, setActiveChannelIndex] = useState(0);
  const isAnimating = useRef(false);
  const touchStartX = useRef<number | null>(null);
  const isDragging = useRef(false);
  const [dragPx, setDragPx] = useState(0);
  const desktopPointerStartX = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mq = window.matchMedia("(max-width: 1100px)");
    const update = () => setIsMobile(mq.matches);
    update();

    if (mq.addEventListener) mq.addEventListener("change", update);
    else mq.addListener(update);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", update);
      else mq.removeListener(update);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isMobile === null) return;

    if (!isMobile) {
      return;
    }

    const saved = window.localStorage.getItem("inrcy_bubble_view_mobile");

    if (saved === "list" || saved === "carousel") {
      setBubbleView(saved);
    } else {
      setBubbleView("carousel");
    }
  }, [isMobile]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isMobile) return;

    window.localStorage.setItem("inrcy_bubble_view_mobile", bubbleView);
  }, [bubbleView, isMobile]);

  const getStatusDotClassName = (item: DashboardFluxBubbleData) => [
    bubbleStyles.dot,
    item.bubbleStatus === "connected"
      ? bubbleStyles.connected
      : item.bubbleStatus === "available"
        ? bubbleStyles.available
        : bubbleStyles.coming,
  ].join(" ");

  const renderFluxBubble = (item: DashboardFluxBubbleData, keyOverride?: string) => (
    <DashboardFluxBubble
      key={keyOverride ?? item.key}
      item={item}
      itemKey={keyOverride ?? item.key}
      requiredSetupLocked={["inr_agent", "mails", "inrbadge", "inr_search"].includes(item.key) && requiredSetupLockVisible}
      requiredSetupLockMessage={t.modules.requiredSetupLocked}
    />
  );

  const renderDesktopSideBubble = (item: DashboardFluxBubbleData, keyOverride?: string) => {
    const isComingSoon = item.bubbleStatus === "coming";
    const isReconnect = item.bubbleStatus === "reconnect";
    const emphasizeDisabledReason = isComingSoon && item.emphasizeDisabledReason === true;

    return (
    <article
      key={keyOverride ?? item.key}
      className={`${bubbleStyles.card} ${styles.desktopSideBubbleCard} ${styles[`accent_${item.accent}`]} ${isComingSoon ? bubbleStyles.comingSoon : ""} ${isReconnect ? bubbleStyles.reconnectCard : ""}`}
      title={isComingSoon ? item.configureTitle || item.configureLabel || "Option désactivée" : undefined}
      aria-hidden
    >
      <div className={bubbleStyles.sideStack}>
        <div className={bubbleStyles.logo}>
          <img
            className={bubbleStyles.logoImage}
            src={item.logoSrc}
            alt={item.logoAlt}
            width={96}
            height={96}
            loading="eager"
            decoding="sync"
            fetchPriority="high"
          />
        </div>

        <div className={bubbleStyles.title}>{item.name}</div>

        <div className={`${bubbleStyles.status} ${isReconnect ? bubbleStyles.statusReconnect : ""} ${emphasizeDisabledReason ? bubbleStyles.statusDisabledReason : ""}`}>
          {isReconnect ? (
            <WarningTriangle className={bubbleStyles.warningTriangle} />
          ) : (
            <span className={getStatusDotClassName(item)} aria-hidden />
          )}
          <span className={bubbleStyles.statusText}>{item.bubbleStatusText}</span>
        </div>

        <div className={bubbleStyles.tagline} title={item.description}>{item.description}</div>
      </div>
    </article>
    );
  };

  const baseModules = fluxBubbleItems;
  const hasCarousel = baseModules.length > 1;
  const carouselItems = hasCarousel
    ? [baseModules[baseModules.length - 1], ...baseModules, baseModules[0]]
    : baseModules;

  const summaryModules = useMemo(
    () => standardMode
      ? baseModules.filter((item) => item.key !== "mails" && item.key !== "site_inrcy")
      : baseModules,
    [baseModules, standardMode],
  );
  const connectedChannelsCount = useMemo(
    () => summaryModules.filter((item) => getChannelPillTone(item) === "connected").length,
    [summaryModules],
  );
  const availableChannelsCount = summaryModules.length;

  const channelPillRows = useMemo(() => {
    if (baseModules.length <= 7) return [baseModules];
    const firstRowCount = baseModules.length >= 11 ? 7 : Math.ceil(baseModules.length / 2);
    return [baseModules.slice(0, firstRowCount), baseModules.slice(firstRowCount)].filter((row) => row.length > 0);
  }, [baseModules]);

  const normalizeIndex = useCallback((index: number) => {
    if (!baseModules.length) return 0;
    return ((index % baseModules.length) + baseModules.length) % baseModules.length;
  }, [baseModules.length]);

  const desktopPrevIndex = normalizeIndex(activeChannelIndex - 1);
  const desktopNextIndex = normalizeIndex(activeChannelIndex + 1);
  const desktopActiveItem = baseModules[normalizeIndex(activeChannelIndex)] ?? null;
  const desktopPrevItem = baseModules[desktopPrevIndex] ?? null;
  const desktopNextItem = baseModules[desktopNextIndex] ?? null;

  const goPrevDesktop = useCallback(() => {
    setActiveChannelIndex((index) => normalizeIndex(index - 1));
  }, [normalizeIndex]);

  const goNextDesktop = useCallback(() => {
    setActiveChannelIndex((index) => normalizeIndex(index + 1));
  }, [normalizeIndex]);

  const goPrev = useCallback(() => {
    if (!hasCarousel) return;
    if (isAnimating.current) return;
    isAnimating.current = true;
    setCarouselIndex((i) => i - 1);
  }, [hasCarousel]);

  const goNext = useCallback(() => {
    if (!hasCarousel) return;
    if (isAnimating.current) return;
    isAnimating.current = true;
    setCarouselIndex((i) => i + 1);
  }, [hasCarousel]);

  useEffect(() => {
    if (!isMobile) return;
    if (bubbleView !== "carousel") return;

    setCarouselTransition(false);
    setCarouselIndex(1);
    setDragPx(0);

    const id = window.setTimeout(() => setCarouselTransition(true), 0);
    return () => window.clearTimeout(id);
  }, [bubbleView, isMobile]);

  const onCarouselTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (!hasCarousel) return;
    if (isAnimating.current) return;
    touchStartX.current = e.touches[0]?.clientX ?? null;
    isDragging.current = true;
    setCarouselTransition(false);
    setDragPx(0);
  };

  const onCarouselTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (!hasCarousel) return;
    if (!isDragging.current || touchStartX.current == null) return;

    const x = e.touches[0]?.clientX ?? 0;
    setDragPx(x - touchStartX.current);
  };

  const onCarouselTouchEnd = () => {
    if (!hasCarousel) return;

    const dx = dragPx;
    isDragging.current = false;
    touchStartX.current = null;

    setCarouselTransition(true);
    setDragPx(0);

    if (Math.abs(dx) < 60) return;
    if (dx < 0) goNext();
    else goPrev();
  };

  const onCarouselTransitionEnd = () => {
    if (!hasCarousel) return;
    if (isDragging.current) return;

    const lastReal = baseModules.length;

    if (carouselIndex === 0) {
      setCarouselTransition(false);
      setCarouselIndex(lastReal);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setCarouselTransition(true);
          isAnimating.current = false;
        });
      });
      return;
    }

    if (carouselIndex === lastReal + 1) {
      setCarouselTransition(false);
      setCarouselIndex(1);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setCarouselTransition(true);
          isAnimating.current = false;
        });
      });
      return;
    }

    isAnimating.current = false;
  };

  useEffect(() => {
    if (!baseModules.length) return;

    setActiveChannelIndex((index) => normalizeIndex(index));
  }, [baseModules.length, normalizeIndex]);

  useEffect(() => {
    if (!hasCarousel) return;
    const lastReal = baseModules.length;

    if (carouselIndex < 0) {
      setCarouselTransition(false);
      setCarouselIndex(lastReal);
      requestAnimationFrame(() => requestAnimationFrame(() => setCarouselTransition(true)));
      isAnimating.current = false;
    } else if (carouselIndex > lastReal + 1) {
      setCarouselTransition(false);
      setCarouselIndex(1);
      requestAnimationFrame(() => requestAnimationFrame(() => setCarouselTransition(true)));
      isAnimating.current = false;
    }
  }, [carouselIndex, baseModules.length, hasCarousel]);

  const activeDot = hasCarousel
    ? (((carouselIndex - 1) % baseModules.length) + baseModules.length) % baseModules.length
    : 0;

  const onDesktopPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("button,a")) return;
    desktopPointerStartX.current = e.clientX;
  };

  const onDesktopPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (desktopPointerStartX.current === null) return;

    const dx = e.clientX - desktopPointerStartX.current;
    desktopPointerStartX.current = null;

    if (Math.abs(dx) < 58) return;
    if (dx < 0) goNextDesktop();
    else goPrevDesktop();
  };

  const onDesktopPointerCancel = () => {
    desktopPointerStartX.current = null;
  };

  const showDesktopRightSide = hasCarousel && desktopNextIndex !== desktopPrevIndex;

  return (
    <section className={styles.contentFull}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadTop}>
          <div className={styles.channelTitleCluster}>
            <h2 className={styles.h2}>{t.channels.title}</h2>
            <HelpButton onClick={onOpenChannelsHelp} title={t.channels.helpTitle} />
          </div>


          <div className={styles.channelHeaderActions}>
            <div className={styles.channelSummaryBadge}>
              {connectedChannelsCount} {t.channels.connected} / {availableChannelsCount} {t.channels.available}
            </div>

            <div className={styles.mobileViewToggle} aria-label={t.channels.displayAria}>
              <button
                type="button"
                className={`${styles.viewToggleBtn} ${bubbleView === "list" ? styles.viewToggleActive : ""}`}
                onClick={() => setBubbleView("list")}
              >
                {t.channels.list}
              </button>
              <button
                type="button"
                className={`${styles.viewToggleBtn} ${bubbleView === "carousel" ? styles.viewToggleActive : ""}`}
                onClick={() => setBubbleView("carousel")}
              >
                {t.channels.carousel}
              </button>
            </div>
          </div>
        </div>


        <div className={styles.channelPillRail} aria-label={t.channels.railAria}>
          {channelPillRows.map((row, rowIndex) => (
            <div className={styles.channelPillRow} key={`channel-row-${rowIndex}`}>
              {row.map((item) => {
                const index = baseModules.findIndex((entry) => entry.key === item.key);
                const tone = getChannelPillTone(item);
                const isActive = index === normalizeIndex(activeChannelIndex);

                return (
                  <button
                    type="button"
                    key={item.key}
                    className={[
                      styles.channelPill,
                      tone === "connected"
                        ? styles.channelPillConnected
                        : tone === "warning"
                          ? styles.channelPillWarning
                          : tone === "disabled"
                            ? styles.channelPillDisabled
                            : styles.channelPillAvailable,
                      isActive ? styles.channelPillActive : "",
                    ].join(" ")}
                    onClick={() => {
                      setActiveChannelIndex(index);
                      if (isMobile) {
                        setCarouselTransition(true);
                        setCarouselIndex(index + 1);
                      }
                    }}
                    aria-pressed={isActive}
                  >
                    {tone === "warning" ? (
                      <WarningTriangle className={styles.channelPillWarningIcon} />
                    ) : (
                      <span className={styles.channelPillDot} aria-hidden />
                    )}
                    <span>{getChannelPillLabel(item)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {isMobile && bubbleView === "carousel" ? (
        <>
          <div
            className={styles.mobileCarousel}
            ref={carouselRef}
            onTouchStart={onCarouselTouchStart}
            onTouchMove={onCarouselTouchMove}
            onTouchEnd={onCarouselTouchEnd}
          >
            <div
              className={styles.carouselTrack}
              style={{
                transform: `translateX(calc(-${carouselIndex * 100}% + ${dragPx}px))`,
                transition: carouselTransition ? "transform 260ms ease" : "none",
              }}
              onTransitionEnd={onCarouselTransitionEnd}
            >
              {carouselItems.map((item, idx) => (
                <div className={styles.carouselSlide} key={`${item.key}_${idx}`}>
                  {renderFluxBubble(item, `${item.key}_${idx}`)}
                </div>
              ))}
            </div>
          </div>

          {hasCarousel && (
            <div className={styles.carouselNavWrap}>
              <div className={styles.carouselNav} aria-label={t.channels.positionAria}>
                <button
                  type="button"
                  className={styles.carouselArrow}
                  onClick={goPrev}
                  aria-label={t.channels.prev}
                >
                  <span aria-hidden="true">&lt;</span>
                </button>

                <div className={styles.carouselIconRail}>
                  {baseModules.map((item, i) => {
                    const tone = getChannelPillTone(item);

                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={[
                          styles.carouselIconBtn,
                          i === activeDot ? styles.carouselIconBtnActive : "",
                          tone === "connected"
                            ? styles.carouselIconBtnConnected
                            : tone === "warning"
                              ? styles.carouselIconBtnWarning
                              : tone === "disabled"
                                ? styles.carouselIconBtnDisabled
                                : styles.carouselIconBtnAvailable,
                        ].join(" ")}
                        onClick={() => {
                          if (isAnimating.current) return;
                          isAnimating.current = true;
                          setCarouselTransition(true);
                          setCarouselIndex(i + 1);
                        }}
                        aria-label={`${t.channels.goToChannel} ${item.name}`}
                        aria-pressed={i === activeDot}
                        title={item.name}
                      >
                        <img
                          className={styles.carouselIconImg}
                          src={item.logoSrc}
                          alt=""
                          aria-hidden
                          width={48}
                          height={48}
                          loading="eager"
                          decoding="sync"
                          fetchPriority="high"
                        />
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className={styles.carouselArrow}
                  onClick={goNext}
                  aria-label={t.channels.next}
                >
                  <span aria-hidden="true">&gt;</span>
                </button>
              </div>

              <div className={styles.mobileChannelSummary} aria-label={`${connectedChannelsCount} ${t.channels.connectedAria} ${availableChannelsCount}`}>
                {connectedChannelsCount}/{availableChannelsCount} {t.channels.connected}
              </div>
            </div>
          )}
        </>
      ) : isMobile && bubbleView === "list" ? (
        <>
          <div className={bubbleStyles.grid}>
            {fluxBubbleItems.map((item) => renderFluxBubble(item, item.key))}
          </div>

          <div className={styles.mobileChannelSummary} aria-label={`${connectedChannelsCount} ${t.channels.connectedAria} ${availableChannelsCount}`}>
            {connectedChannelsCount}/{availableChannelsCount} {t.channels.connected}
          </div>
        </>
      ) : (
        <>
          <div
            className={styles.desktopChannelsCarousel}
            aria-label={t.channels.positionAria}
          >
            {hasCarousel && (
              <button
                type="button"
                className={`${styles.desktopChannelArrow} ${styles.desktopChannelArrowLeft}`}
                onClick={goPrevDesktop}
                aria-label={t.channels.prev}
              >
                <span aria-hidden="true">&lt;</span>
              </button>
            )}

            <div
              className={bubbleStyles.desktopStage}
              onPointerDown={onDesktopPointerDown}
              onPointerUp={onDesktopPointerUp}
              onPointerCancel={onDesktopPointerCancel}
              onPointerLeave={onDesktopPointerCancel}
            >
              {hasCarousel && desktopPrevItem && (
                <div
                  className={`${bubbleStyles.desktopItem} ${bubbleStyles.desktopSide} ${bubbleStyles.desktopLeft}`}
                  role="button"
                  tabIndex={0}
                  onClick={goPrevDesktop}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      goPrevDesktop();
                    }
                  }}
                  aria-label={`${t.channels.showChannel} ${desktopPrevItem.name}`}
                >
                  {renderDesktopSideBubble(desktopPrevItem, `${desktopPrevItem.key}_desktop_prev`)}
                </div>
              )}

              {desktopActiveItem && (
                <div className={`${bubbleStyles.desktopItem} ${bubbleStyles.desktopCenter}`}>
                  {renderFluxBubble(desktopActiveItem, `${desktopActiveItem.key}_desktop_active`)}
                </div>
              )}

              {showDesktopRightSide && desktopNextItem && (
                <div
                  className={`${bubbleStyles.desktopItem} ${bubbleStyles.desktopSide} ${bubbleStyles.desktopRight}`}
                  role="button"
                  tabIndex={0}
                  onClick={goNextDesktop}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      goNextDesktop();
                    }
                  }}
                  aria-label={`${t.channels.showChannel} ${desktopNextItem.name}`}
                >
                  {renderDesktopSideBubble(desktopNextItem, `${desktopNextItem.key}_desktop_next`)}
                </div>
              )}
            </div>

            {hasCarousel && (
              <button
                type="button"
                className={`${styles.desktopChannelArrow} ${styles.desktopChannelArrowRight}`}
                onClick={goNextDesktop}
                aria-label={t.channels.next}
              >
                <span aria-hidden="true">&gt;</span>
              </button>
            )}
          </div>

          {hasCarousel && (
            <div className={styles.desktopChannelDots} aria-label={t.channels.positionAria}>
              {baseModules.map((item, index) => (
                <button
                  type="button"
                  key={item.key}
                  className={`${styles.carouselDot} ${index === normalizeIndex(activeChannelIndex) ? styles.carouselDotActive : ""}`}
                  onClick={() => setActiveChannelIndex(index)}
                  aria-label={`${t.channels.showChannel} ${item.name}`}
                />
              ))}
            </div>
          )}
        </>
      )}

      {standardMode ? (
        <DashboardStandardModulesCard
          goToModule={goToModule}
          onOpenStats={onOpenStats}
          onOpenBoosterPublish={onOpenBoosterPublish}
          onOpenBoosterStats={onOpenBoosterStats}
        />
      ) : (
        <DashboardModulesCard
          goToModule={goToModule}
          openPanel={openPanel}
          requiredSetupAccessAllowed={requiredSetupAccessAllowed}
          requiredSetupLockVisible={requiredSetupLockVisible}
          onRequiredSetupBlocked={onRequiredSetupBlocked}
          onOpenStats={onOpenStats}
          onOpenBoosterPublish={onOpenBoosterPublish}
          onOpenBoosterStats={onOpenBoosterStats}
        />
      )}
    </section>
  );
}
