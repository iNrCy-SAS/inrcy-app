"use client";

import { useEffect } from "react";

import {
  APP_APPEARANCE_THEME_STORAGE_KEY,
  applyAppAppearanceTheme,
  readStoredAppAppearanceTheme,
} from "@/lib/appAppearanceTheme";

export default function AppAppearanceThemeBridge() {
  useEffect(() => {
    applyAppAppearanceTheme(readStoredAppAppearanceTheme());

    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key !== APP_APPEARANCE_THEME_STORAGE_KEY) return;
      applyAppAppearanceTheme(event.newValue);
    };

    window.addEventListener("storage", syncAcrossTabs);
    return () => window.removeEventListener("storage", syncAcrossTabs);
  }, []);

  return null;
}
