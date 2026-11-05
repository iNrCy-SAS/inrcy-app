import { isMetaChannelPilotEnabledForActorAndAccount } from "@/lib/metaChannelRolloutServer";
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
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function validThemeSnapshot(value: unknown) {
  const raw = safeObj(value), normalized = normalizeInrBadgeThemeSettings(value);
  if (Object.keys(raw).length !== 2 || raw.id !== normalized.id || !Object.hasOwn(raw, "identityColors")) return false;
  if (raw.identityColors === null) return normalized.identityColors === null;
  const colors = safeObj(raw.identityColors);
  return Object.keys(colors).length === 3 && (["primary", "secondary", "accent"] as const).every(key => typeof colors[key] === "string" && /^#[0-9a-f]{6}$/i.test(String(colors[key])) && String(colors[key]).toUpperCase() === normalized.identityColors?.[key]);
}
const themeConflict = () => NextResponse.json({ ok: false, code: "badge_theme_scope_changed", error: "Le compte, la session ou les réglages du Badge ont changé. Relisez-les avant de réessayer." }, { status: 409 });

export async function GET() {
  const { supabase, user, errorResponse, activeUserId, authUserId } = await requireUser();
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
    accountId: activeUserId,
    actorAuthUserId: authUserId,
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
  const { supabase, user, errorResponse, activeUserId, authUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = await req.json().catch(() => ({}));
  const input = safeObj(body);
  const guarded = ["expectedAccountId", "expectedActorUserId", "expectedTheme"].some(key => Object.hasOwn(input, key));
  if (guarded && (typeof input.expectedAccountId !== "string" || !UUID.test(input.expectedAccountId) || typeof input.expectedActorUserId !== "string" || !UUID.test(input.expectedActorUserId) || input.expectedAccountId !== activeUserId || input.expectedActorUserId !== authUserId || !validThemeSnapshot(input.expectedTheme) || !Object.hasOwn(input, "theme") || req.signal.aborted)) return themeConflict();
  const dashboardEdition = await getDashboardEditionForAuthUser(user.id);
  const metaPilotEnabled = await isMetaChannelPilotEnabledForActorAndAccount(supabase, activeUserId);
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
  if (guarded && (req.signal.aborted || JSON.stringify(normalizeInrBadgeThemeSettings(input.expectedTheme)) !== JSON.stringify(currentTheme))) return themeConflict();
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

  if (guarded) {
    if (req.signal.aborted) return themeConflict();
    // Compare the complete JSON value atomically, preserving concurrent writes
    // to every unrelated tool configuration as well as the displayed theme.
    const table = supabase.from("pro_tools_configs");
    const update = current ? table.update({ settings: nextSettings }).eq("user_id", activeUserId) : null;
    const persisted = update && current
      ? await (current.settings === null ? update.is("settings", null) : update.eq("settings", current.settings)).select("user_id").maybeSingle()
      : await table.insert({ user_id: activeUserId, settings: nextSettings }).select("user_id").maybeSingle();
    if (persisted.error) return persisted.error.code === "23505" ? themeConflict() : jsonUserFacingError(persisted.error, { status: 500 });
    if (!persisted.data) return themeConflict();
  } else {
    const { error } = await supabase.from("pro_tools_configs").upsert({ user_id: activeUserId, settings: nextSettings }, { onConflict: "user_id" });
    if (error) return jsonUserFacingError(error, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    accountId: activeUserId,
    actorAuthUserId: authUserId,
    settings: withoutThreadsData(effectiveInrBadgeShareSettings(nextShareSettings, dashboardEdition), metaPilotEnabled),
    theme: nextTheme,
    appointmentSettings: nextAppointmentSettings,
    selectedMailAccountId: isStandardDashboardEdition(dashboardEdition) ? "" : nextSelectedMailAccountId,
  });
}
