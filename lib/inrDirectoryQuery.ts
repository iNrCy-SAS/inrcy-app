import { listInrDirectoryCompanies, type InrDirectoryCompany } from "@/lib/inrDirectoryPublic";
import { directorySlug, getDirectoryProfessionFacets } from "@/lib/inrDirectoryCatalog";

function facet(companies: InrDirectoryCompany[], key: "city" | "department" | "region" | "sectorLabel") {
  const map = new Map<string, { slug: string; label: string; count: number }>();
  for (const company of companies) {
    const label = company[key];
    const slug = directorySlug(label);
    if (slug) map.set(slug, { slug, label, count: (map.get(slug)?.count || 0) + 1 });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

const normalizeText = (value: unknown) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export async function getInrDirectoryResult(params: URLSearchParams, origin?: string) {
  const allCompanies = await listInrDirectoryCompanies();
  const filters = { q: params.get("q") || "", metier: params.get("metier") || params.get("profession") || "",
    secteur: params.get("secteur") || params.get("sector") || "", ville: params.get("ville") || params.get("city") || "",
    departement: params.get("departement") || params.get("department") || "", region: params.get("region") || "" };
  const query = normalizeText(filters.q);
  const companies = allCompanies.filter(company => (!query || normalizeText([company.companyName, company.profession, company.sectorLabel, company.city, company.department, company.region].join(" ")).includes(query))
    && (!filters.metier || company.professionSlug === directorySlug(filters.metier))
    && (!filters.secteur || company.sectorSlug === directorySlug(filters.secteur))
    && (!filters.ville || company.citySlug === directorySlug(filters.ville))
    && (!filters.departement || company.departmentSlug === directorySlug(filters.departement))
    && (!filters.region || company.regionSlug === directorySlug(filters.region)));
  const integer = (key: string, fallback: number, max: number) => Math.max(1, Math.min(max, Number.parseInt(params.get(key) || "", 10) || fallback));
  const pageSize = integer("pageSize", 12, 48);
  const pages = Math.max(1, Math.ceil(companies.length / pageSize));
  const page = Math.min(pages, integer("page", 1, 10_000));
  const start = (page - 1) * pageSize;
  const items = companies.slice(start, start + pageSize).map(company => origin ? { ...company,
    url: `${origin}/badge/${company.slug}`, qrUrl: `${origin}/api/public/directory/qr/${company.slug}` } : company);
  return { ok: true, items, total: companies.length, page, pageSize, hasNext: page < pages,
    updatedAt: allCompanies.map(company => company.updatedAt || "").sort().at(-1) || null, filters,
    facets: { professions: getDirectoryProfessionFacets(allCompanies), sectors: facet(allCompanies, "sectorLabel"), cities: facet(allCompanies, "city"), departments: facet(allCompanies, "department"), regions: facet(allCompanies, "region") } };
}
