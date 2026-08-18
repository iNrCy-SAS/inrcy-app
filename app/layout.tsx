import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import OrientationGuard from "./OrientationGuard";
import CookieConsentBanner from "./_components/CookieConsentBanner";
import InrcyDialogProvider from "./_components/InrcyDialogProvider";
import PullToRefresh from "./_components/PullToRefresh";
import { htmlLanguageFromLocale } from "@/i18n/config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        translate="no"
      >
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Paris">
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
