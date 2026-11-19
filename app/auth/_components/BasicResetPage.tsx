import { Suspense } from "react";
import type { Metadata } from "next";
import { BASIC_RESET_PRESENTATION_ROUTES } from "@/lib/basicNavigation";
import FinishEmailLinkClient from "./FinishEmailLinkClient";

export const metadata: Metadata = { title: "Votre mot de passe iNrCy", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Only the presentation entry differs; the password recovery engine is shared. */
export default function BasicResetPage({ path }: { path: keyof typeof BASIC_RESET_PRESENTATION_ROUTES }) {
  return <Suspense fallback={null}>
    <FinishEmailLinkClient mode="reset" initialLanguage={BASIC_RESET_PRESENTATION_ROUTES[path]} navigationEntry="basique" />
  </Suspense>;
}
