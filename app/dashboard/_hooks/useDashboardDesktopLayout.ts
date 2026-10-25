"use client";

import { useSyncExternalStore } from "react";

const DESKTOP_QUERY = "(min-width: 1101px)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useDashboardDesktopLayout() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(DESKTOP_QUERY).matches, () => false);
}
