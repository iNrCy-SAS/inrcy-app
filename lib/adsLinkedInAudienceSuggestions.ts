import type { LinkedInCallToAction, LinkedInDeliverySettings, LinkedInProfessionalTarget } from "./adsLinkedInCampaignSettings.ts";

export const LINKEDIN_AUDIENCE_FACET_LABELS = {
  titles: "Intitulés de poste", seniorities: "Niveaux hiérarchiques", companySizes: "Taille de l’entreprise",
  functions: "Fonctions professionnelles", industries: "Secteurs d’activité", skills: "Compétences",
} as const;
export type LinkedInAudienceFacet = keyof typeof LINKEDIN_AUDIENCE_FACET_LABELS;
export type LinkedInAudienceSuggestion = { facet: LinkedInAudienceFacet; terms: string[] };

/** The AI proposes human labels only. Native identifiers always come from LinkedIn. */
export function normalizeLinkedInAudienceSuggestions(value: unknown): LinkedInAudienceSuggestion[] {
  if (!Array.isArray(value)) return [];
  const result = new Map<LinkedInAudienceFacet, Set<string>>();
  for (const entry of value.slice(0, 6)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.facet !== "string" || !Object.hasOwn(LINKEDIN_AUDIENCE_FACET_LABELS, row.facet) || !Array.isArray(row.terms)) continue;
    const facet = row.facet as LinkedInAudienceFacet;
    const terms = result.get(facet) || new Set<string>();
    for (const term of row.terms.slice(0, 8)) {
      if (typeof term === "string" && term.trim().length >= 1 && term.trim().length <= 80 && !/urn:/i.test(term)) terms.add(term.trim());
    }
    if (terms.size) result.set(facet, terms);
  }
  // LinkedIn cannot combine titles with hierarchy/functions in an AND audience.
  if (result.has("titles")) { result.delete("seniorities"); result.delete("functions"); }
  return [...result].map(([facet, terms]) => ({ facet, terms: [...terms].slice(0, 8) }));
}

export function linkedInAudienceLabelKey(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Display-only wording; native labels and targeting identifiers remain unchanged. */
export function linkedInAudienceDisplayName(target: { facet: LinkedInAudienceFacet; name: string; urn?: string }): string {
  if (target.facet === "companySizes" && (target.urn === "urn:li:staffCountRange:(1,1)"
    || ["moi uniquement", "self employed", "self employed only"].includes(linkedInAudienceLabelKey(target.name)))) return "Indépendant";
  return target.name;
}

/** Unique exact matches may be prefilled; ambiguous suggestions remain reviewable. */
export function uniqueLinkedInAudienceMatch<T extends { name: string }>(term: string, targets: readonly T[]): T | null {
  const key = linkedInAudienceLabelKey(term);
  const aliases: Record<string, string[]> = {
    owner: ["proprietaire", "proprietaires"], director: ["directeur", "directeurs"], partner: ["partenaire", "partenaires"],
    proprietaire: ["owner"], proprietaires: ["owner"], pdg: ["cxo", "chief executive officer"],
    directeur: ["director"], directeurs: ["director"], partenaire: ["partner"], partenaires: ["partner"],
    "moi uniquement": ["self employed", "self employed only", "1"], independant: ["self employed", "self employed only"],
    "2 10": ["2 10 employees", "2 10 employes", "2 a 10 employes"], "11 50": ["11 50 employees", "11 50 employes", "11 a 50 employes"],
  };
  const sizeRange = key.match(/^(\d+) (\d+)$/);
  const matches = targets.filter((target) => {
    const targetKey = linkedInAudienceLabelKey(target.name);
    return [key, ...(aliases[key] || [])].includes(targetKey)
      || Boolean(sizeRange && [`${sizeRange[1]} ${sizeRange[2]} employees`, `${sizeRange[1]} ${sizeRange[2]} employes`, `${sizeRange[1]} a ${sizeRange[2]} employes`].includes(targetKey));
  });
  return matches.length === 1 ? matches[0] : null;
}

/** Both manual choices and AI matches use the same native combination rules. */
export function addLinkedInAudienceTarget(current: LinkedInDeliverySettings["professionalTargeting"], target: LinkedInProfessionalTarget, mode: "include" | "exclude") {
  const opposite = mode === "include" ? "exclude" : "include";
  const fail = (error: string) => ({ targeting: current, error });
  if (current[mode].some((item) => item.facet === target.facet && item.urn === target.urn)) return { targeting: current, error: null };
  if (mode === "include" && ((target.facet === "titles" && current.include.some((item) => item.facet === "seniorities" || item.facet === "functions")) || ((target.facet === "seniorities" || target.facet === "functions") && current.include.some((item) => item.facet === "titles")))) return fail("Choisissez soit les intitulés de poste, soit les niveaux hiérarchiques et fonctions. Ces catégories ne peuvent pas être combinées dans LinkedIn.");
  if (current[opposite].some((item) => item.facet === target.facet && item.urn === target.urn)) return fail("Ce critère est déjà utilisé dans la sélection opposée. Retirez-le avant de le déplacer.");
  if (target.facet === "companySizes" && current[opposite].some((item) => item.facet === "companySizes")) return fail("Les tailles d’entreprise doivent être utilisées en inclusion ou en exclusion, selon les règles LinkedIn.");
  if (current.include.length + current.exclude.length >= 100) return fail("Vous avez atteint la limite de 100 critères professionnels.");
  return { targeting: { ...current, [mode]: [...current[mode], target] }, error: null };
}

export function linkedInCallToActionFromLabel(label: string): LinkedInCallToAction {
  const labels: Record<string, LinkedInCallToAction> = {
    "en savoir plus": "LEARN_MORE", "learn more": "LEARN_MORE", "s inscrire": "SIGN_UP", "sign up": "SIGN_UP", "essai gratuit": "SIGN_UP",
    "demander un devis": "VIEW_QUOTE", "demander une demonstration": "REQUEST_DEMO", "telecharger": "DOWNLOAD", "postuler": "APPLY",
    "s abonner": "SUBSCRIBE", "s enregistrer": "REGISTER", "rejoindre": "JOIN", "participer": "ATTEND", "voir plus": "SEE_MORE",
    "acheter": "BUY_NOW", "acheter maintenant": "SHOP_NOW",
  };
  return labels[linkedInAudienceLabelKey(label)] || "LEARN_MORE";
}

export type LinkedInBudgetSuggestion = { type: "daily" | "total"; totalEuros: number | null };
/** A total envelope must be explicit, numeric and valid; it is never turned into a daily budget. */
export function normalizeLinkedInBudgetSuggestion(value: unknown): LinkedInBudgetSuggestion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.type === "daily") return { type: "daily", totalEuros: null };
  const amount = row.totalEuros;
  if (row.type !== "total" || typeof amount !== "number" || !Number.isFinite(amount) || amount < 5 || amount > 45000 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001) return null;
  return { type: "total", totalEuros: amount };
}
