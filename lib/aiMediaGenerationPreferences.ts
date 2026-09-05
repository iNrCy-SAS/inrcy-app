export const AI_MEDIA_GENERATOR_PREFERENCES_VERSION = 1 as const;

export type AiMediaGeneratorPreferenceBlockId = 1 | 2 | 3 | 4 | 5 | 6;

export type AiMediaGeneratorBlockDefaults = {
  1: {
    kind: "image" | "video";
    subjectSource: "profile" | "publication";
  };
  2: {
    typology:
      | "company"
      | "service"
      | "advice"
      | "showcase"
      | "offer"
      | "event"
      | "behind_scenes"
      | "recruitment";
    format: "square" | "portrait" | "story" | "landscape";
  };
  3: {
    visualStyle:
      | "brand"
      | "clean"
      | "premium"
      | "warm"
      | "dynamic"
      | "expert"
      | "local"
      | "colorful";
    creativity: "faithful" | "bold";
    useBrandColors: boolean;
    logoMode: "discreet" | "visible" | "none";
  };
  4: {
    imageStyle: "photo" | "illustration" | "three_d" | "graphic";
    shotType: "auto" | "close" | "medium" | "wide";
  };
  5: {
    peopleMode: "auto" | "none" | "solo" | "team";
    identityMode:
      | "auto"
      | "professional"
      | "brand_avatar"
      | "reference_team";
  };
  6: {
    durationSeconds: 8 | 16 | 24;
    withText: boolean;
    withMusic: boolean;
    withNarration: boolean;
    narrationVoice: "female" | "male";
  };
};

export type AiMediaGeneratorSavedBlock<K extends AiMediaGeneratorPreferenceBlockId> = {
  saved: boolean;
  defaults: AiMediaGeneratorBlockDefaults[K];
};

export type AiMediaGeneratorPreferences = {
  version: typeof AI_MEDIA_GENERATOR_PREFERENCES_VERSION;
  blocks: {
    [K in AiMediaGeneratorPreferenceBlockId]: AiMediaGeneratorSavedBlock<K>;
  };
};

export class AiMediaGeneratorPreferencesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiMediaGeneratorPreferencesValidationError";
  }
}

export class AiMediaGeneratorPreferencesVersionError extends Error {
  readonly storedVersion: number;

  constructor(storedVersion: number) {
    super(
      `La version ${storedVersion} des réglages média est plus récente que la version prise en charge.`,
    );
    this.name = "AiMediaGeneratorPreferencesVersionError";
    this.storedVersion = storedVersion;
  }
}

type AiMediaGeneratorPreferencesPatch =
  | {
      blockId: AiMediaGeneratorPreferenceBlockId;
      saved: true;
      defaults: AiMediaGeneratorBlockDefaults[AiMediaGeneratorPreferenceBlockId];
    }
  | {
      blockId: AiMediaGeneratorPreferenceBlockId;
      saved: false;
      defaults: null;
    };

const BLOCK_IDS = [1, 2, 3, 4, 5, 6] as const;

const DEFAULT_BLOCKS: AiMediaGeneratorPreferences["blocks"] = {
  1: {
    saved: false,
    defaults: { kind: "image", subjectSource: "profile" },
  },
  2: {
    saved: false,
    defaults: { typology: "service", format: "square" },
  },
  3: {
    saved: false,
    defaults: {
      visualStyle: "brand",
      creativity: "faithful",
      useBrandColors: true,
      logoMode: "discreet",
    },
  },
  4: {
    saved: false,
    defaults: { imageStyle: "photo", shotType: "auto" },
  },
  5: {
    saved: false,
    defaults: { peopleMode: "auto", identityMode: "auto" },
  },
  6: {
    saved: false,
    defaults: {
      durationSeconds: 8,
      withText: true,
      withMusic: true,
      withNarration: true,
      narrationVoice: "female",
    },
  },
};

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && allowed.includes(value)
    ? (value as T[number])
    : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function invalidPatch(message: string): never {
  throw new AiMediaGeneratorPreferencesValidationError(message);
}

