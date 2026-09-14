import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import OrientationGuard from "./OrientationGuard";
import CookieConsentBanner from "./_components/CookieConsentBanner";
import InrcyDialogProvider from "./_components/InrcyDialogProvider";
import PullToRefresh from "./_components/PullToRefresh";
import NativeRuntimeBridge from "./_components/NativeRuntimeBridge";
import { htmlLanguageFromLocale } from "@/i18n/config";
import AppAppearanceThemeBridge from "./_components/AppAppearanceThemeBridge";
import { APP_APPEARANCE_THEME_BOOT_SCRIPT } from "@/lib/appAppearanceTheme";

export const metadata: Metadata = {
  title: "iNrCy",
  description: "Générateur de contacts – Hub connecté",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  // 🔒 Bloque la traduction Google
  other: {
    "google": "notranslate",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={htmlLanguageFromLocale(locale)}
      translate="no"
      className="notranslate"
      suppressHydrationWarning
    >
      <head>
        {/* 🔒 Empêche Google Translate */}
        <meta name="google" content="notranslate" />
        <Script id="inrcy-appearance-theme-init" strategy="beforeInteractive">
          {APP_APPEARANCE_THEME_BOOT_SCRIPT}
        </Script>
      </head>
      <body className="antialiased" translate="no">
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Paris">
          <AppAppearanceThemeBridge />
          <NativeRuntimeBridge />
          <OrientationGuard />
          <CookieConsentBanner />
          <InrcyDialogProvider />
          <PullToRefresh disabledOnDashboard />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
