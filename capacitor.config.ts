import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

const productionUrl = "https://app.inrcy.com";
const configuredUrl = String(process.env.CAPACITOR_SERVER_URL || productionUrl).trim().replace(/\/$/, "");
const isLocalUrl = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(configuredUrl);

/**
 * iNrCy is currently a server-rendered Next.js application. The native shell
 * therefore points at the canonical HTTPS application origin while we keep
 * the web app as the single source of truth. CAPACITOR_SERVER_URL can point
 * to a staging or LAN build during device testing without changing source.
 */
const config: CapacitorConfig = {
  appId: "com.inrcy.app",
  appName: "iNrCy",
  webDir: "mobile-web",
  loggingBehavior: process.env.NODE_ENV === "production" ? "none" : "debug",
  server: {
    url: configuredUrl,
    cleartext: isLocalUrl,
    appStartPath: "/login",
  },
  plugins: {
    App: {
      disableBackButtonHandler: true,
    },
    Keyboard: {
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true,
      autoBackdropColor: "auto",
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 350,
      backgroundColor: "#ffffff",
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: "LIGHT",
      backgroundColor: "#ffffff",
    },
  },
};

export default config;
