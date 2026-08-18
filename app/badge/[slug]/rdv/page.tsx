import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { extractInrBadgeUserIdFromSlug } from "@/lib/inrBadge";
import { normalizeInrBadgeShareSettings, resolveInrBadgeAppointmentSettings } from "@/lib/inrBadgeSettings";
import { getInrBadgeTexts, normalizeInrBadgeLanguage } from "@/lib/inrBadgeLanguage";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { canUseInrBadgeAppointments } from "@/lib/inrBadgeEditionPolicy";
import RdvBookingClient from "./RdvBookingClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function getBadgeManifestUrl(slug: string) {
  return `/badge/${encodeURIComponent(slug)}/manifest.webmanifest`;
}

function getBadgeIconUrl(slug: string) {
  return `/badge/${encodeURIComponent(slug)}/icon.png`;
}

function trim(value: unknown) {
  return String(value || "").trim();
}

function safeObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isRejectedAgendaEvent(event: Record<string, unknown>) {
  const meta = safeObj(event.meta);
  return String(meta.status || "").toLowerCase() === "rejected";
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const i18nT = await getTranslations("public");
  const resolvedParams = await params;
  const slug = trim(resolvedParams.slug);
  const iconUrl = getBadgeIconUrl(slug);
  const userId = extractInrBadgeUserIdFromSlug(slug);
  let title = i18nT("prendre_rdv_inr_badge_4997d8db");

  if (userId) {
    const [businessRes, toolsRes] = await Promise.all([
      supabaseAdmin
        .from("business_profiles")
        .select("client_language")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("pro_tools_configs")
        .select("settings")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    const business = (businessRes.data ?? {}) as Record<string, unknown>;
    const rootSettings = safeObj((toolsRes.data as { settings?: unknown } | null)?.settings);
    title = getInrBadgeTexts(normalizeInrBadgeLanguage(business.client_language || rootSettings.inrBadgeLanguage)).rdvMetaTitle;
  }

  return {
    title,
    manifest: getBadgeManifestUrl(slug),
    icons: {
      icon: iconUrl,
      shortcut: iconUrl,
      apple: iconUrl,
    },
  };
}

export default async function InrBadgeRdvPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const slug = trim(resolvedParams.slug);
  const userId = extractInrBadgeUserIdFromSlug(slug);
  if (!userId) notFound();

  const [profileRes, toolsRes, businessRes, dashboardEdition] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("business_profiles")
      .select("client_language")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getDashboardEditionForAccountId(userId),
  ]);

  if (profileRes.error || !profileRes.data) notFound();

  const rootSettings = safeObj((toolsRes.data as { settings?: unknown } | null)?.settings);
  const shareSettings = normalizeInrBadgeShareSettings(rootSettings.inrBadgeShareSettings);
  const appointmentSettings = resolveInrBadgeAppointmentSettings(rootSettings);
  const business = (businessRes.data ?? {}) as Record<string, unknown>;
  const badgeLanguage = normalizeInrBadgeLanguage(business.client_language || rootSettings.inrBadgeLanguage);
  if (!canUseInrBadgeAppointments(dashboardEdition, shareSettings)) notFound();

  const now = new Date();
  const rangeEnd = new Date(now.getTime() + (appointmentSettings.daysAhead + 2) * 24 * 60 * 60 * 1000);
  const { data: events } = await supabaseAdmin
    .from("agenda_events")
    .select("id,title,start_at,end_at,all_day,meta")
    .eq("user_id", userId)
    .lt("start_at", rangeEnd.toISOString())
    .gt("end_at", now.toISOString())
    .order("start_at", { ascending: true })
    .limit(500);

  return (
    <RdvBookingClient
      slug={slug}
      settings={appointmentSettings}
      language={badgeLanguage}
      events={(events || []).filter((event: Record<string, unknown>) => !isRejectedAgendaEvent(event)).map((event: Record<string, unknown>) => ({
        id: String(event.id || ""),
        start: String(event.start_at || ""),
        end: String(event.end_at || ""),
      }))}
    />
  );
}