function requiredObject(
  value: unknown,
  label = "Les réglages du bloc",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidPatch(`${label} doivent être un objet.`);
  }
  return value as Record<string, unknown>;
}

function requiredEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    return invalidPatch(`${label} est invalide.`);
  }
  return value as T[number];
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    return invalidPatch(`${label} est invalide.`);
  }
  return value;
}

function parseStrictBlockDefaults<K extends AiMediaGeneratorPreferenceBlockId>(
  blockId: K,
  value: unknown,
): AiMediaGeneratorBlockDefaults[K] {
  const input = requiredObject(value);

  switch (blockId) {
    case 1: {
      const subjectSource = requiredEnum(
        input.subjectSource,
        ["profile", "publication", "custom"] as const,
        "La source du sujet",
      );
      return {
        kind: requiredEnum(
          input.kind,
          ["image", "video"] as const,
          "Le type de média",
        ),
        // A custom subject is deliberately one-shot and is never persisted.
        subjectSource: subjectSource === "custom" ? "profile" : subjectSource,
      } as AiMediaGeneratorBlockDefaults[K];
    }
    case 2:
      return {
        typology: requiredEnum(
          input.typology,
          [
            "company",
            "service",
            "advice",
            "showcase",
            "offer",
            "event",
            "behind_scenes",
            "recruitment",
          ] as const,
          "La typologie du contenu",
        ),
        format: requiredEnum(
          input.format,
          ["square", "portrait", "story", "landscape"] as const,
          "Le format du contenu",
        ),
      } as AiMediaGeneratorBlockDefaults[K];
    case 3:
      return {
        visualStyle: requiredEnum(
          input.visualStyle,
          [
            "brand",
            "clean",
            "premium",
            "warm",
            "dynamic",
            "expert",
            "local",
            "colorful",
          ] as const,
          "L’univers visuel",
        ),
        creativity: requiredEnum(
          input.creativity,
          ["faithful", "bold"] as const,
          "Le niveau de créativité",
        ),
        useBrandColors: requiredBoolean(
          input.useBrandColors,
          "L’utilisation des couleurs de marque",
        ),
        logoMode: requiredEnum(
          input.logoMode,
          ["discreet", "visible", "none"] as const,
          "La présence du logo",
        ),
      } as AiMediaGeneratorBlockDefaults[K];
    case 4:
      return {
        imageStyle: requiredEnum(
          input.imageStyle,
          ["photo", "illustration", "three_d", "graphic"] as const,
          "Le style de rendu",
        ),
        shotType: requiredEnum(
          input.shotType,
          ["auto", "close", "medium", "wide"] as const,
          "Le cadrage",
        ),
      } as AiMediaGeneratorBlockDefaults[K];
    case 5: {
      const identityMode =
        input.identityMode ?? input.characterMode ?? input.videoCharacterMode;
      const peopleMode = requiredEnum(
          input.peopleMode,
          ["auto", "none", "solo", "team"] as const,
          "La présence de personnes",
        );
      const normalizedIdentityMode = requiredEnum(
          identityMode,
          ["auto", "professional", "brand_avatar", "reference_team"] as const,
          "Le mode d’identité",
        );
      return {
        peopleMode:
          normalizedIdentityMode === "reference_team" ? "team" : peopleMode,
        identityMode: normalizedIdentityMode,
      } as AiMediaGeneratorBlockDefaults[K];
    }
    case 6: {
      if (
        typeof input.durationSeconds !== "number" ||
        ![8, 16, 24].includes(input.durationSeconds)
      ) {
        return invalidPatch("La durée du média est invalide.");
      }
      return {
        durationSeconds: input.durationSeconds as 8 | 16 | 24,
        withText: requiredBoolean(input.withText, "L’option de texte"),
        withMusic: requiredBoolean(input.withMusic, "L’option de musique"),
        withNarration: requiredBoolean(
          input.withNarration,
          "L’option de narration",
        ),
        narrationVoice: requiredEnum(
          input.narrationVoice,
          ["female", "male"] as const,
          "La voix de narration",
        ),
      } as AiMediaGeneratorBlockDefaults[K];
    }
  }
}

