"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import {
  readAccountCacheValue,
  writeAccountCacheValue,
} from "@/lib/browserAccountCache";
import { confirmInrcy } from "@/lib/inrcyDialog";
import {
  BROWSER_SIGN_OUT_START_EVENT,
  isBrowserSignOutInProgress,
} from "@/lib/browserSignOutState";

const DASHBOARD_SETUP_ALERT_SEEN_KEY =
  "inrcy_dashboard_setup_alert_seen_v2";

type DashboardSetupAlertOptions = {
  accountId: string | null;
  completionCheckReady: boolean;
  profileIncomplete: boolean;
  activityIncomplete: boolean;
  onOpenChannels: () => void;
};

export function useDashboardSetupAlert({
  accountId,
  completionCheckReady,
  profileIncomplete,
  activityIncomplete,
  onOpenChannels,
}: DashboardSetupAlertOptions) {
  const t = useTranslations("dashboard.setupAlert");

  useEffect(() => {
    let timeout: number | null = null;
    const cancelPendingAlert = () => {
      if (timeout !== null) {
        window.clearTimeout(timeout);
        timeout = null;
      }
    };

    window.addEventListener(BROWSER_SIGN_OUT_START_EVENT, cancelPendingAlert);

    if (
      isBrowserSignOutInProgress() ||
      !completionCheckReady ||
      !accountId ||
      (!profileIncomplete && !activityIncomplete)
    ) {
      return () => {
        window.removeEventListener(BROWSER_SIGN_OUT_START_EVENT, cancelPendingAlert);
      };
    }

    if (readAccountCacheValue(DASHBOARD_SETUP_ALERT_SEEN_KEY, accountId) === "1") {
      return () => {
        window.removeEventListener(BROWSER_SIGN_OUT_START_EVENT, cancelPendingAlert);
      };
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
    timeout = window.setTimeout(() => {
      timeout = null;
      if (isBrowserSignOutInProgress()) return;

      void confirmInrcy({
        eyebrow: t("eyebrow"),
        title: t("title"),
        message,
        steps: [
          t("stepChannels"),
          t("stepDna"),
          t("stepAi"),
          t("stepFirstPublication"),
        ],
        confirmLabel: t("confirm"),
        cancelLabel: t("cancel"),
        variant: "warning",
      }).then((shouldOpenChannels) => {
        if (shouldOpenChannels) onOpenChannels();
      });
    }, 0);

    return () => {
      cancelPendingAlert();
      window.removeEventListener(BROWSER_SIGN_OUT_START_EVENT, cancelPendingAlert);
    };
  }, [
    accountId,
    activityIncomplete,
    completionCheckReady,
    onOpenChannels,
    profileIncomplete,
    t,
  ]);
}
