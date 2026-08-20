"use client";

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { StatusBar, Style } from "@capacitor/status-bar";
import { useEffect } from "react";
import { normalizeNativeOpenUrl } from "@/lib/nativeRuntime";

export default function NativeRuntimeBridge() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    document.documentElement.dataset.inrcyNative = "true";

    void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined);
    void StatusBar.setStyle({ style: Style.Light }).catch(() => undefined);
    void StatusBar.setBackgroundColor({ color: "#ffffff" }).catch(() => undefined);
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
