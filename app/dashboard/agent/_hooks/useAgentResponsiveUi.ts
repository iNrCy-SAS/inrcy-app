"use client";

import { useEffect, useState } from "react";

export function useAgentResponsiveUi() {
  const [robotPanelOpen, setRobotPanelOpen] = useState(false);
  const [isMobileHeader, setIsMobileHeader] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobileHeader(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 761px)");
    const closeOutsideDesktopLayout = () => {
      if (!mq.matches) setRobotPanelOpen(false);
    };
    closeOutsideDesktopLayout();
    mq.addEventListener?.("change", closeOutsideDesktopLayout);
    return () =>
      mq.removeEventListener?.("change", closeOutsideDesktopLayout);
  }, []);

  useEffect(() => {
    if (!robotPanelOpen || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRobotPanelOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [robotPanelOpen]);

  return {
    robotPanelOpen,
    setRobotPanelOpen,
    isMobileHeader,
  };
}
