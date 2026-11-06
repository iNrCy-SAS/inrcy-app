import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isInrDirectoryEnabled } from "@/lib/inrDirectorySettings";
import { filterEligibleInrDirectoryAccountIds, filterEligibleInrSearchAccountIds } from "@/lib/inrSearchEligibility";
import { createInrBadgeSlug, getInrBadgeBaseUrl, createInrBadgeQrTrackingUrl } from "@/lib/inrBadge";
import { directorySlug, resolveDirectoryProfession } from "@/lib/inrDirectoryCatalog";
import { resolveFrenchGeography } from "@/lib/frenchGeography";
import { resolveProfessionalCompanyNameFromProfile } from "@/lib/professionalBusinessIdentity";
import { getNativeChannelMissingFields } from "@/lib/nativeChannelActivation";
import { applyInrSearchPublicDisplaySettings, normalizeInrSearchSections } from "@/lib/inrSearchDisplaySettings";

export type InrDirectoryCompany = {
  slug: string; url: string; qrUrl: string; companyName: string; pageTitle: string; pageDescription: string;
  city: string; citySlug: string; department: string; departmentSlug: string; region: string; regionSlug: string;
  profession: string; professionSlug: string; sectorCategory: string; sectorLabel: string; sectorSlug: string; updatedAt: string | null;
  services?: string[];
};

const clean = (value: unknown, max = 200) => String(value || "").trim().slice(0, max);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function hasPublishedServiceSection(settings: unknown) {
  const search = record(record(settings).inrSearch);
  return search.enabled === true && typeof search.slug === "string" && Boolean(directorySlug(search.slug))
    && (search.activationVersion !== 1 || (search.activationRequested === true && search.publicationReady !== false))
    && normalizeInrSearchSections(search.sections).services;
}

/** Index only services already visible on an eligible public Search page.
 * Directory consent alone never publishes private ADN or catalogue defaults. */
function publishedServices(profile: Record<string, unknown>, business: Record<string, unknown>, settings: unknown, searchAllowed: boolean): string[] {
  if (!searchAllowed || !hasPublishedServiceSection(settings)) return [];
  const root = record(settings), search = record(root.inrSearch);
  if (search.activationVersion === 1 && getNativeChannelMissingFields(profile, business, root).inr_search.length) return [];
  const raw = Array.isArray(business.services) ? business.services.flatMap(value => typeof value === "string" ? value.split(/\r?\n/) : [])
    : typeof business.services === "string" ? business.services.split(/\r?\n|,|;/) : [];
  const services = [...new Set(raw.map(value => clean(value, 180).replace(/^(?:[-–—•·▪◦*]+|\d+[.)])\s*/u, "")
    .replace(/^(?:et|ou)\s+/iu, "").replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 40);
  const projection = applyInrSearchPublicDisplaySettings({ services }, search, {
    phone: profile.phone, email: profile.contact_email, address: profile.hq_address, zip: profile.hq_zip,
    city: profile.hq_city, country: profile.hq_country, contactName: [clean(profile.first_name), clean(profile.last_name)].filter(Boolean).join(" "),
  });
  return projection.services.filter(Boolean);
}

export const listInrDirectoryCompanies = cache(async (): Promise<InrDirectoryCompany[]> => {
  const configs: { user_id: string; settings: unknown }[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await supabaseAdmin.from("pro_tools_configs").select("user_id,settings").order("user_id").range(offset, offset + 499);
    if (result.error) throw result.error;
    configs.push(...(result.data || []));
    if ((result.data || []).length < 500) break;
  }
  const optedIn = configs.filter(row => isInrDirectoryEnabled(row.settings));
  if (!optedIn.length) return [];
  const eligible = await filterEligibleInrDirectoryAccountIds(optedIn.map(row => row.user_id));
  const ids = optedIn.filter(row => eligible.has(row.user_id)).map(row => row.user_id);
  const configByAccount = new Map(optedIn.map(row => [row.user_id, row.settings]));
  const searchCandidates = ids.filter(id => hasPublishedServiceSection(configByAccount.get(id)));
  // An unavailable secondary channel cannot expose its services, or remove
  // otherwise eligible directory cards. No per-company provider/DB request.
  const searchEligible = searchCandidates.length
    ? await filterEligibleInrSearchAccountIds(searchCandidates).catch(() => new Set<string>())
    : new Set<string>();
  const companies: InrDirectoryCompany[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const [profiles, businesses] = await Promise.all([
      supabaseAdmin.from("profiles").select("user_id,company_legal_name,first_name,last_name,hq_city,hq_zip,hq_address,hq_country,phone,contact_email,updated_at").in("user_id", batch),
      supabaseAdmin.from("business_profiles").select("user_id,sector,services,updated_at").in("user_id", batch).order("updated_at", { ascending: false }),
    ]);
    if (profiles.error) throw profiles.error;
    if (businesses.error) throw businesses.error;
    const byAccount = new Map<string, Record<string, unknown>>();
    for (const business of businesses.data || []) if (!byAccount.has(business.user_id)) byAccount.set(business.user_id, business);
    for (const profile of profiles.data || []) {
      const business = byAccount.get(profile.user_id);
      const companyName = resolveProfessionalCompanyNameFromProfile(profile.company_legal_name);
      const city = clean(profile.hq_city, 120);
      const trade = resolveDirectoryProfession(clean(business?.sector, 300));
      if (!companyName || !city || !trade.profession) continue;
      const settings = record(configByAccount.get(profile.user_id));
      const directory = (settings.inrDirectory || {}) as Record<string, unknown>;
      if (directory.activationVersion === 1 && getNativeChannelMissingFields(profile, business, settings).inr_directory.length) continue;
      const geography = resolveFrenchGeography(profile.hq_zip, city);
      const department = geography?.department || "";
      const region = geography?.region || "";
      const slug = createInrBadgeSlug({ userId: profile.user_id, companyLegalName: companyName, firstName: clean(profile.first_name), lastName: clean(profile.last_name), logoUrl: "", phone: "", contactEmail: "" });
      const url = `${getInrBadgeBaseUrl()}/badge/${slug}`;
      const updated = [clean(profile.updated_at), clean(business?.updated_at)].filter(Boolean).sort().at(-1) || null;
      companies.push({ slug, url, qrUrl: `${getInrBadgeBaseUrl()}/api/public/directory/qr/${slug}`, companyName, pageTitle: companyName,
        pageDescription: `${companyName} — ${trade.profession} à ${city}.`, city, citySlug: directorySlug(city), department,
        departmentSlug: directorySlug(department), region, regionSlug: directorySlug(region),
        profession: trade.profession, professionSlug: trade.professionSlug, sectorCategory: trade.sectorCategory,
        sectorLabel: trade.sectorLabel, sectorSlug: directorySlug(trade.sectorLabel), updatedAt: updated,
        services: publishedServices(profile, business || {}, settings, searchEligible.has(profile.user_id)) });
    }
  }
  return companies.sort((a, b) => a.companyName.localeCompare(b.companyName, "fr"));
});

export function directoryBadgeQrTarget(slug: string, origin = getInrBadgeBaseUrl()) {
  return createInrBadgeQrTrackingUrl(`${origin}/badge/${encodeURIComponent(slug)}`);
}
