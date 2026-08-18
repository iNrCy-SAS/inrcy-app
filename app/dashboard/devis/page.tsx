"use client";

import { useTranslations } from "next-intl";

import ListPage from "./ListPage";
export default function DevisListPage() {
  const i18nT = useTranslations("documents");
  return <ListPage kind="devis" title={i18nT("mes_devis_33d3e01c")} ctaLabel={i18nT("creer_un_devis_426c5610")} ctaHref="/dashboard/devis/new" />;
}
