import { ACTIVITY_CATALOG, getJobLabel, isValidJobForSector } from "./activityCatalog.ts";
import {
  decodeBusinessSector,
  encodeBusinessSector,
  isActivitySectorCategory,
  type ActivitySectorCategory,
} from "./activitySectors.ts";

export type BusinessDnaProfessionSuggestion = {
  sectorCategory: ActivitySectorCategory;
  job: string;
};

type AnalyzedSource = { status: string; content: string };

function normalizedEvidence(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The model sees IDs and labels, but only a catalogue ID can reach the profile. */
export function buildBusinessDnaProfessionCatalog() {
  return Object.entries(ACTIVITY_CATALOG)
    .filter(([sector]) => sector !== "autre")
    .flatMap(([sector, definition]) =>
      Object.entries(definition.jobs).map(
        ([job, value]) => `${sector}/${job} : ${value.label}`,
      ),
    )
    .join("\n");
}

export function isBusinessDnaProfessionChoice(value: unknown): value is BusinessDnaProfessionSuggestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sectorCategory === "string" &&
    isActivitySectorCategory(candidate.sectorCategory) &&
    candidate.sectorCategory !== "autre" &&
    typeof candidate.job === "string" &&
    isValidJobForSector(candidate.sectorCategory, candidate.job)
  );
}

/** A high-confidence catalogue match still needs a literal quote from an analyzed source. */
export function resolveBusinessDnaProfessionSuggestion(
  value: unknown,
  sources: AnalyzedSource[],
): BusinessDnaProfessionSuggestion | null {
  if (!isBusinessDnaProfessionChoice(value)) return null;
  const candidate = value as unknown as Record<string, unknown>;
  if (candidate.confidence !== "high" || typeof candidate.sourceQuote !== "string") return null;
  const quote = normalizedEvidence(candidate.sourceQuote);
  if (quote.length < 10 || quote.length > 180) return null;
  const isPresent = sources.some(
    (source) => source.status === "analyzed" && normalizedEvidence(source.content).includes(quote),
  );
  return isPresent ? { sectorCategory: value.sectorCategory, job: value.job } : null;
}

export function buildMissingBusinessDnaProfession(
  storedSector: unknown,
  suggestion: unknown,
): string | null {
  if (!isBusinessDnaProfessionChoice(suggestion)) return null;
  if (decodeBusinessSector(typeof storedSector === "string" ? storedSector : "").profession) return null;
  const label = getJobLabel(suggestion.sectorCategory, suggestion.job);
  return label ? encodeBusinessSector(suggestion.sectorCategory, label) : null;
}
