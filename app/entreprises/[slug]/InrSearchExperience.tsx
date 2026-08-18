"use client";

import { useTranslations } from "next-intl";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InrSearchLogo from "./InrSearchLogo";
import { requestInrSearchContact } from "./inrSearchContactEvents";
import styles from "./inrSearchPublic.module.css";

type NavItem = { href: string; label: string };

type Props = {
  companyName: string;
  logoUrl: string;
  navItems: NavItem[];
};

type SwipeState = {
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  time: number;
  pointerId: number;
};

const GESTURE_IGNORE_SELECTOR =
  "[data-local-carousel], [data-inrsearch-gesture-ignore], a, button, input, textarea, select, summary, [contenteditable='true'], [role='dialog']";

function getSectionIndex(sections: HTMLElement[], id: string) {
  const cleanId = id.replace(/^#/, "");
  const index = sections.findIndex((section) => section.id === cleanId);
  return index >= 0 ? index : 0;
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

const MOBILE_VIEWPORT_WIDTH_DELTA = 24;
const MOBILE_VIEWPORT_SETTLE_MS = 140;

function readLayoutViewport() {
  const width = Math.max(1, Math.round(window.innerWidth));
  const height = Math.max(1, Math.round(window.innerHeight));

  return {
    width,
    height,
    orientation: width >= height ? "landscape" : "portrait",
  } as const;
}

export default function InrSearchExperience({
  companyName,
  logoUrl,
  navItems,
}: Props) {
  const i18nT = useTranslations("public");
  const [active, setActive] = useState(navItems[0]?.href || "#presentation");
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  const touchStartRef = useRef<SwipeState | null>(null);
  const sectionCount = navItems.length;

  const itemByHref = useMemo(
    () => new Map(navItems.map((item) => [item.href, item])),
    [navItems],
  );

  const setCurrentIndex = useCallback((index: number) => {
    activeIndexRef.current = index;
    setActiveIndex((current) => (current === index ? current : index));
  }, []);

  const navigateTo = useCallback(
    (href: string, behavior?: ScrollBehavior) => {
      const orbit = document.querySelector<HTMLElement>("[data-inrsearch-orbit]");
      const target = document.getElementById(href.replace(/^#/, ""));
      if (!orbit || !target) return;

      const resolvedBehavior = behavior || (prefersReducedMotion() ? "auto" : "smooth");
      orbit.scrollTo({ left: target.offsetLeft, behavior: resolvedBehavior });
      target.focus({ preventScroll: true });
      setMenuOpen(false);
    },
    [],
  );

  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-inrsearch-page]");
    const orbit = document.querySelector<HTMLElement>("[data-inrsearch-orbit]");
    if (!root || !orbit) return;

    const sections = Array.from(
      orbit.querySelectorAll<HTMLElement>("[data-orbit-section]"),
    );
    if (!sections.length) return;

    let scrollFrame = 0;
    let pointerFrame = 0;
    let wheelLock = false;
    let wheelUnlockTimer = 0;
    let wheelResetTimer = 0;
    let wheelAccumulator = 0;
    let viewportSettleTimer = 0;
    let viewportFrame = 0;
    let stableViewport = readLayoutViewport();
    let lastPointerEvent: PointerEvent | null = null;
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileStabilityQuery = window.matchMedia(
      "(max-width: 900px), (hover: none) and (pointer: coarse)",
    );

    const applySectionState = (index: number) => {
      const safeIndex = Math.max(0, Math.min(sections.length - 1, index));
      const section = sections[safeIndex];
      const progress = sections.length > 1 ? safeIndex / (sections.length - 1) : 0;

      root.style.setProperty("--page-progress", String(progress));
      root.style.setProperty(
        "--page-progress-angle",
        `${(progress * 110).toFixed(2)}deg`,
      );
      root.style.setProperty("--active-orbit-index", String(safeIndex));
      setCurrentIndex(safeIndex);

      // Every section stays in the server-rendered HTML for crawlers and
      // no-JavaScript readers. After hydration, only the current visual scene
      // remains interactive so focus cannot jump into an off-screen chapter.
      sections.forEach((item, itemIndex) => {
        if (itemIndex === safeIndex) {
          item.removeAttribute("data-orbit-inactive");
          item.setAttribute("data-orbit-active", "true");
          item.removeAttribute("aria-hidden");
          item.removeAttribute("inert");
        } else {
          item.setAttribute("data-orbit-inactive", "true");
          item.removeAttribute("data-orbit-active");
          item.setAttribute("aria-hidden", "true");
          item.setAttribute("inert", "");
        }
      });

      if (section?.id) {
        root.dataset.activeSection = section.id;
        const href = `#${section.id}`;
        setActive((current) => (current === href ? current : href));
        if (window.location.hash !== href) {
          window.history.replaceState(null, "", href);
        }
      }
    };

    const syncFromScroll = () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        const viewportWidth = Math.max(1, orbit.clientWidth);
        const index = Math.round(orbit.scrollLeft / viewportWidth);
        applySectionState(index);
      });
    };

    const moveToIndex = (index: number, behavior?: ScrollBehavior) => {
      const safeIndex = Math.max(0, Math.min(sections.length - 1, index));
      const resolvedBehavior =
        behavior || (reducedMotionQuery.matches ? "auto" : "smooth");
      orbit.scrollTo({
        left: sections[safeIndex]?.offsetLeft || 0,
        behavior: resolvedBehavior,
      });
    };

    const applyStableViewportHeight = () => {
      const nextViewport = readLayoutViewport();
      stableViewport = nextViewport;

      if (mobileStabilityQuery.matches) {
        root.style.setProperty(
          "--inrsearch-viewport-height",
          `${nextViewport.height}px`,
        );
        root.dataset.viewportHeight = "locked";
      } else {
        root.style.removeProperty("--inrsearch-viewport-height");
        root.dataset.viewportHeight = "dynamic";
      }
    };

    const syncAfterViewportChange = (force = false) => {
      const nextViewport = readLayoutViewport();
      const widthChanged =
        Math.abs(nextViewport.width - stableViewport.width) >=
        MOBILE_VIEWPORT_WIDTH_DELTA;
      const orientationChanged =
        nextViewport.orientation !== stableViewport.orientation;

      if (!mobileStabilityQuery.matches) {
        stableViewport = nextViewport;
        root.style.removeProperty("--inrsearch-viewport-height");
        root.dataset.viewportHeight = "dynamic";
        syncFromScroll();
        return;
      }

      // Les barres d'adresse des navigateurs mobiles changent seulement la
      // hauteur du viewport. On les ignore pour ne pas faire sauter la scène.
      if (!force && !widthChanged && !orientationChanged) return;

      window.clearTimeout(viewportSettleTimer);
      viewportSettleTimer = window.setTimeout(() => {
        applyStableViewportHeight();
        cancelAnimationFrame(viewportFrame);
        viewportFrame = requestAnimationFrame(() => {
          moveToIndex(activeIndexRef.current, "auto");
          syncFromScroll();
        });
      }, MOBILE_VIEWPORT_SETTLE_MS);
    };

    const onViewportResize = () => syncAfterViewportChange(false);
    const onOrientationChange = () => syncAfterViewportChange(true);
    const onMobileStabilityChange = () => syncAfterViewportChange(true);

    const flushPointer = () => {
      pointerFrame = 0;
      const event = lastPointerEvent;
      if (!event || reducedMotionQuery.matches) return;
      const normalizedX = event.clientX / Math.max(1, window.innerWidth) - 0.5;
      const normalizedY = event.clientY / Math.max(1, window.innerHeight) - 0.5;
      root.style.setProperty("--pointer-x", `${event.clientX}px`);
      root.style.setProperty("--pointer-y", `${event.clientY}px`);
      root.style.setProperty(
        "--pointer-shift-x",
        `${(normalizedX * 28).toFixed(2)}px`,
      );
      root.style.setProperty(
        "--pointer-shift-y",
        `${(normalizedY * 22).toFixed(2)}px`,
      );
      root.style.setProperty(
        "--pointer-tilt-x",
        `${(normalizedY * -1.8).toFixed(2)}deg`,
      );
      root.style.setProperty(
        "--pointer-tilt-y",
        `${(normalizedX * 2.4).toFixed(2)}deg`,
      );
    };

    const updatePointer = (event: PointerEvent) => {
      if (
        event.pointerType !== "mouse" ||
        reducedMotionQuery.matches ||
        mobileStabilityQuery.matches
      ) {
        return;
      }
      lastPointerEvent = event;
      if (!pointerFrame) pointerFrame = requestAnimationFrame(flushPointer);
    };

    const onRootClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const trigger = (event.target as Element | null)?.closest<HTMLElement>(
        `[data-inrsearch-contact-trigger], .${styles.presentationPrimaryAction}`,
      );
      if (!trigger) return;

      event.preventDefault();
      requestInrSearchContact(trigger);
    };

    const onWheel = (event: WheelEvent) => {
      const panel = (event.target as Element | null)?.closest<HTMLElement>("[data-orbit-section]");
      if (panel && window.innerWidth <= 900 && Math.abs(event.deltaY) >= Math.abs(event.deltaX) * 1.1) {
        // Sur mobile, le geste vertical appartient toujours au panneau courant,
        // même lorsqu'il atteint sa limite. Le changement de chapitre reste horizontal.
        return;
      }

      const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
      if (Math.abs(dominantDelta) < 3) return;

      event.preventDefault();
      if (wheelLock) return;

      wheelAccumulator += dominantDelta;
      window.clearTimeout(wheelResetTimer);
      wheelResetTimer = window.setTimeout(() => {
        wheelAccumulator = 0;
      }, 240);

      const threshold = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 8 : 118;
      if (Math.abs(wheelAccumulator) < threshold) return;

      const direction = wheelAccumulator > 0 ? 1 : -1;
      wheelAccumulator = 0;
      wheelLock = true;
      moveToIndex(activeIndexRef.current + direction);
      window.clearTimeout(wheelUnlockTimer);
      window.clearTimeout(wheelResetTimer);
      wheelUnlockTimer = window.setTimeout(() => {
        wheelLock = false;
      }, reducedMotionQuery.matches ? 260 : 820);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      const target = event.target as Element | null;
      if (target?.closest(GESTURE_IGNORE_SELECTOR)) {
        touchStartRef.current = null;
        return;
      }
      touchStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        time: performance.now(),
        pointerId: event.pointerId,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !touchStartRef.current) return;
      if (touchStartRef.current.pointerId !== event.pointerId) return;
      touchStartRef.current.lastX = event.clientX;
      touchStartRef.current.lastY = event.clientY;
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !touchStartRef.current) return;
      if (wheelLock) {
        touchStartRef.current = null;
        return;
      }
      const start = touchStartRef.current;
      touchStartRef.current = null;
      const pointerDeltaX = event.clientX - start.x;
      const trackedDeltaX = start.lastX - start.x;
      const endX = Math.abs(pointerDeltaX) >= Math.abs(trackedDeltaX)
        ? event.clientX
        : start.lastX;
      const endY = endX === event.clientX ? event.clientY : start.lastY;
      const deltaX = endX - start.x;
      const deltaY = endY - start.y;
      const elapsed = Math.max(1, performance.now() - start.time);
      const velocity = Math.abs(deltaX) / elapsed;
      const threshold = Math.max(72, Math.min(112, orbit.clientWidth * 0.18));
      const deliberate =
        Math.abs(deltaX) >= threshold || (Math.abs(deltaX) >= 54 && velocity > 0.45);
      if (!deliberate || Math.abs(deltaX) < Math.abs(deltaY) * 1.18) return;
      event.preventDefault();
      wheelLock = true;
      moveToIndex(activeIndexRef.current + (deltaX < 0 ? 1 : -1));
      window.clearTimeout(wheelUnlockTimer);
      wheelUnlockTimer = window.setTimeout(() => {
        wheelLock = false;
      }, reducedMotionQuery.matches ? 260 : 620);
    };

    const onPointerCancel = () => {
      touchStartRef.current = null;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches(
          "input, textarea, select, button, a, [contenteditable='true']",
        )
      ) {
        return;
      }

      if (["ArrowRight", "PageDown"].includes(event.key)) {
        event.preventDefault();
        moveToIndex(activeIndexRef.current + 1);
      } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        moveToIndex(activeIndexRef.current - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        moveToIndex(0);
      } else if (event.key === "End") {
        event.preventDefault();
        moveToIndex(sections.length - 1);
      }
    };

    const onHashChange = () => {
      moveToIndex(getSectionIndex(sections, window.location.hash), "auto");
    };

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.visible = "true";
          }
        });
      },
      { root: orbit, rootMargin: "0px", threshold: 0.18 },
    );

    root
      .querySelectorAll<HTMLElement>("[data-reveal]")
      .forEach((element) => revealObserver.observe(element));

    applyStableViewportHeight();

    orbit.addEventListener("scroll", syncFromScroll, { passive: true });
    orbit.addEventListener("wheel", onWheel, { passive: false });
    orbit.addEventListener("pointerdown", onPointerDown, { passive: true });
    orbit.addEventListener("pointermove", onPointerMove, { passive: true });
    orbit.addEventListener("pointerup", onPointerUp, { passive: false });
    orbit.addEventListener("pointercancel", onPointerCancel, { passive: true });
    if (!reducedMotionQuery.matches && !mobileStabilityQuery.matches) {
      root.addEventListener("pointermove", updatePointer, { passive: true });
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportResize, { passive: true });
    window.addEventListener("orientationchange", onOrientationChange, {
      passive: true,
    });
    window.visualViewport?.addEventListener("resize", onViewportResize, {
      passive: true,
    });
    mobileStabilityQuery.addEventListener?.("change", onMobileStabilityChange);
    window.addEventListener("hashchange", onHashChange);
    root.addEventListener("click", onRootClick);

    const initialIndex = window.location.hash
      ? getSectionIndex(sections, window.location.hash)
      : 0;
    requestAnimationFrame(() => {
      moveToIndex(initialIndex, "auto");
      applySectionState(initialIndex);
    });

    return () => {
      cancelAnimationFrame(scrollFrame);
      cancelAnimationFrame(pointerFrame);
      cancelAnimationFrame(viewportFrame);
      window.clearTimeout(wheelUnlockTimer);
      window.clearTimeout(wheelResetTimer);
      window.clearTimeout(viewportSettleTimer);
      revealObserver.disconnect();
      sections.forEach((section) => {
        section.removeAttribute("data-orbit-inactive");
        section.removeAttribute("data-orbit-active");
        section.removeAttribute("aria-hidden");
        section.removeAttribute("inert");
      });
      orbit.removeEventListener("scroll", syncFromScroll);
      orbit.removeEventListener("wheel", onWheel);
      orbit.removeEventListener("pointerdown", onPointerDown);
      orbit.removeEventListener("pointermove", onPointerMove);
      orbit.removeEventListener("pointerup", onPointerUp);
      orbit.removeEventListener("pointercancel", onPointerCancel);
      root.removeEventListener("pointermove", updatePointer);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportResize);
      window.removeEventListener("orientationchange", onOrientationChange);
      window.visualViewport?.removeEventListener("resize", onViewportResize);
      mobileStabilityQuery.removeEventListener?.(
        "change",
        onMobileStabilityChange,
      );
      window.removeEventListener("hashchange", onHashChange);
      root.removeEventListener("click", onRootClick);
      root.style.removeProperty("--inrsearch-viewport-height");
      delete root.dataset.viewportHeight;
    };
  }, [setCurrentIndex]);

  const goRelative = (offset: number) => {
    const item = navItems[
      Math.max(0, Math.min(sectionCount - 1, activeIndex + offset))
    ];
    if (item) navigateTo(item.href);
  };

  return (
    <>
      <header
        className={styles.topbar}
        data-menu-open={menuOpen ? "true" : "false"}
      >
        <div className={styles.readingProgress} aria-hidden="true">
          <span />
        </div>
        <div className={styles.topbarInner}>
          <a
            className={styles.brandLockup}
            href="#presentation"
            aria-label={i18nT("revenir_a_la_presentation_de_value_8050ad4a", { value0: companyName })}
            onClick={(event) => {
              event.preventDefault();
              navigateTo("#presentation");
            }}
          >
            <InrSearchLogo
              className={styles.headerCompanyLogo}
              fallbackClassName={styles.headerLogoFallback}
              src={logoUrl}
              alt=""
              companyName={companyName}
              width={48}
              height={48}
              fetchPriority="high"
            />
            <span className={styles.headerCompanyName}>{companyName}</span>
          </a>

          <button
            className={styles.menuToggle}
            type="button"
            aria-expanded={menuOpen}
            aria-controls="inrsearch-page-navigation"
            aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span />
            <span />
            <span />
          </button>

          <nav
            className={styles.topbarLinks}
            aria-label={i18nT("navigation_dans_la_page_8ce3dd72")}
            id="inrsearch-page-navigation"
          >
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                data-active={active === item.href ? "true" : "false"}
                aria-current={active === item.href ? "location" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigateTo(item.href);
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>

       </div>
      </header>

      <div
        className={styles.orbitControls}
        aria-label={i18nT("navigation_entre_les_rubriques_0fc5b94a")}
        role="group"
      >
        <button
          type="button"
          onClick={() => goRelative(-1)}
          disabled={activeIndex === 0}
          aria-label={i18nT("rubrique_precedente_bf41ecb1")}
        >
          ←
        </button>
        <div className={styles.orbitDots}>
          {Array.from({ length: sectionCount }, (_, index) => {
            const item = navItems[index];
            return (
              <button
                key={`${item?.href || "section"}-${index}`}
                type="button"
                data-active={activeIndex === index ? "true" : "false"}
                aria-current={activeIndex === index ? "step" : undefined}
                aria-label={
                  item
                    ? `Aller à ${item.label}`
                    : `Aller à la rubrique ${index + 1}`
                }
                onClick={() =>
                  item ? navigateTo(item.href) : goRelative(index - activeIndex)
                }
              />
            );
          })}
        </div>
        <span className={styles.orbitCounter} aria-hidden="true">
          {String(activeIndex + 1).padStart(2, "0")} /{" "}
          {String(sectionCount).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={() => goRelative(1)}
          disabled={activeIndex >= sectionCount - 1}
          aria-label={i18nT("rubrique_suivante_3a822c16")}
        >
          →
        </button>
      </div>

      <div
        className={styles.orbitSectionLabel}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span>{itemByHref.get(active)?.label || i18nT("presentation_aa245f5f")}</span>
      </div>
    </>
  );
}
