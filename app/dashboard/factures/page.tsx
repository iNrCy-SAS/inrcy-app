"use client";

import { useTranslations } from "next-intl";

import ListPage from "./ListPage";
export default function FacturesListPage() {
  const i18nT = useTranslations("documents");
  return <ListPage kind="facture" title={i18nT("mes_factures_f5fd6966")} ctaLabel={i18nT("creer_une_facture_13a9becd")} ctaHref="/dashboard/factures/new" />;
}
