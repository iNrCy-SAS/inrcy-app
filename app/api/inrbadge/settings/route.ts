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

function safeObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function GET() {
  const { supabase, user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const dashboardEdition = await getDashboardEditionForAuthUser(user.id);

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
    settings: effectiveInrBadgeShareSettings(storedShareSettings, dashboardEdition),
    appointmentSettings: resolveInrBadgeAppointmentSettings(rootSettings),
    selectedMailAccountId: dashboardEdition === "standard"
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

  const body = await req.json().catch(() => ({}));
  const input = safeObj(body);

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
  const currentShareSettings = normalizeInrBadgeShareSettings(currentSettings.inrBadgeShareSettings);
  const requestedShareSettings = hasShareSettings
    ? sanitizeInrBadgeShareSettingsPayload(input.settings)
    : currentShareSettings;
  const nextShareSettings = dashboardEdition === "standard"
    ? { ...requestedShareSettings, appointment: currentShareSettings.appointment }
    : requestedShareSettings;
  const currentAppointmentSettings = resolveInrBadgeAppointmentSettings(currentSettings);
  const nextAppointmentSettings = dashboardEdition === "standard"
    ? currentAppointmentSettings
    : hasAppointmentSettings
      ? sanitizeInrBadgeAppointmentSettingsPayload(input.appointmentSettings)
      : currentAppointmentSettings;


  const currentInrCalendar = safeObj(currentSettings.inrcalendar);
  const currentSelectedMailAccountId = typeof currentSettings.inrBadgeMailAccountId === "string"
    ? currentSettings.inrBadgeMailAccountId
    : "";
  const nextSelectedMailAccountId = dashboardEdition === "standard"
    ? currentSelectedMailAccountId
    : hasSelectedMailAccountId
      ? String(input.selectedMailAccountId || "").trim()
      : currentSelectedMailAccountId;

  const nextSettings = {
    ...currentSettings,
    inrBadgeShareSettings: nextShareSettings,
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
    settings: effectiveInrBadgeShareSettings(nextShareSettings, dashboardEdition),
    appointmentSettings: nextAppointmentSettings,
    selectedMailAccountId: dashboardEdition === "standard" ? "" : nextSelectedMailAccountId,
  });
}
