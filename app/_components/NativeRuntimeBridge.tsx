"use client";

import { App } from "@capacitor/app";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { useEffect } from "react";
import { normalizeNativeOpenUrl } from "@/lib/nativeRuntime";

export default function NativeRuntimeBridge() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    document.documentElement.dataset.inrcyNative = "true";

    // Capacitor 8's SystemBars plugin is the single native owner for system
    // bar visibility/style. Calling the legacy StatusBar overlay API here
    // races with its inset listener and can put the dashboard under either
    // the status bar or the navigation bar on Android 15+.
    void SystemBars.setStyle({ style: SystemBarsStyle.Light }).catch(() => undefined);
    void SystemBars.show().catch(() => undefined);
    void Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => undefined);

    const openListener = App.addListener("appUrlOpen", ({ url }) => {
      const internalUrl = normalizeNativeOpenUrl(url, window.location.origin);
      if (internalUrl && internalUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.location.assign(internalUrl);
      }
    });

    return () => {
      delete document.documentElement.dataset.inrcyNative;
      void openListener.then((listener) => listener.remove()).catch(() => undefined);
    };
  }, []);

  return null;
}
