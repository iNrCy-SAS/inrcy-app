"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import {
  readAccountCacheValue,
  writeAccountCacheValue,
} from "@/lib/browserAccountCache";
import { alertInrcy } from "@/lib/inrcyDialog";

const DASHBOARD_SETUP_ALERT_SEEN_KEY =
  "inrcy_dashboard_setup_alert_seen_v1";

type DashboardSetupAlertOptions = {
  accountId: string | null;
  completionCheckReady: boolean;
  profileIncomplete: boolean;
  activityIncomplete: boolean;
};

export function useDashboardSetupAlert({
  accountId,
  completionCheckReady,
  profileIncomplete,
  activityIncomplete,
}: DashboardSetupAlertOptions) {
  const t = useTranslations("dashboard.setupAlert");

  useEffect(() => {
    if (
      !completionCheckReady ||
      !accountId ||
      (!profileIncomplete && !activityIncomplete)
    ) {
      return;
    }

    if (readAccountCacheValue(DASHBOARD_SETUP_ALERT_SEEN_KEY, accountId) === "1") {
      return;
    }

    // Le marqueur est écrit avant l'ouverture pour résister au double montage
    // de React en développement. Il est volontairement conservé entre les
    // connexions : ce rappel ne doit apparaître qu'à la première arrivée sur
    // le dashboard pour cet établissement et ce navigateur.
    writeAccountCacheValue(DASHBOARD_SETUP_ALERT_SEEN_KEY, "1", accountId);

    const message = profileIncomplete && activityIncomplete
      ? t("bothIncomplete")
      : profileIncomplete
        ? t("profileIncomplete")
        : t("activityIncomplete");

    // Le léger décalage laisse au fournisseur global de dialogues le temps
    // d'installer son écouteur lors du tout premier rendu de l'application.
    window.setTimeout(() => {
      void alertInrcy({
        eyebrow: t("eyebrow"),
        title: t("title"),
        message,
        confirmLabel: t("confirm"),
        variant: "warning",
      });
    }, 0);
  }, [
    accountId,
    activityIncomplete,
    completionCheckReady,
    profileIncomplete,
    t,
  ]);
}
