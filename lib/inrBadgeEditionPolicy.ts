import {
  hasPremiumDashboardAccess,
  type DashboardEdition,
} from "./dashboardEdition.ts";
import type { InrBadgeShareSettings } from "./inrBadgeSettings.ts";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function effectiveInrBadgeShareSettings(
  settings: InrBadgeShareSettings,
  edition: DashboardEdition,
): InrBadgeShareSettings {
  if (hasPremiumDashboardAccess(edition)) return settings;
  return { ...settings, appointment: false };
}

export function canUseInrBadgeAppointments(
  edition: DashboardEdition,
  settings: InrBadgeShareSettings,
): boolean {
  return hasPremiumDashboardAccess(edition) && settings.appointment === true;
}

export function resolveInrBadgePublicEmail({
  edition,
  profileEmail,
  selectedMailAccountEmail,
}: {
  edition: DashboardEdition;
  profileEmail: unknown;
  selectedMailAccountEmail?: unknown;
}): string {
  const normalizedProfileEmail = clean(profileEmail);
  if (edition === "standard") return normalizedProfileEmail;
  return clean(selectedMailAccountEmail) || normalizedProfileEmail;
}

export function getInrBadgeLeadPresentation(edition: DashboardEdition) {
  if (edition === "standard") {
    return {
      ctaLabel: "Voir mes statistiques",
      ctaPath: "/dashboard/stats",
      emailActionLabel: "Voir iNr’Stats",
      emailFooter:
        "Ce contact est comptabilisé dans vos statistiques iNr’Badge. Ses coordonnées sont reprises dans cet email.",
    } as const;
  }

  return {
    ctaLabel: "Ouvrir le CRM",
    ctaPath: "/dashboard/crm",
    emailActionLabel: "Ouvrir iNr’CRM",
    emailFooter: "Ce contact a aussi été ajouté automatiquement dans votre CRM iNrCy.",
  } as const;
}
