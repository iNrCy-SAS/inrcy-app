import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

export const revalidate = 300;

export function generateMetadata(): Metadata {
  return {
    title: "iNrCy",
    robots: { index: false, follow: false },
  };
}

export default function MetiersPage() {
  permanentRedirect("https://inrcy.com/annuaire/");
}
