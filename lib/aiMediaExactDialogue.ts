/** Explicit speaker selections are data; never infer them from names or files. */
export type AiMediaExactDialogueTurn = {
  speaker: "ai_voice" | "character" | "provided_voice";
  characterIndex?: 1 | 2 | 3;
  text: string;
};
export const AI_MEDIA_EXACT_DIALOGUE_MAX_TURNS = 12;
export const AI_MEDIA_EXACT_DIALOGUE_MAX_CHARS = 4_000;
export const AI_MEDIA_OFFSCREEN_NARRATOR = "NARRATOR_OFFSCREEN_AI";

export function normalizeAiMediaExactDialogue(value: unknown): AiMediaExactDialogueTurn[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > AI_MEDIA_EXACT_DIALOGUE_MAX_TURNS) {
    throw new TypeError("Ajoutez de 1 à 12 répliques exactes, avec un locuteur pour chacune.");
  }
  let characters = 0;
  const turns = value.map((raw, index): AiMediaExactDialogueTurn => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("Une réplique exacte est invalide.");
    const row = raw as Record<string, unknown>;
    if (Object.keys(row).some(key => !["speaker", "characterIndex", "text"].includes(key)) ||
      typeof row.speaker !== "string" || !["ai_voice", "character", "provided_voice"].includes(row.speaker) || typeof row.text !== "string") {
      throw new TypeError("Chaque réplique doit indiquer son locuteur et son texte exact.");
    }
    if (row.speaker !== "character" ? row.characterIndex !== undefined : ![1, 2, 3].includes(row.characterIndex as number)) {
      throw new TypeError("Choisissez un personnage existant ou la voix IA hors champ pour chaque réplique.");
    }
    const text = row.text.replace(/\r\n?/g, "\n");
    characters += text.length + (index ? 1 : 0);
    if (!text.trim() || characters > AI_MEDIA_EXACT_DIALOGUE_MAX_CHARS || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) {
      throw new TypeError("Les répliques doivent être renseignées et contenir au total 4 000 caractères maximum, sans caractères de contrôle.");
    }
    return row.speaker === "character" ? { speaker: "character", characterIndex: row.characterIndex as 1 | 2 | 3, text }
      : { speaker: row.speaker as "ai_voice" | "provided_voice", text };
  });
  if (turns.some(turn => turn.speaker === "provided_voice") && turns.some(turn => turn.speaker !== "provided_voice")) {
    throw new TypeError("La voix off réelle s’utilise seule pour toutes les répliques. Le mélange avec une voix IA ou des personnages n’est pas pris en charge.");
  }
  return turns;
}

export function aiMediaExactDialogueScript(turns: readonly AiMediaExactDialogueTurn[]): string {
  return turns.map(turn => turn.text).join("\n");
}

export function assertAiMediaExactDialogueBindings(turns: readonly AiMediaExactDialogueTurn[],
  references: readonly { role?: string; characterIndex?: number }[], engine: unknown) {
  const characters = turns.filter(turn => turn.speaker === "character");
  if (characters.length && !["wan27", "kling", "kling-flash"].includes(String(engine))) {
    throw new TypeError("Ce moteur ne prend pas en charge ces locuteurs exacts. Choisissez Wan 2.7 ou Kling pour les personnages.");
  }
  if (characters.length && turns.some(turn => turn.speaker === "ai_voice") && engine !== "kling") {
    throw new TypeError("Le mélange voix IA hors champ et personnages parlants nécessite Kling 4.0. Aucun moteur n’a été changé.");
  }
  for (const turn of characters) {
    if (references.filter(reference => reference.role === "character" && reference.characterIndex === turn.characterIndex).length !== 1) {
      throw new TypeError("Une photo de personnage sélectionnée dans les répliques est absente. Réassociez cette réplique avant de générer.");
    }
  }
}
