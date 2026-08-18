"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  isMostlyHorizontalPull,
  supportsCustomPullToRefresh,
} from "@/lib/mobilePullToRefresh";

const REFRESH_THRESHOLD = 112;
const MAX_DISTANCE = 120;
const READY_DISTANCE = Math.round(REFRESH_THRESHOLD * 0.55);

type PullToRefreshProps = {
  beforeRefresh?: () => boolean | Promise<boolean>;
  disabled?: boolean;
  disabledOnDashboard?: boolean;
};

function isTouchRefreshDevice() {
  if (typeof window === "undefined") return false;

  return supportsCustomPullToRefresh({
    maxTouchPoints: window.navigator.maxTouchPoints || 0,
    primaryPointerCoarse: window.matchMedia("(pointer: coarse)").matches,
    anyPointerCoarse: window.matchMedia("(any-pointer: coarse)").matches,
    hoverNone: window.matchMedia("(hover: none)").matches,
  });
}

function isEditableElement(element: Element | null) {
  if (!element) return false;
  return Boolean(
    element.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
    ),
  );
}

function isInsideBlockingLayer(element: Element | null) {
  if (!element) return false;
  return Boolean(
    element.closest(
      [
        '[data-disable-pull-refresh]',
        '[data-pull-refresh="off"]',
        '[aria-modal="true"]',
        '[role="dialog"]',
        '[role="menu"]',
        '[role="listbox"]',
        'dialog',
        '[class*="modal"]',
        '[class*="Modal"]',
        '[class*="drawer"]',
        '[class*="Drawer"]',
        '[class*="popover"]',
        '[class*="Popover"]',
      ].join(','),
    ),
  );
}

function isVerticallyScrollable(element: Element) {
  const style = window.getComputedStyle(element);
  const overflowY = style.overflowY;

  if (!/(auto|scroll|overlay)/.test(overflowY)) return false;
  return element.scrollHeight > element.clientHeight + 8;
}

function findScrollableContainer(element: Element | null): HTMLElement | null {
  let current = element instanceof HTMLElement ? element : null;

  while (current && current !== document.body && current !== document.documentElement) {
    if (isVerticallyScrollable(current)) return current;
    current = current.parentElement;
  }

  return null;
}

function getDocumentScrollTop() {
  return Math.max(
    window.scrollY || 0,
    document.documentElement.scrollTop || 0,
    document.body.scrollTop || 0,
  );
}

function isAtRealTop(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  const scrollContainer = findScrollableContainer(element);

  // Internal tool viewports must be at their own real top. This avoids
  // refreshing while the document itself is technically still at scrollY=0.
  if (scrollContainer) return scrollContainer.scrollTop <= 2;

  return getDocumentScrollTop() <= 2;
}

function canPullToRefresh(target: EventTarget | null) {
  if (typeof window === "undefined" || !isTouchRefreshDevice()) return false;

  const element = target instanceof Element ? target : null;
  if (isEditableElement(document.activeElement)) return false;
  if (isEditableElement(element)) return false;
  if (isInsideBlockingLayer(element)) return false;
  if (!isAtRealTop(target)) return false;

  return true;
}

export default function PullToRefresh({
  beforeRefresh,
  disabled = false,
  disabledOnDashboard = false,
}: PullToRefreshProps) {
  const t = useTranslations("common.pullToRefresh");
  const pathname = usePathname();
  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const activeRef = useRef(false);
  const triggeredRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const unavailable = disabled || (disabledOnDashboard && pathname.startsWith("/dashboard"));

  const reset = useCallback(() => {
    activeRef.current = false;
    triggeredRef.current = false;
    startYRef.current = 0;
    startXRef.current = 0;
    setRefreshing(false);

    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      resetTimerRef.current = null;
      setDistance(0);
    }, 120);
  }, []);

  useEffect(() => {
    if (unavailable || !isTouchRefreshDevice()) return;

    const root = document.documentElement;
    const previousEnabled = root.dataset.inrcyPullRefreshEnabled;
    root.dataset.inrcyPullRefreshEnabled = "1";

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !canPullToRefresh(event.target)) return;

      const touch = event.touches[0];
      if (!touch) return;

      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }

      startYRef.current = touch.clientY;
      startXRef.current = touch.clientX;
      activeRef.current = true;
      triggeredRef.current = false;
      setRefreshing(false);
      setDistance(0);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!activeRef.current || event.touches.length !== 1) return;
      if (!canPullToRefresh(event.target)) {
        reset();
        return;
      }

      const touch = event.touches[0];
      if (!touch) return;

      const diffY = touch.clientY - startYRef.current;
      const diffX = Math.abs(touch.clientX - startXRef.current);

      if (isMostlyHorizontalPull(diffX, diffY)) {
        reset();
        return;
      }

      if (diffY <= 0) {
        setDistance(0);
        return;
      }

      // The custom gesture owns only a real downward pull from the top. Normal
      // page scrolling remains untouched in every other situation.
      event.preventDefault();
      setDistance(Math.min(MAX_DISTANCE, Math.round(diffY * 0.55)));
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!activeRef.current) return;

      const touch = event.changedTouches[0];
      const diffY = (touch?.clientY ?? 0) - startYRef.current;
      const shouldRefresh =
        diffY > REFRESH_THRESHOLD &&
        canPullToRefresh(event.target) &&
        !triggeredRef.current;

      if (!shouldRefresh) {
        reset();
        return;
      }

      triggeredRef.current = true;
      activeRef.current = false;
      setRefreshing(true);
      setDistance(90);

      void Promise.resolve(beforeRefresh?.() ?? true)
        .then((allowed) => {
          if (!allowed) {
            reset();
            return;
          }

          // Let the "Actualisation…" state paint before the real reload.
          window.requestAnimationFrame(() => window.location.reload());
        })
        .catch((error) => {
          console.error("Erreur pull-to-refresh iNrCy:", error);
          reset();
        });
    };

    const onTouchCancel = () => reset();

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      if (previousEnabled === undefined) delete root.dataset.inrcyPullRefreshEnabled;
      else root.dataset.inrcyPullRefreshEnabled = previousEnabled;
    };
  }, [beforeRefresh, reset, unavailable]);

  const ready = distance >= READY_DISTANCE;

  if (unavailable) return null;

  return (
    <div
      className={`globalPullRefreshIndicator ${distance > 0 ? "globalPullRefreshIndicatorVisible" : ""}`}
      style={{ transform: `translate(-50%, ${Math.min(76, distance)}px)` }}
      aria-hidden="true"
    >
      {refreshing ? t("refreshing") : ready ? t("ready") : t("pull")}
    </div>
  );
}
