"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useDashboardViewerAccess } from "../_components/DashboardViewerAccessProvider";
import { useDashboardUnsavedNavigation } from "../_components/DashboardUnsavedNavigationProvider";

/** Visual hint and native subscription entry point; the server enforces access. */
export default function usePaidMediaAction() {
  const { paidActionsLocked } = useDashboardViewerAccess();
  const router = useRouter();
  const { requestNavigation } = useDashboardUnsavedNavigation();
  const dashboard = useTranslations("dashboard");
  const auth = useTranslations("auth");
  return {
    paidActionsLocked,
    subscriptionLabel: dashboard("drawer.titles.abonnement"),
    subscriptionMessage: auth("directSignup.body"),
    openSubscription: () => { void requestNavigation(() => router.push("/dashboard?panel=abonnement")); },
  };
}
