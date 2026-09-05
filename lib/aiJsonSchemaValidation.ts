type JsonSchema = Record<string, unknown>;

export class AiJsonSchemaValidationError extends Error {
  readonly code = "ai_gateway_invalid_output";

  constructor(path: string, reason: string) {
    super(`Sortie JSON structurée invalide à ${path} : ${reason}.`);
    this.name = "AiJsonSchemaValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function schemaAtReference(root: JsonSchema, reference: string): JsonSchema {
  if (!reference.startsWith("#/")) {
    throw new AiJsonSchemaValidationError("$", "référence de schéma non prise en charge");
  }
  let current: unknown = root;
  for (const rawPart of reference.slice(2).split("/")) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    current = isRecord(current) ? current[part] : undefined;
  }
  if (!isRecord(current)) {
    throw new AiJsonSchemaValidationError("$", "référence de schéma introuvable");
  }
  return current;
}

function valueMatchesType(value: unknown, type: string): boolean {
  if (type === "object") return isRecord(value);
  if (type === "array") return Array.isArray(value);
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "null") return value === null;
  return true;
}

function assertNode(value: unknown, schema: JsonSchema, root: JsonSchema, path: string): void {
  if (typeof schema.$ref === "string") {
    assertNode(value, schemaAtReference(root, schema.$ref), root, path);
    return;
  }

  if (Array.isArray(schema.allOf)) {
    for (const candidate of schema.allOf) {
      if (isRecord(candidate)) assertNode(value, candidate, root, path);
    }
  }

  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const candidates = (Array.isArray(schema.oneOf) ? schema.oneOf : schema.anyOf) as unknown[];
    const matches = candidates.filter((candidate) => {
      if (!isRecord(candidate)) return false;
      try {
        assertNode(value, candidate, root, path);
        return true;
      } catch {
        return false;
      }
    }).length;
    const valid = Array.isArray(schema.oneOf) ? matches === 1 : matches >= 1;
    if (!valid) throw new AiJsonSchemaValidationError(path, "aucune forme autorisée ne correspond");
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    throw new AiJsonSchemaValidationError(path, "valeur hors liste autorisée");
  }
  if (Object.prototype.hasOwnProperty.call(schema, "const") && !Object.is(schema.const, value)) {
    throw new AiJsonSchemaValidationError(path, "valeur constante inattendue");
  }

  const expectedTypes = Array.isArray(schema.type)
    ? schema.type.filter((item): item is string => typeof item === "string")
    : typeof schema.type === "string"
      ? [schema.type]
      : [];
  if (expectedTypes.length && !expectedTypes.some((type) => valueMatchesType(value, type))) {
    throw new AiJsonSchemaValidationError(path, `type attendu ${expectedTypes.join(" ou ")}`);
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      throw new AiJsonSchemaValidationError(path, "texte trop court");
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      throw new AiJsonSchemaValidationError(path, "texte trop long");
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      throw new AiJsonSchemaValidationError(path, "format de texte inattendu");
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      throw new AiJsonSchemaValidationError(path, "liste trop courte");
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      throw new AiJsonSchemaValidationError(path, "liste trop longue");
    }
    if (isRecord(schema.items)) {
      value.forEach((item, index) => assertNode(item, schema.items as JsonSchema, root, `${path}[${index}]`));
    }
  }

  if (!isRecord(value)) return;

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : [];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new AiJsonSchemaValidationError(`${path}.${key}`, "champ obligatoire absent");
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        throw new AiJsonSchemaValidationError(`${path}.${key}`, "champ non autorisé");
      }
    }
  }

  for (const [key, childSchema] of Object.entries(properties)) {
    if (!Object.prototype.hasOwnProperty.call(value, key) || !isRecord(childSchema)) continue;
    assertNode(value[key], childSchema, root, `${path}.${key}`);
  }
}

/**
 * Revalide localement une sortie fournisseur, y compris en mode prompt-only.
 * Le schéma envoyé au modèle guide sa réponse ; ce contrôle empêche qu'une
 * réponse incomplète ou mal typée soit acceptée silencieusement.
 */
export function assertAiJsonMatchesSchema(value: unknown, schema: JsonSchema): void {
  if (!isRecord(schema)) throw new AiJsonSchemaValidationError("$", "schéma invalide");
  assertNode(value, schema, schema, "$");
}
