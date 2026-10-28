import { ACTIVITY_CATALOG, findJobValueByLabel, getJobLabel } from "./activityCatalog";
import { decodeBusinessSector } from "./activitySectors";

export function directorySlug(value: unknown) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function resolveDirectoryProfession(rawSector: string) {
  const decoded = decodeBusinessSector(rawSector);
  const sectors = [decoded.sectorCategory, ...Object.keys(ACTIVITY_CATALOG).filter(key => key !== decoded.sectorCategory)];
  for (const sector of sectors) {
    const catalog = ACTIVITY_CATALOG[sector as keyof typeof ACTIVITY_CATALOG];
    const key = Object.prototype.hasOwnProperty.call(catalog.jobs, decoded.profession)
      ? decoded.profession : findJobValueByLabel(sector, decoded.profession);
    if (typeof key === "string" && Object.prototype.hasOwnProperty.call(catalog.jobs, key)) {
      const label = getJobLabel(sector, key);
      return { profession: label, professionSlug: directorySlug(label), sectorCategory: sector, sectorLabel: catalog.label, catalogMatch: true };
    }
  }
  // A custom specialty is kept on its card; it must not create a fictitious catalog entry.
  return { profession: decoded.profession, professionSlug: "autre-metier", sectorCategory: decoded.sectorCategory,
    sectorLabel: ACTIVITY_CATALOG[decoded.sectorCategory].label, catalogMatch: false };
}

export function getDirectoryProfessionFacets(companies: readonly { professionSlug: string }[]) {
  const counts = new Map<string, number>();
  for (const company of companies) counts.set(company.professionSlug, (counts.get(company.professionSlug) || 0) + 1);
  const entries = new Map<string, { slug: string; label: string; count: number; sector: string }>();
  for (const catalog of Object.values(ACTIVITY_CATALOG)) {
    for (const job of Object.values(catalog.jobs)) {
      const slug = directorySlug(job.label);
      if (!entries.has(slug)) entries.set(slug, { slug, label: job.label, count: counts.get(slug) || 0, sector: catalog.label });
    }
  }
  if (counts.has("autre-metier")) entries.set("autre-metier", { slug: "autre-metier", label: "Autre métier", count: counts.get("autre-metier") || 0, sector: "Autre" });
  return [...entries.values()].sort((a, b) => a.sector.localeCompare(b.sector, "fr") || a.label.localeCompare(b.label, "fr"));
}
