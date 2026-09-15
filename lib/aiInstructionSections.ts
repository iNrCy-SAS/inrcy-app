export const AI_INSTRUCTION_SECTION_MAX_LENGTH = 1_200;

const SERIALIZED_PREFIX = "INRCY_AI_INSTRUCTIONS_V2:";

function cleanInstruction(value: unknown) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, AI_INSTRUCTION_SECTION_MAX_LENGTH);
}

export type AiInstructionSections = {
  instructions: string;
  forbiddenInstructions: string;
};

/**
 * Conserve les deux rubriques dans la colonne texte historique, sans migration
 * SQL. Une valeur ancienne non structurée reste une interdiction, conformément
 * au sens historique du champ « Consignes et interdictions ».
 */
export function decodeAiInstructionSections(value: unknown): AiInstructionSections {
  const raw = String(value ?? "").trim();
  if (!raw) return { instructions: "", forbiddenInstructions: "" };

  if (raw.startsWith(SERIALIZED_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(SERIALIZED_PREFIX.length)) as Record<string, unknown>;
      return {
        instructions: cleanInstruction(parsed.instructions),
        forbiddenInstructions: cleanInstruction(parsed.forbiddenInstructions),
      };
    } catch {
      // Une donnée structurée abîmée ne doit pas effacer le texte historique.
    }
  }

  return {
    instructions: "",
    forbiddenInstructions: cleanInstruction(raw),
  };
}

export function encodeAiInstructionSections(
  value: Partial<AiInstructionSections>,
) {
  const normalized = {
    instructions: cleanInstruction(value.instructions),
    forbiddenInstructions: cleanInstruction(value.forbiddenInstructions),
  };
  if (!normalized.instructions) return normalized.forbiddenInstructions;
  return `${SERIALIZED_PREFIX}${JSON.stringify(normalized)}`;
}
