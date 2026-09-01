import "server-only";

import { decodeBusinessSector } from "@/lib/activitySectors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type QualityConfig = Record<string, unknown>;

export type InrSearchQualityItem = {
  key: string;
  label: string;
  complete: boolean;
  critical: boolean;
  weight: number;
  help: string;
};

export type InrSearchQualitySnapshot = {
  score: number;
  level: "excellent" | "good" | "incomplete";
  essentialReady: boolean;
  completeCount: number;
  totalCount: number;
  items: InrSearchQualityItem[];
  recommendations: string[];
  checkedAt: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clean(value: unknown, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function hasList(value: unknown) {
  if (Array.isArray(value)) return value.some((item) => clean(item, 180).length > 0);
  return clean(value, 1000).split(/\r?\n|,|;/).some((item) => item.trim().length > 0);
}

function item(
  key: string,
  label: string,
  complete: boolean,
  weight: number,
  help: string,
  critical = false,
): InrSearchQualityItem {
  return { key, label, complete, critical, weight, help };
}

export async function loadInrSearchQuality(
  userId: string,
  configValue: QualityConfig,
): Promise<InrSearchQualitySnapshot> {
  const config = asRecord(configValue);
  const [profileRes, businessRes, mediaRes] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("business_profiles")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("pro_media_library")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("media_type", "image")
      .eq("is_active", true),
  ]);

  const profile = asRecord(profileRes.data);
  const business = asRecord(businessRes.data);
  const decodedSector = decodeBusinessSector(clean(business.sector, 300));
  const description = clean(
    config.pageDescription || business.business_description || business.activity_description,
    1000,
  );
  const companyName = clean(profile.company_legal_name || config.pageTitle, 180);
  const profession = clean(decodedSector.profession, 180);
  const hasContact = Boolean(clean(profile.phone, 80) || clean(profile.contact_email, 180));
  const hasLocation = Boolean(clean(profile.hq_city, 120) || clean(profile.hq_address, 240));
  const hasLogo = Boolean(clean(profile.logo_url, 1000) || clean(profile.logo_path, 600));
  const mediaCount = Number(mediaRes.count || 0);

  const items = [
    item("identity", "Nom de l’entreprise", Boolean(companyName), 10, "Renseignez le nom légal ou commercial dans Mon profil.", true),
    item("title", "Titre public", clean(config.pageTitle, 180).length >= 3, 10, "Ajoutez un titre clair avec le nom de l’entreprise.", true),
    item("description", "Présentation détaillée", description.length >= 80, 15, "Ajoutez au moins 80 caractères pour expliquer clairement l’activité.", true),
    item("profession", "Métier principal", Boolean(profession), 15, "Sélectionnez précisément le métier dans Mon profil.", true),
    item("contact", "Moyen de contact", hasContact, 10, "Ajoutez un téléphone ou un email professionnel.", true),
    item("location", "Localisation", hasLocation, 10, "Ajoutez au minimum la ville ou l’adresse de l’entreprise."),
    item("services", "Prestations", hasList(business.services) || hasList(business.services_text), 10, "Renseignez les principales prestations proposées."),
    item("areas", "Zones d’intervention", hasList(business.intervention_zones) || hasList(business.intervention_zones_text), 5, "Renseignez les villes ou zones desservies."),
    item("hours", "Horaires", Boolean(clean(business.opening_days, 160) || clean(business.opening_hours, 160)), 5, "Ajoutez les jours et horaires d’ouverture."),
    item("logo", "Logo", hasLogo, 5, "Ajoutez le logo de l’entreprise dans Mon profil."),
    item("media", "Photos", mediaCount > 0, 5, "Ajoutez au moins une photo dans la médiathèque."),
  ];

  const score = Math.max(
    0,
    Math.min(100, items.reduce((total, entry) => total + (entry.complete ? entry.weight : 0), 0)),
  );
  const criticalItems = items.filter((entry) => entry.critical);
  const essentialReady = criticalItems.every((entry) => entry.complete);
  const level = score >= 85 && essentialReady
    ? "excellent"
    : score >= 65 && essentialReady
      ? "good"
      : "incomplete";

  return {
    score,
    level,
    essentialReady,
    completeCount: items.filter((entry) => entry.complete).length,
    totalCount: items.length,
    items,
    recommendations: items.filter((entry) => !entry.complete).map((entry) => entry.help).slice(0, 5),
    checkedAt: Date.now(),
  };
}
