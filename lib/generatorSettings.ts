import {
  decodeBusinessSector,
  getActivitySectorLabel,
  type ActivitySectorCategory,
} from "./activitySectors.ts";

export type GeneratorBusinessSettings = {
  avgBasket: number;
  conversionRate: number;
};

export type GeneratorRecommendation = GeneratorBusinessSettings & {
  sectorCategory: ActivitySectorCategory;
  sectorLabel: string;
};

const DEFAULT_GENERATOR_SETTINGS: GeneratorBusinessSettings = {
  avgBasket: 250,
  conversionRate: 20,
};

const SECTOR_RECOMMENDATIONS: Record<
  ActivitySectorCategory,
  GeneratorBusinessSettings
> = {
  animalier: { avgBasket: 120, conversionRate: 25 },
  agriculture_producteurs: { avgBasket: 80, conversionRate: 25 },
  architecture_design: { avgBasket: 1800, conversionRate: 15 },
  bois_foret: { avgBasket: 450, conversionRate: 25 },
  energie_habitat: { avgBasket: 6500, conversionRate: 12 },
  funeraire: { avgBasket: 3500, conversionRate: 20 },
  metiers_art: { avgBasket: 180, conversionRate: 25 },
  assurance: { avgBasket: 900, conversionRate: 18 },
  automobile: { avgBasket: 450, conversionRate: 25 },
  beaute_bien_etre: { avgBasket: 75, conversionRate: 35 },
  artisan_btp: { avgBasket: 1800, conversionRate: 20 },
  commerce_boutique: { avgBasket: 65, conversionRate: 30 },
  communication: { avgBasket: 950, conversionRate: 20 },
  education_enfance: { avgBasket: 350, conversionRate: 25 },
  formation_enseignement: { avgBasket: 700, conversionRate: 22 },
  evenementiel: { avgBasket: 1500, conversionRate: 18 },
  exterieur_jardin: { avgBasket: 850, conversionRate: 25 },
  finance: { avgBasket: 1500, conversionRate: 15 },
  hotel_restaurant: { avgBasket: 75, conversionRate: 35 },
  hygiene_habitat: { avgBasket: 350, conversionRate: 28 },
  immobilier: { avgBasket: 4500, conversionRate: 10 },
  industrie: { avgBasket: 4000, conversionRate: 12 },
  juridique: { avgBasket: 1200, conversionRate: 18 },
  loisirs_sport: { avgBasket: 80, conversionRate: 30 },
  medecine_douce: { avgBasket: 70, conversionRate: 35 },
  sante: { avgBasket: 100, conversionRate: 30 },
  securite: { avgBasket: 1800, conversionRate: 18 },
  plateformes_numeriques: { avgBasket: 300, conversionRate: 15 },
  services_entreprises: { avgBasket: 1200, conversionRate: 20 },
  services_particuliers: { avgBasket: 180, conversionRate: 30 },
  transport: { avgBasket: 300, conversionRate: 25 },
  tourisme: { avgBasket: 180, conversionRate: 28 },
  autre: DEFAULT_GENERATOR_SETTINGS,
};

export function getGeneratorRecommendation(
  storedSector?: string | null,
): GeneratorRecommendation {
  const decoded = decodeBusinessSector(storedSector);
  const values =
    SECTOR_RECOMMENDATIONS[decoded.sectorCategory] ||
    DEFAULT_GENERATOR_SETTINGS;
  return {
    ...values,
    sectorCategory: decoded.sectorCategory,
    sectorLabel: getActivitySectorLabel(decoded.sectorCategory),
  };
}

export function sanitizeGeneratorBusinessSettings(
  avgBasket: unknown,
  conversionRate: unknown,
  fallback: GeneratorBusinessSettings = DEFAULT_GENERATOR_SETTINGS,
): GeneratorBusinessSettings {
  const basket = Number(avgBasket);
  const rate = Number(conversionRate);
  return {
    avgBasket:
      Number.isFinite(basket) && basket > 0 ? Math.round(basket * 100) / 100 : fallback.avgBasket,
    conversionRate:
      Number.isFinite(rate) && rate > 0 && rate <= 100
        ? Math.round(rate * 100) / 100
        : fallback.conversionRate,
  };
}

export function estimateGeneratorRevenue(
  opportunities: number,
  settings: GeneratorBusinessSettings,
) {
  const safeOpportunities = Math.max(0, Number(opportunities) || 0);
  return Math.round(
    safeOpportunities * (settings.conversionRate / 100) * settings.avgBasket,
  );
}
