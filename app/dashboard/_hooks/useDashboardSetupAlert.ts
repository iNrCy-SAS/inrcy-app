"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { confirmInrcy } from "@/lib/inrcyDialog";
import {
  BROWSER_SIGN_OUT_START_EVENT,
  isBrowserSignOutInProgress,
} from "@/lib/browserSignOutState";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";

type SetupIntroClaim = { accountId: string; show: boolean };

// React peut monter deux fois le dashboard en développement. Les deux effets
// doivent partager la même réponse : seul le serveur décide si l'introduction
// a déjà été présentée à cet établissement.
const claimsInFlight = new Map<string, Promise<SetupIntroClaim | null>>();

function claimSetupIntro(accountId: string) {
  const existing = claimsInFlight.get(accountId);
  if (existing) return existing;

  const claim = fetch("/api/dashboard/setup-intro", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId }),
  })
    .then(async (response): Promise<SetupIntroClaim | null> => {
      if (!response.ok) return null;
      const payload = await response.json() as Partial<SetupIntroClaim>;
      if (typeof payload.accountId !== "string" || typeof payload.show !== "boolean") return null;
      return { accountId: payload.accountId, show: payload.show };
    })
    .catch(() => null)
    .finally(() => {
      if (claimsInFlight.get(accountId) === claim) claimsInFlight.delete(accountId);
    });

  claimsInFlight.set(accountId, claim);
  return claim;
}

type DashboardSetupAlertOptions = {
  onOpenChannels: () => void;
};

export function useDashboardSetupAlert({ onOpenChannels }: DashboardSetupAlertOptions) {
  const t = useTranslations("dashboard.setupAlert");

  useEffect(() => {
    let cancelled = false;
    let requestSequence = 0;
    let timeout: number | null = null;

    const cancelPendingAlert = () => {
      requestSequence += 1;
      if (timeout !== null) {
        window.clearTimeout(timeout);
        timeout = null;
      }
    };

    const checkFirstArrival = async () => {
      if (isBrowserSignOutInProgress()) return;
      const browserAccountId = getActiveBrowserUserId();
      // Le dashboard restaure le compte actif après l'authentification. Ne pas
      // consommer l'introduction avant que ce compte soit connu du navigateur.
      if (!browserAccountId) return;
      const sequence = ++requestSequence;
      const claim = await claimSetupIntro(browserAccountId);
      if (cancelled || sequence !== requestSequence || !claim?.show || isBrowserSignOutInProgress()) return;

      const currentAccountId = getActiveBrowserUserId();
      if (currentAccountId && claim.accountId !== currentAccountId) return;

      // Le fournisseur global de dialogues s'installe après le premier rendu.
      timeout = window.setTimeout(() => {
        timeout = null;
        if (cancelled || sequence !== requestSequence || isBrowserSignOutInProgress()) return;

        void confirmInrcy({
          eyebrow: t("eyebrow"),
          title: t("title"),
          message: t("bothIncomplete"),
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
          if (shouldOpenChannels && !cancelled && sequence === requestSequence) onOpenChannels();
        });
      }, 0);
    };

    const handleActiveAccountChange = () => {
      cancelPendingAlert();
      void checkFirstArrival();
    };

    window.addEventListener(BROWSER_SIGN_OUT_START_EVENT, cancelPendingAlert);
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, handleActiveAccountChange);
    void checkFirstArrival();

    return () => {
      cancelled = true;
      cancelPendingAlert();
      window.removeEventListener(BROWSER_SIGN_OUT_START_EVENT, cancelPendingAlert);
      window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, handleActiveAccountChange);
    };
  }, [onOpenChannels, t]);
}
