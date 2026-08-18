import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

export const revalidate = 300;

export function generateMetadata(): Metadata {
  return {
    title: "iNrCy",
    robots: { index: false, follow: false },
  };
}

/**
 * Le catalogue technique reste un moteur interne de l'application.
 * L'entrée publique unique est l'annuaire hébergé sur inrcy.com.
 */
export default function EntreprisesPage() {
  permanentRedirect("https://inrcy.com/annuaire/");
}
