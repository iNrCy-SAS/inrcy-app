import { isMetaChannelPilotEnabledForActorAndAccount, metaChannelPilotDeniedResponse } from "@/lib/metaChannelRolloutServer";
import { withoutThreadsData } from "@/lib/stats/metaPilotData";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import {
  normalizeInrBadgeShareSettings,
  resolveInrBadgeAppointmentSettings,
  sanitizeInrBadgeAppointmentSettingsPayload,
  sanitizeInrBadgeShareSettingsPayload,
} from "@/lib/inrBadgeSettings";
import { getDashboardEditionForAuthUser } from "@/lib/dashboardEditionServer";
import { effectiveInrBadgeShareSettings } from "@/lib/inrBadgeEditionPolicy";
import { isStandardDashboardEdition } from "@/lib/dashboardEdition";
import {
  normalizeInrBadgeThemeSettings,
  sanitizeInrBadgeThemeSettingsPayload,
} from "@/lib/inrBadgeTheme";

function safeObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function GET() {
  const { supabase, user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const dashboardEdition = await getDashboardEditionForAuthUser(user.id);
  const metaPilotEnabled = await isMetaChannelPilotEnabledForActorAndAccount(supabase, activeUserId);

  const { data, error } = await supabase
    .from("pro_tools_configs")
    .select("settings")
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (error) return jsonUserFacingError(error, { status: 500 });

  const rootSettings = safeObj(data?.settings);
  const storedShareSettings = normalizeInrBadgeShareSettings(rootSettings.inrBadgeShareSettings);
  return NextResponse.json({
    ok: true,
    settings: withoutThreadsData(effectiveInrBadgeShareSettings(storedShareSettings, dashboardEdition), metaPilotEnabled),
    theme: normalizeInrBadgeThemeSettings(rootSettings.inrBadgeTheme),
    appointmentSettings: resolveInrBadgeAppointmentSettings(rootSettings),
    selectedMailAccountId: isStandardDashboardEdition(dashboardEdition)
      ? ""
      : typeof rootSettings.inrBadgeMailAccountId === "string"
        ? rootSettings.inrBadgeMailAccountId
        : "",
  });
}

export async function PATCH(req: Request) {
  const { supabase, user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const dashboardEdition = await getDashboardEditionForAuthUser(user.id);
  const metaPilotEnabled = await isMetaChannelPilotEnabledForActorAndAccount(supabase, activeUserId);

  const body = await req.json().catch(() => ({}));
  const input = safeObj(body);
  // The hidden pilot setting may be present in older full-form clients.
  // Preserve it without allowing a USER to activate or erase that setting.

  const { data: current, error: currentError } = await supabase
    .from("pro_tools_configs")
    .select("settings")
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (currentError) return jsonUserFacingError(currentError, { status: 500 });

  const currentSettings = safeObj(current?.settings);
  const hasShareSettings = Object.prototype.hasOwnProperty.call(input, "settings");
  const hasAppointmentSettings = Object.prototype.hasOwnProperty.call(input, "appointmentSettings");
  const hasSelectedMailAccountId = Object.prototype.hasOwnProperty.call(input, "selectedMailAccountId");
  const hasTheme = Object.prototype.hasOwnProperty.call(input, "theme");
  const currentShareSettings = normalizeInrBadgeShareSettings(currentSettings.inrBadgeShareSettings);
  const requestedShareSettings = hasShareSettings
    ? sanitizeInrBadgeShareSettingsPayload(input.settings)
    : currentShareSettings;
  if (!metaPilotEnabled) requestedShareSettings.threads = currentShareSettings.threads;
  const nextShareSettings = isStandardDashboardEdition(dashboardEdition)
    ? { ...requestedShareSettings, appointment: currentShareSettings.appointment }
    : requestedShareSettings;
  const currentAppointmentSettings = resolveInrBadgeAppointmentSettings(currentSettings);
  const nextAppointmentSettings = isStandardDashboardEdition(dashboardEdition)
    ? currentAppointmentSettings
    : hasAppointmentSettings
      ? sanitizeInrBadgeAppointmentSettingsPayload(input.appointmentSettings)
      : currentAppointmentSettings;
  const currentTheme = normalizeInrBadgeThemeSettings(currentSettings.inrBadgeTheme);
  const nextTheme = hasTheme
    ? sanitizeInrBadgeThemeSettingsPayload(input.theme)
    : currentTheme;


  const currentInrCalendar = safeObj(currentSettings.inrcalendar);
  const currentSelectedMailAccountId = typeof currentSettings.inrBadgeMailAccountId === "string"
    ? currentSettings.inrBadgeMailAccountId
    : "";
  const nextSelectedMailAccountId = isStandardDashboardEdition(dashboardEdition)
    ? currentSelectedMailAccountId
    : hasSelectedMailAccountId
      ? String(input.selectedMailAccountId || "").trim()
      : currentSelectedMailAccountId;

  const nextSettings = {
    ...currentSettings,
    inrBadgeShareSettings: nextShareSettings,
    inrBadgeTheme: nextTheme,
    inrBadgeAppointmentSettings: nextAppointmentSettings,
    inrBadgeMailAccountId: nextSelectedMailAccountId,
    inrcalendar: {
      ...currentInrCalendar,
      appointment_settings: nextAppointmentSettings,
    },
  };

  const { error } = await supabase
    .from("pro_tools_configs")
    .upsert({ user_id: activeUserId, settings: nextSettings }, { onConflict: "user_id" });

  if (error) return jsonUserFacingError(error, { status: 500 });

  return NextResponse.json({
    ok: true,
    settings: withoutThreadsData(effectiveInrBadgeShareSettings(nextShareSettings, dashboardEdition), metaPilotEnabled),
    theme: nextTheme,
    appointmentSettings: nextAppointmentSettings,
    selectedMailAccountId: isStandardDashboardEdition(dashboardEdition) ? "" : nextSelectedMailAccountId,
  });
}
