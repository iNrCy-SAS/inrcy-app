import { decodeBusinessSector } from "./activitySectors.ts";

export const DASHBOARD_PROFILE_COMPLETION_FIELDS = [
  "first_name",
  "last_name",
  "phone",
  "contact_email",
  "company_legal_name",
  "hq_zip",
  "hq_city",
] as const;

// Le parcours obligatoire reste volontairement court : secteur et métier.
// Les horaires, prestations, zones, forces et cibles enrichissent désormais
// l'ADN de l'entreprise sans bloquer l'accès à l'application.
export const DASHBOARD_ACTIVITY_COMPLETION_FIELDS = [] as const;

export const DASHBOARD_PROFILE_COMPLETION_SELECT =
  DASHBOARD_PROFILE_COMPLETION_FIELDS.join(",");

export const DASHBOARD_ACTIVITY_COMPLETION_SELECT = ["sector", ...DASHBOARD_ACTIVITY_COMPLETION_FIELDS].join(",");

export type DashboardProfileCompletionField =
  (typeof DASHBOARD_PROFILE_COMPLETION_FIELDS)[number];

export type DashboardActivityCompletionField =
  | (typeof DASHBOARD_ACTIVITY_COMPLETION_FIELDS)[number]
  | "sector_category"
  | "profession";

export type DashboardCompletionSection = "profile" | "activity";

export type DashboardSectionCompletion<Field extends string> = {
  completed: boolean;
  incomplete: boolean;
  missingFields: Field[];
};

export type DashboardRequiredSetupCompletion = {
  profile: DashboardSectionCompletion<DashboardProfileCompletionField>;
  activity: DashboardSectionCompletion<DashboardActivityCompletionField>;
  completed: boolean;
  incomplete: boolean;
  missingSections: DashboardCompletionSection[];
};

function isFilled(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).length > 0;
  return Boolean(value) && String(value).trim().length > 0;
}

export function evaluateDashboardProfileCompletion(
  profile: Record<string, unknown> | null | undefined,
): DashboardSectionCompletion<DashboardProfileCompletionField> {
  const missingFields = DASHBOARD_PROFILE_COMPLETION_FIELDS.filter(
    (field) => !isFilled(profile?.[field]),
  );

  return {
    completed: missingFields.length === 0,
    incomplete: missingFields.length > 0,
    missingFields: [...missingFields],
  };
}

export function evaluateDashboardActivityCompletion(
  business: Record<string, unknown> | null | undefined,
): DashboardSectionCompletion<DashboardActivityCompletionField> {
  const missingFields: DashboardActivityCompletionField[] = [];
  const decodedSector = decodeBusinessSector(String(business?.sector ?? ""));

  if (!decodedSector.sectorCategory) missingFields.push("sector_category");
  if (!decodedSector.profession.trim()) missingFields.push("profession");

  for (const field of DASHBOARD_ACTIVITY_COMPLETION_FIELDS) {
    if (!isFilled(business?.[field])) missingFields.push(field);
  }

  return {
    completed: missingFields.length === 0,
    incomplete: missingFields.length > 0,
    missingFields,
  };
}

export function evaluateDashboardRequiredSetupCompletion(
  profile: Record<string, unknown> | null | undefined,
  business: Record<string, unknown> | null | undefined,
): DashboardRequiredSetupCompletion {
  const profileCompletion = evaluateDashboardProfileCompletion(profile);
  const activityCompletion = evaluateDashboardActivityCompletion(business);
  const missingSections: DashboardCompletionSection[] = [];

  if (profileCompletion.incomplete) missingSections.push("profile");
  if (activityCompletion.incomplete) missingSections.push("activity");

  return {
    profile: profileCompletion,
    activity: activityCompletion,
    completed: missingSections.length === 0,
    incomplete: missingSections.length > 0,
    missingSections,
  };
}
