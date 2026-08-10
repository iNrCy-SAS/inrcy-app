export const dynamic = "force-dynamic";
export const revalidate = 0;

import React from "react";
import { unstable_noStore as noStore } from "next/cache";
import styles from "./dashboard.module.css";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getMaintenanceState, isAdminUser } from "@/lib/maintenance";
import ProfileRealtimeBridge from "./_components/ProfileRealtimeBridge";
import LastActiveTracker from "./_components/LastActiveTracker";
import { ensureProfileRow } from "@/lib/ensureProfileRow";
import { resolveInrcyAccountScopeForUser } from "@/lib/multicompte/server";
import ActiveAccountTabSync from "./_components/ActiveAccountTabSync";
import ResponsiveBottomNav from "./_components/ResponsiveBottomNav";
import DashboardUnsavedNavigationProvider from "./_components/DashboardUnsavedNavigationProvider";
import DashboardPullToRefresh from "./_components/DashboardPullToRefresh";
import SentryUserContext from "./_components/SentryUserContext";
import ClientAuthSessionGuard from "./_components/ClientAuthSessionGuard";
import DashboardRequiredSetupGate from "./_components/DashboardRequiredSetupGate";
import DashboardToolWarmup from "./_components/DashboardToolWarmup";
import { DashboardRequiredSetupBypassProvider } from "./_components/DashboardRequiredSetupBypassProvider";
import { isRequiredSetupE2EBypassEnabled } from "@/lib/e2eServerFlags";
import { DASHBOARD_BUBBLE_ICON_PRELOADS } from "./dashboard.constants";
import DashboardPersistentImageCache from "./_components/DashboardPersistentImageCache";
import DashboardEditionProvider from "./_components/DashboardEditionProvider";
import { resolveDashboardEdition } from "@/lib/dashboardEdition";


type SubscriptionGateRow = {
  status?: string | null;
  trial_end_at?: string | null;
  start_date?: string | null;
  app_edition?: string | null;
  plan?: string | null;
};

const TRIAL_DURATION_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeSubscriptionStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function parseDateMs(value?: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function isTrialStillValid(subscription?: SubscriptionGateRow | null) {
  if (normalizeSubscriptionStatus(subscription?.status) !== "trialing") return false;

  const trialEndMs = parseDateMs(subscription?.trial_end_at);
  if (trialEndMs !== null) return trialEndMs > Date.now();

  const startMs = parseDateMs(subscription?.start_date);
  if (startMs !== null) return startMs + TRIAL_DURATION_DAYS * DAY_MS > Date.now();

  return false;
}

function hasDashboardAccess(subscription?: SubscriptionGateRow | null) {
  const status = normalizeSubscriptionStatus(subscription?.status);
  return status === "active" || isTrialStillValid(subscription);
}

const DASHBOARD_SECONDARY_IMAGE_PRELOADS = [
  "/logo-inrcy.png",
  "/agent/inr-agent-robot-cutout.webp",
  "/icons/inr-agent-header.png",
  "/inrcalendar-logo.png",
  "/inrstats-logo.png",
  "/inrcrm-logo.png",
  "/inrsend-logo.png",
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  noStore();

  const bypassRequiredSetup = isRequiredSetupE2EBypassEnabled();

  const supabase = await createSupabaseServer();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  const accountScope = await resolveInrcyAccountScopeForUser(supabase, user);
  await ensureProfileRow(user, accountScope.activeUserId).catch(() => null);

  const { data: subscription } = await supabaseAdmin
    .from("subscriptions")
    .select("status, trial_end_at, start_date, app_edition, plan")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!hasDashboardAccess(subscription)) {
    redirect("/compte-bloque");
  }

  const dashboardEdition = resolveDashboardEdition({
    edition: subscription?.app_edition,
    plan: subscription?.plan,
    developmentOverride: process.env.INRCY_DEV_DASHBOARD_EDITION,
  });
  const secondaryImagePreloads = dashboardEdition === "standard"
    ? ["/logo-inrcy.png", "/inrstats-logo.png", "/inrsend-logo.png"]
    : DASHBOARD_SECONDARY_IMAGE_PRELOADS;

  // Vérifie l'état maintenance
  const maintenance = await getMaintenanceState();

  if (maintenance.enabled) {
    const admin = await isAdminUser(user.id);

    if (!admin) {
      redirect("/maintenance");
    }
  }

  return (
    <div className={`${styles.shell} inrcy-dashboard-shell`}>
      {DASHBOARD_BUBBLE_ICON_PRELOADS.map((src) => (
        <link key={src} rel="preload" as="image" href={src} fetchPriority="high" />
      ))}
      {secondaryImagePreloads.map((src) => (
        <link key={src} rel="preload" as="image" href={src} />
      ))}
      <DashboardEditionProvider edition={dashboardEdition}>
        <DashboardPersistentImageCache />
        <div className={styles.bg} />
        <div className={styles.noise} />
        <ActiveAccountTabSync />
        <ProfileRealtimeBridge />
        <LastActiveTracker />
        <ClientAuthSessionGuard />
        <DashboardToolWarmup />
        <SentryUserContext userId={user.id} accountId={accountScope.activeUserId} />

        <DashboardRequiredSetupBypassProvider enabled={bypassRequiredSetup}>
          <DashboardUnsavedNavigationProvider>
            <DashboardPullToRefresh />
            <DashboardRequiredSetupGate>
              <div className={styles.mobileViewport}>
                {children}
              </div>
              <ResponsiveBottomNav />
            </DashboardRequiredSetupGate>
          </DashboardUnsavedNavigationProvider>
        </DashboardRequiredSetupBypassProvider>
      </DashboardEditionProvider>
    </div>
  );
}
