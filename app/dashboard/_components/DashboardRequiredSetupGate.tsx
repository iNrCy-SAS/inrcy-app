"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { isDashboardRequiredSetupProtectedLocation } from "@/lib/dashboardRequiredSetupAccess";
import { useDashboardCompletionChecks } from "../_hooks/useDashboardCompletionChecks";
import { StableBootScreen } from "./ClientHydrationGate";
import { useDashboardRequiredSetupBypass } from "./DashboardRequiredSetupBypassProvider";

export default function DashboardRequiredSetupGate({ children }: { children: ReactNode }) {
  const t = useTranslations("dashboard.requiredSetup");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const bypassRequiredSetup = useDashboardRequiredSetupBypass();
  const { completionCheckReady, requiredSetupCompleted } = useDashboardCompletionChecks();

  const protectedDestination = useMemo(
    () => isDashboardRequiredSetupProtectedLocation(pathname, searchParams),
    [pathname, searchParams],
  );

  useEffect(() => {
    if (bypassRequiredSetup || !protectedDestination || !completionCheckReady || requiredSetupCompleted) return;
    router.replace("/dashboard");
  }, [bypassRequiredSetup, completionCheckReady, protectedDestination, requiredSetupCompleted, router]);

  // Ne jamais figer l’ouverture d’un outil pendant la vérification réseau.
  // Si le compte est réellement incomplet, l’effet ci-dessus redirige ensuite
  // vers le dashboard. Le cache de complétion rend ce cas quasi immédiat.
  if (!bypassRequiredSetup && protectedDestination && completionCheckReady && !requiredSetupCompleted) {
    return <StableBootScreen label={t("loading")} />;
  }

  return <>{children}</>;
}
