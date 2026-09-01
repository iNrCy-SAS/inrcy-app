import "server-only";

import { redirect } from "next/navigation";

import {
  DASHBOARD_ACTIVITY_COMPLETION_SELECT,
  DASHBOARD_PROFILE_COMPLETION_SELECT,
  evaluateDashboardRequiredSetupCompletion,
} from "@/lib/dashboardCompletion";
import { requireUser } from "@/lib/requireUser";
import { isRequiredSetupE2EBypassEnabled } from "@/lib/e2eServerFlags";

export async function isDashboardRequiredSetupCompletedServer() {
  // The dedicated Playwright server may opt in to bypassing setup locks.
  // This is never enabled by the application itself and does not affect production.
  if (isRequiredSetupE2EBypassEnabled()) return true;
  const { supabase, activeUserId, errorResponse } = await requireUser();
  if (errorResponse || !supabase || !activeUserId) return false;

  const [profileResult, activityResult] = await Promise.all([
    supabase
      .from("profiles")
      .select(DASHBOARD_PROFILE_COMPLETION_SELECT)
      .eq("user_id", activeUserId)
      .maybeSingle(),
    supabase
      .from("business_profiles")
      .select(DASHBOARD_ACTIVITY_COMPLETION_SELECT)
      .eq("user_id", activeUserId)
      .maybeSingle(),
  ]);

  if (profileResult.error || activityResult.error) return false;

  return evaluateDashboardRequiredSetupCompletion(
    profileResult.data as Record<string, unknown> | null,
    activityResult.data as Record<string, unknown> | null,
  ).completed;
}

export async function requireDashboardRequiredSetupCompleted() {
  const completed = await isDashboardRequiredSetupCompletedServer();
  if (!completed) redirect("/dashboard");
}
