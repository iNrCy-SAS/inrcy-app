import { ACTIVITY_CATALOG } from "./activityCatalog.ts";
import type { ActivitySectorCategory } from "./activitySectors.ts";

export type ActivityJobSearchResult = {
  sectorCategory: ActivitySectorCategory;
  sectorLabel: string;
  job: string;
  jobLabel: string;
};

const JOB_ALIASES: Partial<
  Record<ActivitySectorCategory, Record<string, string[]>>
> = {
  communication: {
    agence_communication: [
      "agence com",
      "communication",
      "agence communication",
    ],
    agence_seo: ["referencement", "référencement", "google ads", "sea"],
    community_manager: [
      "social media manager",
      "réseaux sociaux",
      "reseaux sociaux",
    ],
    createur_sites_internet: [
      "créateur site web",
      "createur site web",
      "webmaster",
    ],
  },
  evenementiel: {
    magicien: [
      "magie",
      "illusionniste",
      "prestidigitateur",
      "close up",
      "close-up",
      "spectacle de magie",
      "animation magie",
      "magicien mariage",
      "magicien anniversaire",
      "magicien entreprise",
    ],
  },
  formation_enseignement: {
    auto_ecole: [
      "école de conduite",
      "ecole de conduite",
      "permis b",
      "conduite accompagnée",
      "conduite accompagnee",
      "conduite supervisée",
      "conduite supervisee",
    ],
    moto_ecole: [
      "permis moto",
      "formation 125",
      "scooter école",
      "scooter ecole",
    ],
    bateau_ecole: ["permis bateau", "permis côtier", "permis cotier"],
    formation_poids_lourd_transport: [
      "permis poids lourd",
      "permis remorque",
      "formation transport",
      "fimo",
      "fco",
    ],
    recuperation_points: [
      "récupération de points",
      "recuperation de points",
      "stage permis",
    ],
    formation_code_route: ["code de la route", "formation code", "examen code"],
  },
  plateformes_numeriques: {
    plateforme_mise_en_relation: [
      "plateforme en ligne",
      "mise en relation",
      "site de mise en relation",
      "intermédiaire en ligne",
      "intermédiation numérique",
      "matching",
      "portail en ligne",
    ],
    mise_en_relation_particuliers_pros: [
      "particuliers professionnels",
      "trouver un professionnel",
      "trouver un pro",
      "plateforme de devis",
      "mise en relation b2c",
    ],
    mise_en_relation_b2b: [
      "plateforme b2b",
      "mise en relation entreprises",
      "partenaires professionnels",
      "réseau d'affaires",
    ],
    mise_en_relation_particuliers: [
      "plateforme c2c",
      "entre particuliers",
      "petites annonces",
    ],
    marketplace_services: [
      "marketplace",
      "place de marché",
      "place de marché de services",
      "prestataires en ligne",
    ],
    annuaire_comparateur: [
      "annuaire professionnel",
      "comparateur",
      "comparateur en ligne",
      "répertoire professionnel",
    ],
    plateforme_reservation: [
      "réservation en ligne",
      "prise de rendez-vous en ligne",
      "booking",
    ],
    plateforme_emploi_talents: [
      "plateforme emploi",
      "plateforme de recrutement",
      "job board",
      "candidats recruteurs",
      "freelance",
    ],
    communaute_reseau: [
      "réseau professionnel",
      "communauté en ligne",
      "réseau social professionnel",
    ],
    logiciel_saas: [
      "saas",
      "logiciel en ligne",
      "service en ligne",
      "application web",
      "application métier",
      "application mobile",
    ],
  },
};

function normalizeSearchText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeToken(value: string) {
  if (value.length > 4 && value.endsWith("s")) return value.slice(0, -1);
  return value;
}

function editDistance(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);

  for (let row = 1; row <= a.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + substitutionCost,
      );
    }
    for (let column = 0; column <= b.length; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[b.length];
}

function tokenMatches(queryToken: string, candidateToken: string) {
  const normalizedQuery = normalizeToken(queryToken);
  const normalizedCandidate = normalizeToken(candidateToken);

  if (
    normalizedCandidate.startsWith(normalizedQuery) ||
    normalizedQuery.startsWith(normalizedCandidate)
  ) {
    return true;
  }

  if (normalizedQuery.length < 4 || normalizedCandidate.length < 4) {
    return false;
  }

  const tolerance =
    Math.max(normalizedQuery.length, normalizedCandidate.length) >= 8 ? 2 : 1;
  return editDistance(normalizedQuery, normalizedCandidate) <= tolerance;
}

function scoreCandidate(query: string, candidate: string) {
  if (!candidate) return null;
  if (candidate === query) return 0;
  if (candidate.startsWith(query)) return 10;

  const candidateTokens = candidate.split(" ").filter(Boolean);
  const queryTokens = query.split(" ").filter(Boolean);

  if (candidateTokens.some((token) => token.startsWith(query))) return 20;
  if (candidate.includes(query)) return 30;

  const allTokensMatch = queryTokens.every((queryToken) =>
    candidateTokens.some((candidateToken) =>
      tokenMatches(queryToken, candidateToken),
    ),
  );

  return allTokensMatch ? 40 : null;
}

export function searchActivityJobs(
  rawQuery: string,
  limit = 8,
): ActivityJobSearchResult[] {
  const query = normalizeSearchText(rawQuery);
  if (!query) return [];

  const ranked: Array<ActivityJobSearchResult & { score: number }> = [];

  for (const [rawSectorCategory, sector] of Object.entries(ACTIVITY_CATALOG)) {
    const sectorCategory = rawSectorCategory as ActivitySectorCategory;
    if (sectorCategory === "autre") continue;

    for (const [job, jobDefinition] of Object.entries(sector.jobs)) {
      const aliases = JOB_ALIASES[sectorCategory]?.[job] ?? [];
      const candidates = [
        { text: jobDefinition.label, bias: 0 },
        ...aliases.map((alias) => ({ text: alias, bias: 4 })),
        { text: job.replace(/_/g, " "), bias: 8 },
        { text: `${jobDefinition.label} ${sector.label}`, bias: 12 },
      ];

      let bestScore: number | null = null;
      for (const candidate of candidates) {
        const score = scoreCandidate(
          query,
          normalizeSearchText(candidate.text),
        );
        if (score === null) continue;
        const weightedScore = score + candidate.bias;
        if (bestScore === null || weightedScore < bestScore) {
          bestScore = weightedScore;
        }
      }

      if (bestScore === null) continue;
      ranked.push({
        sectorCategory,
        sectorLabel: sector.label,
        job,
        jobLabel: jobDefinition.label,
        score: bestScore,
      });
    }
  }

  return ranked
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.jobLabel.localeCompare(b.jobLabel, "fr", { sensitivity: "base" }),
    )
    .slice(0, Math.max(1, limit))
    .map(({ score: _score, ...result }) => result);
}
