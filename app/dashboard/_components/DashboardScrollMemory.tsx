"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  readDashboardScrollPosition,
  rememberDashboardScrollPosition,
  restoreDashboardScrollPosition,
} from "../dashboard.scroll";

const DASHBOARD_HOME_PATH = "/dashboard";

/**
 * Single scroll-memory owner for the dashboard.
 *
 * It deliberately lives in the persistent dashboard layout rather than in a
 * bubble or tool button. Every departure is therefore covered: cards, menus,
 * mobile dock, notification links, OAuth redirects and future tools.
 */
export default function DashboardScrollMemory() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isDashboardHome = pathname === DASHBOARD_HOME_PATH;
  const dashboardLocationKey = isDashboardHome ? searchParams.toString() : "";
  const lastKnownScrollTop = useRef(0);

  useEffect(() => {
    if (!isDashboardHome) return;

    lastKnownScrollTop.current =
      readDashboardScrollPosition() ?? Math.max(0, Math.round(window.scrollY || 0));

    let scrollFrame = 0;

    const persistCurrentPosition = () => {
      const scrollTop = Math.max(0, Math.round(window.scrollY || 0));
      lastKnownScrollTop.current = scrollTop;
      rememberDashboardScrollPosition(scrollTop);
    };

    const onScroll = () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        persistCurrentPosition();
      });
    };

    const onNavigationKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") persistCurrentPosition();
    };

    const persistLastKnownPosition = () => {
      rememberDashboardScrollPosition(lastKnownScrollTop.current);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", persistLastKnownPosition);
    document.addEventListener("pointerdown", persistCurrentPosition, true);
    document.addEventListener("keydown", onNavigationKey, true);

    return () => {
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", persistLastKnownPosition);
      document.removeEventListener("pointerdown", persistCurrentPosition, true);
      document.removeEventListener("keydown", onNavigationKey, true);
      persistLastKnownPosition();
    };
  }, [isDashboardHome]);

  useEffect(() => {
    if (!isDashboardHome) return;
    return restoreDashboardScrollPosition();
  }, [dashboardLocationKey, isDashboardHome]);

  return null;
}
