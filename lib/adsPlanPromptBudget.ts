import { appendPromptOnlyJsonContract } from "./aiGatewayResponse.ts";

const CONTEXT_PREFIX = "DONNÉES FIABLES DE L’ENTREPRISE :\n";

export const ADS_PLAN_CONTEXT_TOO_LARGE_MESSAGE = "Votre dossier contient trop d’informations indispensables pour cette analyse. Raccourcissez l’objectif de campagne, les consignes personnalisées ou les documents de référence, puis réessayez. Vos informations restent enregistrées.";

export class AdsPlanPromptBudgetError extends Error {
  readonly code = "ads_plan_input_budget_exceeded";

  constructor() {
    super(ADS_PLAN_CONTEXT_TOO_LARGE_MESSAGE);
    this.name = "AdsPlanPromptBudgetError";
  }
}

type PromptContext = Record<string, unknown>;
type RepairContext = { issueCodes: readonly string[]; instructions: string; details: string };

/** The Gateway counts strict schemas separately; prompt-only schemas are text. */
export function adsPlanEffectiveSystemPrompt(args: {
  system: string;
  jsonMode?: "strict" | "prompt-only";
  responseSchema?: { schema: unknown };
}): string {
  if (args.jsonMode !== "prompt-only") return args.system;
  return [
    appendPromptOnlyJsonContract(args.system),
    args.responseSchema
      ? `SCHÉMA JSON OBLIGATOIRE (respecte exactement cette structure) :\n${JSON.stringify(args.responseSchema.schema)}`
      : "",
  ].filter(Boolean).join("\n\n");
}

function parentAtPath(context: PromptContext, path: readonly string[]) {
  let parent = context;
  for (const key of path.slice(0, -1)) {
    const value = parent[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    parent = value as PromptContext;
  }
  return parent;
}

/**
 * Spend only the remaining request budget on optional context. Never trim the
 * human brief, constraints, selected geography, destinations or quality rules.
 * Entries are removed whole: a shortened fact must not change its meaning.
 */
export function buildAdsPlanBudgetedPrompt(args: {
  system: string;
  context: Readonly<PromptContext>;
  maxInputChars: number;
  jsonMode?: "strict" | "prompt-only";
  responseSchema?: { schema: unknown };
  repair?: RepairContext;
}) {
  const systemChars = adsPlanEffectiveSystemPrompt(args).length;
  const repair = args.repair?.issueCodes.length
    ? `\nCONTRÔLE QUALITÉ : la proposition précédente a été refusée pour ${args.repair.issueCodes.join(", ")}. ${args.repair.instructions}\n${args.repair.details}`
    : "";
  const serialize = (context: PromptContext) => `${CONTEXT_PREFIX}${JSON.stringify(context)}${repair}`;
  const context = JSON.parse(JSON.stringify(args.context)) as PromptContext;
  const originalInputChars = serialize(context).length;
  const maximum = Math.max(0, Math.floor(args.maxInputChars));
  const fits = () => systemChars + serialize(context).length <= maximum;
  const removedSections = new Set<string>();

  function remove(path: readonly string[], keepItems = 0) {
    if (fits()) return;
    const parent = parentAtPath(context, path);
    if (!parent) return;
    const key = path[path.length - 1];
    if (!(key in parent)) return;
    const value = parent[key];
    if (Array.isArray(value)) {
      while (!fits() && value.length > keepItems) {
        value.pop();
        removedSections.add(path.join("."));
      }
      if (!value.length) {
        delete parent[key];
        removedSections.add(path.join("."));
      }
    } else if (!fits()) {
      delete parent[key];
      removedSections.add(path.join("."));
    }
  }

  // Past content is only an anti-repetition aid, never evidence for this offer.
  for (const key of ["history", "recentPublications"]) remove([key]);
  for (const key of ["likedExample2", "likedExample"]) remove(["communicationPreferences", key]);
  // References, offer terms, proofs, audiences and campaign dates can be
  // essential to the requested proposal. Keep them whole, even if that means
  // returning an actionable refusal instead of generating without the facts.
  const optionalLists = ["brandPersonality", "values", "preferredVocabulary"];
  for (const key of optionalLists) remove([key], 1);
  for (const key of optionalLists) remove([key]);

  if (!fits()) throw new AdsPlanPromptBudgetError();
  const input = serialize(context);
  return {
    system: args.system,
    input,
    systemChars,
    inputChars: input.length,
    originalInputChars,
    totalChars: systemChars + input.length,
    maxInputChars: maximum,
    compacted: removedSections.size > 0,
    removedSections: [...removedSections],
  };
}