export function assertAiMediaGeneratorPreferencesVersionSupported(
  value: unknown,
): void {
  const root = safeObject(value);
  const rawVersion = root.version;
  if (rawVersion === undefined || rawVersion === null) return;

  const storedVersion =
    typeof rawVersion === "number"
      ? rawVersion
      : typeof rawVersion === "string" && rawVersion.trim() !== ""
        ? Number(rawVersion)
        : Number.NaN;

  if (
    Number.isFinite(storedVersion) &&
    storedVersion > AI_MEDIA_GENERATOR_PREFERENCES_VERSION
  ) {
    throw new AiMediaGeneratorPreferencesVersionError(storedVersion);
  }
}

export function sanitizeAiMediaGeneratorBlockDefaults<K extends AiMediaGeneratorPreferenceBlockId>(
  blockId: K,
  value: unknown,
): AiMediaGeneratorBlockDefaults[K] {
  const input = safeObject(value);

  switch (blockId) {
    case 1:
      return {
        kind: enumValue(input.kind, ["image", "video"] as const, "image"),
        // A custom subject is deliberately one-shot and is never persisted.
        subjectSource: enumValue(
          input.subjectSource,
          ["profile", "publication"] as const,
          "profile",
        ),
      } as AiMediaGeneratorBlockDefaults[K];
    case 2:
      return {
        typology: enumValue(
          input.typology,
          [
            "company",
            "service",
            "advice",
            "showcase",
            "offer",
            "event",
            "behind_scenes",
            "recruitment",
          ] as const,
          "service",
        ),
        format: enumValue(
          input.format,
          ["square", "portrait", "story", "landscape"] as const,
          "square",
        ),
      } as AiMediaGeneratorBlockDefaults[K];
    case 3:
      return {
        visualStyle: enumValue(
          input.visualStyle,
          [
            "brand",
            "clean",
            "premium",
            "warm",
            "dynamic",
            "expert",
            "local",
            "colorful",
          ] as const,
          "brand",
        ),
        creativity: enumValue(
          input.creativity,
          ["faithful", "bold"] as const,
          "faithful",
        ),
        useBrandColors: booleanValue(input.useBrandColors, true),
        logoMode: enumValue(
          input.logoMode,
          ["discreet", "visible", "none"] as const,
          "discreet",
        ),
      } as AiMediaGeneratorBlockDefaults[K];
    case 4:
      return {
        imageStyle: enumValue(
          input.imageStyle,
          ["photo", "illustration", "three_d", "graphic"] as const,
          "photo",
        ),
        shotType: enumValue(
          input.shotType,
          ["auto", "close", "medium", "wide"] as const,
          "auto",
        ),
      } as AiMediaGeneratorBlockDefaults[K];
    case 5: {
      const identityMode =
        input.identityMode ?? input.characterMode ?? input.videoCharacterMode;
      const peopleMode = enumValue(
          input.peopleMode,
          ["auto", "none", "solo", "team"] as const,
          "auto",
        );
      const normalizedIdentityMode = enumValue(
          identityMode,
          ["auto", "professional", "brand_avatar", "reference_team"] as const,
          "auto",
        );
      return {
        peopleMode:
          normalizedIdentityMode === "reference_team" ? "team" : peopleMode,
        identityMode: normalizedIdentityMode,
      } as AiMediaGeneratorBlockDefaults[K];
    }
    case 6:
      return {
        durationSeconds: [8, 16, 24].includes(Number(input.durationSeconds))
          ? (Number(input.durationSeconds) as 8 | 16 | 24)
          : 8,
        withText: booleanValue(input.withText, true),
        withMusic: booleanValue(input.withMusic, true),
        withNarration: booleanValue(input.withNarration, true),
        narrationVoice: enumValue(
          input.narrationVoice,
          ["female", "male"] as const,
          "female",
        ),
      } as AiMediaGeneratorBlockDefaults[K];
  }
}

