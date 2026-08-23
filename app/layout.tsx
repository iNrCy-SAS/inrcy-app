import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import OrientationGuard from "./OrientationGuard";
import CookieConsentBanner from "./_components/CookieConsentBanner";
import InrcyDialogProvider from "./_components/InrcyDialogProvider";
import PullToRefresh from "./_components/PullToRefresh";
import NativeRuntimeBridge from "./_components/NativeRuntimeBridge";
import { htmlLanguageFromLocale } from "@/i18n/config";

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
    <html lang={htmlLanguageFromLocale(locale)} translate="no" className="notranslate">
      <head>
        {/* 🔒 Empêche Google Translate */}
        <meta name="google" content="notranslate" />
      </head>
      <body className="antialiased" translate="no">
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Paris">
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