export function normalizeAiMediaGeneratorPreferences(
  value: unknown,
): AiMediaGeneratorPreferences {
  assertAiMediaGeneratorPreferencesVersionSupported(value);
  const root = safeObject(value);
  const storedBlocks = safeObject(root.blocks);
  const blocks = structuredClone(DEFAULT_BLOCKS);

  for (const blockId of BLOCK_IDS) {
    const storedBlock = safeObject(storedBlocks[String(blockId)]);
    if (storedBlock.saved !== true) continue;
    blocks[blockId] = {
      saved: true,
      defaults: sanitizeAiMediaGeneratorBlockDefaults(
        blockId,
        storedBlock.defaults,
      ),
    } as never;
  }

  return {
    version: AI_MEDIA_GENERATOR_PREFERENCES_VERSION,
    blocks,
  };
}

export function parseAiMediaGeneratorPreferencesPatch(
  value: unknown,
): AiMediaGeneratorPreferencesPatch {
  const input = requiredObject(value, "La requête de mémorisation");
  const blockId = input.blockId;
  if (
    typeof blockId !== "number" ||
    !Number.isInteger(blockId) ||
    !BLOCK_IDS.includes(blockId as AiMediaGeneratorPreferenceBlockId)
  ) {
    throw new AiMediaGeneratorPreferencesValidationError(
      "Le bloc de réglages média est invalide.",
    );
  }
  if (typeof input.saved !== "boolean") {
    throw new AiMediaGeneratorPreferencesValidationError(
      "L’état de mémorisation des réglages est invalide.",
    );
  }

  if (!input.saved) {
    return {
      blockId: blockId as AiMediaGeneratorPreferenceBlockId,
      saved: false,
      defaults: null,
    };
  }

  return {
    blockId: blockId as AiMediaGeneratorPreferenceBlockId,
    saved: true,
    defaults: parseStrictBlockDefaults(
      blockId as AiMediaGeneratorPreferenceBlockId,
      input.defaults,
    ),
  };
}

export function patchAiMediaGeneratorPreferences(
  current: unknown,
  patchValue: unknown,
): AiMediaGeneratorPreferences {
  const patch = parseAiMediaGeneratorPreferencesPatch(patchValue);
  const preferences = normalizeAiMediaGeneratorPreferences(current);
  const blockId = patch.blockId;

  preferences.blocks[blockId] = patch.saved
    ? ({
        saved: true,
        defaults: structuredClone(patch.defaults),
      } as never)
    : ({
        saved: false,
        defaults: structuredClone(DEFAULT_BLOCKS[blockId].defaults),
      } as never);

  return preferences;
}

/**
 * Serialize only the allow-listed structured defaults. In particular, this
 * cannot retain uploaded image bytes, identity consent, AI instructions,
 * custom subjects or text-keyword free-form content supplied by a caller.
 */
export function serializeAiMediaGeneratorPreferences(
  value: unknown,
): Record<string, unknown> {
  const normalized = normalizeAiMediaGeneratorPreferences(value);
  const blocks: Record<string, unknown> = {};

  for (const blockId of BLOCK_IDS) {
    const block = normalized.blocks[blockId];
    if (!block.saved) continue;
    blocks[String(blockId)] = {
      saved: true,
      defaults: structuredClone(block.defaults),
    };
  }

  return {
    version: AI_MEDIA_GENERATOR_PREFERENCES_VERSION,
    blocks,
  };
}
